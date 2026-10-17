import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { leads } from '../../src/contexts/crm/db/schema.js';
import { vnDate } from '../../src/platform/time.js';
import { createTestApp, type TestApp } from './harness.js';

/** GĐ7 — trạng thái lead S1–S5 (docs/gd7-lead-stages.md). */

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string, b2: string;
let cm: U, sl: U, sale: U, cs: U, cm2: U, sale2: U;
let levelId: string, pkgId: string;
let phoneSeq = 0;

const admin = () => t.as(t.adminToken);
const idem = () => randomUUID();
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('G1');
  b2 = await t.makeBranch('G2');
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1] });
  cs = await t.makeUser({ email: 'cs@test.local', role: 'CS', branchIds: [b1], managerId: cm.id });
  sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale = await t.makeUser({ email: 'sale@test.local', role: 'SALE', branchIds: [b1], managerId: sl.id });
  cm2 = await t.makeUser({ email: 'cm2@test.local', role: 'CM', branchIds: [b2] });
  const sl2 = await t.makeUser({ email: 'sl2@test.local', role: 'SL', branchIds: [b2], managerId: cm2.id });
  sale2 = await t.makeUser({ email: 'sale2@test.local', role: 'SALE', branchIds: [b2], managerId: sl2.id });

  const subjectId = (await admin().post('/api/v1/lms/subjects', { code: 'ROB', name: 'Robotics' })).body.data.id;
  levelId = (await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ROB1', name: 'Robotics 1', sessionsCount: 14 })).body.data.id;
  await t.drainEvents();
  pkgId = (await admin().post('/api/v1/crm/packages', { code: 'R3', name: 'Robotics 3 tháng', subjectId, months: 3, sessionsCount: 24, basePrice: 6_000_000 })).body.data.id;
});
afterAll(() => t?.close());

async function newLead(u: U = sale) {
  phoneSeq += 1;
  const res = await t.as(u.token).post('/api/v1/crm/leads', { parentName: 'Phụ huynh', parentPhone: `09020000${String(phoneSeq).padStart(2, '0')}`, childName: `Bé ${phoneSeq}`, source: 'ZALO' });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}
const getLead = async (id: string, u: U = sale) => (await t.as(u.token).get(`/api/v1/crm/leads/${id}`)).body.data;
const book = (id: string, u: U = sale) => t.as(u.token).post(`/api/v1/crm/leads/${id}/appointments`, { type: 'EXPERIENCE', scheduledAt: inDays(1) });
const apptStatus = (apptId: string, status: string, u: U = sale) => t.as(u.token).post(`/api/v1/crm/appointments/${apptId}/status`, { status });
const call = (id: string, body: object, u: U = sale) => t.as(u.token).post(`/api/v1/crm/leads/${id}/calls`, body);
const setStatus = (id: string, body: object, u: U = sale) => t.as(u.token).post(`/api/v1/crm/leads/${id}/status`, body);
const enrollmentBody = () => ({ packageId: pkgId, startLevelId: levelId });
const convert = (id: string, u: U = sale) =>
  t.as(u.token).post(`/api/v1/crm/leads/${id}/convert`, { student: { fullName: 'Học viên GĐ7' }, enrollment: enrollmentBody() }).set('Idempotency-Key', idem());

