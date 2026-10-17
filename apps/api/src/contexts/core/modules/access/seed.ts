import { eq, inArray } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import type { CoreDb } from '../../db/types.js';
import { permissions, rolePermissions, roles, users } from '../../db/schema.js';
import { generateTempPassword, hashPassword } from '../auth/password.js';
import { PERMISSIONS, ROLES } from './catalog.js';

/**
 * Đồng bộ danh mục vai trò & quyền vào DB. Chạy lại an toàn:
 * - vai trò / quyền mới được thêm, tên & mô tả được cập nhật;
 * - quyền MỚI được gán cho các vai trò mặc định;
 * - quyền đã có thì giữ nguyên phân quyền ADMIN đã chỉnh.
 */
export async function seedAccess(db: CoreDb): Promise<{ newPermissions: string[] }> {
  return db.transaction(async (tx) => {
    for (const r of ROLES) {
      await tx
        .insert(roles)
        .values({ code: r.code, name: r.name, description: r.description, rank: r.rank })
        .onDuplicateKeyUpdate({ set: { name: r.name, description: r.description, rank: r.rank } });
    }

    const existing = new Set((await tx.select({ code: permissions.code }).from(permissions)).map((p) => p.code));
    const fresh = PERMISSIONS.filter((p) => !existing.has(p.code));

    for (const p of PERMISSIONS) {
      await tx
        .insert(permissions)
        .values({ code: p.code, app: p.app, description: p.description })
        .onDuplicateKeyUpdate({ set: { app: p.app, description: p.description } });
    }

    const mappings = fresh.flatMap((p) => p.roles.map((roleCode) => ({ roleCode, permissionCode: p.code })));
    if (mappings.length) {
      // Xoá mapping mồ côi (nếu có) trước khi thêm, tránh trùng khoá.
      await tx.delete(rolePermissions).where(inArray(rolePermissions.permissionCode, fresh.map((p) => p.code)));
      await tx.insert(rolePermissions).values(mappings);
    }
    return { newPermissions: fresh.map((p) => p.code) };
  });
}

/**
 * Tạo ADMIN đầu tiên nếu hệ thống chưa có ADMIN nào.
 * Trả về mật khẩu tạm khi tự sinh (chỉ hiện một lần).
 */
export async function ensureAdmin(
  db: CoreDb,
  opts: { email: string; password?: string; fullName?: string },
): Promise<{ created: boolean; email: string; generatedPassword?: string }> {
  const [anyAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'ADMIN')).limit(1);
  if (anyAdmin) return { created: false, email: opts.email };

  const generatedPassword = opts.password ? undefined : generateTempPassword();
  await db.insert(users).values({
    id: newId(),
    email: opts.email.toLowerCase(),
    fullName: opts.fullName ?? 'Quản trị hệ thống',
    passwordHash: await hashPassword(opts.password ?? generatedPassword!),
    role: 'ADMIN',
    mustChangePassword: !opts.password,
  });
  return { created: true, email: opts.email, generatedPassword };
}
