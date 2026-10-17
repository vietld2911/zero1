import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createTestApp, type TestApp } from './harness.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string;
let cm: U, cs: U, sale: U;
let levelId: string, pkgId: string;

const admin = () => t.as(t.adminToken);
const idem = () => ({ 'Idempotency-Key': randomUUID() });
let phoneSeq = 0;
const lead = (overrides: object = {}) => ({ parentName: 'Phạm Thị Hồng', parentPhone: `09200000${String(++phoneSeq).padStart(2, '0')}`, childName: `Bé ${phoneSeq}`, source: 'WEBSITE', ...overrides });
/** Chạy hàng đợi gửi ở thời điểm `minutes` phút sau bây giờ. */
const deliver = (minutes = 0) => t.runJobs(new Date(Date.now() + minutes * 60_000));

beforeAll(async () => {
  t = await createTestApp({ env: { TELEGRAM_BOT_TOKEN: 'tg-test-token', WEBHOOK_ALLOW_PRIVATE: 'false' } });
  b1 = await t.makeBranch('I1');
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1] });
  cs = await t.makeUser({ email: 'cs@test.local', role: 'CS', branchIds: [b1], managerId: cm.id });
  const sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale = await t.makeUser({ email: 'sale@test.local', fullName: 'Sale Lan', role: 'SALE', branchIds: [b1], managerId: sl.id });
  const subjectId = (await admin().post('/api/v1/lms/subjects', { code: 'ROB', name: 'Robotics' })).body.data.id;
  levelId = (await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ROB1', name: 'Robotics 1', sessionsCount: 12 })).body.data.id;
  await t.drainEvents();
  pkgId = (await admin().post('/api/v1/crm/packages', { code: 'R3', name: 'Robotics 3 tháng', subjectId, months: 3, sessionsCount: 24, sessionsPerWeek: 2, basePrice: 6_000_000 })).body.data.id;
});
afterAll(() => t?.close());

