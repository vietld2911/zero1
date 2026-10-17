import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createTestApp, type TestApp } from './harness.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string;
let cm: U, sl: U, sale1: U, sale2: U, cs: U;
let levelId: string, pkg6: string, pkgShort: string;

const admin = () => t.as(t.adminToken);
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const DAY = 86_400_000;
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3_600_000 + offset * DAY).toISOString().slice(0, 10);
const month = vnDate().slice(0, 7);
const monthStart = `${month}-01`;
const monthEnd = (() => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
})();
/** Mùng 1 tháng trước (giờ VN, 10:00) — luôn nằm trong "cùng kỳ tháng trước". */
const lastMonthAt = `${new Date(Date.parse(`${monthStart}T00:00:00Z`) - DAY).toISOString().slice(0, 7)}-01T10:00:00+07:00`;

const binary = (res: IncomingMessage, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

let phoneSeq = 0;
async function convert(by: U, child: string, packageId: string, extra: object = {}) {
  const lead = await t.as(by.token).post('/api/v1/crm/leads', { parentName: 'Phụ huynh', parentPhone: `09100000${String(++phoneSeq).padStart(2, '0')}`, childName: child, source: 'FACEBOOK' });
  const conv = await t.as(by.token)
    .post(`/api/v1/crm/leads/${lead.body.data.id}/convert`, { student: { fullName: child }, enrollment: { packageId, startLevelId: levelId, ...extra } })
    .set(idem());
  if (conv.status !== 201) throw new Error(JSON.stringify(conv.body));
  return { leadId: lead.body.data.id as string, ...(conv.body.data as { studentId: string; enrollmentId: string }) };
}
async function pay(by: U, enrollmentId: string, amount: number, paidAt?: string) {
  const res = await t.as(by.token).post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount, method: 'CASH', paidAt }).set(idem());
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
}
const notificationsOf = async (u: U) => (await t.as(u.token).get('/api/v1/core/notifications?pageSize=50')).body.data as Array<{ type: string; title: string; link: string | null; read: boolean }>;

let studentA: string;

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('R1');
  const am = await t.makeUser({ email: 'am@test.local', role: 'AM', branchIds: [b1] });
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1], managerId: am.id });
  sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale1 = await t.makeUser({ email: 'sale1@test.local', fullName: 'Sale Một', role: 'SALE', branchIds: [b1], managerId: sl.id });
  sale2 = await t.makeUser({ email: 'sale2@test.local', fullName: 'Sale Hai', role: 'SALE', branchIds: [b1], managerId: sl.id });
  cs = await t.makeUser({ email: 'cs@test.local', fullName: 'CS Một', role: 'CS', branchIds: [b1], managerId: cm.id });

  const subjectId = (await admin().post('/api/v1/lms/subjects', { code: 'ROB', name: 'Robotics' })).body.data.id;
  levelId = (await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ROB1', name: 'Robotics 1', sessionsCount: 12 })).body.data.id;
  await t.drainEvents();
  pkg6 = (await admin().post('/api/v1/crm/packages', { code: 'R6', name: 'Robotics 6 tháng', subjectId, months: 6, sessionsCount: 48, sessionsPerWeek: 2, basePrice: 12_000_000 })).body.data.id;
  pkgShort = (await admin().post('/api/v1/crm/packages', { code: 'R1', name: 'Robotics 4 buổi', subjectId, months: 1, sessionsCount: 4, sessionsPerWeek: 2, basePrice: 1_000_000 })).body.data.id;

  // sale1: một đăng ký mới, thu 3tr tháng này + 1tr tháng trước
  const a = await convert(sale1, 'Bé An', pkg6);
  studentA = a.studentId;
  await pay(cs, a.enrollmentId, 1_000_000, lastMonthAt);
  await pay(cs, a.enrollmentId, 3_000_000);
  // sale2: khoản thu chờ CS xác nhận (chưa tính doanh thu)
  const b = await convert(sale2, 'Bé Bình', pkg6);
  await pay(sale2, b.enrollmentId, 2_000_000);
  // Gói 4 buổi đã đóng đủ → còn 4 buổi ≤ ngưỡng → cần tái phí
  const c = await convert(sale2, 'Bé Châu', pkgShort);
  await pay(cs, c.enrollmentId, 1_000_000);
  // Tái phí cho bé An: CS chăm sóc → doanh thu tính cho CS
  await t.as(cm.token).post(`/api/v1/crm/students/${studentA}/assign`, { careId: cs.id });
  const renewal = await t.as(cs.token).post(`/api/v1/crm/students/${studentA}/enrollments`, { packageId: pkg6, startLevelId: levelId }).set(idem());
  await pay(cs, renewal.body.data.enrollmentId, 1_000_000);
  await t.drainEvents();
});
afterAll(() => t?.close());

