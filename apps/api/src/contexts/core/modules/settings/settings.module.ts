import { and, eq, inArray } from 'drizzle-orm';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { Mailer } from '../../../../integrations/mailer.js';
import type { Env } from '../../../../platform/env.js';
import type { CoreDb } from '../../db/types.js';
import { branches, settings } from '../../db/schema.js';
import type { SettingDefinition, SettingsReader } from '../../contract/index.js';
import { writeAudit } from '../audit/audit.js';
import { metaOf } from '../auth/auth.routes.js';

const GLOBAL = '';

export function createSettingsService(db: CoreDb, definitions: SettingDefinition[]) {
  const byKey = new Map<string, SettingDefinition>();
  for (const def of definitions) {
    if (byKey.has(def.key)) throw new Error(`Cấu hình bị khai báo trùng: ${def.key}`);
    const ok = def.schema.safeParse(def.defaultValue);
    if (!ok.success) throw new Error(`Giá trị mặc định của ${def.key} không hợp lệ`);
    byKey.set(def.key, def);
  }

  function definition(key: string): SettingDefinition {
    const def = byKey.get(key);
    if (!def) throw Errors.notFound('cấu hình');
    return def;
  }

  /** Giá trị đã lưu không còn hợp lệ (schema đổi) → bỏ qua, dùng mức kế tiếp. */
  function valid<T>(def: SettingDefinition<T>, value: unknown): value is T {
    return def.schema.safeParse(value).success;
  }

  const reader: SettingsReader = {
    async get<T>(def: SettingDefinition<T>, branchId?: string | null): Promise<T> {
      const scopes = branchId && def.branchOverride ? [branchId, GLOBAL] : [GLOBAL];
      const rows = await db
        .select()
        .from(settings)
        .where(and(eq(settings.key, def.key), inArray(settings.branchId, scopes)));
      for (const scope of scopes) {
        const row = rows.find((r) => r.branchId === scope);
        if (row && valid(def, row.value)) return row.value;
      }
      return def.defaultValue;
    },
  };

  return {
    reader,

    async list() {
      const rows = await db.select().from(settings);
      return [...byKey.values()].map((def) => {
        const own = rows.filter((r) => r.key === def.key);
        const global = own.find((r) => r.branchId === GLOBAL);
        return {
          key: def.key,
          app: def.app,
          label: def.label,
          description: def.description,
          input: def.input,
          branchOverride: def.branchOverride,
          defaultValue: def.defaultValue,
          value: global && valid(def, global.value) ? global.value : null,
          branchValues: own
            .filter((r) => r.branchId !== GLOBAL && valid(def, r.value))
            .map((r) => ({ branchId: r.branchId, value: r.value })),
        };
      });
    },

    async set(actor: Principal, key: string, value: unknown, branchId: string | null, ip: string | null) {
      const def = definition(key);
      if (branchId) {
        if (!def.branchOverride) throw new AppError(422, 'SETTING_NOT_PER_BRANCH', 'Cấu hình này không đặt riêng theo chi nhánh');
        const [b] = await db.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId));
        if (!b) throw Errors.validation([{ path: 'body.branchId', message: 'Chi nhánh không tồn tại' }]);
      }
      const parsed = def.schema.safeParse(value);
      if (!parsed.success) {
        throw Errors.validation(parsed.error.issues.map((i) => ({ path: ['body', 'value', ...i.path.map(String)].join('.'), message: i.message })));
      }
      const scope = branchId ?? GLOBAL;
      await db.transaction(async (tx) => {
        const [before] = await tx.select().from(settings).where(and(eq(settings.key, key), eq(settings.branchId, scope)));
        await tx
          .insert(settings)
          .values({ key, branchId: scope, value: parsed.data, updatedBy: actor.userId, updatedAt: new Date() })
          .onDuplicateKeyUpdate({ set: { value: parsed.data, updatedBy: actor.userId, updatedAt: new Date() } });
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'setting.changed',
          entityType: 'setting',
          entityId: branchId ? `${key}@${branchId}` : key,
          branchId,
          before: before?.value ?? null,
          after: parsed.data,
          ip,
        });
      });
    },

    async clear(actor: Principal, key: string, branchId: string | null, ip: string | null) {
      definition(key);
      const scope = branchId ?? GLOBAL;
      await db.transaction(async (tx) => {
        const [before] = await tx.select().from(settings).where(and(eq(settings.key, key), eq(settings.branchId, scope)));
        if (!before) return;
        await tx.delete(settings).where(and(eq(settings.key, key), eq(settings.branchId, scope)));
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'setting.reset',
          entityType: 'setting',
          entityId: branchId ? `${key}@${branchId}` : key,
          branchId,
          before: before.value,
          ip,
        });
      });
    },
  };
}

