import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string, b2: string;
let am: U, cm: U, sale: U;
let subjectId: string;
let pkgId: string;

const admin = () => t.as(t.adminToken);

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('P1');
  b2 = await t.makeBranch('P2');
  am = await t.makeUser({ email: 'am@test.local', role: 'AM', branchIds: [b1] });
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1], managerId: am.id });
  const sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale = await t.makeUser({ email: 'sale@test.local', role: 'SALE', branchIds: [b1], managerId: sl.id });

  // Chương trình học từ LMS → bản sao trong CRM
  subjectId = (await admin().post('/api/v1/lms/subjects', { code: 'ROB', name: 'Robotics' })).body.data.id;
  await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ROB1', name: 'Robotics 1', sessionsCount: 14 });
  await t.drainEvents();
});
afterAll(() => t?.close());

describe('gói học phí', () => {
  it('môn học lấy từ bản sao LMS; môn không tồn tại → 400', async () => {
    const subjects = await t.as(sale.token).get('/api/v1/crm/catalog/subjects');
    expect(subjects.body.data).toEqual([{ id: subjectId, code: 'ROB', name: 'Robotics' }]);
    const bad = await admin().post('/api/v1/crm/packages', {
      code: 'X',
      name: 'Sai môn',
      subjectId: 'X'.repeat(26),
      months: 3,
      sessionsCount: 24,
      basePrice: 1,
    });
    expect(bad.status).toBe(400);
  });

  it('ADMIN tạo gói; SALE chỉ xem', async () => {
    const res = await admin().post('/api/v1/crm/packages', {
      code: 'rob-6t',
      name: 'Robotics 6 tháng',
      subjectId,
      months: 6,
      sessionsCount: 48,
      basePrice: 12_000_000,
      defaultScholarshipMonths: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'ROB-6T', subjectName: 'Robotics', sessionsPerWeek: 2 });
    pkgId = res.body.data.id;

    expect((await t.as(sale.token).post('/api/v1/crm/packages', { code: 'Y', name: 'Y', subjectId, months: 1, sessionsCount: 1, basePrice: 1 })).status).toBe(403);
    expect((await t.as(sale.token).get('/api/v1/crm/packages')).body.data).toHaveLength(1);
  });

  it('học bổng mặc định không vượt số tháng của gói', async () => {
    const res = await admin().patch(`/api/v1/crm/packages/${pkgId}`, { defaultScholarshipMonths: 7 });
    expect(res.status).toBe(400);
  });

  it('AM đặt giá riêng cho chi nhánh mình, không đặt được chi nhánh khác', async () => {
    const ok = await t.as(am.token).patch(`/api/v1/crm/packages/${pkgId}/branch-prices`, { branchId: b1, price: 11_000_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.effectivePrice).toBe(11_000_000);
    expect((await t.as(am.token).patch(`/api/v1/crm/packages/${pkgId}/branch-prices`, { branchId: b2, price: 1 })).body.code).toBe('BRANCH_OUT_OF_SCOPE');

    const atB2 = await admin().get(`/api/v1/crm/packages?branchId=${b2}`);
    expect(atB2.body.data[0].effectivePrice).toBe(12_000_000);
  });
});

describe('khuyến mại', () => {
  it('kiểm tra dữ liệu chương trình', async () => {
    expect((await admin().post('/api/v1/crm/promotions', { code: 'A', name: 'Sai %', discountType: 'PERCENT', discountValue: 150 })).status).toBe(400);
    expect(
      (await admin().post('/api/v1/crm/promotions', { code: 'B1', name: 'Trần sai', discountType: 'AMOUNT', discountValue: 100, maxDiscount: 50 })).status,
    ).toBe(400);
    expect(
      (await admin().post('/api/v1/crm/promotions', { code: 'C1', name: 'Ngày sai', discountType: 'AMOUNT', discountValue: 100, startDate: '2026-10-10', endDate: '2026-10-01' }))
        .status,
    ).toBe(400);
  });

  it('chỉ trả chương trình áp dụng được cho chi nhánh + gói', async () => {
    await admin().post('/api/v1/crm/promotions', {
      code: 'HE10',
      name: 'Giảm 10% hè',
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscount: 1_000_000,
      branchIds: [b1],
    });
    const atB1 = await t.as(sale.token).get(`/api/v1/crm/promotions?branchId=${b1}&packageId=${pkgId}`);
    expect(atB1.body.data.map((p: { code: string }) => p.code)).toContain('HE10');
    const atB2 = await admin().get(`/api/v1/crm/promotions?branchId=${b2}&packageId=${pkgId}`);
    expect(atB2.body.data.map((p: { code: string }) => p.code)).not.toContain('HE10');
  });
});

describe('tính học phí', () => {
  const quote = (token: string, body: object) => t.as(token).post('/api/v1/crm/pricing/quote', { packageId: pkgId, branchId: b1, ...body });
  const promoId = async (code: string) =>
    (await admin().get('/api/v1/crm/promotions?includeInactive=true')).body.data.find((p: { code: string }) => p.code === code).id as string;

  it('giá chi nhánh + KM có trần + học bổng mặc định', async () => {
    const res = await quote(sale.token, { promotionId: await promoId('HE10') });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      priceSource: 'BRANCH',
      listPrice: 11_000_000,
      promotion: { code: 'HE10', discount: 1_000_000 },
      amountDue: 10_000_000,
      sessions: { package: 48, scholarship: 4, total: 52 },
      approval: null,
    });
  });

  it('KM hết hạn / không áp dụng chi nhánh → 422', async () => {
    const expired = (
      await admin().post('/api/v1/crm/promotions', { code: 'CU', name: 'Cũ', discountType: 'AMOUNT', discountValue: 100_000, endDate: '2020-01-01' })
    ).body.data.id;
    const res = await quote(sale.token, { promotionId: expired });
    expect(res.body).toMatchObject({ code: 'PROMOTION_NOT_APPLICABLE', detail: 'Chương trình đã hết hạn' });
    const other = await admin().post('/api/v1/crm/pricing/quote', { packageId: pkgId, branchId: b2, promotionId: await promoId('HE10') });
    expect(other.body.detail).toBe('Chương trình không áp dụng cho chi nhánh này');
  });

  it('giảm thêm + học bổng vượt mức → cần duyệt; hạn mức CM theo chi nhánh', async () => {
    const res = await quote(sale.token, { extraDiscount: 500_000, scholarshipMonths: 2 });
    // 500k + 1 tháng × (11tr / 6) = 2.333.333 > 2tr → AM
    expect(res.body.data.approval).toEqual({ value: 2_333_333, approverRole: 'AM', reasons: ['EXTRA_DISCOUNT', 'EXTRA_SCHOLARSHIP'] });
    expect(res.body.data.amountDue).toBe(11_000_000);
    expect(res.body.data.amountDueIfApproved).toBe(10_500_000);

    await admin().patch('/api/v1/core/settings/crm.approval.cm_limit', { value: 5_000_000, branchId: b1 });
    expect((await quote(sale.token, { extraDiscount: 500_000, scholarshipMonths: 2 })).body.data.approval.approverRole).toBe('CM');
  });

  it('giảm thêm vượt số còn lại → 422', async () => {
    expect((await quote(sale.token, { extraDiscount: 20_000_000 })).body.code).toBe('EXTRA_DISCOUNT_TOO_LARGE');
  });

  it('không tính giá cho chi nhánh ngoài phạm vi; gói ngừng bán → 422', async () => {
    expect((await t.as(sale.token).post('/api/v1/crm/pricing/quote', { packageId: pkgId, branchId: b2 })).body.code).toBe('BRANCH_OUT_OF_SCOPE');
    await admin().patch(`/api/v1/crm/packages/${pkgId}`, { isActive: false });
    expect((await quote(sale.token, {})).body.code).toBe('PACKAGE_INACTIVE');
    await admin().patch(`/api/v1/crm/packages/${pkgId}`, { isActive: true });
  });
});

