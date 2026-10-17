import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { outboxEvents } from '../../src/contexts/core/db/schema.js';
import { createTestApp, type TestApp } from './harness.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string;
let b2: string;
let am: U, cm1: U, cm2: U, sl1: U, sl2: U, sale1: U, sale2: U, cs1: U, teacher1: U;

const ids = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((u) => u.id).sort();

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('B1');
  b2 = await t.makeBranch('B2');
  am = await t.makeUser({ email: 'am@test.local', role: 'AM', branchIds: [b1, b2] });
  cm1 = await t.makeUser({ email: 'cm1@test.local', role: 'CM', branchIds: [b1], managerId: am.id });
  cm2 = await t.makeUser({ email: 'cm2@test.local', role: 'CM', branchIds: [b2], managerId: am.id });
  sl1 = await t.makeUser({ email: 'sl1@test.local', role: 'SL', branchIds: [b1], managerId: cm1.id });
  sale1 = await t.makeUser({ email: 'sale1@test.local', role: 'SALE', branchIds: [b1], managerId: sl1.id });
  // Hai nhóm kinh doanh trong cùng cơ sở, mỗi nhóm một SL
  sl2 = await t.makeUser({ email: 'sl2@test.local', role: 'SL', branchIds: [b1], managerId: cm1.id });
  sale2 = await t.makeUser({ email: 'sale2@test.local', role: 'SALE', branchIds: [b1], managerId: sl2.id });
  cs1 = await t.makeUser({ email: 'cs1@test.local', role: 'CS', branchIds: [b1], managerId: cm1.id });
  teacher1 = await t.makeUser({ email: 'gv1@test.local', role: 'TEACHER', branchIds: [b1] });
});
afterAll(() => t?.close());

describe('phạm vi xem nhân sự', () => {
  it('SALE không có quyền xem danh sách nhân sự', async () => {
    expect((await t.as(sale1.token).get('/api/v1/core/users')).status).toBe(403);
  });

  it('CM chỉ thấy nhân sự trong chi nhánh mình', async () => {
    const res = await t.as(cm1.token).get('/api/v1/core/users?pageSize=100');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([am, cm1, sl1, sl2, sale1, sale2, cs1, teacher1].map((u) => u.id).sort());
    expect(res.body.meta.total).toBe(8);
  });

  it('SL chỉ thấy bản thân và cấp dưới', async () => {
    const res = await t.as(sl1.token).get('/api/v1/core/users');
    expect(ids(res)).toEqual([sl1.id, sale1.id].sort());
  });

  it('AM thấy cả hai chi nhánh', async () => {
    const res = await t.as(am.token).get('/api/v1/core/users?pageSize=100');
    expect(ids(res)).toContain(cm2.id);
    expect(ids(res)).toContain(sale1.id);
  });

  it('ngoài phạm vi → 404 (không lộ sự tồn tại)', async () => {
    expect((await t.as(cm1.token).get(`/api/v1/core/users/${cm2.id}`)).status).toBe(404);
  });

  it('lọc, tìm kiếm, sắp xếp', async () => {
    const res = await t.as(cm1.token).get('/api/v1/core/users?role=SALE,SL&sort=-fullName');
    expect(res.body.data.map((u: { email: string }) => u.email)).toEqual(['sl2@test.local', 'sl1@test.local', 'sale2@test.local', 'sale1@test.local']);
    const q = await t.as(cm1.token).get('/api/v1/core/users?q=gv1');
    expect(ids(q)).toEqual([teacher1.id]);
    expect((await t.as(cm1.token).get('/api/v1/core/users?sort=passwordHash')).status).toBe(400);
  });

  it('dữ liệu trả về không có mật khẩu và có chi nhánh, quản lý', async () => {
    const res = await t.as(cm1.token).get(`/api/v1/core/users/${sale1.id}`);
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.manager).toMatchObject({ id: sl1.id });
    expect(res.body.data.branches).toEqual([expect.objectContaining({ id: b1, isPrimary: true })]);
  });
});

