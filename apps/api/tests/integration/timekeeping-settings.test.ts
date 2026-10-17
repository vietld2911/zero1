import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RENEWAL_REMAINING_THRESHOLD } from '../../src/contexts/crm/settings.js';
import { createTestApp, type TestApp } from './harness.js';
import { vnDate } from '../../src/platform/time.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string;
let cm: U, sale: U, other: U;

const today = vnDate();
const yesterday = vnDate(new Date(Date.now() - 86_400_000));

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('TK1');
  const b2 = await t.makeBranch('TK2');
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1] });
  const sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale = await t.makeUser({ email: 'sale@test.local', role: 'SALE', branchIds: [b1], managerId: sl.id });
  other = await t.makeUser({ email: 'other@test.local', role: 'SALE', branchIds: [b2] });
});
afterAll(() => t?.close());

describe('check-in / check-out', () => {
  it('check-in một lần, check-out một lần', async () => {
    const s = t.as(sale.token);
    const inRes = await s.post('/api/v1/core/timekeeping/check-in');
    expect(inRes.status).toBe(201);
    expect(inRes.body.data).toMatchObject({ status: 'OPEN', branchId: b1, workDate: today, checkInSource: 'WEB' });
    expect((await s.post('/api/v1/core/timekeeping/check-in')).body.code).toBe('ALREADY_CHECKED_IN');

    const status = await s.get('/api/v1/core/timekeeping/me');
    expect(status.body.data.current.id).toBe(inRes.body.data.id);

    const out = await s.post('/api/v1/core/timekeeping/check-out', { latitude: 21.03, longitude: 105.85 });
    expect(out.body.data).toMatchObject({ status: 'CLOSED', checkOutSource: 'WEB' });
    expect((await s.post('/api/v1/core/timekeeping/check-out')).body.code).toBe('NOT_CHECKED_IN');
  });

  it('bấm check-in đồng thời chỉ tạo một lượt', async () => {
    const s = t.as(cm.token);
    const results = await Promise.all([1, 2, 3].map(() => s.post('/api/v1/core/timekeeping/check-in')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    await s.post('/api/v1/core/timekeeping/check-out');
  });

  it('không check-in ở chi nhánh không được gán', async () => {
    const res = await t.as(other.token).post('/api/v1/core/timekeeping/check-in', { branchId: b1 });
    expect(res.body.code).toBe('BRANCH_OUT_OF_SCOPE');
  });

  it('SALE chỉ xem công của mình; CM xem được cấp dưới', async () => {
    const own = await t.as(sale.token).get(`/api/v1/core/timekeeping/entries?from=${today}&to=${today}`);
    expect(own.body.data.every((e: { userId: string }) => e.userId === sale.id)).toBe(true);
    expect((await t.as(sale.token).get(`/api/v1/core/timekeeping/entries?from=${today}&to=${today}&userId=${cm.id}`)).status).toBe(403);

    const team = await t.as(cm.token).get(`/api/v1/core/timekeeping/entries?from=${today}&to=${today}&userId=${sale.id}`);
    expect(team.body.data).toHaveLength(1);
    expect((await t.as(cm.token).get(`/api/v1/core/timekeeping/entries?from=${today}&to=${today}&userId=${other.id}`)).body.data).toHaveLength(0);
  });

  it('giới hạn khoảng ngày', async () => {
    expect((await t.as(cm.token).get('/api/v1/core/timekeeping/entries?from=2026-01-01&to=2026-06-01')).status).toBe(400);
  });
});

describe('sửa công', () => {
  const at = (date: string, hm: string) => `${date}T${hm}:00+07:00`;

  it('nhân viên gửi yêu cầu → chờ duyệt; quản lý duyệt → lượt công được thêm', async () => {
    const req = await t.as(sale.token).post('/api/v1/core/timekeeping/adjustments', {
      checkInAt: at(yesterday, '08:00'),
      checkOutAt: at(yesterday, '17:30'),
      reason: 'Quên check-in hôm qua',
    });
    expect(req.status).toBe(201);
    expect(req.body.data).toMatchObject({ status: 'PENDING', workDate: yesterday });

    expect((await t.as(sale.token).post(`/api/v1/core/timekeeping/adjustments/${req.body.data.id}/approve`)).status).toBe(403);

    const queue = await t.as(cm.token).get('/api/v1/core/timekeeping/adjustments?view=review&status=PENDING');
    expect(queue.body.data.map((a: { id: string }) => a.id)).toContain(req.body.data.id);

    const approved = await t.as(cm.token).post(`/api/v1/core/timekeeping/adjustments/${req.body.data.id}/approve`, { note: 'OK' });
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewNote: 'OK', reviewedBy: { id: cm.id } });
    expect((await t.as(cm.token).post(`/api/v1/core/timekeeping/adjustments/${req.body.data.id}/approve`)).body.code).toBe(
      'ADJUSTMENT_ALREADY_REVIEWED',
    );

    const entries = await t.as(sale.token).get(`/api/v1/core/timekeeping/entries?from=${yesterday}&to=${yesterday}`);
    expect(entries.body.data[0]).toMatchObject({ status: 'ADJUSTED', durationMinutes: 570, checkInSource: 'MANUAL' });
  });

  it('quản lý sửa công cho cấp dưới → có hiệu lực ngay; tự duyệt cho mình → bị chặn', async () => {
    const direct = await t.as(cm.token).post('/api/v1/core/timekeeping/adjustments', {
      userId: sale.id,
      checkInAt: at(yesterday, '18:00'),
      checkOutAt: at(yesterday, '20:00'),
      reason: 'Dạy bù buổi tối',
    });
    expect(direct.body.data.status).toBe('APPROVED');

    const mine = await t.as(cm.token).post('/api/v1/core/timekeeping/adjustments', {
      checkInAt: at(yesterday, '08:00'),
      checkOutAt: at(yesterday, '12:00'),
      reason: 'Quên chấm công',
    });
    expect(mine.body.data.status).toBe('PENDING');
    expect((await t.as(cm.token).post(`/api/v1/core/timekeeping/adjustments/${mine.body.data.id}/approve`)).body.code).toBe('CANNOT_APPROVE_SELF');
  });

  it('từ chối ca dài hơn mức cho phép hoặc giờ ra trước giờ vào', async () => {
    const long = await t.as(sale.token).post('/api/v1/core/timekeeping/adjustments', {
      checkInAt: at(yesterday, '00:00'),
      checkOutAt: at(yesterday, '23:00'),
      reason: 'Thử ca dài',
    });
    expect(long.status).toBe(400);
    const reversed = await t.as(sale.token).post('/api/v1/core/timekeeping/adjustments', {
      checkInAt: at(yesterday, '17:00'),
      checkOutAt: at(yesterday, '08:00'),
      reason: 'Thử đảo giờ',
    });
    expect(reversed.status).toBe(400);
  });

  it('bảng công tổng hợp', async () => {
    const res = await t.as(cm.token).get(`/api/v1/core/timekeeping/summary?from=${yesterday}&to=${today}`);
    const row = res.body.data.find((r: { userId: string }) => r.userId === sale.id);
    expect(row).toMatchObject({ workDays: 2, adjustedEntries: 2, missingCheckouts: 0 });
    expect(row.totalMinutes).toBeGreaterThanOrEqual(570 + 120);
    expect(res.body.data.some((r: { userId: string }) => r.userId === other.id)).toBe(false);
  });
});