describe('API key', () => {
  let key: string, keyId: string;

  it('chỉ ADMIN tạo; không cấp được quyền quản trị Core; key chỉ hiện một lần', async () => {
    expect((await t.as(cm.token).post('/api/v1/core/api-keys', { name: 'Form website', permissions: ['crm.leads.write'] })).status).toBe(403);
    expect((await admin().post('/api/v1/core/api-keys', { name: 'X', permissions: ['core.users.manage'] })).body.code).toBe('VALIDATION_ERROR');
    const res = await admin().post('/api/v1/core/api-keys', { name: 'Form website', permissions: ['crm.leads.write', 'crm.leads.read'], branchIds: [b1] });
    expect(res.status).toBe(201);
    ({ key, id: keyId } = res.body.data);
    expect(key).toMatch(/^z1_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    const list = (await admin().get('/api/v1/core/api-keys')).body.data.keys;
    expect(list[0]).toMatchObject({ name: 'Form website', prefix: key.slice(0, 11), branchIds: [b1] });
    expect(JSON.stringify(list)).not.toContain(key);
  });

  it('form website tạo lead bằng key; ngoài quyền được cấp → 403', async () => {
    const res = await t.api.post('/api/v1/crm/leads').set('X-Api-Key', key).send(lead({ branchId: b1 }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ ownerId: null, branchId: b1 });
    expect((await t.api.get('/api/v1/core/users').set('X-Api-Key', key)).status).toBe(403);
    expect((await t.api.get('/api/v1/crm/leads').set('Authorization', `Bearer ${key}`)).status).toBe(200);
  });

  it('thu hồi → 401', async () => {
    await admin().post(`/api/v1/core/api-keys/${keyId}/revoke`);
    expect((await t.api.get('/api/v1/crm/leads').set('X-Api-Key', key)).body.code).toBe('INVALID_API_KEY');
    expect((await t.api.get('/api/v1/crm/leads').set('X-Api-Key', `${key.slice(0, -1)}X`)).status).toBe(401);
  });
});

describe('webhook', () => {
  let targetId: string, secret: string;
  const URL_OK = 'https://93.184.216.34/zero1-hook';

  it('chặn địa chỉ nội bộ (SSRF)', async () => {
    const internal = [
      'http://127.0.0.1/hook',
      'http://192.168.1.10/hook',
      'http://localhost:9000/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://2130706433/', // 127.0.0.1 dạng số
      'http://[::1]/',
      'http://[::]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[::ffff:a00:1]/', // 10.0.0.1
      'http://[64:ff9b::7f00:1]/',
      'http://[2002:7f00:1::]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
    ];
    for (const url of internal) {
      const res = await admin().post('/api/v1/core/integrations/targets', { kind: 'WEBHOOK', name: 'Nội bộ', url, events: ['*'], branchIds: [] });
      expect(res.body.code, url).toBe('WEBHOOK_PRIVATE_ADDRESS');
    }
  });

  it('nhận lead mới, chữ ký HMAC đúng', async () => {
    await t.drainEvents(); // sự kiện cũ phát trước khi có webhook
    const res = await admin().post('/api/v1/core/integrations/targets', { kind: 'WEBHOOK', name: 'n8n', url: URL_OK, events: ['crm.lead.created'], branchIds: [] });
    expect(res.status).toBe(201);
    ({ id: targetId, secret } = res.body.data);
    expect(secret).toMatch(/^whsec_/);

    const created = await t.as(sale.token).post('/api/v1/crm/leads', lead({ childName: 'Bé Webhook' }));
    await t.drainEvents();
    const before = t.outbound.calls.length;
    await deliver();
    const call = t.outbound.calls.slice(before).find((c) => c.url === URL_OK && c.body.includes(created.body.data.id))!;
    expect(call.headers['x-zero1-event']).toBe('crm.lead.created');
    const expected = createHmac('sha256', secret).update(`${call.headers['x-zero1-timestamp']}.${call.body}`).digest('hex');
    expect(call.headers['x-zero1-signature']).toBe(`sha256=${expected}`);
    expect(JSON.parse(call.body)).toMatchObject({ type: 'crm.lead.created', branchId: b1, data: { leadId: created.body.data.id, childName: 'Bé Webhook', via: 'MANUAL' } });

    const log = (await admin().get(`/api/v1/core/integrations/deliveries?targetId=${targetId}`)).body.data;
    expect(log[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 1, lastStatusCode: 200, eventLabel: 'Khách hàng tiềm năng mới' });
  });

  it('lỗi 5xx → thử lại theo lịch; 4xx → dừng; gửi lại tay được', async () => {
    t.outbound.respond = () => ({ status: 503, body: 'bận' });
    await t.as(sale.token).post('/api/v1/crm/leads', lead());
    await t.drainEvents();
    await deliver();
    let log = (await admin().get(`/api/v1/core/integrations/deliveries?targetId=${targetId}`)).body.data;
    expect(log[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastStatusCode: 503 });
    expect(log[0].nextAttemptAt).not.toBeNull();
    t.outbound.respond = () => ({ status: 200, body: 'ok' });
    await deliver(2); // sau 1 phút backoff
    log = (await admin().get(`/api/v1/core/integrations/deliveries?targetId=${targetId}`)).body.data;
    expect(log[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });

    t.outbound.respond = () => ({ status: 410, body: 'gone' });
    await t.as(sale.token).post('/api/v1/crm/leads', lead());
    await t.drainEvents();
    await deliver(10);
    log = (await admin().get(`/api/v1/core/integrations/deliveries?targetId=${targetId}&status=FAILED`)).body.data;
    expect(log[0]).toMatchObject({ status: 'FAILED', attempts: 1, lastStatusCode: 410 });
    // Không lộ nội dung phản hồi của đích
    expect(JSON.stringify(log[0])).not.toContain('gone');
    t.outbound.respond = () => ({ status: 200, body: 'ok' });
    expect((await admin().post(`/api/v1/core/integrations/deliveries/${log[0].id}/retry`)).body.data).toMatchObject({ ok: true });
  });

  it('tạm dừng → không xếp hàng nữa', async () => {
    await admin().patch(`/api/v1/core/integrations/targets/${targetId}`, { isActive: false });
    const before = (await admin().get('/api/v1/core/integrations')).body.data.targets.find((x: { id: string }) => x.id === targetId);
    await t.as(sale.token).post('/api/v1/crm/leads', lead());
    await t.drainEvents();
    const after = (await admin().get('/api/v1/core/integrations')).body.data.targets.find((x: { id: string }) => x.id === targetId);
    expect(after.delivered + after.pending + after.failed).toBe(before.delivered + before.pending + before.failed);
  });
});

describe('Telegram nội bộ', () => {
  let targetId: string;
  const tgCalls = () => t.outbound.calls.filter((c) => c.url.startsWith('https://api.telegram.org/'));

  it('chỉ nhận sự kiện có mẫu tin; gửi thử', async () => {
    expect((await admin().post('/api/v1/core/integrations/targets', { kind: 'TELEGRAM', name: 'Nhóm I1', chatId: '-1001234567', events: ['crm.student.updated'], branchIds: [b1] })).body.code).toBe('VALIDATION_ERROR');
    const res = await admin().post('/api/v1/core/integrations/targets', { kind: 'TELEGRAM', name: 'Nhóm I1', chatId: '-1001234567', events: ['*'], branchIds: [b1] });
    targetId = res.body.data.id;
    expect((await admin().post(`/api/v1/core/integrations/targets/${targetId}/test`)).body.data).toMatchObject({ ok: true });
    const last = tgCalls().at(-1)!;
    expect(last.url).toBe('https://api.telegram.org/bottg-test-token/sendMessage');
    expect(JSON.parse(last.body)).toMatchObject({ chat_id: '-1001234567', parse_mode: 'HTML' });
  });

  it('lead mới → tin nhắn có tên chi nhánh, SĐT che bớt, người phụ trách', async () => {
    const before = tgCalls().length;
    await t.as(sale.token).post('/api/v1/crm/leads', lead({ childName: 'Bé Telegram', parentPhone: '0987654321' }));
    await t.drainEvents();
    await deliver(30);
    const sent = tgCalls().slice(before).map((c) => JSON.parse(c.body).text as string);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Chi nhánh I1');
    expect(sent[0]).toContain('Bé Telegram');
    expect(sent[0]).toContain('0987 *** 321');
    expect(sent[0]).toContain('Sale Lan');
  });

  it('import Excel không làm ngập nhóm', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.addRow(['Họ tên phụ huynh', 'SĐT', 'Email', 'Tên học sinh', 'Năm sinh', 'Trường', 'Nguồn', 'Ghi chú']);
    ws.addRow(['Lê Văn Hùng', '0977111222', '', 'Lê Gia Bảo', 2016, '', 'Zalo', '']);
    ws.addRow(['Lê Văn Hùng', '0977111223', '', 'Lê Gia Huy', 2017, '', 'Zalo', '']);
    const before = tgCalls().length;
    await t.api
      .post('/api/v1/crm/leads/import')
      .set('Authorization', `Bearer ${cm.token}`)
      .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), { filename: 'l.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await t.drainEvents();
    await deliver(60);
    expect(tgCalls().length).toBe(before);
  });
});

