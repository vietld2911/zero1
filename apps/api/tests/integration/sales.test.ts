import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { outboxEvents } from '../../src/contexts/crm/db/schema.js';
import { createTestApp, type TestApp } from './harness.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string;
let am: U, cm: U, cs: U, sale: U, sale2: U, teacher: U;
let levelId: string, pkgId: string, promoId: string, itemId: string;

const admin = () => t.as(t.adminToken);
const idem = () => randomUUID();

async function outboxTypes(aggregateId: string) {
  return (await t.crmDb.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId))).map((e) => e.type);
}

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('S1');
  am = await t.makeUser({ email: 'am@test.local', role: 'AM', branchIds: [b1] });
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1], managerId: am.id });
  cs = await t.makeUser({ email: 'cs@test.local', role: 'CS', branchIds: [b1], managerId: cm.id });
  const sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  const sl2 = await t.makeUser({ email: 'sl2@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale = await t.makeUser({ email: 'sale@test.local', role: 'SALE', branchIds: [b1], managerId: sl.id });
  sale2 = await t.makeUser({ email: 'sale2@test.local', role: 'SALE', branchIds: [b1], managerId: sl2.id });
  teacher = await t.makeUser({ email: 'gv@test.local', role: 'TEACHER', branchIds: [b1] });

  const subjectId = (await admin().post('/api/v1/lms/subjects', { code: 'ROB', name: 'Robotics' })).body.data.id;
  levelId = (await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ROB1', name: 'Robotics 1', sessionsCount: 14 })).body.data.id;
  await t.drainEvents();
  pkgId = (
    await admin().post('/api/v1/crm/packages', { code: 'R6', name: 'Robotics 6 tháng', subjectId, months: 6, sessionsCount: 48, basePrice: 12_000_000, defaultScholarshipMonths: 1 })
  ).body.data.id;
  promoId = (await admin().post('/api/v1/crm/promotions', { code: 'KM10', name: 'Giảm 10%', discountType: 'PERCENT', discountValue: 10 })).body.data.id;
  itemId = (await admin().post('/api/v1/crm/promotion-items', { code: 'BALO', name: 'Balo' })).body.data.id;
  await t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'IN', quantity: 1 });
  // Hạn mức CM của chi nhánh: 5 triệu
  await admin().patch('/api/v1/core/settings/crm.approval.cm_limit', { value: 5_000_000, branchId: b1 });
});

