import { and, asc, between, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { pageMeta, pageOffset } from '../../../../platform/http/list.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { can, type Principal } from '../../../../platform/auth/principal.js';
import { daysBetween, toApiInstant, vnDate } from '../../../../platform/time.js';
import type { CoreDb, CoreExecutor } from '../../db/types.js';
import {
  branches,
  outboxEvents,
  processedEvents,
  timekeepingAdjustments,
  timekeepingEntries,
  userBranches,
  users,
} from '../../db/schema.js';
import type { SettingsReader } from '../../contract/index.js';
import { MAX_SHIFT_HOURS } from '../../settings.js';
import { canManageRole } from '../access/catalog.js';
import { writeAudit } from '../audit/audit.js';
import { userVisibility } from '../users/users.service.js';

const eventTables = { outboxEvents, processedEvents };
const MAX_RANGE_DAYS = 62;

type Source = 'WEB' | 'MOBILE' | 'DEVICE' | 'MANUAL';
type EntryRow = typeof timekeepingEntries.$inferSelect;

export interface PunchInput {
  branchId?: string;
  source: Exclude<Source, 'MANUAL'>;
  latitude?: number;
  longitude?: number;
  note?: string;
}

export interface PunchMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AdjustmentInput {
  userId?: string;
  entryId?: string;
  checkInAt: Date;
  checkOutAt: Date;
  reason: string;
}

const ADJUST = 'core.timekeeping.adjust';
const READ = 'core.timekeeping.read';

function assertRange(from: string, to: string) {
  const days = daysBetween(from, to);
  if (days < 0) throw Errors.validation([{ path: 'query.to', message: 'Ngày kết thúc phải sau ngày bắt đầu' }]);
  if (days > MAX_RANGE_DAYS) throw Errors.validation([{ path: 'query.to', message: `Tối đa ${MAX_RANGE_DAYS} ngày mỗi lần xem` }]);
}

export function createTimekeepingService(db: CoreDb, settings: SettingsReader) {
  function toEntry(row: EntryRow, extra?: { fullName?: string | null; branchName?: string | null }) {
    const today = vnDate();
    return {
      id: row.id,
      userId: row.userId,
      userFullName: extra?.fullName ?? null,
      branchId: row.branchId,
      branchName: extra?.branchName ?? null,
      workDate: row.workDate,
      checkInAt: toApiInstant(row.checkInAt),
      checkOutAt: row.checkOutAt ? toApiInstant(row.checkOutAt) : null,
      durationMinutes: row.checkOutAt ? Math.round((row.checkOutAt.getTime() - row.checkInAt.getTime()) / 60_000) : null,
      checkInSource: row.checkInSource,
      checkOutSource: row.checkOutSource,
      status: row.status,
      /** Quên check-out ở ngày trước — cần gửi yêu cầu sửa công. */
      missingCheckout: row.status === 'OPEN' && row.workDate < today,
      note: row.note,
    };
  }

  async function lockUser(tx: CoreExecutor, userId: string) {
    // Khoá dòng user: hai lần bấm check-in cùng lúc không tạo hai lượt.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  }

  async function openToday(tx: CoreExecutor, userId: string) {
    const [row] = await tx
      .select()
      .from(timekeepingEntries)
      .where(and(eq(timekeepingEntries.userId, userId), eq(timekeepingEntries.status, 'OPEN'), eq(timekeepingEntries.workDate, vnDate())));
    return row;
  }

  /** Người duyệt phải thấy được người kia và có cấp cao hơn. */
  async function assertCanReview(actor: Principal, targetUserId: string) {
    if (targetUserId === actor.userId) throw new AppError(403, 'CANNOT_APPROVE_SELF', 'Không tự duyệt công của mình');
    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, targetUserId), userVisibility(actor.scope, actor.userId)));
    if (!target) throw Errors.notFound('nhân sự');
    if (!canManageRole(actor.role, target.role)) throw Errors.forbidden('Không duyệt công cho người cùng hoặc cao cấp hơn');
  }

  async function primaryBranch(userId: string, exec: CoreExecutor = db) {
    const rows = await exec
      .select({ branchId: userBranches.branchId, isPrimary: userBranches.isPrimary })
      .from(userBranches)
      .where(eq(userBranches.userId, userId));
    return (rows.find((r) => r.isPrimary) ?? rows[0])?.branchId ?? null;
  }

  async function applyAdjustment(tx: CoreExecutor, adj: typeof timekeepingAdjustments.$inferSelect) {
    const note = `Sửa công: ${adj.reason}`.slice(0, 255);
    if (adj.entryId) {
      await tx
        .update(timekeepingEntries)
        .set({ workDate: adj.workDate, checkInAt: adj.checkInAt, checkOutAt: adj.checkOutAt, status: 'ADJUSTED', checkOutSource: 'MANUAL', note })
        .where(eq(timekeepingEntries.id, adj.entryId));
    } else {
      await tx.insert(timekeepingEntries).values({
        id: newId(),
        userId: adj.userId,
        branchId: await primaryBranch(adj.userId, tx),
        workDate: adj.workDate,
        checkInAt: adj.checkInAt,
        checkOutAt: adj.checkOutAt,
        checkInSource: 'MANUAL',
        checkOutSource: 'MANUAL',
        status: 'ADJUSTED',
        note,
      });
    }
  }

  async function adjustmentDtos(rows: Array<typeof timekeepingAdjustments.$inferSelect>) {
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.reviewedBy].filter((x): x is string => !!x)))];
    const names = ids.length
      ? new Map((await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.fullName]))
      : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userFullName: names.get(r.userId) ?? null,
      entryId: r.entryId,
      workDate: r.workDate,
      checkInAt: toApiInstant(r.checkInAt),
      checkOutAt: toApiInstant(r.checkOutAt),
      reason: r.reason,
      status: r.status,
      reviewedBy: r.reviewedBy ? { id: r.reviewedBy, fullName: names.get(r.reviewedBy) ?? null } : null,
      reviewedAt: r.reviewedAt ? toApiInstant(r.reviewedAt) : null,
      reviewNote: r.reviewNote,
      createdAt: toApiInstant(r.createdAt),
    }));
  }

  return {
    async status(actor: Principal) {
      const today = vnDate();
      const rows = await db
        .select()
        .from(timekeepingEntries)
        .where(and(eq(timekeepingEntries.userId, actor.userId), eq(timekeepingEntries.workDate, today)))
        .orderBy(asc(timekeepingEntries.checkInAt));
      const [missing] = await db
        .select({ n: count() })
        .from(timekeepingEntries)
        .where(and(eq(timekeepingEntries.userId, actor.userId), eq(timekeepingEntries.status, 'OPEN'), sql`${timekeepingEntries.workDate} < ${today}`));
      const entries = rows.map((r) => toEntry(r));
      return {
        workDate: today,
        current: entries.find((e) => e.status === 'OPEN') ?? null,
        today: entries,
        missingCheckoutCount: missing?.n ?? 0,
      };
    },

    async checkIn(actor: Principal, input: PunchInput, meta: PunchMeta) {
      const branchId = input.branchId ?? (await primaryBranch(actor.userId));
      if (branchId && actor.scope.kind !== 'ALL' && !actor.branchIds.includes(branchId)) {
        throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chỉ chấm công tại chi nhánh được gán');
      }
      const id = newId();
      const now = new Date();
      await db.transaction(async (tx) => {
        await lockUser(tx, actor.userId);
        if (await openToday(tx, actor.userId)) throw Errors.conflict('ALREADY_CHECKED_IN', 'Bạn đã check-in, hãy check-out trước');
        await tx.insert(timekeepingEntries).values({
          id,
          userId: actor.userId,
          branchId,
          workDate: vnDate(now),
          checkInAt: now,
          checkInSource: input.source,
          checkInMeta: { ...meta, latitude: input.latitude ?? null, longitude: input.longitude ?? null },
          status: 'OPEN',
          note: input.note ?? null,
        });
        await appendEvent(tx, eventTables, {
          type: 'core.timekeeping.checked_in',
          aggregateId: id,
          branchId,
          actorId: actor.userId,
          data: { entryId: id, userId: actor.userId, branchId, at: toApiInstant(now), source: input.source },
        });
      });
      const [row] = await db.select().from(timekeepingEntries).where(eq(timekeepingEntries.id, id));
      return toEntry(row!);
    },

    async checkOut(actor: Principal, input: Omit<PunchInput, 'branchId'>, meta: PunchMeta) {
      const now = new Date();
      const id = await db.transaction(async (tx) => {
        await lockUser(tx, actor.userId);
        const open = await openToday(tx, actor.userId);
        if (!open) throw Errors.conflict('NOT_CHECKED_IN', 'Bạn chưa check-in hôm nay');
        await tx
          .update(timekeepingEntries)
          .set({
            checkOutAt: now,
            checkOutSource: input.source,
            checkOutMeta: { ...meta, latitude: input.latitude ?? null, longitude: input.longitude ?? null },
            status: 'CLOSED',
            ...(input.note ? { note: input.note } : {}),
          })
          .where(eq(timekeepingEntries.id, open.id));
        await appendEvent(tx, eventTables, {
          type: 'core.timekeeping.checked_out',
          aggregateId: open.id,
          branchId: open.branchId,
          actorId: actor.userId,
          data: { entryId: open.id, userId: actor.userId, branchId: open.branchId, at: toApiInstant(now), source: input.source },
        });
        return open.id;
      });
      const [row] = await db.select().from(timekeepingEntries).where(eq(timekeepingEntries.id, id));
      return toEntry(row!);
    },

    async listEntries(actor: Principal, q: { from: string; to: string; userId?: string; branchId?: string; page: number; pageSize: number }) {
      assertRange(q.from, q.to);
      const othersAllowed = can(actor, READ);
      if (!othersAllowed && q.userId && q.userId !== actor.userId) throw Errors.forbidden('Chỉ xem được công của bản thân');
      const userId = othersAllowed ? q.userId : actor.userId;

      const where = and(
        between(timekeepingEntries.workDate, q.from, q.to),
        userId ? eq(timekeepingEntries.userId, userId) : undefined,
        q.branchId ? eq(timekeepingEntries.branchId, q.branchId) : undefined,
        othersAllowed ? userVisibility(actor.scope, actor.userId) : undefined,
      );
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db
          .select({ entry: timekeepingEntries, fullName: users.fullName, branchName: branches.name })
          .from(timekeepingEntries)
          .innerJoin(users, eq(users.id, timekeepingEntries.userId))
          .leftJoin(branches, eq(branches.id, timekeepingEntries.branchId))
          .where(where)
          .orderBy(desc(timekeepingEntries.workDate), desc(timekeepingEntries.checkInAt))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(timekeepingEntries).innerJoin(users, eq(users.id, timekeepingEntries.userId)).where(where),
      ]);
      return {
        data: rows.map((r) => toEntry(r.entry, { fullName: r.fullName, branchName: r.branchName })),
        meta: pageMeta(q.page, q.pageSize, total?.n ?? 0),
      };
    },

    async summary(actor: Principal, q: { from: string; to: string; branchId?: string }) {
      assertRange(q.from, q.to);
      const today = vnDate();
      const rows = await db
        .select({
          userId: users.id,
          fullName: users.fullName,
          role: users.role,
          workDays: sql<number>`COUNT(DISTINCT ${timekeepingEntries.workDate})`.mapWith(Number),
          totalMinutes: sql<number>`COALESCE(SUM(CASE WHEN ${timekeepingEntries.checkOutAt} IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, ${timekeepingEntries.checkInAt}, ${timekeepingEntries.checkOutAt}) ELSE 0 END), 0)`.mapWith(Number),
          missingCheckouts: sql<number>`COALESCE(SUM(CASE WHEN ${timekeepingEntries.status} = 'OPEN' AND ${timekeepingEntries.workDate} < ${today} THEN 1 ELSE 0 END), 0)`.mapWith(Number),
          adjustedEntries: sql<number>`COALESCE(SUM(CASE WHEN ${timekeepingEntries.status} = 'ADJUSTED' THEN 1 ELSE 0 END), 0)`.mapWith(Number),
        })
        .from(timekeepingEntries)
        .innerJoin(users, eq(users.id, timekeepingEntries.userId))
        .where(
          and(
            between(timekeepingEntries.workDate, q.from, q.to),
            q.branchId ? eq(timekeepingEntries.branchId, q.branchId) : undefined,
            userVisibility(actor.scope, actor.userId),
          ),
        )
        .groupBy(users.id, users.fullName, users.role)
        .orderBy(asc(users.fullName));
      return rows;
    },

    async createAdjustment(actor: Principal, input: AdjustmentInput, ip: string | null) {
      const userId = input.userId ?? actor.userId;
      const forOther = userId !== actor.userId;
      if (forOther) {
        if (!can(actor, ADJUST)) throw Errors.forbidden('Chỉ quản lý được sửa công cho người khác');
        await assertCanReview(actor, userId);
      }

      const maxHours = await settings.get(MAX_SHIFT_HOURS);
      const minutes = (input.checkOutAt.getTime() - input.checkInAt.getTime()) / 60_000;
      if (minutes <= 0) throw Errors.validation([{ path: 'body.checkOutAt', message: 'Giờ ra phải sau giờ vào' }]);
      if (minutes > maxHours * 60) {
        throw Errors.validation([{ path: 'body.checkOutAt', message: `Một lần chấm công tối đa ${maxHours} giờ` }]);
      }
      if (input.checkOutAt.getTime() > Date.now()) {
        throw Errors.validation([{ path: 'body.checkOutAt', message: 'Không sửa công cho thời điểm trong tương lai' }]);
      }
      const workDate = vnDate(input.checkInAt);

      if (input.entryId) {
        const [entry] = await db.select().from(timekeepingEntries).where(eq(timekeepingEntries.id, input.entryId));
        if (!entry || entry.userId !== userId) throw Errors.validation([{ path: 'body.entryId', message: 'Lượt chấm công không thuộc nhân sự này' }]);
      }

      const id = newId();
      await db.transaction(async (tx) => {
        const row = {
          id,
          userId,
          entryId: input.entryId ?? null,
          workDate,
          checkInAt: input.checkInAt,
          checkOutAt: input.checkOutAt,
          reason: input.reason,
          requestedBy: actor.userId,
          // Quản lý sửa công cho cấp dưới → có hiệu lực ngay.
          status: forOther ? ('APPROVED' as const) : ('PENDING' as const),
          reviewedBy: forOther ? actor.userId : null,
          reviewedAt: forOther ? new Date() : null,
        };
        await tx.insert(timekeepingAdjustments).values(row);
        if (forOther) await applyAdjustment(tx, { ...row, reviewNote: null, createdAt: new Date(), updatedAt: new Date() });
        await writeAudit(tx, {
          actorId: actor.userId,
          action: forOther ? 'timekeeping.adjusted' : 'timekeeping.adjustment_requested',
          entityType: 'timekeeping_adjustment',
          entityId: id,
          after: row,
          ip,
        });
      });
      const [row] = await db.select().from(timekeepingAdjustments).where(eq(timekeepingAdjustments.id, id));
      return (await adjustmentDtos([row!]))[0]!;
    },

    async listAdjustments(actor: Principal, q: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; view: 'mine' | 'review'; page: number; pageSize: number }) {
      if (q.view === 'review' && !can(actor, ADJUST)) throw Errors.forbidden('Cần quyền duyệt công');
      const where = and(
        q.status ? eq(timekeepingAdjustments.status, q.status) : undefined,
        q.view === 'mine'
          ? eq(timekeepingAdjustments.userId, actor.userId)
          : and(sql`${timekeepingAdjustments.userId} <> ${actor.userId}`, userVisibility(actor.scope, actor.userId)),
      );
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db
          .select({ adj: timekeepingAdjustments })
          .from(timekeepingAdjustments)
          .innerJoin(users, eq(users.id, timekeepingAdjustments.userId))
          .where(where)
          .orderBy(desc(timekeepingAdjustments.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(timekeepingAdjustments).innerJoin(users, eq(users.id, timekeepingAdjustments.userId)).where(where),
      ]);
      return { data: await adjustmentDtos(rows.map((r) => r.adj)), meta: pageMeta(q.page, q.pageSize, total?.n ?? 0) };
    },

    async review(actor: Principal, id: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, ip: string | null) {
      const [adj] = await db.select().from(timekeepingAdjustments).where(eq(timekeepingAdjustments.id, id));
      if (!adj) throw Errors.notFound('yêu cầu sửa công');
      await assertCanReview(actor, adj.userId);

      await db.transaction(async (tx) => {
        const [res] = await tx
          .update(timekeepingAdjustments)
          .set({
            status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            reviewedBy: actor.userId,
            reviewedAt: new Date(),
            reviewNote: note ?? null,
          })
          .where(and(eq(timekeepingAdjustments.id, id), eq(timekeepingAdjustments.status, 'PENDING')));
        if (res.affectedRows !== 1) throw Errors.conflict('ADJUSTMENT_ALREADY_REVIEWED', 'Yêu cầu đã được xử lý');
        if (decision === 'APPROVE') await applyAdjustment(tx, adj);
        await writeAudit(tx, {
          actorId: actor.userId,
          action: decision === 'APPROVE' ? 'timekeeping.adjustment_approved' : 'timekeeping.adjustment_rejected',
          entityType: 'timekeeping_adjustment',
          entityId: id,
          after: { note },
          ip,
        });
      });
      const [row] = await db.select().from(timekeepingAdjustments).where(eq(timekeepingAdjustments.id, id));
      return (await adjustmentDtos([row!]))[0]!;
    },
  };
}

export type TimekeepingService = ReturnType<typeof createTimekeepingService>;