describe('tài khoản phụ huynh', () => {
  const PHONE = '0933444555';
  let studentA: string, studentB: string, enrollmentA: string, code: string;
  let session: { accessToken: string; refreshToken: string };

  it('CS cấp mã cho phụ huynh của học viên', async () => {
    const l = await t.as(sale.token).post('/api/v1/crm/leads', lead({ parentPhone: PHONE, parentName: 'Trần Thị Mai', childName: 'Trần An' }));
    const conv = await t.as(sale.token)
      .post(`/api/v1/crm/leads/${l.body.data.id}/convert`, { student: { fullName: 'Trần An' }, enrollment: { packageId: pkgId, startLevelId: levelId } })
      .set(idem());
    ({ studentId: studentA, enrollmentId: enrollmentA } = conv.body.data);
    const detail = (await t.as(cs.token).get(`/api/v1/crm/students/${studentA}`)).body.data;
    expect(detail.parentAccounts).toEqual([]);
    const res = await t.as(cs.token).post(`/api/v1/crm/students/${studentA}/parent-access`, { guardianId: detail.guardians[0].id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ phone: PHONE, status: 'PENDING', children: 1 });
    code = res.body.data.code;
    expect(code).toMatch(/^\d{6}$/);
    expect((await t.as(cs.token).get(`/api/v1/crm/students/${studentA}`)).body.data.parentAccounts[0]).toMatchObject({ phone: PHONE, status: 'PENDING' });
  });

  it('kích hoạt: sai mã → 401; đúng → đăng nhập luôn', async () => {
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await t.api.post('/api/v1/parent/auth/activate').send({ phone: PHONE, code: wrong, password: 'Matkhau123' })).body.code).toBe('INVALID_ACTIVATION_CODE');
    const res = await t.api.post('/api/v1/parent/auth/activate').send({ phone: '+84 933 444 555', code, password: 'Matkhau123' });
    expect(res.status).toBe(200);
    session = res.body.data;
    // Mã chỉ dùng một lần
    expect((await t.api.post('/api/v1/parent/auth/activate').send({ phone: PHONE, code, password: 'Matkhau456' })).body.code).toBe('INVALID_ACTIVATION_CODE');
  });

  it('con của tôi, học phí; chưa đóng tiền → chưa có dữ liệu học tập', async () => {
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    const children = (await t.api.get('/api/v1/parent/children').set(auth)).body.data;
    expect(children).toEqual([expect.objectContaining({ id: studentA, fullName: 'Trần An', amountOutstanding: 6_000_000 })]);
    const tuition = (await t.api.get(`/api/v1/parent/children/${studentA}/tuition`).set(auth)).body.data;
    expect(tuition[0]).toMatchObject({ amountDue: 6_000_000, balance: 6_000_000, payments: [] });
    expect((await t.api.get(`/api/v1/parent/children/${studentA}/learning`).set(auth)).body.data).toMatchObject({ enrolled: false });
  });

  it('đóng tiền → LMS có học viên; học phí cập nhật', async () => {
    await t.as(cs.token).post(`/api/v1/crm/enrollments/${enrollmentA}/payments`, { amount: 2_000_000, method: 'CASH' }).set(idem());
    await t.drainEvents();
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    expect((await t.api.get(`/api/v1/parent/children/${studentA}/learning`).set(auth)).body.data).toMatchObject({ enrolled: true, currentLevelName: 'Robotics 1', classes: [] });
    expect((await t.api.get(`/api/v1/parent/children/${studentA}/tuition`).set(auth)).body.data[0]).toMatchObject({ amountPaid: 2_000_000, balance: 4_000_000 });
  });

  it('anh / chị em cùng SĐT phụ huynh → tự thêm vào danh sách con', async () => {
    const l = await t.as(cm.token).post('/api/v1/crm/leads', lead({ parentPhone: PHONE, parentName: 'Trần Thị Mai', childName: 'Trần Bình', force: true }));
    const conv = await t.as(cm.token)
      .post(`/api/v1/crm/leads/${l.body.data.id}/convert`, { student: { fullName: 'Trần Bình' }, enrollment: { packageId: pkgId, startLevelId: levelId } })
      .set(idem());
    studentB = conv.body.data.studentId;
    // Danh sách con nằm trong token → lấy token mới
    const relogin = (await t.api.post('/api/v1/parent/auth/login').send({ phone: PHONE, password: 'Matkhau123' })).body.data;
    const children = (await t.api.get('/api/v1/parent/children').set('Authorization', `Bearer ${relogin.accessToken}`)).body.data;
    expect(children.map((c: { id: string }) => c.id).sort()).toEqual([studentA, studentB].sort());
  });

  it('không xem được học viên khác; token phụ huynh không dùng được API nhân sự và ngược lại', async () => {
    const other = (await t.as(cs.token).get('/api/v1/crm/students?pageSize=100')).body.data.find((s: { id: string }) => s.id !== studentA && s.id !== studentB);
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    if (other) expect((await t.api.get(`/api/v1/parent/children/${other.id}/tuition`).set(auth)).status).toBe(404);
    expect((await t.api.get('/api/v1/crm/leads').set(auth)).body.code).toBe('WRONG_ACCOUNT_TYPE');
    expect((await t.as(cs.token).get('/api/v1/parent/children')).body.code).toBe('WRONG_ACCOUNT_TYPE');
  });

  it('nhập mã song song không vượt quá 5 lần thử', async () => {
    const detail = (await t.as(cs.token).get(`/api/v1/crm/students/${studentA}`)).body.data;
    const fresh = (await t.as(cs.token).post(`/api/v1/crm/students/${studentA}/parent-access`, { guardianId: detail.guardians[0].id })).body.data.code as string;
    const wrong = fresh === '000000' ? '111111' : '000000';
    const results = await Promise.all(
      Array.from({ length: 20 }, () => t.api.post('/api/v1/parent/auth/activate').send({ phone: PHONE, code: wrong, password: 'Matkhau999' })),
    );
    const codes = results.map((r) => r.body.code);
    expect(codes.filter((c) => c === 'INVALID_ACTIVATION_CODE')).toHaveLength(5);
    expect(codes.filter((c) => c === 'ACTIVATION_LOCKED')).toHaveLength(15);
    // Hết lượt: mã đúng cũng không dùng được nữa
    expect((await t.api.post('/api/v1/parent/auth/activate').send({ phone: PHONE, code: fresh, password: 'Matkhau999' })).body.code).toBe('ACTIVATION_LOCKED');
    // Mật khẩu cũ vẫn dùng được
    expect((await t.api.post('/api/v1/parent/auth/login').send({ phone: PHONE, password: 'Matkhau123' })).status).toBe(200);
  });

  it('refresh xoay vòng; dùng lại token cũ → huỷ phiên; đăng nhập sai → 401', async () => {
    const r1 = await t.api.post('/api/v1/parent/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(r1.status).toBe(200);
    expect((await t.api.post('/api/v1/parent/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
    expect((await t.api.post('/api/v1/parent/auth/refresh').send({ refreshToken: r1.body.data.refreshToken })).status).toBe(401);
    expect((await t.api.post('/api/v1/parent/auth/login').send({ phone: PHONE, password: 'Sai12345' })).body.code).toBe('INVALID_CREDENTIALS');
    expect((await t.as(cs.token).get(`/api/v1/crm/students/${studentA}`)).body.data.parentAccounts[0]).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('chống gửi trùng & kiểm tra dữ liệu', () => {
  let leadId: string, enrollmentId: string;

  it('chuyển đổi lead: 4 request song song cùng Idempotency-Key → cùng một kết quả', async () => {
    leadId = (await t.as(sale.token).post('/api/v1/crm/leads', lead({ childName: 'Ngô Minh' }))).body.data.id;
    const key = idem();
    const body = { student: { fullName: 'Ngô Minh' }, enrollment: { packageId: pkgId, startLevelId: levelId } };
    const results = await Promise.all(Array.from({ length: 4 }, () => t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/convert`, body).set(key)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const ids = new Set(results.map((r) => r.body.data.enrollmentId));
    expect(ids.size).toBe(1);
    enrollmentId = [...ids][0]!;
  });

  it('ghi khoản thu: 4 request song song cùng key → 1 khoản thu', async () => {
    const key = idem();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => t.as(cs.token).post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount: 1_000_000, method: 'CASH' }).set(key)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    const e = (await t.as(cs.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect(e.payments).toHaveLength(1);
  });

  it('ngày thu ở tương lai → 400', async () => {
    const res = await t.as(cs.token)
      .post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount: 1_000_000, method: 'CASH', paidAt: '2030-01-01T10:00:00+07:00' })
      .set(idem());
    expect(res.status).toBe(400);
  });

  it('hẹn gọi lại vào thời điểm đã qua → 400', async () => {
    const id = (await t.as(sale.token).post('/api/v1/crm/leads', lead())).body.data.id;
    const past = await t.as(sale.token).post(`/api/v1/crm/leads/${id}/calls`, { outcome: 'CALL_BACK', note: 'Hẹn gọi lại', status: 'S1B', nextFollowUpAt: '2020-01-01T09:00:00+07:00' });
    expect(past.status).toBe(400);
    const future = await t.as(sale.token).post(`/api/v1/crm/leads/${id}/calls`, { outcome: 'CALL_BACK', note: 'Hẹn gọi lại', status: 'S1B', nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(future.status).toBe(201);
  });
});
