import { and, asc, count, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { csvList, likeContains, pageMeta, pageOffset, parseSort } from '../../../../platform/http/list.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import type { DataScope, Principal } from '../../../../platform/auth/principal.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { Logger } from '../../../../platform/logger.js';
import type { Mailer } from '../../../../integrations/mailer.js';
import type { CoreDb, CoreExecutor } from '../../db/types.js';
import { branches, outboxEvents, processedEvents, roles, userBranches, users } from '../../db/schema.js';
import { canManageRole, isRoleCode, roleDef } from '../access/catalog.js';
import { writeAudit } from '../audit/audit.js';
import { generateTempPassword, hashPassword } from '../auth/password.js';
import { subordinateIds } from './hierarchy.js';

const eventTables = { outboxEvents, processedEvents };

type UserRow = typeof users.$inferSelect;

export interface ListUsersQuery {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  role?: string;
  status?: 'ACTIVE' | 'LOCKED';
  branchId?: string;
  managerId?: string;
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  phone?: string | null;
  role: string;
  branchIds: string[];
  managerId?: string | null;
  password?: string;
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'password'>> & { status?: 'ACTIVE' | 'LOCKED' };

interface Deps {
  db: CoreDb;
  mailer: Mailer;
  logger: Logger;
  revokeSessions: (userId: string) => Promise<void>;
}

/** Điều kiện "người gọi được thấy user này" theo phạm vi dữ liệu. */
export function userVisibility(scope: DataScope, selfId: string): SQL | undefined {
  switch (scope.kind) {
    case 'ALL':
      return undefined;
    case 'BRANCHES':
      return scope.branchIds.length
        ? inArray(users.id, sql`(SELECT ${userBranches.userId} FROM ${userBranches} WHERE ${inArray(userBranches.branchId, scope.branchIds)})`)
        : eq(users.id, selfId);
    case 'TEAM':
      return inArray(users.id, scope.userIds);
    case 'OWN':
    case 'TEACHING':
      return eq(users.id, selfId);
  }
}

const roleNotAllowed = (role: string) =>
  new AppError(403, 'ROLE_NOT_ALLOWED', 'Không được quản lý tài khoản ở vai trò này', `Vai trò ${role}`);

export function createUsersService({ db, mailer, logger, revokeSessions }: Deps) {
  async function toDtos(rows: UserRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const managerIds = [...new Set(rows.map((r) => r.managerId).filter((x): x is string => !!x))];
    const [branchRows, managerRows, roleRows] = await Promise.all([
      db
        .select({ userId: userBranches.userId, id: branches.id, code: branches.code, name: branches.name, isPrimary: userBranches.isPrimary })
        .from(userBranches)
        .innerJoin(branches, eq(branches.id, userBranches.branchId))
        .where(inArray(userBranches.userId, ids))
        .orderBy(asc(branches.name)),
      managerIds.length
        ? db.select({ id: users.id, fullName: users.fullName, role: users.role }).from(users).where(inArray(users.id, managerIds))
        : Promise.resolve([]),
      db.select({ code: roles.code, name: roles.name }).from(roles),
    ]);
    const roleName = new Map(roleRows.map((r) => [r.code, r.name]));
    const managers = new Map(managerRows.map((m) => [m.id, m]));

    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      role: u.role,
      roleName: roleName.get(u.role) ?? u.role,
      team: roleDef(u.role)?.team ?? 'MANAGEMENT',
      status: u.status,
      manager: u.managerId ? (managers.get(u.managerId) ?? null) : null,
      branches: branchRows
        .filter((b) => b.userId === u.id)
        .map(({ userId: _u, ...b }) => b)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt ? toApiInstant(u.lastLoginAt) : null,
      createdAt: toApiInstant(u.createdAt),
      version: u.version,
    }));
  }

  /** Lấy user trong phạm vi người gọi; ngoài phạm vi → 404 (không tiết lộ sự tồn tại). */
  async function getVisible(actor: Principal, id: string, exec: CoreExecutor = db): Promise<UserRow> {
    const [row] = await exec
      .select()
      .from(users)
      .where(and(eq(users.id, id), userVisibility(actor.scope, actor.userId)));
    if (!row) throw Errors.notFound('nhân sự');
    return row;
  }

  async function assertBranches(actor: Principal, role: string, branchIds: string[], exec: CoreExecutor) {
    if (!branchIds.length) {
      if (role === 'ADMIN') return;
      throw Errors.validation([{ path: 'body.branchIds', message: 'Cần ít nhất một chi nhánh' }]);
    }
    const found = await exec
      .select({ id: branches.id, isActive: branches.isActive })
      .from(branches)
      .where(inArray(branches.id, branchIds));
    if (found.length !== new Set(branchIds).size || found.some((b) => !b.isActive)) {
      throw Errors.validation([{ path: 'body.branchIds', message: 'Chi nhánh không tồn tại hoặc đã ngừng hoạt động' }]);
    }
    if (actor.scope.kind !== 'ALL' && branchIds.some((b) => !actor.branchIds.includes(b))) {
      throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Không được gán chi nhánh ngoài phạm vi quản lý');
    }
    if (roleDef(role)?.multiBranch === false && new Set(branchIds).size !== 1) {
      throw Errors.validation([{ path: 'body.branchIds', message: 'Nhân sự cơ sở thuộc đúng một chi nhánh (chỉ AM / ADMIN được gán nhiều chi nhánh)' }]);
    }
  }

  /**
   * Quản lý trực tiếp hợp lệ: đúng vai trò theo cơ cấu (SALE ← SL ← CM ← AM, CS ← CM, GV / TA ← TL ← CM),
   * đang hoạt động, chung chi nhánh (trừ ADMIN), và không tạo vòng lặp trong cây quản lý.
   */
  async function assertManager(managerId: string, userId: string | null, role: string, branchIds: string[], exec: CoreExecutor) {
    const invalid = (detail: string) => new AppError(422, 'MANAGER_INVALID', 'Người quản lý không hợp lệ', detail);
    if (managerId === userId) throw invalid('Không thể tự quản lý chính mình');
    const [manager] = await exec.select().from(users).where(eq(users.id, managerId));
    if (!manager || manager.status !== 'ACTIVE') throw invalid('Người quản lý không tồn tại hoặc đã bị khoá');
    const allowed = roleDef(role)?.managerRoles ?? [];
    if (!allowed.includes(manager.role as (typeof allowed)[number])) {
      throw invalid(allowed.length ? `${role} do ${allowed.join(' / ')} quản lý trực tiếp` : `${role} không có quản lý trực tiếp`);
    }
    if (manager.role !== 'ADMIN') {
      const managerBranches = (
        await exec.select({ b: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, managerId))
      ).map((r) => r.b);
      if (!branchIds.some((b) => managerBranches.includes(b))) throw invalid('Người quản lý phải cùng chi nhánh');
    }
    if (userId && (await subordinateIds(exec, userId)).includes(managerId)) {
      throw invalid('Người quản lý đang là cấp dưới của nhân sự này');
    }
  }

  async function assertEmailFree(email: string, exceptId: string | null, exec: CoreExecutor) {
    const [taken] = await exec.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken && taken.id !== exceptId) throw Errors.conflict('EMAIL_TAKEN', 'Email đã được dùng cho tài khoản khác');
  }

  async function replaceBranches(tx: CoreExecutor, userId: string, branchIds: string[]) {
    await tx.delete(userBranches).where(eq(userBranches.userId, userId));
    if (branchIds.length) {
      await tx
        .insert(userBranches)
        .values([...new Set(branchIds)].map((branchId, i) => ({ userId, branchId, isPrimary: i === 0 })));
    }
  }

  async function sendCredentials(email: string, fullName: string, password: string, reason: 'created' | 'reset') {
    try {
      await mailer.send({
        to: email,
        subject: reason === 'created' ? 'Zero1 — Tài khoản của bạn' : 'Zero1 — Mật khẩu tạm mới',
        text:
          `Xin chào ${fullName},\n\n` +
          (reason === 'created' ? 'Tài khoản Zero1 của bạn đã được tạo.\n' : 'Mật khẩu của bạn đã được đặt lại.\n') +
          `Email đăng nhập: ${email}\nMật khẩu tạm: ${password}\n\nBạn sẽ được yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.`,
      });
    } catch (err) {
      logger.error({ err, email }, 'Không gửi được email thông tin đăng nhập');
    }
  }

  async function summaries(where: SQL | undefined) {
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, role: users.role, status: users.status, managerId: users.managerId })
      .from(users)
      .where(where);
    if (!rows.length) return [];
    const ub = await db.select().from(userBranches).where(inArray(userBranches.userId, rows.map((r) => r.id)));
    return rows.map((r) => ({ ...r, branchIds: ub.filter((x) => x.userId === r.id).map((x) => x.branchId) }));
  }

  return {
    /** Cho core/contract — không lọc theo người gọi. */
    directory: {
      getMany: (ids: string[]) => (ids.length ? summaries(inArray(users.id, ids)) : Promise.resolve([])),
      listByBranch: (branchId: string, roles: string[]) =>
        summaries(
          and(
            eq(users.status, 'ACTIVE'),
            roles.length ? inArray(users.role, roles) : undefined,
            inArray(users.id, sql`(SELECT ${userBranches.userId} FROM ${userBranches} WHERE ${userBranches.branchId} = ${branchId})`),
          ),
        ),
    },

    async list(actor: Principal, q: ListUsersQuery) {
      const roleFilter = csvList(q.role);
      const where = and(
        userVisibility(actor.scope, actor.userId),
        q.q ? or(like(users.fullName, likeContains(q.q)), like(users.email, likeContains(q.q)), like(users.phone, likeContains(q.q))) : undefined,
        roleFilter ? inArray(users.role, roleFilter) : undefined,
        q.status ? eq(users.status, q.status) : undefined,
        q.managerId ? eq(users.managerId, q.managerId) : undefined,
        q.branchId
          ? inArray(users.id, sql`(SELECT ${userBranches.userId} FROM ${userBranches} WHERE ${userBranches.branchId} = ${q.branchId})`)
          : undefined,
      );
      const orderBy = parseSort(
        q.sort,
        { fullName: users.fullName, email: users.email, role: users.role, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt },
        [asc(users.fullName)],
      );
      const [rows, [total]] = await Promise.all([
        db.select().from(users).where(where).orderBy(...orderBy, asc(users.id)).limit(pageOffset(q.page, q.pageSize).limit).offset(pageOffset(q.page, q.pageSize).offset),
        db.select({ n: count() }).from(users).where(where),
      ]);
      return { data: await toDtos(rows), meta: pageMeta(q.page, q.pageSize, total?.n ?? 0) };
    },

    async get(actor: Principal, id: string) {
      const [dto] = await toDtos([await getVisible(actor, id)]);
      return dto!;
    },

    async create(actor: Principal, input: CreateUserInput, ip: string | null) {
      if (!isRoleCode(input.role)) throw Errors.validation([{ path: 'body.role', message: 'Vai trò không tồn tại' }]);
      if (!canManageRole(actor.role, input.role)) throw roleNotAllowed(input.role);
      const email = input.email.trim().toLowerCase();
      const branchIds = [...new Set(input.branchIds)];
      const temporaryPassword = input.password ? null : generateTempPassword();
      const passwordHash = await hashPassword(input.password ?? temporaryPassword!);
      const id = newId();

      await db.transaction(async (tx) => {
        await assertEmailFree(email, null, tx);
        await assertBranches(actor, input.role, branchIds, tx);
        if (input.managerId) await assertManager(input.managerId, null, input.role, branchIds, tx);

        const row = {
          id,
          email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          role: input.role,
          managerId: input.managerId ?? null,
          passwordHash,
          mustChangePassword: true,
        };
        await tx.insert(users).values(row);
        await replaceBranches(tx, id, branchIds);
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'user.created',
          entityType: 'user',
          entityId: id,
          branchId: branchIds[0] ?? null,
          after: { ...row, branchIds },
          ip,
        });
      });

      if (temporaryPassword && mailer.configured) await sendCredentials(email, input.fullName, temporaryPassword, 'created');
      const [dto] = await toDtos([(await db.select().from(users).where(eq(users.id, id)))[0]!]);
      return { user: dto!, temporaryPassword };
    },

    async update(actor: Principal, id: string, patch: UpdateUserInput, ifMatch: number | undefined, ip: string | null) {
      if (id === actor.userId) {
        throw new AppError(403, 'CANNOT_MANAGE_SELF', 'Không tự sửa tài khoản của mình ở đây — dùng trang hồ sơ cá nhân');
      }
      let locked = false;

      await db.transaction(async (tx) => {
        // FOR UPDATE: hai người sửa cùng lúc không ghi đè nhau.
        const [current] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, id), userVisibility(actor.scope, actor.userId)))
          .for('update');
        if (!current) throw Errors.notFound('nhân sự');
        if (ifMatch !== undefined && ifMatch !== current.version) {
          throw Errors.conflict('VERSION_CONFLICT', 'Dữ liệu đã bị người khác thay đổi, vui lòng tải lại');
        }
        if (!canManageRole(actor.role, current.role)) throw roleNotAllowed(current.role);

        const role = patch.role ?? current.role;
        if (patch.role !== undefined) {
          if (!isRoleCode(patch.role)) throw Errors.validation([{ path: 'body.role', message: 'Vai trò không tồn tại' }]);
          if (!canManageRole(actor.role, patch.role)) throw roleNotAllowed(patch.role);
        }

        const currentBranchIds = (
          await tx.select({ b: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, id))
        ).map((r) => r.b);
        const branchIds = patch.branchIds ? [...new Set(patch.branchIds)] : currentBranchIds;
        if (patch.branchIds || patch.role) await assertBranches(actor, role, branchIds, tx);

        const managerId = patch.managerId !== undefined ? patch.managerId : current.managerId;
        if (managerId && (patch.managerId !== undefined || patch.role || patch.branchIds)) {
          await assertManager(managerId, id, role, branchIds, tx);
        }

        const email = patch.email?.trim().toLowerCase();
        if (email && email !== current.email) await assertEmailFree(email, id, tx);

        const changes = {
          ...(email ? { email } : {}),
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.managerId !== undefined ? { managerId: patch.managerId } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        };
        await tx
          .update(users)
          .set({ ...changes, version: sql`${users.version} + 1` })
          .where(eq(users.id, id));
        if (patch.branchIds) await replaceBranches(tx, id, branchIds);

        locked = patch.status === 'LOCKED' && current.status !== 'LOCKED';
        await writeAudit(tx, {
          actorId: actor.userId,
          action: locked ? 'user.locked' : 'user.updated',
          entityType: 'user',
          entityId: id,
          branchId: branchIds[0] ?? null,
          before: { ...current, branchIds: currentBranchIds },
          after: { ...changes, ...(patch.branchIds ? { branchIds } : {}) },
          ip,
        });
        if (locked) {
          await appendEvent(tx, eventTables, {
            type: 'core.user.deactivated',
            aggregateId: id,
            branchId: branchIds[0] ?? null,
            actorId: actor.userId,
            data: { userId: id, role, branchIds },
          });
        }
      });

      if (locked) await revokeSessions(id);
      const [dto] = await toDtos([(await db.select().from(users).where(eq(users.id, id)))[0]!]);
      return dto!;
    },

    async resetPassword(actor: Principal, id: string, ip: string | null) {
      if (id === actor.userId) throw new AppError(403, 'CANNOT_MANAGE_SELF', 'Dùng chức năng đổi mật khẩu cho tài khoản của mình');
      const target = await getVisible(actor, id);
      if (!canManageRole(actor.role, target.role)) throw roleNotAllowed(target.role);

      const temporaryPassword = generateTempPassword();
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, version: sql`${users.version} + 1` })
          .where(eq(users.id, id));
        await writeAudit(tx, { actorId: actor.userId, action: 'user.password_reset_by_manager', entityType: 'user', entityId: id, ip });
      });
      await revokeSessions(id);
      if (mailer.configured) await sendCredentials(target.email, target.fullName, temporaryPassword, 'reset');
      return { temporaryPassword };
    },

    async orgTree(actor: Principal, opts: { branchId?: string; includeLocked: boolean }) {
      const rows = await db
        .select({ id: users.id, fullName: users.fullName, role: users.role, status: users.status, managerId: users.managerId, roleName: roles.name })
        .from(users)
        .leftJoin(roles, eq(roles.code, users.role))
        .where(
          and(
            userVisibility(actor.scope, actor.userId),
            opts.includeLocked ? undefined : eq(users.status, 'ACTIVE'),
            opts.branchId
              ? inArray(users.id, sql`(SELECT ${userBranches.userId} FROM ${userBranches} WHERE ${userBranches.branchId} = ${opts.branchId})`)
              : undefined,
          ),
        )
        .orderBy(asc(users.fullName));
      const visible = new Set(rows.map((r) => r.id));
      // Quản lý nằm ngoài phạm vi → hiển thị như gốc cây.
      return rows.map((r) => ({
        ...r,
        roleName: r.roleName ?? r.role,
        team: roleDef(r.role)?.team ?? 'MANAGEMENT',
        managerId: r.managerId && visible.has(r.managerId) ? r.managerId : null,
      }));
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