describe('tạo / sửa nhân sự theo cấp bậc', () => {
  it('CM tạo SALE trong chi nhánh mình, nhận mật khẩu tạm, email được gửi', async () => {
    t.mailer.sent.length = 0;
    const res = await t
      .as(cm1.token)
      .post('/api/v1/core/users', { email: 'Sale3@Test.Local', fullName: 'Sale Ba', role: 'SALE', branchIds: [b1], managerId: sl1.id });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'sale3@test.local', role: 'SALE', mustChangePassword: true });
    expect(res.body.data.temporaryPassword).toBeTruthy();
    expect(t.mailer.sent.at(-1)?.to).toBe('sale3@test.local');
  });

  it('CM không tạo được CM, không gán chi nhánh khác', async () => {
    const asCm = await t.as(cm1.token).post('/api/v1/core/users', { email: 'x1@test.local', fullName: 'X Một', role: 'CM', branchIds: [b1] });
    expect(asCm.body.code).toBe('ROLE_NOT_ALLOWED');
    const other = await t.as(cm1.token).post('/api/v1/core/users', { email: 'x2@test.local', fullName: 'X Hai', role: 'SALE', branchIds: [b2] });
    expect(other.body.code).toBe('BRANCH_OUT_OF_SCOPE');
  });

  it('email trùng → 409', async () => {
    const res = await t.as(cm1.token).post('/api/v1/core/users', { email: 'sale1@test.local', fullName: 'Trùng', role: 'SALE', branchIds: [b1] });
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('quản lý phải cấp cao hơn và cùng chi nhánh', async () => {
    const lower = await t.as(cm1.token).patch(`/api/v1/core/users/${sl1.id}`, { managerId: sale1.id });
    expect(lower.body.code).toBe('MANAGER_INVALID');
    const sl3 = await t.as(am.token).post('/api/v1/core/users', { email: 'sl3@test.local', fullName: 'SL Ba', role: 'SL', branchIds: [b2], managerId: cm2.id });
    const otherBranch = await t.as(am.token).patch(`/api/v1/core/users/${sale2.id}`, { managerId: sl3.body.data.user.id });
    expect(otherBranch.body.code).toBe('MANAGER_INVALID');
  });

  it('cơ cấu: SALE ← SL, CS ← CM, GV ← TL; CM không quản lý trực tiếp SALE / GV', async () => {
    const saleUnderCm = await t.as(cm1.token).patch(`/api/v1/core/users/${sale1.id}`, { managerId: cm1.id });
    expect(saleUnderCm.body).toMatchObject({ code: 'MANAGER_INVALID', detail: 'SALE do SL quản lý trực tiếp' });
    expect((await t.as(cm1.token).patch(`/api/v1/core/users/${teacher1.id}`, { managerId: cm1.id })).body.code).toBe('MANAGER_INVALID');
    const tl = await t.as(cm1.token).post('/api/v1/core/users', { email: 'tl1@test.local', fullName: 'TL Một', role: 'TL', branchIds: [b1], managerId: cm1.id });
    expect(tl.status).toBe(201);
    expect((await t.as(cm1.token).patch(`/api/v1/core/users/${teacher1.id}`, { managerId: tl.body.data.user.id })).status).toBe(200);
    expect((await t.as(cm1.token).get(`/api/v1/core/users/${sale1.id}`)).body.data.team).toBe('SALES');
  });

  it('nhân sự cơ sở thuộc đúng một chi nhánh; AM được nhiều chi nhánh', async () => {
    const res = await t.as(am.token).post('/api/v1/core/users', { email: 'cs2@test.local', fullName: 'CS Hai', role: 'CS', branchIds: [b1, b2] });
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect((await t.as(am.token).patch(`/api/v1/core/users/${cm1.id}`, { branchIds: [b1, b2] })).body.code).toBe('VALIDATION_ERROR');
    expect((await t.as(am.token).get(`/api/v1/core/users/${am.id}`)).body.data.branches).toHaveLength(2);
  });

  it('CM không sửa được AM (cấp cao hơn) dù cùng chi nhánh', async () => {
    const res = await t.as(cm1.token).patch(`/api/v1/core/users/${am.id}`, { fullName: 'Đổi tên' });
    expect(res.body.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('không tự sửa tài khoản mình qua trang quản lý', async () => {
    expect((await t.as(cm1.token).patch(`/api/v1/core/users/${cm1.id}`, { fullName: 'Tôi' })).body.code).toBe('CANNOT_MANAGE_SELF');
  });

  it('If-Match lệch version → 409 VERSION_CONFLICT', async () => {
    const current = await t.as(cm1.token).get(`/api/v1/core/users/${cs1.id}`);
    const v = current.body.data.version as number;
    expect((await t.as(cm1.token).patch(`/api/v1/core/users/${cs1.id}`, { phone: '0911111111' }).set('If-Match', String(v))).status).toBe(200);
    const stale = await t.as(cm1.token).patch(`/api/v1/core/users/${cs1.id}`, { phone: '0922222222' }).set('If-Match', String(v));
    expect(stale.body.code).toBe('VERSION_CONFLICT');
  });

  it('khoá tài khoản: token đang dùng bị từ chối ngay, phát sự kiện core.user.deactivated', async () => {
    expect((await t.as(sale2.token).get('/api/v1/core/auth/me')).status).toBe(200);
    const res = await t.as(cm1.token).patch(`/api/v1/core/users/${sale2.id}`, { status: 'LOCKED' });
    expect(res.status).toBe(200);
    const after = await t.as(sale2.token).get('/api/v1/core/auth/me');
    expect(after.body.code).toBe('ACCOUNT_LOCKED');
    const login = await t.api.post('/api/v1/core/auth/login').send({ email: 'sale2@test.local', password: 'Matkhau123' });
    expect(login.body.code).toBe('ACCOUNT_LOCKED');

    const events = await t.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, sale2.id));
    expect(events.map((e) => e.type)).toContain('core.user.deactivated');
  });

  it('cấp mật khẩu tạm: buộc đổi lại mật khẩu', async () => {
    const res = await t.as(cm1.token).post(`/api/v1/core/users/${teacher1.id}/reset-password`);
    expect(res.status).toBe(200);
    const { body } = await t.login('gv1@test.local', res.body.data.temporaryPassword);
    expect(body.data.user.mustChangePassword).toBe(true);
  });
});

describe('cây quản lý', () => {
  it('CM thấy cây của chi nhánh mình; quản lý ngoài phạm vi thành gốc', async () => {
    const res = await t.as(cm1.token).get('/api/v1/core/org-tree');
    const byId = new Map(res.body.data.map((m: { id: string; managerId: string | null }) => [m.id, m.managerId]));
    expect(byId.get(sale1.id)).toBe(sl1.id);
    expect(byId.get(sl1.id)).toBe(cm1.id);
    expect(byId.get(cm1.id)).toBe(am.id);
    expect(byId.has(cm2.id)).toBe(false);
    expect(byId.has(sale2.id)).toBe(false); // đã khoá
  });
});

describe('chi nhánh', () => {
  it('nhân sự chỉ thấy chi nhánh được gán; ADMIN thấy tất cả', async () => {
    expect((await t.as(cm1.token).get('/api/v1/core/branches')).body.data.map((b: { id: string }) => b.id)).toEqual([b1]);
    expect((await t.as(t.adminToken).get('/api/v1/core/branches')).body.data).toHaveLength(2);
  });

  it('chỉ ADMIN tạo chi nhánh; mã trùng → 409', async () => {
    expect((await t.as(cm1.token).post('/api/v1/core/branches', { code: 'B9', name: 'Chín' })).status).toBe(403);
    expect((await t.as(t.adminToken).post('/api/v1/core/branches', { code: 'b1', name: 'Trùng' })).body.code).toBe('BRANCH_CODE_TAKEN');
  });

  it('không ngừng chi nhánh còn nhân sự đang hoạt động', async () => {
    const res = await t.as(t.adminToken).patch(`/api/v1/core/branches/${b2}`, { isActive: false });
    expect(res.body.code).toBe('BRANCH_HAS_STAFF');
  });
});

describe('phân quyền vai trò', () => {
  it('ADMIN không tự bỏ quyền core.roles.manage', async () => {
    const res = await t.as(t.adminToken).patch('/api/v1/core/roles/ADMIN', { permissions: ['core.users.read'] });
    expect(res.body.code).toBe('ADMIN_LOCKOUT');
  });

  it('cấp thêm quyền cho vai trò có hiệu lực ngay', async () => {
    const roles = await t.as(t.adminToken).get('/api/v1/core/roles');
    const salePerms = roles.body.data.find((r: { code: string }) => r.code === 'SALE').permissions as string[];
    expect((await t.as(sale1.token).get('/api/v1/core/users')).status).toBe(403);

    await t.as(t.adminToken).patch('/api/v1/core/roles/SALE', { permissions: [...salePerms, 'core.users.read'] });
    const res = await t.as(sale1.token).get('/api/v1/core/users');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([sale1.id]); // phạm vi OWN vẫn áp dụng

    await t.as(t.adminToken).patch('/api/v1/core/roles/SALE', { permissions: salePerms });
  });

  it('danh sách vai trò cho biết người gọi gán được vai trò nào', async () => {
    const res = await t.as(cm1.token).get('/api/v1/core/roles');
    const assignable = res.body.data.filter((r: { assignable: boolean }) => r.assignable).map((r: { code: string }) => r.code).sort();
    expect(assignable).toEqual(['CS', 'SALE', 'SL', 'TA', 'TEACHER', 'TL']);
  });
});