describe('cài đặt', () => {
  it('chỉ ADMIN xem / sửa', async () => {
    expect((await t.as(cm.token).get('/api/v1/core/settings')).status).toBe(403);
    const res = await t.as(t.adminToken).get('/api/v1/core/settings');
    expect(res.body.data.map((s: { key: string }) => s.key)).toEqual(
      expect.arrayContaining(['core.timekeeping.max_shift_hours', 'crm.renewal.remaining_threshold', 'lms.attendance.consuming_statuses']),
    );
  });

  it('kiểm tra giá trị theo schema; ưu tiên chi nhánh → chung → mặc định', async () => {
    const admin = t.as(t.adminToken);
    const reader = t.core.contract.settings;
    expect(await reader.get(RENEWAL_REMAINING_THRESHOLD, b1)).toBe(4);

    expect((await admin.patch('/api/v1/core/settings/crm.renewal.remaining_threshold', { value: -1 })).status).toBe(400);
    expect((await admin.patch('/api/v1/core/settings/crm.renewal.remaining_threshold', { value: 'năm' })).status).toBe(400);
    expect((await admin.patch('/api/v1/core/settings/crm.renewal.remaining_threshold', { value: 5 })).status).toBe(204);
    expect((await admin.patch('/api/v1/core/settings/crm.renewal.remaining_threshold', { value: 3, branchId: b1 })).status).toBe(204);

    expect(await reader.get(RENEWAL_REMAINING_THRESHOLD, b1)).toBe(3);
    expect(await reader.get(RENEWAL_REMAINING_THRESHOLD, 'X'.repeat(26))).toBe(5);

    await admin.delete(`/api/v1/core/settings/crm.renewal.remaining_threshold?branchId=${b1}`);
    expect(await reader.get(RENEWAL_REMAINING_THRESHOLD, b1)).toBe(5);
  });

  it('cấu hình không cho đặt theo chi nhánh → 422', async () => {
    const res = await t
      .as(t.adminToken)
      .patch('/api/v1/core/settings/lms.attendance.consuming_statuses', { value: ['PRESENT'], branchId: b1 });
    expect(res.body.code).toBe('SETTING_NOT_PER_BRANCH');
  });

  it('gửi email thử', async () => {
    t.mailer.sent.length = 0;
    expect((await t.as(t.adminToken).post('/api/v1/core/settings/email/test', { to: 'it@test.local' })).status).toBe(204);
    expect(t.mailer.sent[0]?.to).toBe('it@test.local');
  });
});
