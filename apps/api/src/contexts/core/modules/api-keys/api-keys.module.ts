import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { toApiInstant } from '../../../../platform/time.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { CoreDb } from '../../db/types.js';
import { apiKeys, branches } from '../../db/schema.js';
import { PERMISSIONS } from '../access/catalog.js';
import type { CorePrincipal } from '../auth/guards.js';

const PERMISSION = 'core.integrations.manage';
/** Key chỉ được cấp quyền nghiệp vụ CRM / LMS — không bao giờ quyền quản trị Core. */
export const API_KEY_PERMISSIONS = PERMISSIONS.filter((p) => p.app !== 'core').map((p) => p.code);
const LAST_USED_THROTTLE_MS = 60_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const base62 = (bytes: Buffer) => bytes.toString('base64url').replace(/[-_]/g, '').slice(0, 32);

/** Key dạng `z1_<8 ký tự>_<32 ký tự>`; tiền tố dùng để tra cứu, phần sau chỉ lưu dạng băm. */
export function parseApiKey(raw: string): { prefix: string; raw: string } | null {
  const m = /^(z1_[A-Za-z0-9]{8})_[A-Za-z0-9]{32}$/.exec(raw.trim());
  return m ? { prefix: m[1]!, raw: raw.trim() } : null;
}

export function createApiKeysService(db: CoreDb) {
  const lastTouched = new Map<string, number>();

  return {
    /** Principal cho request dùng API key; null nếu key không hợp lệ. */
    async authenticate(rawKey: string): Promise<CorePrincipal | null> {
      const parsed = parseApiKey(rawKey);
      if (!parsed) return null;
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.prefix, parsed.prefix));
      if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) return null;
      const a = Buffer.from(row.keyHash, 'hex');
      const b = Buffer.from(sha256(parsed.raw), 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const now = Date.now();
      if (now - (lastTouched.get(row.id) ?? 0) > LAST_USED_THROTTLE_MS) {
        lastTouched.set(row.id, now);
        await db.update(apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(apiKeys.id, row.id));
      }
      const permissions = new Set(row.permissions.filter((p) => API_KEY_PERMISSIONS.includes(p)));
      return {
        userId: row.id,
        role: 'INTEGRATION',
        permissions,
        branchIds: row.branchIds,
        scope: row.branchIds.length ? { kind: 'BRANCHES', branchIds: row.branchIds } : { kind: 'ALL' },
        mustChangePassword: false,
      };
    },

    async list() {
      const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        permissions: r.permissions,
        branchIds: r.branchIds,
        lastUsedAt: r.lastUsedAt ? toApiInstant(r.lastUsedAt) : null,
        expiresAt: r.expiresAt ? toApiInstant(r.expiresAt) : null,
        revokedAt: r.revokedAt ? toApiInstant(r.revokedAt) : null,
        createdAt: toApiInstant(r.createdAt),
      }));
    },

    async create(actor: Principal, input: { name: string; permissions: string[]; branchIds: string[]; expiresAt?: Date | null }) {
      const unknown = input.permissions.filter((p) => !API_KEY_PERMISSIONS.includes(p));
      if (unknown.length) throw Errors.validation([{ path: 'body.permissions', message: `Không cấp được cho API key: ${unknown.join(', ')}` }]);
      if (input.branchIds.length) {
        const found = await db.select({ id: branches.id }).from(branches);
        const missing = input.branchIds.filter((b) => !found.some((f) => f.id === b));
        if (missing.length) throw Errors.validation([{ path: 'body.branchIds', message: 'Chi nhánh không tồn tại' }]);
      }
      if (input.expiresAt && input.expiresAt <= new Date()) throw Errors.validation([{ path: 'body.expiresAt', message: 'Ngày hết hạn phải ở tương lai' }]);
      const prefix = `z1_${base62(randomBytes(12)).slice(0, 8)}`;
      const key = `${prefix}_${base62(randomBytes(32))}`;
      const id = newId();
      await db.insert(apiKeys).values({
        id,
        name: input.name,
        prefix,
        keyHash: sha256(key),
        permissions: [...new Set(input.permissions)],
        branchIds: [...new Set(input.branchIds)],
        expiresAt: input.expiresAt ?? null,
        createdBy: actor.userId,
      });
      return { id, key };
    },

    async revoke(id: string) {
      const [row] = await db.select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt }).from(apiKeys).where(eq(apiKeys.id, id));
      if (!row) throw Errors.notFound('API key');
      if (row.revokedAt) throw new AppError(409, 'API_KEY_REVOKED', 'Key đã bị thu hồi');
      await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    },
  };
}

export type ApiKeysService = ReturnType<typeof createApiKeysService>;

const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string().openapi({ description: 'Phần đầu key để nhận diện' }),
    permissions: z.array(z.string()),
    branchIds: z.array(z.string()).openapi({ description: 'Rỗng = mọi chi nhánh' }),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ApiKey');

export function registerApiKeyRoutes(route: RouteRegistrar, service: ApiKeysService) {
  const manage = { permission: PERMISSION } as const;

  route({
    method: 'get',
    path: '/core/api-keys',
    tags: ['core'],
    summary: 'API key',
    access: manage,
    responses: {
      200: {
        description: 'Danh sách key + quyền cấp được',
        schema: item(z.object({ keys: z.array(ApiKeySchema), grantable: z.array(z.object({ code: z.string(), app: z.string(), description: z.string() })) })),
      },
    },
    handler: async () => ({
      data: {
        keys: await service.list(),
        grantable: PERMISSIONS.filter((p) => API_KEY_PERMISSIONS.includes(p.code)).map((p) => ({ code: p.code, app: p.app, description: p.description })),
      },
    }),
  });

  route({
    method: 'post',
    path: '/core/api-keys',
    tags: ['core'],
    summary: 'Tạo API key',
    description:
      'Key chỉ hiện **một lần** trong phản hồi. Gọi API bằng header `X-Api-Key: <key>` (hoặc `Authorization: Bearer <key>`). ' +
      'Key có đúng các quyền được cấp, trong phạm vi chi nhánh chọn (rỗng = mọi chi nhánh). Không cấp được quyền quản trị Core.',
    access: manage,
    request: {
      body: z.object({
        name: z.string().trim().min(2).max(100),
        permissions: z.array(z.string()).min(1).max(100),
        branchIds: z.array(z.string().length(26)).max(200).default([]),
        expiresAt: z.iso
          .datetime({ offset: true })
          .transform((s) => new Date(s))
          .nullable()
          .optional()
          .openapi({ type: 'string' }),
      }),
    },
    responses: { 201: { description: 'Đã tạo', schema: item(z.object({ id: z.string(), key: z.string() })) } },
    handler: async ({ principal, body }) => ({ data: await service.create(principal, body) }),
  });

  route({
    method: 'post',
    path: '/core/api-keys/:id/revoke',
    tags: ['core'],
    summary: 'Thu hồi API key',
    access: manage,
    request: { params: IdParams },
    responses: { 204: { description: 'Đã thu hồi' } },
    errorCodes: ['API_KEY_REVOKED'],
    async handler({ params }) {
      await service.revoke(params.id);
    },
  });
}
