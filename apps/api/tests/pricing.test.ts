import { describe, expect, it } from 'vitest';
import { computeQuote, PricingError, promotionDiscount, type QuoteInput } from '../src/contexts/crm/modules/pricing/pricing.core.js';

/** Gói Robotics 6 tháng · 48 buổi · 12.000.000đ · học bổng mặc định 1 tháng. */
const base: QuoteInput = {
  listPrice: 12_000_000,
  packageMonths: 6,
  packageSessions: 48,
  defaultScholarshipMonths: 1,
  promotion: null,
  extraDiscount: 0,
  scholarshipMonths: 1,
  approved: false,
  sessionsPerMonth: 4,
  cmApprovalLimit: 2_000_000,
};

const percent = (value: number, maxDiscount: number | null = null) => ({
  id: 'p',
  code: 'KM',
  name: 'KM',
  discountType: 'PERCENT' as const,
  discountValue: value,
  maxDiscount,
});
const amount = (value: number) => ({ id: 'a', code: 'KM', name: 'KM', discountType: 'AMOUNT' as const, discountValue: value, maxDiscount: null });

describe('khuyến mại', () => {
  it('giảm % làm tròn tới đồng', () => {
    expect(promotionDiscount(1_234_567, percent(10))).toBe(123_457);
  });

  it('giảm % bị chặn bởi mức trần (students.html / renewals.html cũ bỏ qua trần)', () => {
    expect(promotionDiscount(12_000_000, percent(20, 1_500_000))).toBe(1_500_000);
    expect(promotionDiscount(5_000_000, percent(20, 1_500_000))).toBe(1_000_000);
  });

  it('giảm số tiền cố định được áp đúng (trial-calendar.html cũ luôn ra 0đ)', () => {
    expect(promotionDiscount(12_000_000, amount(500_000))).toBe(500_000);
  });

  it('không giảm quá giá niêm yết', () => {
    expect(promotionDiscount(300_000, amount(500_000))).toBe(300_000);
    expect(promotionDiscount(1_000_000, percent(100))).toBe(1_000_000);
  });
});

describe('computeQuote', () => {
  it('không KM, học bổng trong mức mặc định → không cần duyệt', () => {
    const q = computeQuote(base);
    expect(q.amountDue).toBe(12_000_000);
    expect(q.approval).toBeNull();
    expect(q.scholarship).toEqual({ defaultMonths: 1, requestedMonths: 1, grantedMonths: 1, pendingMonths: 0 });
    expect(q.sessions).toEqual({ package: 48, scholarship: 4, total: 52 });
    expect(q.months).toEqual({ package: 6, scholarship: 1, total: 7 });
  });

  it('thứ tự: giá niêm yết → KM (tính trên giá niêm yết) → giảm thêm', () => {
    const q = computeQuote({ ...base, promotion: percent(10), extraDiscount: 300_000, approved: true });
    expect(q.promotion?.discount).toBe(1_200_000);
    expect(q.extraDiscount).toEqual({ requested: 300_000, applied: 300_000 });
    expect(q.amountDue).toBe(10_500_000);
  });

  it('giảm thêm chưa duyệt: chưa trừ vào số phải thu, báo số sau khi duyệt', () => {
    const q = computeQuote({ ...base, extraDiscount: 500_000 });
    expect(q.amountDue).toBe(12_000_000);
    expect(q.amountDueIfApproved).toBe(11_500_000);
    expect(q.approval).toEqual({ value: 500_000, approverRole: 'CM', reasons: ['EXTRA_DISCOUNT'] });
  });

  it('giảm thêm đã duyệt phải được trừ (backend cũ quên trừ)', () => {
    expect(computeQuote({ ...base, extraDiscount: 500_000, approved: true }).amountDue).toBe(11_500_000);
  });

  it('học bổng vượt mức: chỉ cấp phần mặc định cho tới khi duyệt (tái phí cũ cấp hết)', () => {
    const pending = computeQuote({ ...base, scholarshipMonths: 3 });
    expect(pending.scholarship).toEqual({ defaultMonths: 1, requestedMonths: 3, grantedMonths: 1, pendingMonths: 2 });
    expect(pending.sessions.total).toBe(52);
    // 2 tháng vượt × (12tr / 6 tháng) = 4tr > hạn mức CM 2tr → AM duyệt
    expect(pending.approval).toEqual({ value: 4_000_000, approverRole: 'AM', reasons: ['EXTRA_SCHOLARSHIP'] });

    const approved = computeQuote({ ...base, scholarshipMonths: 3, approved: true });
    expect(approved.scholarship.grantedMonths).toBe(3);
    // Buổi học bổng được cộng vào số buổi (tái phí cũ chỉ cộng hạn, quên cộng buổi)
    expect(approved.sessions).toEqual({ package: 48, scholarship: 12, total: 60 });
    expect(approved.months.total).toBe(9);
    expect(approved.approval).toBeNull();
  });

  it('gộp giảm thêm và học bổng vượt mức vào một lần duyệt', () => {
    const q = computeQuote({ ...base, extraDiscount: 200_000, scholarshipMonths: 2 });
    expect(q.approval).toEqual({ value: 2_200_000, approverRole: 'AM', reasons: ['EXTRA_DISCOUNT', 'EXTRA_SCHOLARSHIP'] });
  });

  it('đúng bằng hạn mức → CM duyệt', () => {
    expect(computeQuote({ ...base, extraDiscount: 2_000_000 }).approval?.approverRole).toBe('CM');
    expect(computeQuote({ ...base, extraDiscount: 2_000_001 }).approval?.approverRole).toBe('AM');
  });

  it('giảm thêm không được vượt giá sau khuyến mại', () => {
    expect(() => computeQuote({ ...base, promotion: amount(11_000_000), extraDiscount: 1_000_001 })).toThrow(PricingError);
    expect(computeQuote({ ...base, promotion: amount(11_000_000), extraDiscount: 1_000_000, approved: true }).amountDue).toBe(0);
  });

  it('xin ít hơn học bổng mặc định thì chỉ cấp phần xin', () => {
    expect(computeQuote({ ...base, scholarshipMonths: 0 }).scholarship.grantedMonths).toBe(0);
  });

  it('từ chối số lẻ / số âm', () => {
    expect(() => computeQuote({ ...base, extraDiscount: -1 })).toThrow(/extraDiscount/);
    expect(() => computeQuote({ ...base, listPrice: 100.5 })).toThrow(/listPrice/);
  });

  it('số buổi / tháng học bổng theo cấu hình', () => {
    expect(computeQuote({ ...base, sessionsPerMonth: 8 }).sessions.scholarship).toBe(8);
  });
});