describe('tự động theo nghiệp vụ', () => {
  it('S1A → S3A → S3B → S4A → S5A → S5B, mỗi lần đổi có lịch sử', async () => {
    const id = await newLead();
    let lead = await getLead(id);
    expect(lead).toMatchObject({ status: 'S1A', reachedS2At: null, enrollmentCancelled: false, stale: false });
    expect(lead.statusLogs).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'S1A', source: 'CREATE', actorName: 'sale' })]);

    const appt = (await book(id)).body.data.id;
    expect((await getLead(id)).status).toBe('S3A');
    await apptStatus(appt, 'CONFIRMED');
    expect((await getLead(id)).status).toBe('S3B');
    await apptStatus(appt, 'ATTENDED');
    lead = await getLead(id);
    expect(lead.status).toBe('S4A');
    expect(lead.reachedS4At).not.toBeNull();

    const converted = await convert(id);
    expect(converted.status).toBe(201);
    expect((await getLead(id)).status).toBe('S5A');
    await t.as(cs.token).post(`/api/v1/crm/enrollments/${converted.body.data.enrollmentId}/payments`, { amount: 1_000_000, method: 'CASH' }).set('Idempotency-Key', idem());
    lead = await getLead(id);
    expect(lead.status).toBe('S5B');
    expect(lead.statusLogs.map((l: { toStatus: string; source: string }) => `${l.source}:${l.toStatus}`)).toEqual([
      'PAYMENT:S5B',
      'ENROLLMENT:S5A',
      'APPOINTMENT:S4A',
      'APPOINTMENT:S3B',
      'APPOINTMENT:S3A',
      'CREATE:S1A',
    ]);
  });

  it('đặt lịch ngay từ S1 → lên thẳng S3, mốc S2 được điền cùng lúc', async () => {
    const id = await newLead();
    await book(id);
    const lead = await getLead(id);
    expect(lead.status).toBe('S3A');
    expect(lead.reachedS2At).toBe(lead.reachedS3At);
    expect(lead.reachedS4At).toBeNull();
  });

  it('chuyển đổi thẳng từ S1 → điền đủ mốc S2–S5', async () => {
    const id = await newLead();
    expect((await convert(id)).status).toBe(201);
    const lead = await getLead(id);
    expect(lead.status).toBe('S5A');
    expect([lead.reachedS2At, lead.reachedS3At, lead.reachedS4At]).toEqual([lead.reachedS5At, lead.reachedS5At, lead.reachedS5At]);
  });

  it('huỷ lịch → giữ S3; không đến → S3C (vẫn mở, ghi cuộc gọi được)', async () => {
    const id = await newLead();
    const a1 = (await book(id)).body.data.id;
    await apptStatus(a1, 'CANCELLED');
    expect((await getLead(id)).status).toBe('S3A');
    const a2 = (await book(id)).body.data.id;
    await apptStatus(a2, 'NO_SHOW');
    expect((await getLead(id)).status).toBe('S3C');
    const res = await call(id, { outcome: 'NO_ANSWER', note: 'Gọi hẹn lại không nghe', status: 'S3C' });
    expect(res.status).toBe(201);
    expect(res.body.data.calls[0].statusAfter).toBe('S3C');
  });

  it('không tự lùi bước: S4 đặt lịch mới vẫn ở S4', async () => {
    const id = await newLead();
    await apptStatus((await book(id)).body.data.id, 'ATTENDED');
    await book(id);
    expect((await getLead(id)).status).toBe('S4A');
  });
});