describe('doanh thu = tiền đã thu, tính cho người được tính', () => {
  it('đăng ký mới → sale; tái phí → CS chăm sóc', async () => {
    const list = (await t.as(cm.token).get(`/api/v1/crm/enrollments?studentId=${studentA}`)).body.data as Array<{ type: string; creditName: string | null }>;
    expect(list.find((e) => e.type === 'NEW')?.creditName).toBe('Sale Một');
    expect(list.find((e) => e.type === 'RENEWAL')?.creditName).toBe('CS Một');
  });

  it('tổng quan tháng: chỉ khoản đã xác nhận trong tháng; so sánh tháng trước', async () => {
    const o = (await t.as(cm.token).get(`/api/v1/crm/reports/overview?from=${monthStart}&to=${monthEnd}`)).body.data;
    expect(o.revenue).toMatchObject({ total: 5_000_000, newEnrollments: 4_000_000, renewals: 1_000_000 });
    expect(o.revenue.previousTotal).toBe(1_000_000);
    expect(o.revenue.byDay).toHaveLength(Number(monthEnd.slice(8)));
    expect(o.revenue.byDay.find((d: { date: string }) => d.date === vnDate()).amount).toBe(5_000_000);
    expect(o.pendingPayments).toEqual({ count: 1, amount: 2_000_000 });
    expect(o.enrollments).toMatchObject({ newCount: 3, renewalCount: 1 });
    expect(o.funnel).toMatchObject({ leads: 3, converted: 3 });
    expect(o.ranking[0]).toMatchObject({ fullName: 'Sale Một', revenue: 3_000_000 });
    expect(o.renewalsDue).toBe(1);
  });

  it('SALE chỉ thấy doanh thu của mình', async () => {
    const o = (await t.as(sale1.token).get(`/api/v1/crm/reports/overview?from=${monthStart}&to=${monthEnd}`)).body.data;
    expect(o.revenue.total).toBe(3_000_000);
    expect(o.funnel.leads).toBe(1);
  });

  it('khoảng ngày sai → 400', async () => {
    expect((await t.as(cm.token).get(`/api/v1/crm/reports/overview?from=${monthEnd}&to=${monthStart}`)).status).toBe(400);
  });
});