/** Đọc body nhị phân (docx / xlsx) từ supertest. */
const binary = (res: IncomingMessage, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
afterAll(() => t?.close());

const lead = (overrides: object = {}) => ({
  parentName: 'Trần Thị Mai',
  parentPhone: '+84 912 345 678',
  childName: 'Trần Minh Khôi',
  childBirthYear: 2017,
  source: 'FACEBOOK',
  ...overrides,
});

describe('khách hàng tiềm năng', () => {
  let leadId: string;

  it('SALE tạo lead → tự phụ trách, SĐT được chuẩn hoá', async () => {
    const res = await t.as(sale.token).post('/api/v1/crm/leads', lead());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ parentPhone: '0912345678', ownerId: sale.id, status: 'NEW', branchId: b1 });
    leadId = res.body.data.id;
  });

  it('trùng SĐT: cùng con → luôn chặn; anh/chị em → chỉ người có quyền phân công tạo được', async () => {
    expect((await t.as(sale.token).post('/api/v1/crm/leads', lead())).body.code).toBe('LEAD_DUPLICATE');
    expect((await t.as(sale.token).post('/api/v1/crm/leads', lead({ childName: 'Trần Minh An', force: true }))).body.code).toBe('LEAD_DUPLICATE');
    expect((await t.as(cm.token).post('/api/v1/crm/leads', lead({ childName: 'Trần Minh Khôi', force: true }))).body.code).toBe('LEAD_DUPLICATE');
    const sibling = await t.as(cm.token).post('/api/v1/crm/leads', lead({ childName: 'Trần Minh An', force: true }));
    expect(sibling.status).toBe(201);
    expect(sibling.body.data.ownerId).toBeNull(); // CM tạo → chờ phân công
  });

  it('kiểm tra SĐT: lead ngoài phạm vi chỉ báo là có, không lộ id', async () => {
    const asOther = await t.as(sale2.token).get('/api/v1/crm/leads/check-phone?phone=0912345678');
    expect(asOther.body.data.leads).toHaveLength(2);
    expect(asOther.body.data.leads.every((l: { id: string | null }) => l.id === null)).toBe(true);
    const asOwner = await t.as(sale.token).get('/api/v1/crm/leads/check-phone?phone=0912.345.678');
    expect(asOwner.body.data.leads.find((l: { id: string | null }) => l.id === leadId)).toBeTruthy();
  });

  it('SALE chỉ thấy lead của mình; CM thấy cả chi nhánh', async () => {
    expect((await t.as(sale2.token).get('/api/v1/crm/leads')).body.meta.total).toBe(0);
    expect((await t.as(sale2.token).get(`/api/v1/crm/leads/${leadId}`)).status).toBe(404);
    expect((await t.as(cm.token).get('/api/v1/crm/leads')).body.meta.total).toBe(2);
    expect((await t.as(teacher.token).get('/api/v1/crm/leads')).status).toBe(403);
  });

  it('ghi cuộc gọi → đang liên hệ, hẹn gọi lại', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const res = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/calls`, { outcome: 'TALKED', note: 'Quan tâm robotics', nextFollowUpAt: at });
    expect(res.body.data).toMatchObject({ status: 'CONTACTING' });
    expect(res.body.data.calls[0]).toMatchObject({ outcome: 'TALKED', userName: 'sale' });
    expect((await t.as(sale.token).get('/api/v1/crm/leads/follow-ups')).body.data.map((l: { id: string }) => l.id)).toContain(leadId);
  });

  it('lịch trải nghiệm: đặt → SCHEDULED; đến → ATTENDED; không đổi lại được', async () => {
    const appt = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/appointments`, { type: 'EXPERIENCE', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(appt.status).toBe(201);
    expect((await t.as(sale.token).get(`/api/v1/crm/leads/${leadId}`)).body.data.status).toBe('SCHEDULED');
    await t.as(sale.token).post(`/api/v1/crm/appointments/${appt.body.data.id}/status`, { status: 'ATTENDED', resultNote: 'Bé thích' });
    expect((await t.as(sale.token).get(`/api/v1/crm/leads/${leadId}`)).body.data.status).toBe('ATTENDED');
    expect((await t.as(sale.token).post(`/api/v1/crm/appointments/${appt.body.data.id}/status`, { status: 'CANCELLED' })).body.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('học thử cần buổi học LMS; đặt được thì phát crm.trial.booked', async () => {
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/appointments`, { type: 'TRIAL', scheduledAt: at })).status).toBe(400);
    const res = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/appointments`, { type: 'TRIAL', scheduledAt: at, lmsSessionId: 'S'.repeat(26) });
    expect(await outboxTypes(res.body.data.id)).toEqual(['crm.trial.booked']);
    // Huỷ → báo LMS gỡ khách
    await t.as(sale.token).post(`/api/v1/crm/appointments/${res.body.data.id}/status`, { status: 'CANCELLED' });
    expect(await outboxTypes(res.body.data.id)).toEqual(['crm.trial.booked', 'crm.trial.cancelled']);
  });

  it('phân công: chỉ cho SALE/SL/CS/CM cùng chi nhánh', async () => {
    const unassigned = (await t.as(cm.token).get('/api/v1/crm/leads?ownerId=none')).body.data[0].id;
    expect((await t.as(cm.token).post('/api/v1/crm/leads/assign', { leadIds: [unassigned], ownerId: teacher.id })).body.code).toBe('OWNER_INVALID');
    expect((await t.as(sale.token).post('/api/v1/crm/leads/assign', { leadIds: [unassigned], ownerId: sale.id })).status).toBe(403);
    expect((await t.as(cm.token).post('/api/v1/crm/leads/assign', { leadIds: [unassigned], ownerId: sale2.id })).body.data.updated).toBe(1);
    expect((await t.as(sale2.token).get('/api/v1/crm/leads')).body.meta.total).toBe(1);
  });

  it('import Excel: dòng hợp lệ được tạo, dòng lỗi / trùng báo lại số dòng', async () => {
    const template = await t.as(cm.token).get('/api/v1/crm/leads/import-template').buffer(true).parse(binary as never);
    expect(template.headers['content-type']).toContain('spreadsheetml');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.addRow(['Họ tên phụ huynh', 'SĐT', 'Email', 'Tên học sinh', 'Năm sinh', 'Trường', 'Nguồn', 'Ghi chú']);
    ws.addRow(['Lê Văn Hùng', '0987 654 321', '', 'Lê Gia Bảo', 2016, 'TH Nghĩa Tân', 'Zalo', '']);
    ws.addRow(['Sai Số', '12345', '', 'Bé X', '', '', '', '']);
    ws.addRow(['Trần Thị Mai', '0912345678', '', 'Trần Minh Khôi', '', '', 'Facebook', '']); // trùng
    ws.addRow(['Lê Văn Hùng', '0987654321', '', 'Lê Gia Bảo', '', '', '', '']); // trùng trong file
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await t.api
      .post('/api/v1/crm/leads/import')
      .set('Authorization', `Bearer ${cm.token}`)
      .field('ownerId', sale.id)
      .attach('file', file, { filename: 'leads.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.skipped.map((s: { row: number }) => s.row)).toEqual([3, 4, 5]);
  });

  it('LOST cần lý do', async () => {
    const id = (await t.as(sale.token).post('/api/v1/crm/leads', lead({ parentPhone: '0900000001', childName: 'Bé Mất' }))).body.data.id;
    expect((await t.as(sale.token).patch(`/api/v1/crm/leads/${id}`, { status: 'LOST' })).status).toBe(400);
    expect((await t.as(sale.token).patch(`/api/v1/crm/leads/${id}`, { status: 'LOST', lostReason: 'Chọn trung tâm khác' })).body.data.status).toBe('LOST');
  });
});

describe('chuyển đổi, thu tiền, duyệt', () => {
  let leadId: string, studentId: string, enrollmentId: string;

  const convertBody = (overrides: object = {}) => ({
    student: { fullName: 'Phạm Gia Huy', birthDate: '2016-05-20', gender: 'MALE' },
    enrollment: {
      packageId: pkgId,
      startLevelId: levelId,
      promotionId: promoId,
      scholarshipMonths: 2,
      extraDiscount: 300_000,
      extraDiscountReason: 'Khách quen',
      gifts: [{ itemId, quantity: 1, deliveryCondition: 'ON_PAID' }],
      ...overrides,
    },
  });

  beforeAll(async () => {
    leadId = (await t.as(sale.token).post('/api/v1/crm/leads', lead({ parentPhone: '0911111111', parentName: 'Phạm Văn Nam', childName: 'Phạm Gia Huy' }))).body.data.id;
  });

  it('thiếu Idempotency-Key → 400; gửi lại cùng key không tạo trùng', async () => {
    expect((await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/convert`, convertBody())).status).toBe(400);
    const key = idem();
    const first = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/convert`, convertBody()).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    const again = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/convert`, convertBody()).set('Idempotency-Key', key);
    expect(again.body.data).toEqual(first.body.data);
    ({ studentId, enrollmentId } = first.body.data);

    expect((await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/convert`, convertBody()).set('Idempotency-Key', idem())).body.code).toBe('LEAD_CONVERTED');
  });

  it('học viên + đăng ký được tạo với giá chốt và phần chờ duyệt', async () => {
    const s = (await t.as(sale.token).get(`/api/v1/crm/students/${studentId}`)).body.data;
    expect(s).toMatchObject({ fullName: 'Phạm Gia Huy', status: 'PENDING', ownerId: sale.id });
    expect(s.code).toMatch(/^HV\d{2}-\d{5}$/);
    expect(s.guardians).toEqual([expect.objectContaining({ fullName: 'Phạm Văn Nam', phone: '0911111111', isPrimary: true })]);

    const e = (await t.as(sale.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect(e.code).toMatch(/^DK\d{2}-\d{5}$/);
    expect(e).toMatchObject({
      type: 'NEW',
      status: 'AWAITING_PAYMENT',
      listPrice: 12_000_000,
      promotionDiscount: 1_200_000,
      extraDiscountRequested: 300_000,
      extraDiscountApplied: 0,
      scholarshipMonthsGranted: 1,
      amountDue: 10_800_000,
      sessionsPurchased: 52,
      approvalStatus: 'PENDING',
      paymentState: 'UNPAID',
    });
    // 300k giảm thêm + 1 tháng vượt mức × (12tr / 6 tháng) = 2,3tr ≤ hạn mức 5tr của chi nhánh → CM
    expect(e.approval).toMatchObject({ status: 'PENDING', approverRole: 'CM', value: 2_300_000 });
    expect((await t.as(sale.token).get(`/api/v1/crm/leads/${leadId}`)).body.data).toMatchObject({ status: 'CONVERTED', convertedStudentId: studentId });
  });

  it('quà "khi đóng tiền" chưa giao được trước khoản thu đầu tiên', async () => {
    const e = (await t.as(sale.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect((await t.as(sale.token).post(`/api/v1/crm/enrollment-gifts/${e.gifts[0].id}/status`, { status: 'DELIVERED' })).body.code).toBe('GIFT_NOT_YET');
  });

  it('SALE ghi khoản thu → chờ xác nhận; CS xác nhận → kích hoạt + báo LMS', async () => {
    const pay = await t.as(sale.token).post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount: 5_000_000, method: 'TRANSFER' }).set('Idempotency-Key', idem());
    expect(pay.status).toBe(201);
    let e = (await t.as(sale.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect(e).toMatchObject({ status: 'AWAITING_PAYMENT', amountPaid: 0 });
    expect(e.payments[0]).toMatchObject({ status: 'PENDING', recordedByName: 'sale' });

    // Vượt số còn phải thu (tính cả khoản đang chờ)
    const over = await t.as(sale.token).post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount: 6_000_000, method: 'CASH' }).set('Idempotency-Key', idem());
    expect(over.body.code).toBe('PAYMENT_EXCEEDS_DUE');

    expect((await t.as(sale.token).post(`/api/v1/crm/payments/${pay.body.data.id}/confirm`)).status).toBe(403);
    expect((await t.as(cs.token).post(`/api/v1/crm/payments/${pay.body.data.id}/confirm`)).status).toBe(204);
    expect((await t.as(cs.token).post(`/api/v1/crm/payments/${pay.body.data.id}/confirm`)).body.code).toBe('PAYMENT_NOT_PENDING');

    e = (await t.as(sale.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect(e).toMatchObject({ status: 'ACTIVE', amountPaid: 5_000_000, paymentState: 'PARTIAL' });
    expect((await t.as(sale.token).get(`/api/v1/crm/students/${studentId}`)).body.data.status).toBe('ACTIVE');
    expect(await outboxTypes(enrollmentId)).toContain('crm.enrollment.activated');
  });

  it('CS ghi khoản thu → xác nhận ngay; quà được giao, trừ kho', async () => {
    const pay = await t.as(cs.token).post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount: 5_800_000, method: 'CASH' }).set('Idempotency-Key', idem());
    expect(pay.status).toBe(201);
    const e = (await t.as(cs.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect(e).toMatchObject({ amountPaid: 10_800_000, paymentState: 'PAID' });

    expect((await t.as(cs.token).post(`/api/v1/crm/enrollment-gifts/${e.gifts[0].id}/status`, { status: 'DELIVERED' })).status).toBe(204);
    const items = (await t.as(cm.token).get('/api/v1/crm/promotion-items')).body.data;
    expect(items.find((i: { id: string }) => i.id === itemId).totalStock).toBe(0);
  });

  it('duyệt: SALE không vào được; CM duyệt → số phải thu giảm, thêm buổi học bổng, hiện thu dư', async () => {
    expect((await t.as(sale.token).get('/api/v1/crm/approvals')).status).toBe(403);
    const list = (await t.as(cm.token).get('/api/v1/crm/approvals?status=PENDING')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ approverRole: 'CM', canReview: true, extraDiscount: 300_000, extraScholarshipMonths: 1 });

    expect((await t.as(cm.token).post(`/api/v1/crm/approvals/${list[0].id}/approve`, { note: 'OK' })).status).toBe(204);
    const e = (await t.as(cs.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data;
    expect(e).toMatchObject({
      approvalStatus: 'APPROVED',
      extraDiscountApplied: 300_000,
      scholarshipMonthsGranted: 2,
      amountDue: 10_500_000,
      sessionsPurchased: 56,
      paymentState: 'OVERPAID',
      balance: -300_000,
    });
    expect(await outboxTypes(enrollmentId)).toContain('crm.enrollment.adjusted');
    expect((await t.as(cm.token).post(`/api/v1/crm/approvals/${list[0].id}/approve`)).body.code).toBe('APPROVAL_ALREADY_REVIEWED');
  });

  it('mức AM: CM không duyệt được; người xin không tự duyệt', async () => {
    const s2 = await t.as(cm.token).post('/api/v1/crm/leads', lead({ parentPhone: '0922222222', childName: 'Bé Hai' }));
    const conv = await t.as(cm.token)
      .post(`/api/v1/crm/leads/${s2.body.data.id}/convert`, convertBody({ extraDiscount: 6_000_000, scholarshipMonths: 1, gifts: [] }))
      .set('Idempotency-Key', idem());
    expect(conv.status).toBe(201);
    const pending = (await t.as(cm.token).get('/api/v1/crm/approvals?status=PENDING')).body.data[0];
    expect(pending).toMatchObject({ approverRole: 'AM', canReview: false });
    expect((await t.as(cm.token).post(`/api/v1/crm/approvals/${pending.id}/approve`)).body.code).toBe('CANNOT_APPROVE_SELF');
    expect((await t.as(am.token).post(`/api/v1/crm/approvals/${pending.id}/reject`, { note: 'Quá cao' })).status).toBe(204);
    const e = (await t.as(cm.token).get(`/api/v1/crm/enrollments/${conv.body.data.enrollmentId}`)).body.data;
    expect(e).toMatchObject({ approvalStatus: 'REJECTED', extraDiscountApplied: 0, amountDue: 10_800_000 });
  });

  it('QR: thiếu tài khoản chi nhánh → 422; có tài khoản → link VietQR đúng số còn lại', async () => {
    const s3 = await t.as(sale.token).post('/api/v1/crm/leads', lead({ parentPhone: '0933333333', childName: 'Bé Ba' }));
    const conv = await t.as(sale.token)
      .post(`/api/v1/crm/leads/${s3.body.data.id}/convert`, convertBody({ promotionId: null, extraDiscount: 0, scholarshipMonths: 1, gifts: [] }))
      .set('Idempotency-Key', idem());
    const id = conv.body.data.enrollmentId;
    expect((await t.as(sale.token).get(`/api/v1/crm/enrollments/${id}/payment-qr`)).body.code).toBe('PAYMENT_ACCOUNT_MISSING');
    expect((await t.as(am.token).patch(`/api/v1/crm/payment-accounts/${b1}`, { account: { bankBin: '970422', accountNo: '0866766189', accountName: 'Công ty Zero1' } })).status).toBe(204);
    const qr = (await t.as(sale.token).get(`/api/v1/crm/enrollments/${id}/payment-qr`)).body.data;
    expect(qr).toMatchObject({ bankName: 'MB Bank', accountName: 'CONG TY ZERO1', amount: 12_000_000 });
    expect(qr.imageUrl).toContain('img.vietqr.io/image/970422-0866766189-compact2.png?amount=12000000');
    expect(qr.content).toMatch(/^DK\d{2}-\d{5} HV\d{2}-\d{5}$/);
  });

  it('phiếu đăng ký Word', async () => {
    const res = await t.as(sale.token).get(`/api/v1/crm/enrollments/${enrollmentId}/form.docx`).buffer(true).parse(binary as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml');
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('tái phí cho học viên đã có đăng ký', async () => {
    const res = await t.as(sale.token)
      .post(`/api/v1/crm/students/${studentId}/enrollments`, { packageId: pkgId, startLevelId: levelId, scholarshipMonths: 0 })
      .set('Idempotency-Key', idem());
    expect(res.status).toBe(201);
    const e = (await t.as(sale.token).get(`/api/v1/crm/enrollments/${res.body.data.enrollmentId}`)).body.data;
    expect(e).toMatchObject({ type: 'RENEWAL', saleId: sale.id, amountDue: 12_000_000, sessionsPurchased: 48 });
  });

  it('trừ buổi theo điểm danh LMS; sửa điểm danh → trả buổi', async () => {
    const sub = (name: string) => t.crmSubscriptions.find((s) => s.name === name)!;
    const envelope = (type: string, data: object) => ({
      id: `0${Date.now().toString(36).toUpperCase().padStart(25, '0')}`.slice(0, 26),
      type,
      version: 1,
      occurredAt: '',
      source: 'lms' as const,
      aggregateId: 'X'.repeat(26),
      branchId: b1,
      actorId: null,
      data,
    });
    const base = { sessionId: 'L'.repeat(26), classId: 'C'.repeat(26), learnerId: studentId, enrollmentId, sessionStartsAt: new Date().toISOString() };
    await sub('crm.enrollments.onAttendanceRecorded').handle(envelope('lms.attendance.recorded', { ...base, status: 'PRESENT', consumesSession: true }));
    expect((await t.as(cs.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data).toMatchObject({ sessionsUsed: 1, sessionsRemaining: 55 });
    await new Promise((r) => setTimeout(r, 5));
    await sub('crm.enrollments.onAttendanceCorrected').handle(envelope('lms.attendance.corrected', { ...base, status: 'EXCUSED', fromStatus: 'PRESENT', consumesSession: false }));
    expect((await t.as(cs.token).get(`/api/v1/crm/enrollments/${enrollmentId}`)).body.data.sessionsUsed).toBe(0);
  });

  it('bảo lưu học viên → phát crm.student.status_changed; cần lý do', async () => {
    expect((await t.as(cs.token).post(`/api/v1/crm/students/${studentId}/status`, { status: 'PAUSED' })).status).toBe(400);
    expect((await t.as(cs.token).post(`/api/v1/crm/students/${studentId}/status`, { status: 'PAUSED', reason: 'Đi du lịch' })).body.data.status).toBe('PAUSED');
    expect(await outboxTypes(studentId)).toContain('crm.student.status_changed');
    expect((await t.as(sale.token).post(`/api/v1/crm/students/${studentId}/status`, { status: 'ACTIVE' })).status).toBe(403);
  });

  it('tải giấy tờ lên hồ sơ', async () => {
    const res = await t.api
      .post(`/api/v1/crm/students/${studentId}/documents`)
      .set('Authorization', `Bearer ${sale.token}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'Giấy khai sinh.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data.documents[0]).toMatchObject({ name: 'Giấy khai sinh.pdf', mimeType: 'application/pdf' });
    const exe = await t.api
      .post(`/api/v1/crm/students/${studentId}/documents`)
      .set('Authorization', `Bearer ${sale.token}`)
      .attach('file', Buffer.from('MZ'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
    expect(exe.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });
});
