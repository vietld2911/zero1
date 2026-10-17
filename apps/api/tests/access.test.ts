import { describe, expect, it } from 'vitest';
import { char, MySqlDialect, mysqlTable } from 'drizzle-orm/mysql-core';
import { appsOf, canManageRole, PERMISSIONS, ROLES, ROLE_CODES } from '../src/contexts/core/modules/access/catalog.js';
import { scopeWhere } from '../src/platform/auth/scope-sql.js';
import { generateTempPassword, hashPassword, PasswordSchema, verifyPassword } from '../src/contexts/core/modules/auth/password.js';

describe('danh mục quyền', () => {
  it('mã quyền không trùng, đúng tiền tố app', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of PERMISSIONS) expect(p.code.startsWith(`${p.app}.`)).toBe(true);
  });

  it('mọi vai trò trong ma trận đều tồn tại; ADMIN có mọi quyền', () => {
    for (const p of PERMISSIONS) {
      for (const r of p.roles) expect(ROLE_CODES).toContain(r);
      expect(p.roles).toContain('ADMIN');
    }
  });

  it('app truy cập khớp docs/roles-permissions.md', () => {
    const appsFor = (role: string) => appsOf(PERMISSIONS.filter((p) => p.roles.includes(role as never)).map((p) => p.code));
    expect(Object.fromEntries(ROLES.map((r) => [r.code, appsFor(r.code)]))).toEqual({
      ADMIN: ['crm', 'lms'],
      AM: ['crm', 'lms'],
      CM: ['crm', 'lms'],
      CS: ['crm', 'lms'],
      SL: ['crm'],
      SALE: ['crm'],
      TL: ['lms'],
      TEACHER: ['lms'],
      TA: ['lms'],
    });
  });

  it('chỉ quản lý vai trò cấp thấp hơn (ADMIN quản lý tất cả)', () => {
    expect(canManageRole('ADMIN', 'ADMIN')).toBe(true);
    expect(canManageRole('AM', 'AM')).toBe(false);
    expect(canManageRole('AM', 'CM')).toBe(true);
    expect(canManageRole('CM', 'CM')).toBe(false);
    expect(canManageRole('CM', 'TL')).toBe(true);
    expect(canManageRole('SL', 'TL')).toBe(false); // cùng cấp
    expect(canManageRole('CM', 'UNKNOWN')).toBe(false);
  });
});

describe('scopeWhere', () => {
  const t = mysqlTable('t', { branchId: char('branch_id', { length: 26 }), ownerId: char('owner_id', { length: 26 }), teacherId: char('teacher_id', { length: 26 }) });
  const render = (s: ReturnType<typeof scopeWhere>) => (s ? new MySqlDialect().sqlToQuery(s) : undefined);

  it('ALL không lọc', () => {
    expect(scopeWhere({ kind: 'ALL' }, { branch: t.branchId })).toBeUndefined();
  });

  it('BRANCHES lọc theo chi nhánh; không có chi nhánh → không thấy gì', () => {
    expect(render(scopeWhere({ kind: 'BRANCHES', branchIds: ['b1', 'b2'] }, { branch: t.branchId }))).toMatchObject({
      sql: '`t`.`branch_id` in (?, ?)',
      params: ['b1', 'b2'],
    });
    expect(render(scopeWhere({ kind: 'BRANCHES', branchIds: [] }, { branch: t.branchId }))?.sql).toBe('1 = 0');
  });

  it('OWN / TEAM cần cột người phụ trách — thiếu cột thì không thấy gì (an toàn mặc định)', () => {
    expect(render(scopeWhere({ kind: 'OWN', branchIds: ['b1'], userId: 'u1' }, { branch: t.branchId }))?.sql).toBe('1 = 0');
    const team = render(scopeWhere({ kind: 'TEAM', branchIds: ['b1'], userIds: ['u1', 'u2'] }, { branch: t.branchId, owner: t.ownerId }));
    expect(team?.sql).toBe('(`t`.`branch_id` in (?) and `t`.`owner_id` in (?, ?))');
  });

  it('TEACHING lọc theo cột giáo viên', () => {
    const q = render(scopeWhere({ kind: 'TEACHING', branchIds: ['b1'], userId: 'u1' }, { branch: t.branchId, teachers: [t.teacherId] }));
    expect(q?.params).toEqual(['b1', 'u1']);
  });
});

describe('mật khẩu', () => {
  it('băm và kiểm tra', async () => {
    const hash = await hashPassword('Matkhau123');
    expect(hash).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(await verifyPassword('Matkhau123', hash)).toBe(true);
    expect(await verifyPassword('matkhau123', hash)).toBe(false);
    expect(await verifyPassword('x', 'rác')).toBe(false);
  });

  it('mật khẩu tạm luôn đạt chính sách', () => {
    for (let i = 0; i < 200; i++) expect(PasswordSchema.safeParse(generateTempPassword()).success).toBe(true);
  });
});