describe('KPI tháng', () => {
  it('SL đặt mục tiêu cho sale trong nhóm, không đặt cho CS; SALE không có quyền', async () => {
    const put = (u: U, items: object[]) => t.api.put('/api/v1/crm/reports/kpi/targets').set('Authorization', `Bearer ${u.token}`).send({ month, items });
    expect((await put(sl, [{ userId: sale1.id, targetRevenue: 10_000_000 }])).status).toBe(204);
    expect((await put(sl, [{ userId: cs.id, targetRevenue: 5_000_000 }])).status).toBe(403);
    expect((await put(sale1, [{ userId: sale1.id, targetRevenue: 1 }])).status).toBe(403);
    expect((await put(cm, [{ userId: cs.id, targetRevenue: 4_000_000 }])).status).toBe(204);
  });

  it('bảng KPI: SL thấy nhóm mình; CM thấy cả CS; % mục tiêu', async () => {
    const asSl = (await t.as(sl.token).get(`/api/v1/crm/reports/kpi?month=${month}`)).body.data;
    expect(asSl.rows.map((r: { userId: string }) => r.userId).sort()).toEqual([sl.id, sale1.id, sale2.id].sort());
    const asCm = (await t.as(cm.token).get(`/api/v1/crm/reports/kpi?month=${month}`)).body.data;
    const row = (id: string) => asCm.rows.find((r: { userId: string }) => r.userId === id);
    expect(row(sale1.id)).toMatchObject({ target: 10_000_000, revenue: 3_000_000, progress: 30, newEnrollments: 1, leads: 1, converted: 1, managerName: 'sl' });
    expect(row(cs.id)).toMatchObject({ target: 4_000_000, revenue: 1_000_000, renewalRevenue: 1_000_000, renewals: 1, progress: 25, canEditTarget: true });
    expect(row(sale2.id)).toMatchObject({ revenue: 1_000_000, target: null });
    expect(asCm.totals).toMatchObject({ revenue: 5_000_000, target: 14_000_000 });
    // Mục tiêu tháng vào tổng quan khi xem trọn tháng
    expect((await t.as(cm.token).get(`/api/v1/crm/reports/overview?from=${monthStart}&to=${monthEnd}`)).body.data.revenue.target).toBe(14_000_000);
  });

  it('xuất Excel', async () => {
    const res = await t.as(cm.token).get(`/api/v1/crm/reports/kpi/export?month=${month}`).buffer(true).parse(binary as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });
});

describe('tái phí', () => {
  it('cần tái phí: gói sắp hết buổi; học viên vừa tái phí không còn trong danh sách', async () => {
    const r = (await t.as(cs.token).get('/api/v1/crm/renewals')).body.data;
    expect(r.due.map((d: { fullName: string }) => d.fullName)).toEqual(['Bé Châu']);
    expect(r.due[0]).toMatchObject({ reason: 'LOW_SESSIONS', sessionsRemaining: 4 });
    expect(r.renewed).toEqual([expect.objectContaining({ studentName: 'Bé An', creditName: 'CS Một' })]);
    expect(r.summary).toMatchObject({ due: 1, renewed: 1, rate: 50 });
  });
});

describe('thông báo', () => {
  it('khoản thu chờ xác nhận → CS và CM', async () => {
    expect((await notificationsOf(cs)).map((n) => n.type)).toContain('crm.payment.pending');
    expect((await notificationsOf(cm)).map((n) => n.type)).toContain('crm.payment.pending');
  });

  it('được giao lead → sale nhận; đánh dấu đã đọc', async () => {
    const lead = await t.as(cm.token).post('/api/v1/crm/leads', { parentName: 'PH', parentPhone: '0919999999', childName: 'Bé Dung', source: 'ZALO' });
    await t.as(cm.token).post('/api/v1/crm/leads/assign', { leadIds: [lead.body.data.id], ownerId: sale2.id });
    const list = await notificationsOf(sale2);
    expect(list[0]).toMatchObject({ type: 'crm.lead.assigned', link: `/leads/${lead.body.data.id}`, read: false });
    expect((await t.as(sale2.token).get('/api/v1/core/notifications/unread-count')).body.data.count).toBeGreaterThan(0);
    expect((await t.as(sale2.token).post('/api/v1/core/notifications/read', { all: true })).status).toBe(204);
    expect((await t.as(sale2.token).get('/api/v1/core/notifications/unread-count')).body.data.count).toBe(0);
  });

  it('yêu cầu ưu đãi → CM; duyệt xong → người xin', async () => {
    await convert(sale1, 'Bé Em', pkg6, { extraDiscount: 500_000, extraDiscountReason: 'Khách quen' });
    expect((await notificationsOf(cm)).map((n) => n.type)).toContain('crm.approval.requested');
    const pending = (await t.as(cm.token).get('/api/v1/crm/approvals?status=PENDING')).body.data[0];
    await t.as(cm.token).post(`/api/v1/crm/approvals/${pending.id}/approve`, {});
    expect((await notificationsOf(sale1))[0]).toMatchObject({ type: 'crm.approval.reviewed', title: 'Ưu đãi đã được duyệt' });
  });

  it('đóng tiền xong → CM / CS nhận "học viên mới chờ xếp lớp"', async () => {
    expect((await notificationsOf(cs)).map((n) => n.type)).toContain('lms.learner.waiting');
  });

  it('nhắc gọi lại: đến hạn trong giờ làm việc, mỗi lịch nhắc một lần', async () => {
    const at = new Date(`${vnDate()}T03:00:00Z`); // 10:00 giờ VN hôm nay
    const lead = await t.as(sale1.token).post('/api/v1/crm/leads', { parentName: 'PH', parentPhone: '0918888888', childName: 'Bé Gấm', source: 'ZALO' });
    await t.as(sale1.token).post(`/api/v1/crm/leads/${lead.body.data.id}/calls`, { outcome: 'CALL_BACK', nextFollowUpAt: new Date(at.getTime() - 10 * 60_000).toISOString() });
    await t.runJobs(at);
    await t.runJobs(at);
    const reminders = (await notificationsOf(sale1)).filter((n) => n.type === 'crm.lead.follow_up_due');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ link: `/leads/${lead.body.data.id}` });
  });

  it('ngoài giờ làm việc không nhắc gọi lại', async () => {
    const night = new Date(`${vnDate()}T16:00:00Z`); // 23:00 giờ VN
    const lead = await t.as(sale2.token).post('/api/v1/crm/leads', { parentName: 'PH', parentPhone: '0917777777', childName: 'Bé Hạnh', source: 'ZALO' });
    await t.as(sale2.token).post(`/api/v1/crm/leads/${lead.body.data.id}/calls`, { outcome: 'CALL_BACK', nextFollowUpAt: new Date(night.getTime() - 60_000).toISOString() });
    await t.runJobs(night);
    expect((await notificationsOf(sale2)).filter((n) => n.type === 'crm.lead.follow_up_due')).toHaveLength(0);
  });
});
