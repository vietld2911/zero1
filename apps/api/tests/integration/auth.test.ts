import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADMIN, createTestApp, PASSWORD, refreshCookie, type TestApp } from './harness.js';

let t: TestApp;
let branchId: string;

beforeAll(async () => {
  t = await createTestApp();
  branchId = await t.makeBranch('HN1');
});
afterAll(() => t?.close());
afterEach(() => vi.useRealTimers());

describe('đăng nhập', () => {
  it('sai mật khẩu và email không tồn tại trả cùng một lỗi', async () => {
    const wrong = await t.api.post('/api/v1/core/auth/login').send({ email: ADMIN.email, password: 'sai12345' });
    const unknown = await t.api.post('/api/v1/core/auth/login').send({ email: 'nobody@test.local', password: 'sai12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('web: refresh token chỉ nằm trong cookie httpOnly, SameSite=Strict', async () => {
    const res = await t.api.post('/api/v1/core/auth/login').send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user).toMatchObject({ email: ADMIN.email, role: 'ADMIN', apps: ['crm', 'lms'], scope: 'ALL' });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('z1_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/core\/auth/);
  });

  it('email không phân biệt hoa thường', async () => {
    const res = await t.api.post('/api/v1/core/auth/login').send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password });
    expect(res.status).toBe(200);
  });

  it('access token hết hạn → TOKEN_EXPIRED', async () => {
    const { token } = await t.login(ADMIN.email, ADMIN.password);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 16 * 60_000 });
    const res = await t.as(token).get('/api/v1/core/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('không có token → 401, token rác → 401', async () => {
    expect((await t.api.get('/api/v1/core/auth/me')).status).toBe(401);
    expect((await t.api.get('/api/v1/core/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
  });
});

describe('refresh token', () => {
  it('xoay vòng: cookie mới mỗi lần, cookie cũ không dùng lại được', async () => {
    const { cookie } = await t.login(ADMIN.email, ADMIN.password);
    const first = refreshCookie(cookie);

    const r1 = await t.api.post('/api/v1/core/auth/refresh').set('Cookie', first);
    expect(r1.status).toBe(200);
    const second = refreshCookie(r1.headers['set-cookie'] as unknown as string[]);
    expect(second).not.toBe(first);

    // Dùng lại ngay (hai tab / CRM + LMS cùng refresh): vẫn được phiên mới, token kia vẫn dùng được.
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', first)).status).toBe(200);
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', second)).status).toBe(200);
  });

  it('dùng lại token cũ sau thời gian ân hạn → huỷ cả phiên (nghi bị đánh cắp)', async () => {
    const { cookie } = await t.login(ADMIN.email, ADMIN.password);
    const stolen = refreshCookie(cookie);
    const r1 = await t.api.post('/api/v1/core/auth/refresh').set('Cookie', stolen);
    const current = refreshCookie(r1.headers['set-cookie'] as unknown as string[]);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60_000 });
    const reuse = await t.api.post('/api/v1/core/auth/refresh').set('Cookie', stolen);
    expect(reuse.body.code).toBe('INVALID_REFRESH_TOKEN');
    // Token hợp lệ của cùng phiên cũng bị huỷ.
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', current)).status).toBe(401);
  });

  it('ân hạn không mở lại phiên đã đăng xuất', async () => {
    const { cookie } = await t.login(ADMIN.email, ADMIN.password);
    const first = refreshCookie(cookie);
    const r1 = await t.api.post('/api/v1/core/auth/refresh').set('Cookie', first);
    const second = refreshCookie(r1.headers['set-cookie'] as unknown as string[]);
    expect((await t.api.post('/api/v1/core/auth/logout').set('Cookie', second)).status).toBe(204);
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', first)).status).toBe(401);
  });

  it('mobile: refresh token trả trong body và gửi lại qua body', async () => {
    const login = await t.api.post('/api/v1/core/auth/login').set('X-Client', 'mobile').send(ADMIN);
    expect(login.headers['set-cookie']).toBeUndefined();
    const rt = login.body.data.refreshToken as string;
    expect(rt).toBeTruthy();
    const r = await t.api.post('/api/v1/core/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: rt });
    expect(r.status).toBe(200);
    expect(r.body.data.refreshToken).not.toBe(rt);
  });

  it('origin lạ bị chặn khi refresh bằng cookie', async () => {
    const { cookie } = await t.login(ADMIN.email, ADMIN.password);
    const res = await t.api.post('/api/v1/core/auth/refresh').set('Cookie', refreshCookie(cookie)).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('đăng xuất → không refresh được nữa', async () => {
    const { cookie } = await t.login(ADMIN.email, ADMIN.password);
    const c = refreshCookie(cookie);
    expect((await t.api.post('/api/v1/core/auth/logout').set('Cookie', c)).status).toBe(204);
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', c)).status).toBe(401);
  });
});

describe('mật khẩu', () => {
  it('tài khoản mới phải đổi mật khẩu trước khi dùng chức năng nghiệp vụ', async () => {
    const created = await t
      .as(t.adminToken)
      .post('/api/v1/core/users', { email: 'moi@test.local', fullName: 'Nhân viên mới', role: 'SALE', branchIds: [branchId] });
    expect(created.status).toBe(201);
    const temp = created.body.data.temporaryPassword as string;
    expect(temp).toMatch(/^[A-Za-z0-9]{12}$/);

    const { token, body } = await t.login('moi@test.local', temp);
    expect(body.data.user.mustChangePassword).toBe(true);
    expect((await t.as(token).get('/api/v1/core/auth/me')).status).toBe(200);
    const blocked = await t.as(token).get('/api/v1/core/timekeeping/me');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await t.as(token).post('/api/v1/core/auth/change-password', { currentPassword: temp, newPassword: 'abcdefgh' });
    expect(weak.status).toBe(400);
    expect((await t.as(token).post('/api/v1/core/auth/change-password', { currentPassword: temp, newPassword: PASSWORD })).status).toBe(204);
    expect((await t.as(token).get('/api/v1/core/timekeeping/me')).status).toBe(200);
  });

  it('đổi mật khẩu: sai mật khẩu cũ → 422; đăng xuất thiết bị khác, giữ thiết bị hiện tại', async () => {
    const u = await t.makeUser({ email: 'doimk@test.local', role: 'CS', branchIds: [branchId] });
    const a = await t.login(u.email, PASSWORD);
    const b = await t.login(u.email, PASSWORD);

    const wrong = await t.as(a.token).post('/api/v1/core/auth/change-password', { currentPassword: 'sai', newPassword: 'MoiMoi123' });
    expect(wrong.body.code).toBe('WRONG_CURRENT_PASSWORD');

    const ok = await t
      .as(a.token)
      .post('/api/v1/core/auth/change-password', { currentPassword: PASSWORD, newPassword: 'MoiMoi123' })
      .set('Cookie', refreshCookie(a.cookie));
    expect(ok.status).toBe(204);
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', refreshCookie(b.cookie))).status).toBe(401);
    expect((await t.api.post('/api/v1/core/auth/refresh').set('Cookie', refreshCookie(a.cookie))).status).toBe(200);
  });

  it('quên mật khẩu: gửi link, đặt lại được một lần', async () => {
    await t.makeUser({ email: 'quen@test.local', role: 'TEACHER', branchIds: [branchId] });
    t.mailer.sent.length = 0;

    expect((await t.api.post('/api/v1/core/auth/forgot-password').send({ email: 'khongco@test.local' })).status).toBe(204);
    expect(t.mailer.sent).toHaveLength(0);

    expect((await t.api.post('/api/v1/core/auth/forgot-password').send({ email: 'quen@test.local', app: 'lms' })).status).toBe(204);
    const mail = t.mailer.sent.at(-1)!;
    const link = /http:\/\/localhost:5174\/reset-password\?token=([\w-]+)/.exec(mail.text);
    expect(link).toBeTruthy();

    const token = link![1]!;
    expect((await t.api.post('/api/v1/core/auth/reset-password').send({ token, newPassword: 'DatLai123' })).status).toBe(204);
    expect((await t.api.post('/api/v1/core/auth/reset-password').send({ token, newPassword: 'DatLai456' })).body.code).toBe('INVALID_RESET_TOKEN');
    expect((await t.api.post('/api/v1/core/auth/login').send({ email: 'quen@test.local', password: 'DatLai123' })).status).toBe(200);
  });

  it('cập nhật hồ sơ cá nhân', async () => {
    const u = await t.makeUser({ email: 'hoso@test.local', role: 'TA', branchIds: [branchId] });
    const res = await t.as(u.token).patch('/api/v1/core/auth/me', { fullName: 'Trợ Giảng A', phone: '0901234567' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fullName: 'Trợ Giảng A', phone: '0901234567', apps: ['lms'] });
    // Không tự đổi vai trò qua hồ sơ
    expect((await t.as(u.token).patch('/api/v1/core/auth/me', { role: 'ADMIN' })).status).toBe(400);
  });
});