describe('ghi cuộc gọi / đổi trạng thái tay', () => {
  it('cuộc gọi thiếu ghi chú hoặc thiếu trạng thái → 400; có đủ → S1B, lưu lần gọi đầu', async () => {
    const id = await newLead();
    expect((await call(id, { outcome: 'NO_ANSWER', status: 'S1B' })).status).toBe(400);
    expect((await call(id, { outcome: 'NO_ANSWER', note: 'ok', status: 'S1B' })).status).toBe(400); // ghi chú < 3 ký tự
    expect((await call(id, { outcome: 'NO_ANSWER', note: 'Không nghe máy' })).status).toBe(400);
    const res = await call(id, { outcome: 'NO_ANSWER', note: 'Không nghe máy', status: 'S1B' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'S1B', reachedS2At: null });
    expect(res.body.data.firstCalledAt).toBe(res.body.data.lastContactedAt);
    expect(res.body.data.statusLogs[0]).toMatchObject({ fromStatus: 'S1A', toStatus: 'S1B', source: 'CALL', note: 'Không nghe máy' });
  });

  it('S3 / S4A / S5 không chọn tay được → 400', async () => {
    const id = await newLead();
    for (const status of ['S3A', 'S3B', 'S4A', 'S5A', 'S5B']) {
      expect((await setStatus(id, { status, note: 'Thử chọn tay' })).status).toBe(400);
      expect((await call(id, { outcome: 'TALKED', note: 'Thử chọn tay', status })).status).toBe(400);
    }
    expect((await setStatus(id, { status: 'S1A', note: 'Giữ nguyên' })).status).toBe(200); // giữ nguyên trạng thái hiện tại
    expect((await setStatus(id, { status: 'S2B', note: 'Đang cân nhắc học phí' })).body.data.status).toBe('S2B');
    expect((await setStatus(id, { status: 'S2B' })).status).toBe(400); // thiếu ghi chú
  });

  it('S4B / S4C chỉ khi đã đạt S4; S4B cần ngày hẹn đóng phí', async () => {
    const id = await newLead();
    expect((await setStatus(id, { status: 'S4B', note: 'Hẹn đóng phí', nextFollowUpAt: inDays(3) })).status).toBe(400);
    expect((await setStatus(id, { status: 'S4C', note: 'Từ chối', lostReason: 'Xa nhà' })).status).toBe(400);
    await apptStatus((await book(id)).body.data.id, 'ATTENDED');
    expect((await setStatus(id, { status: 'S4B', note: 'Hẹn đóng phí' })).status).toBe(400);
    const res = await setStatus(id, { status: 'S4B', note: 'Hẹn đóng phí thứ 7', nextFollowUpAt: inDays(3) });
    expect(res.body.data).toMatchObject({ status: 'S4B' });
    expect(res.body.data.nextFollowUpAt).not.toBeNull();
    // Lùi tay vẫn được, mốc S4 giữ nguyên
    const back = await setStatus(id, { status: 'S2B', note: 'Phụ huynh muốn suy nghĩ thêm' });
    expect(back.body.data).toMatchObject({ status: 'S2B' });
    expect(back.body.data.reachedS4At).not.toBeNull();
  });

  it('dừng cần lý do; lead dừng không ghi cuộc gọi được', async () => {
    const id = await newLead();
    await call(id, { outcome: 'TALKED', note: 'Phụ huynh quan tâm', status: 'S2A' });
    expect((await setStatus(id, { status: 'S2C', note: 'Từ chối' })).status).toBe(400);
    expect((await setStatus(id, { status: 'S2C', note: 'Từ chối', lostReason: 'Học phí cao' })).body.data).toMatchObject({ status: 'S2C', lostReason: 'Học phí cao' });
    expect((await call(id, { outcome: 'TALKED', note: 'Gọi lại', status: 'S2C' })).body.code).toBe('LEAD_CLOSED');
    expect((await book(id)).body.code).toBe('LEAD_CLOSED');
    expect((await convert(id)).body.code).toBe('LEAD_CLOSED');
  });

  it('cuộc gọi sai số → S1C kèm lý do', async () => {
    const id = await newLead();
    const res = await call(id, { outcome: 'WRONG_NUMBER', note: 'Số không đúng', status: 'S1C', lostReason: 'Sai số' });
    expect(res.body.data).toMatchObject({ status: 'S1C', lostReason: 'Sai số' });
  });

  it('mở lại: SALE → 403; SL mở lại được; lead chưa dừng → 409', async () => {
    const id = await newLead();
    await setStatus(id, { status: 'S1C', note: 'Không có nhu cầu', lostReason: 'Không có nhu cầu' });
    expect((await t.as(sale.token).post(`/api/v1/crm/leads/${id}/reopen`, { status: 'S2A', note: 'Phụ huynh gọi lại' })).status).toBe(403);
    expect((await t.as(sl.token).post(`/api/v1/crm/leads/${id}/reopen`, { status: 'S1C', note: 'Thử' })).status).toBe(400);
    const res = await t.as(sl.token).post(`/api/v1/crm/leads/${id}/reopen`, { status: 'S2A', note: 'Phụ huynh gọi lại hỏi lịch' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'S2A', lostReason: null });
    expect(res.body.data.statusLogs[0]).toMatchObject({ fromStatus: 'S1C', toStatus: 'S2A', source: 'REOPEN', actorName: 'sl' });
    expect((await t.as(sl.token).post(`/api/v1/crm/leads/${id}/reopen`, { status: 'S2B', note: 'Thử lại' })).body.code).toBe('LEAD_NOT_STOPPED');
  });

  it('có lịch hẹn chờ → không chọn được trạng thái dưới S3; huỷ lịch xong thì được', async () => {
    const id = await newLead();
    const appt = (await book(id)).body.data.id;
    expect((await setStatus(id, { status: 'S2B', note: 'Cân nhắc' })).body.code).toBe('LEAD_HAS_APPOINTMENT');
    expect((await call(id, { outcome: 'TALKED', note: 'Gọi nhắc lịch', status: 'S3A' })).status).toBe(201); // giữ nguyên
    await apptStatus(appt, 'CANCELLED');
    expect((await setStatus(id, { status: 'S2B', note: 'Cân nhắc lịch học' })).body.data.status).toBe('S2B');
  });

  it('PATCH không đổi trạng thái', async () => {
    const id = await newLead();
    expect((await t.as(sale.token).patch(`/api/v1/crm/leads/${id}`, { status: 'S2A' })).status).toBe(400);
    expect((await t.as(sale.token).patch(`/api/v1/crm/leads/${id}`, { school: 'TH Kim Đồng' })).body.data).toMatchObject({ status: 'S1A', school: 'TH Kim Đồng' });
  });
});

