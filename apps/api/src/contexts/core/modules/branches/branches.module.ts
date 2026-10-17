import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { newId } from '../../../../platform/ids.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { CoreDb } from '../../db/types.js';
import { branches, userBranches, users } from '../../db/schema.js';
import { writeAudit } from '../audit/audit.js';
import { metaOf } from '../auth/auth.routes.js';

export const BranchSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    staffCount: z.number().int().openapi({ description: 'Số nhân sự đang hoạt động' }),
  })
  .openapi('Branch');

const BranchBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Mã 2–20 ký tự: chữ, số, - hoặc _'),
  name: z.string().trim().min(2).max(150),
  address: z.string().trim().max(255).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ ]{8,20}$/, 'Số điện thoại không hợp lệ')
    .nullable()
    .optional(),
});

const UpdateBranchBody = BranchBody.partial().extend({ isActive: z.boolean().optional() }).strict();

const BranchListQuery = z.object({
  includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }),
});

export function createBranchesService(db: CoreDb) {
  async function withStaffCount(rows: Array<typeof branches.$inferSelect>) {
    if (!rows.length) return [];
    const counts = await db
      .select({ branchId: userBranches.branchId, n: count() })
      .from(userBranches)
      .innerJoin(users, and(eq(users.id, userBranches.userId), eq(users.status, 'ACTIVE')))
      .where(inArray(userBranches.branchId, rows.map((r) => r.id)))
      .groupBy(userBranches.branchId);
    const byId = new Map(counts.map((c) => [c.branchId, c.n]));
    return rows.map(({ createdAt: _c, updatedAt: _u, ...b }) => ({ ...b, staffCount: byId.get(b.id) ?? 0 }));
  }

  /** ADMIN thấy mọi chi nhánh; người khác chỉ thấy chi nhánh được gán. */
  function visible(actor: Principal) {
    if (actor.scope.kind === 'ALL') return undefined;
    return actor.branchIds.length ? inArray(branches.id, actor.branchIds) : sql`1 = 0`;
  }

  async function assertCodeFree(code: string, exceptId: string | null) {
    const [taken] = await db.select({ id: branches.id }).from(branches).where(eq(branches.code, code));
    if (taken && taken.id !== exceptId) throw Errors.conflict('BRANCH_CODE_TAKEN', 'Mã chi nhánh đã tồn tại');
  }

  return {
    /** Cho core/contract — không lọc theo người gọi. */
    async getMany(ids: string[]) {
      if (!ids.length) return [];
      return db
        .select({ id: branches.id, code: branches.code, name: branches.name, isActive: branches.isActive })
        .from(branches)
        .where(inArray(branches.id, ids));
    },

    async listActive() {
      return db
        .select({ id: branches.id, code: branches.code, name: branches.name, isActive: branches.isActive })
        .from(branches)
        .where(eq(branches.isActive, true))
        .orderBy(branches.code);
    },

    async list(actor: Principal, includeInactive: boolean) {
      const rows = await db
        .select()
        .from(branches)
        .where(and(visible(actor), includeInactive ? undefined : eq(branches.isActive, true)))
        .orderBy(asc(branches.name));
      return withStaffCount(rows);
    },

    async get(actor: Principal, id: string) {
      const [row] = await db.select().from(branches).where(and(eq(branches.id, id), visible(actor)));
      if (!row) throw Errors.notFound('chi nhánh');
      return (await withStaffCount([row]))[0]!;
    },

    async create(actor: Principal, input: z.output<typeof BranchBody>, ip: string | null) {
      await assertCodeFree(input.code, null);
      const id = newId();
      const row = { id, code: input.code, name: input.name, address: input.address ?? null, phone: input.phone ?? null };
      await db.transaction(async (tx) => {
        await tx.insert(branches).values(row);
        await writeAudit(tx, { actorId: actor.userId, action: 'branch.created', entityType: 'branch', entityId: id, branchId: id, after: row, ip });
      });
      return this.get(actor, id);
    },

    async update(actor: Principal, id: string, patch: z.output<typeof UpdateBranchBody>, ip: string | null) {
      const [current] = await db.select().from(branches).where(eq(branches.id, id));
      if (!current) throw Errors.notFound('chi nhánh');
      if (patch.code && patch.code !== current.code) await assertCodeFree(patch.code, id);
      if (patch.isActive === false && current.isActive) {
        const [{ n } = { n: 0 }] = await db
          .select({ n: count() })
          .from(userBranches)
          .innerJoin(users, and(eq(users.id, userBranches.userId), eq(users.status, 'ACTIVE')))
          .where(eq(userBranches.branchId, id));
        if (n > 0) {
          throw new AppError(409, 'BRANCH_HAS_STAFF', 'Chi nhánh còn nhân sự đang hoạt động', `Chuyển hoặc khoá ${n} nhân sự trước khi ngừng chi nhánh`);
        }
      }
      await db.transaction(async (tx) => {
        await tx.update(branches).set(patch).where(eq(branches.id, id));
        await writeAudit(tx, { actorId: actor.userId, action: 'branch.updated', entityType: 'branch', entityId: id, branchId: id, before: current, after: patch, ip });
      });
      return this.get(actor, id);
    },
  };
}

export function registerBranchRoutes(route: RouteRegistrar, service: ReturnType<typeof createBranchesService>) {
  route({
    method: 'get',
    path: '/core/branches',
    tags: ['core'],
    summary: 'Danh sách chi nhánh',
    description: 'ADMIN thấy tất cả; người khác chỉ thấy chi nhánh được gán.',
    access: { authenticated: true },
    request: { query: BranchListQuery },
    responses: { 200: { description: 'Chi nhánh', schema: item(z.array(BranchSchema)) } },
    handler: async ({ principal, query }) => ({ data: await service.list(principal, query.includeInactive) }),
  });

  route({
    method: 'get',
    path: '/core/branches/:id',
    tags: ['core'],
    summary: 'Chi tiết chi nhánh',
    access: { authenticated: true },
    request: { params: IdParams },
    responses: { 200: { description: 'Chi nhánh', schema: item(BranchSchema) } },
    handler: async ({ principal, params }) => ({ data: await service.get(principal, params.id) }),
  });

  route({
    method: 'post',
    path: '/core/branches',
    tags: ['core'],
    summary: 'Tạo chi nhánh',
    access: { permission: 'core.branches.manage' },
    request: { body: BranchBody },
    responses: { 201: { description: 'Đã tạo', schema: item(BranchSchema) } },
    errorCodes: ['BRANCH_CODE_TAKEN'],
    handler: async ({ principal, body, req }) => ({ data: await service.create(principal, body, metaOf(req).ip) }),
  });

  route({
    method: 'patch',
    path: '/core/branches/:id',
    tags: ['core'],
    summary: 'Sửa / ngừng hoạt động chi nhánh',
    access: { permission: 'core.branches.manage' },
    request: { params: IdParams, body: UpdateBranchBody },
    responses: { 200: { description: 'Sau khi sửa', schema: item(BranchSchema) } },
    errorCodes: ['BRANCH_CODE_TAKEN', 'BRANCH_HAS_STAFF'],
    handler: async ({ principal, params, body, req }) => ({ data: await service.update(principal, params.id, body, metaOf(req).ip) }),
  });
}
