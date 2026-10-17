import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHttpSender, isPrivateIp, privateAddressError, type HttpSender } from './outbound.js';
import { and, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import type { Logger } from '../../../../platform/logger.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import type { Job } from '../../../../platform/jobs.js';
import { pageMeta, pageOffset } from '../../../../platform/http/list.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { CoreDb } from '../../db/types.js';
import { branches, integrationDeliveries, integrationTargets, users } from '../../db/schema.js';
import { EVENT_LABELS, eventCatalog, TELEGRAM_EVENTS } from './catalog.js';
import { formatTelegram } from './telegram.js';

/** Lần thử thứ n (1-based) thất bại → chờ bao lâu trước lần sau (phút). Hết danh sách → FAILED. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360];
const TIMEOUT_MS = 10_000;
const BATCH = 50;

type Kind = 'WEBHOOK' | 'TELEGRAM';

/** Lỗi Telegram trả về dạng `{ ok: false, description }` — chỉ lấy mô tả. */
function telegramError(res: { status: number; body: string }) {
  try {
    const d = (JSON.parse(res.body) as { description?: unknown }).description;
    if (typeof d === 'string') return `Telegram: ${d}`.slice(0, 300);
  } catch {
    // không phải JSON
  }
  return `Telegram HTTP ${res.status}`;
}
type Target = typeof integrationTargets.$inferSelect;
type Delivery = typeof integrationDeliveries.$inferSelect;

export interface IntegrationsDeps {
  db: CoreDb;
  logger: Logger;
  telegramBotToken?: string;
  allowPrivate: boolean;
  http?: HttpSender;
}

export type { HttpSender } from './outbound.js';

export function createIntegrationsService({ db, logger, telegramBotToken, allowPrivate, http = createHttpSender({ allowPrivate }) }: IntegrationsDeps) {
  async function assertPublicUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw Errors.validation([{ path: 'body.url', message: 'URL không hợp lệ' }]);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw Errors.validation([{ path: 'body.url', message: 'Chỉ nhận http(s)' }]);
    if (allowPrivate) return;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const ips = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((a) => a.address), () => []);
    if (!ips.length) throw new AppError(422, 'WEBHOOK_HOST_UNRESOLVED', 'Không phân giải được tên miền của webhook');
    if (host === 'localhost' || ips.some(isPrivateIp)) throw privateAddressError();
  }

  /** Tin Telegram cần tên chi nhánh / người; Core tự tra (dữ liệu của Core). */
  async function telegramText(envelope: EventEnvelope) {
    const ids = new Set<string>();
    const d = envelope.data as { ownerId?: string | null; teacherId?: string };
    if (d.ownerId) ids.add(d.ownerId);
    if (d.teacherId) ids.add(d.teacherId);
    const [branchRows, userRows] = await Promise.all([
      envelope.branchId ? db.select({ name: branches.name }).from(branches).where(eq(branches.id, envelope.branchId)) : Promise.resolve([]),
      ids.size ? db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, [...ids])) : Promise.resolve([]),
    ]);
    return formatTelegram(envelope, {
      branchName: branchRows[0]?.name ?? null,
      userName: (id) => (id ? (userRows.find((u) => u.id === id)?.fullName ?? null) : null),
    });
  }

  /** Gửi một lần tới một nơi nhận. Trả về kết quả, không ném lỗi. */
  async function send(target: Target, envelope: EventEnvelope, deliveryId: string): Promise<{ ok: boolean; status: number | null; error: string | null; retry: boolean }> {
    try {
      if (target.kind === 'TELEGRAM') {
        if (!telegramBotToken) return { ok: false, status: null, error: 'Chưa cấu hình TELEGRAM_BOT_TOKEN trên máy chủ', retry: false };
        const text = envelope.type === 'core.integration.test' ? `✅ Zero1 đã kết nối nhóm “${target.name}”.` : await telegramText(envelope);
        if (!text) return { ok: true, status: null, error: null, retry: false };
        const res = await http(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: target.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
          timeoutMs: TIMEOUT_MS,
        });
        const ok = res.status >= 200 && res.status < 300;
        return { ok, status: res.status, error: ok ? null : telegramError(res), retry: !ok && (res.status === 429 || res.status >= 500) };
      }
      await assertPublicUrl(target.url!);
      const body = JSON.stringify({
        id: envelope.id,
        type: envelope.type,
        version: envelope.version,
        occurredAt: envelope.occurredAt,
        branchId: envelope.branchId,
        data: envelope.data,
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', target.secret!).update(`${timestamp}.${body}`).digest('hex');
      const res = await http(target.url!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Zero1-Webhooks/1.0',
          'x-zero1-event': envelope.type,
          'x-zero1-delivery': deliveryId,
          'x-zero1-timestamp': timestamp,
          'x-zero1-signature': `sha256=${signature}`,
        },
        body,
        timeoutMs: TIMEOUT_MS,
      });
      const ok = res.status >= 200 && res.status < 300;
      // 4xx (trừ 408 / 429) là lỗi phía nhận cấu hình sai — không thử lại.
      // Không lưu / trả nội dung phản hồi của đích (tránh dùng webhook để đọc dữ liệu nơi khác).
      return { ok, status: res.status, error: ok ? null : `HTTP ${res.status}`, retry: !ok && (res.status >= 500 || res.status === 408 || res.status === 429) };
    } catch (err) {
      const message = err instanceof AppError ? err.title : err instanceof Error ? err.message : String(err);
      return { ok: false, status: null, error: message.slice(0, 500), retry: !(err instanceof AppError) };
    }
  }

  async function attempt(d: Delivery, target: Target, now = new Date()) {
    const r = await send(target, d.payload as EventEnvelope, d.id);
    const attempts = d.attempts + 1;
    const wait = BACKOFF_MINUTES[attempts - 1];
    const status = r.ok ? 'SUCCEEDED' : r.retry && wait !== undefined ? 'PENDING' : 'FAILED';
    await db
      .update(integrationDeliveries)
      .set({
        status,
        attempts,
        lastStatusCode: r.status,
        lastError: r.error,
        deliveredAt: r.ok ? now : null,
        nextAttemptAt: status === 'PENDING' ? new Date(now.getTime() + wait! * 60_000) : d.nextAttemptAt,
      })
      .where(eq(integrationDeliveries.id, d.id));
    return { ...r, status };
  }

  const toDto = (t: Target) => ({
    id: t.id,
    kind: t.kind,
    name: t.name,
    url: t.url,
    chatId: t.chatId,
    /** Chỉ hiện phần đầu khoá ký. */
    secretPreview: t.secret ? `${t.secret.slice(0, 10)}…` : null,
    events: t.events,
    branchIds: t.branchIds,
    isActive: t.isActive,
    createdAt: toApiInstant(t.createdAt),
  });

  function validateEvents(kind: Kind, events: string[]) {
    const known = kind === 'TELEGRAM' ? TELEGRAM_EVENTS : Object.keys(EVENT_LABELS);
    const bad = events.filter((e) => e !== '*' && !known.includes(e));
    if (bad.length) throw Errors.validation([{ path: 'body.events', message: `Sự kiện không hỗ trợ${kind === 'TELEGRAM' ? ' cho Telegram' : ''}: ${bad.join(', ')}` }]);
  }

  async function getTarget(id: string) {
    const [t] = await db.select().from(integrationTargets).where(eq(integrationTargets.id, id));
    if (!t) throw Errors.notFound('nơi nhận');
    return t;
  }

  return {
    telegramConfigured: !!telegramBotToken,

    async overview() {
      const targets = await db.select().from(integrationTargets).orderBy(integrationTargets.kind, integrationTargets.name);
      const stats = targets.length
        ? await db
            .select({ targetId: integrationDeliveries.targetId, status: integrationDeliveries.status, n: count() })
            .from(integrationDeliveries)
            .where(inArray(integrationDeliveries.targetId, targets.map((t) => t.id)))
            .groupBy(integrationDeliveries.targetId, integrationDeliveries.status)
        : [];
      const n = (id: string, status: string) => stats.find((s) => s.targetId === id && s.status === status)?.n ?? 0;
      return {
        telegramConfigured: !!telegramBotToken,
        eventTypes: eventCatalog(),
        targets: targets.map((t) => ({ ...toDto(t), delivered: n(t.id, 'SUCCEEDED'), pending: n(t.id, 'PENDING'), failed: n(t.id, 'FAILED') })),
      };
    },

    async create(actor: Principal, input: { kind: Kind; name: string; url?: string | null; chatId?: string | null; events: string[]; branchIds: string[] }) {
      validateEvents(input.kind, input.events);
      if (input.kind === 'WEBHOOK') {
        if (!input.url) throw Errors.validation([{ path: 'body.url', message: 'Nhập URL nhận webhook' }]);
        await assertPublicUrl(input.url);
      } else if (!input.chatId) throw Errors.validation([{ path: 'body.chatId', message: 'Nhập chat_id của nhóm Telegram' }]);
      const id = newId();
      const secret = input.kind === 'WEBHOOK' ? `whsec_${randomBytes(24).toString('base64url')}` : null;
      await db.insert(integrationTargets).values({
        id,
        kind: input.kind,
        name: input.name,
        url: input.kind === 'WEBHOOK' ? input.url! : null,
        chatId: input.kind === 'TELEGRAM' ? input.chatId! : null,
        secret,
        events: [...new Set(input.events)],
        branchIds: [...new Set(input.branchIds)],
        createdBy: actor.userId,
      });
      return { id, secret };
    },

    async update(id: string, patch: { name?: string; url?: string; chatId?: string; events?: string[]; branchIds?: string[]; isActive?: boolean }) {
      const t = await getTarget(id);
      if (patch.events) validateEvents(t.kind, patch.events);
      if (patch.url && t.kind === 'WEBHOOK') await assertPublicUrl(patch.url);
      await db
        .update(integrationTargets)
        .set({
          name: patch.name,
          url: t.kind === 'WEBHOOK' ? patch.url : undefined,
          chatId: t.kind === 'TELEGRAM' ? patch.chatId : undefined,
          events: patch.events ? [...new Set(patch.events)] : undefined,
          branchIds: patch.branchIds ? [...new Set(patch.branchIds)] : undefined,
          isActive: patch.isActive,
        })
        .where(eq(integrationTargets.id, id));
    },

    async remove(id: string) {
      await getTarget(id);
      await db.delete(integrationDeliveries).where(eq(integrationDeliveries.targetId, id));
      await db.delete(integrationTargets).where(eq(integrationTargets.id, id));
    },

    /** Gửi thử ngay (không qua hàng đợi). */
    async test(id: string) {
      const t = await getTarget(id);
      const envelope: EventEnvelope = {
        id: newId(),
        type: 'core.integration.test',
        version: 1,
        occurredAt: toApiInstant(new Date()),
        source: 'core',
        aggregateId: t.id,
        branchId: null,
        actorId: null,
        data: { message: 'Tin thử từ Zero1' },
      };
      const r = await send(t, envelope, `test-${envelope.id}`);
      return { ok: r.ok, statusCode: r.status, error: r.error };
    },

    async deliveries(q: { targetId?: string; status?: 'PENDING' | 'SUCCEEDED' | 'FAILED'; page: number; pageSize: number }) {
      const where = and(q.targetId ? eq(integrationDeliveries.targetId, q.targetId) : undefined, q.status ? eq(integrationDeliveries.status, q.status) : undefined);
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db.select().from(integrationDeliveries).where(where).orderBy(desc(integrationDeliveries.createdAt)).limit(limit).offset(offset),
        db.select({ n: count() }).from(integrationDeliveries).where(where),
      ]);
      return {
        data: rows.map((d) => ({
          id: d.id,
          targetId: d.targetId,
          eventId: d.eventId,
          eventType: d.eventType,
          eventLabel: EVENT_LABELS[d.eventType] ?? d.eventType,
          status: d.status,
          attempts: d.attempts,
          lastStatusCode: d.lastStatusCode,
          lastError: d.lastError,
          nextAttemptAt: d.status === 'PENDING' ? toApiInstant(d.nextAttemptAt) : null,
          deliveredAt: d.deliveredAt ? toApiInstant(d.deliveredAt) : null,
          createdAt: toApiInstant(d.createdAt),
        })),
        meta: pageMeta(q.page, q.pageSize, total?.n ?? 0),
      };
    },

    /** Gửi lại ngay một lần (thường cho lần gửi đã FAILED). */
    async retry(id: string) {
      const [d] = await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, id));
      if (!d) throw Errors.notFound('lần gửi');
      const t = await getTarget(d.targetId);
      const r = await attempt({ ...d, attempts: 0 }, t);
      return { ok: r.ok, statusCode: r.status, error: r.error };
    },

    /** Mọi sự kiện CRM / LMS / Core → xếp hàng cho nơi nhận phù hợp. */
    subscription(): Subscription {
      return {
        name: 'core.integrations.enqueue',
        type: '*',
        async handle(event: EventEnvelope) {
          const targets = await db.select().from(integrationTargets).where(eq(integrationTargets.isActive, true));
          const matched = targets.filter(
            (t) =>
              (t.events.includes('*') ? t.kind === 'WEBHOOK' || TELEGRAM_EVENTS.includes(event.type) : t.events.includes(event.type)) &&
              (!t.branchIds.length || (event.branchId !== null && t.branchIds.includes(event.branchId))),
          );
          if (!matched.length) return;
          const now = new Date();
          await db
            .insert(integrationDeliveries)
            .values(matched.map((t) => ({ id: newId(), targetId: t.id, eventId: event.id, eventType: event.type, payload: event, nextAttemptAt: now })))
            .onDuplicateKeyUpdate({ set: { id: sql`id` } });
        },
      };
    },

    /** Gửi các lần đến hạn (PENDING). */
    job(): Job {
      return {
        name: 'core.integrations.deliver',
        everyMinutes: 1,
        async run(now) {
          const due = await db
            .select({ d: integrationDeliveries, t: integrationTargets })
            .from(integrationDeliveries)
            .innerJoin(integrationTargets, eq(integrationTargets.id, integrationDeliveries.targetId))
            .where(and(eq(integrationDeliveries.status, 'PENDING'), lte(integrationDeliveries.nextAttemptAt, now), eq(integrationTargets.isActive, true)))
            .orderBy(integrationDeliveries.nextAttemptAt)
            .limit(BATCH);
          for (const { d, t } of due) {
            const r = await attempt(d, t, now);
            if (r.status === 'FAILED') logger.warn({ deliveryId: d.id, target: t.name, error: r.error }, 'Gửi tích hợp thất bại');
          }
          return due.length;
        },
      };
    },
  };
}

export type IntegrationsService = ReturnType<typeof createIntegrationsService>;