describe('đăng ký huỷ / đăng ký lại', () => {
  it('S5 khoá trạng thái; huỷ đăng ký → S5A + đánh dấu; đăng ký mới → bỏ đánh dấu', async () => {
    const id = await newLead();
    const { studentId, enrollmentId } = (await convert(id)).body.data;
    expect((await setStatus(id, { status: 'S2B', note: 'Thử đổi' })).body.code).toBe('LEAD_ENROLLED');

    expect((await t.as(cm.token).post(`/api/v1/crm/enrollments/${enrollmentId}/cancel`, { reason: 'Phụ huynh đổi ý' })).status).toBe(204);
    let lead = await getLead(id);
    expect(lead).toMatchObject({ status: 'S5A', enrollmentCancelled: true });

    // Được chọn lại trạng thái (vd. S2B) → bỏ đánh dấu
    expect((await setStatus(id, { status: 'S2B', note: 'Phụ huynh còn cân nhắc' })).body.data).toMatchObject({ status: 'S2B', enrollmentCancelled: false });
    expect((await t.as(sale.token).post(`/api/v1/crm/students/${studentId}/enrollments`, enrollmentBody()).set('Idempotency-Key', idem())).status).toBe(201);
    lead = await getLead(id);
    expect(lead).toMatchObject({ status: 'S5A', enrollmentCancelled: false });
  });

  it('huỷ rồi đăng ký lại ngay (không đổi tay) → bỏ đánh dấu', async () => {
    const id = await newLead();
    const { studentId, enrollmentId } = (await convert(id)).body.data;
    await t.as(cm.token).post(`/api/v1/crm/enrollments/${enrollmentId}/cancel`, { reason: 'Nhập nhầm gói' });
    expect((await getLead(id)).enrollmentCancelled).toBe(true);
    await t.as(sale.token).post(`/api/v1/crm/students/${studentId}/enrollments`, enrollmentBody()).set('Idempotency-Key', idem());
    expect(await getLead(id)).toMatchObject({ status: 'S5A', enrollmentCancelled: false });
  });
});