const SettingSchema = z
  .object({
    key: z.string(),
    app: z.enum(['core', 'crm', 'lms']),
    label: z.string(),
    description: z.string(),
    input: z
      .object({ kind: z.enum(['number', 'boolean', 'text', 'multiselect']) })
      .catchall(z.unknown())
      .openapi({ description: 'Gợi ý ô nhập cho giao diện (đơn vị, min/max, lựa chọn…)' }),
    branchOverride: z.boolean(),
    defaultValue: z.unknown(),
    value: z.unknown().openapi({ description: 'Giá trị chung đã đặt; null = đang dùng mặc định' }),
    branchValues: z.array(z.object({ branchId: z.string(), value: z.unknown() })),
  })
  .openapi('Setting');

const KeyParams = z.object({ key: z.string().max(100) });

export function registerSettingsRoutes(
  route: RouteRegistrar,
  service: ReturnType<typeof createSettingsService>,
  mailer: Mailer,
  env: Pick<Env, 'SMTP_FROM'>,
) {
  route({
    method: 'get',
    path: '/core/settings',
    tags: ['core'],
    summary: 'Danh sách cấu hình hệ thống',
    access: { permission: 'core.settings.manage' },
    responses: { 200: { description: 'Cấu hình', schema: item(z.array(SettingSchema)) } },
    handler: async () => ({ data: await service.list() }),
  });

  route({
    method: 'patch',
    path: '/core/settings/:key',
    tags: ['core'],
    summary: 'Đặt giá trị cấu hình',
    description: 'Có `branchId` → giá trị riêng của chi nhánh (chỉ với cấu hình cho phép).',
    access: { permission: 'core.settings.manage' },
    request: {
      params: KeyParams,
      body: z.object({ value: z.unknown(), branchId: z.string().length(26).nullable().optional() }),
    },
    responses: { 204: { description: 'Đã lưu' } },
    errorCodes: ['SETTING_NOT_PER_BRANCH'],
    async handler({ principal, params, body, req }) {
      await service.set(principal, params.key, body.value, body.branchId ?? null, metaOf(req).ip);
    },
  });

  route({
    method: 'delete',
    path: '/core/settings/:key',
    tags: ['core'],
    summary: 'Xoá giá trị đã đặt (quay về mặc định / giá trị chung)',
    access: { permission: 'core.settings.manage' },
    request: { params: KeyParams, query: z.object({ branchId: z.string().length(26).optional() }) },
    responses: { 204: { description: 'Đã xoá' } },
    async handler({ principal, params, query, req }) {
      await service.clear(principal, params.key, query.branchId ?? null, metaOf(req).ip);
    },
  });

  route({
    method: 'get',
    path: '/core/settings/email',
    tags: ['core'],
    summary: 'Trạng thái email (SMTP)',
    description: 'SMTP cấu hình qua biến môi trường của server để mật khẩu không nằm trong DB.',
    access: { permission: 'core.settings.manage' },
    responses: {
      200: { description: 'Trạng thái', schema: item(z.object({ configured: z.boolean(), from: z.string() })) },
    },
    handler: () => ({ data: { configured: mailer.configured, from: env.SMTP_FROM } }),
  });

  route({
    method: 'post',
    path: '/core/settings/email/test',
    tags: ['core'],
    summary: 'Gửi email thử',
    access: { permission: 'core.settings.manage' },
    request: { body: z.object({ to: z.email() }) },
    responses: { 204: { description: 'Đã gửi' } },
    errorCodes: ['SMTP_NOT_CONFIGURED', 'SMTP_FAILED'],
    async handler({ body }) {
      if (!mailer.configured) throw new AppError(422, 'SMTP_NOT_CONFIGURED', 'Chưa cấu hình SMTP trên server');
      try {
        await mailer.send({ to: body.to, subject: 'Zero1 — Email thử', text: 'Cấu hình email của hệ thống Zero1 hoạt động bình thường.' });
      } catch (err) {
        throw new AppError(502, 'SMTP_FAILED', 'Gửi email thất bại', err instanceof Error ? err.message : undefined);
      }
    },
  });
}