describe('kho quà tặng', () => {
  let itemId: string;

  it('nhập / xuất kho theo chi nhánh, không cho tồn âm', async () => {
    itemId = (await admin().post('/api/v1/crm/promotion-items', { code: 'balo', name: 'Balo Zero1', minStock: 3 })).body.data.id;
    expect((await t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'IN', quantity: 10 })).body.data).toEqual({
      branchId: b1,
      quantity: 10,
    });
    const tooMany = await t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'OUT', quantity: 15 });
    expect(tooMany.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'OUT', quantity: 8 })).body.data.quantity).toBe(2);
  });

  it('cảnh báo sắp hết, chỉ thấy tồn chi nhánh mình; SALE không thao tác kho', async () => {
    await admin().post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b2, kind: 'IN', quantity: 50 });
    const asCm = (await t.as(cm.token).get('/api/v1/crm/promotion-items')).body.data.find((i: { id: string }) => i.id === itemId);
    expect(asCm).toMatchObject({ code: 'BALO', totalStock: 2, lowStockBranches: [b1] });
    const asAdmin = (await admin().get('/api/v1/crm/promotion-items')).body.data.find((i: { id: string }) => i.id === itemId);
    expect(asAdmin.totalStock).toBe(52);

    expect((await t.as(sale.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'IN', quantity: 1 })).status).toBe(403);
    expect((await t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b2, kind: 'IN', quantity: 1 })).body.code).toBe('BRANCH_OUT_OF_SCOPE');
  });

  it('hai lần xuất đồng thời không làm tồn âm', async () => {
    await t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'IN', quantity: 4 }); // còn 6
    const results = await Promise.all(
      [1, 2].map(() => t.as(cm.token).post(`/api/v1/crm/promotion-items/${itemId}/stock-moves`, { branchId: b1, kind: 'OUT', quantity: 4 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const moves = await t.as(cm.token).get(`/api/v1/crm/promotion-items/${itemId}/stock-moves?branchId=${b1}`);
    expect(moves.body.data.reduce((s: number, m: { quantity: number }) => s + m.quantity, 0)).toBe(2);
  });
});