describe('danh sách, S1B quá hạn, báo cáo', () => {
  it('lọc theo bước / đã dừng; đếm đủ 14 trạng thái', async () => {
    const counts = (await t.as(cm.token).get('/api/v1/crm/leads/status-counts')).body.data;
    expect(Object.keys(counts)).toHaveLength(14);
    const s1 = (await t.as(cm.token).get('/api/v1/crm/leads?stage=1&pageSize=100')).body.data as Array<{ status: string }>;
    expect(s1.length).toBe(counts.S1A + counts.S1B + counts.S1C);
    const open1 = (await t.as(cm.token).get('/api/v1/crm/leads?stage=1&stopped=false&pageSize=100')).body.data as Array<{ status: string }>;
    expect(open1.every((l) => ['S1A', 'S1B'].includes(l.status))).toBe(true);
    const stopped = (await t.as(cm.token).get('/api/v1/crm/leads?stopped=true&pageSize=100')).body.meta.total;
    expect(stopped).toBe(counts.S1C + counts.S2C + counts.S4C);
  });

  it('S1B quá hạn hiện trong stale=true; job báo SL + CM một lần mỗi ngày', async () => {
    const id = await newLead();
    await call(id, { outcome: 'BUSY', note: 'Máy bận', status: 'S1B' });
    expect((await t.as(cm.token).get('/api/v1/crm/leads?stale=true')).body.meta.total).toBe(0);
    await t.crmDb
      .update(leads)
      .set({ firstCalledAt: new Date(Date.now() - 130 * 86_400_000) })
      .where(eq(leads.id, id));
    const stale = await t.as(cm.token).get('/api/v1/crm/leads?stale=true');
    expect(stale.body.data.map((l: { id: string }) => l.id)).toEqual([id]);
    expect(stale.body.data[0].stale).toBe(true);

    // Chi nhánh đặt hạn dài hơn → hết quá hạn
    await admin().patch('/api/v1/core/settings/crm.leads.s1b_window_days', { value: 200, branchId: b1 });
    expect((await t.as(cm.token).get('/api/v1/crm/leads?stale=true')).body.meta.total).toBe(0);
    await admin().patch('/api/v1/core/settings/crm.leads.s1b_window_days', { value: 120, branchId: b1 });

    const at = new Date(`${vnDate()}T03:00:00Z`); // 10:00 giờ VN
    await t.runJobs(at);
    await t.runJobs(at);
    const notes = async (u: U) =>
      ((await t.as(u.token).get('/api/v1/core/notifications?pageSize=50')).body.data as Array<{ type: string; title: string }>).filter((n) => n.type === 'crm.lead.s1b_stale');
    expect(await notes(sl)).toEqual([expect.objectContaining({ title: '1 lead S1B quá hạn khai thác' })]);
    expect(await notes(cm)).toHaveLength(1);
    expect(await notes(sale)).toHaveLength(0);
    expect(await notes(cm2)).toHaveLength(0);
  });

  it('phễu báo cáo theo mốc lần đầu đạt bước', async () => {
    // Chi nhánh riêng: A hẹn rồi huỷ, lùi về S2B; B dừng ở S1; C chuyển đổi thẳng
    const a = await newLead(sale2);
    const appt = (await book(a, sale2)).body.data.id;
    await apptStatus(appt, 'CANCELLED', sale2);
    await setStatus(a, { status: 'S2B', note: 'Cân nhắc thêm' }, sale2);
    const b = await newLead(sale2);
    await setStatus(b, { status: 'S1C', note: 'Không có nhu cầu', lostReason: 'Không có nhu cầu' }, sale2);
    const c = await newLead(sale2);
    expect((await convert(c, sale2)).status).toBe(201);

    const today = vnDate();
    const res = await t.as(cm2.token).get(`/api/v1/crm/reports/overview?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.data.funnel).toEqual({ leads: 3, contacted: 2, appointed: 2, attended: 1, converted: 1, lost: 1 });
    expect(res.body.data.sources).toEqual([{ source: 'ZALO', leads: 3, converted: 1 }]);
  });
});
