import { asc, eq } from 'drizzle-orm';
import { Errors, AppError } from '../../../../platform/http/errors.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { CoreDb } from '../../db/types.js';
import { permissions, rolePermissions, roles } from '../../db/schema.js';
import { writeAudit } from '../audit/audit.js';
import { canManageRole, roleDef } from './catalog.js';

const CACHE_TTL_MS = 60_000;

export function createAccessService(db: CoreDb) {
  let cache: Map<string, ReadonlySet<string>> | null = null;
  let loadedAt = 0;

  async function load() {
    const rows = await db.select().from(rolePermissions);
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      let set = map.get(r.roleCode);
      if (!set) map.set(r.roleCode, (set = new Set()));
      set.add(r.permissionCode);
    }
    cache = map;
    loadedAt = Date.now();
    return map;
  }

  async function permissionsOf(role: string): Promise<ReadonlySet<string>> {
    const map = cache && Date.now() - loadedAt < CACHE_TTL_MS ? cache : await load();
    return map.get(role) ?? new Set();
  }

  async function listRoles(actor: Principal) {
    const [roleRows, rp] = await Promise.all([
      db.select().from(roles).orderBy(asc(roles.rank)),
      db.select().from(rolePermissions),
    ]);
    return roleRows
      .sort((a, b) => b.rank - a.rank)
      .map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        rank: r.rank,
        team: roleDef(r.code)?.team ?? 'MANAGEMENT',
        multiBranch: roleDef(r.code)?.multiBranch ?? true,
        managerRoles: roleDef(r.code)?.managerRoles ?? [],
        /** Người gọi có gán được vai trò này cho người khác không. */
        assignable: canManageRole(actor.role, r.code),
        permissions: rp.filter((x) => x.roleCode === r.code).map((x) => x.permissionCode).sort(),
      }));
  }

  async function listPermissions() {
    return db.select().from(permissions).orderBy(asc(permissions.code));
  }

  async function setRolePermissions(actor: Principal, roleCode: string, codes: string[], ip: string | null) {
    const unique = [...new Set(codes)].sort();
    if (roleCode === 'ADMIN' && !unique.includes('core.roles.manage')) {
      // Không cho ADMIN tự khoá mình khỏi màn phân quyền.
      throw new AppError(422, 'ADMIN_LOCKOUT', 'ADMIN phải giữ quyền core.roles.manage');
    }
    const [role] = await db.select().from(roles).where(eq(roles.code, roleCode));
    if (!role) throw Errors.notFound('vai trò');
    const known = new Set((await db.select({ code: permissions.code }).from(permissions)).map((p) => p.code));
    const unknown = unique.filter((c) => !known.has(c));
    if (unknown.length) {
      throw Errors.validation(unknown.map((c) => ({ path: 'body.permissions', message: `Quyền không tồn tại: ${c}` })));
    }

    await db.transaction(async (tx) => {
      const before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleCode, roleCode)))
        .map((r) => r.permissionCode)
        .sort();
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleCode, roleCode));
      if (unique.length) {
        await tx.insert(rolePermissions).values(unique.map((permissionCode) => ({ roleCode, permissionCode })));
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: roleCode,
        before,
        after: unique,
        ip,
      });
    });
    cache = null;
  }

  return { permissionsOf, listRoles, listPermissions, setRolePermissions, invalidate: () => (cache = null) };
}

export type AccessService = ReturnType<typeof createAccessService>;
