/**
 * Lõi tính học phí — hàm thuần, không đụng DB. Quy tắc: docs/pricing-rules.md.
 * Mọi luồng (xem trước, chuyển lead, tái phí) đều đi qua `computeQuote`.
 */

export type DiscountType = 'PERCENT' | 'AMOUNT';

export interface QuotePromotion {
  id: string;
  code: string;
  name: string;
  discountType: DiscountType;
  /** PERCENT: 1–100. AMOUNT: số tiền VNĐ. */
  discountValue: number;
  /** Trần số tiền giảm cho loại PERCENT; null = không trần. */
  maxDiscount: number | null;
}

export interface QuoteInput {
  /** Giá niêm yết đã chọn (giá chi nhánh ?? giá gốc). */
  listPrice: number;
  packageMonths: number;
  packageSessions: number;
  defaultScholarshipMonths: number;
  promotion: QuotePromotion | null;
  /** Số tiền xin giảm thêm. */
  extraDiscount: number;
  /** Tổng số tháng học bổng xin (gồm cả phần mặc định của gói). */
  scholarshipMonths: number;
  /** Phần cần duyệt (giảm thêm + học bổng vượt mức) đã được duyệt chưa. */
  approved: boolean;
  sessionsPerMonth: number;
  cmApprovalLimit: number;
}

export interface Quote {
  listPrice: number;
  promotion: (QuotePromotion & { discount: number }) | null;
  extraDiscount: { requested: number; applied: number };
  /** Số phải thu với những gì đã được cấp. */
  amountDue: number;
  /** Số phải thu nếu phần đang chờ duyệt được duyệt. */
  amountDueIfApproved: number;
  scholarship: { defaultMonths: number; requestedMonths: number; grantedMonths: number; pendingMonths: number };
  sessions: { package: number; scholarship: number; total: number };
  months: { package: number; scholarship: number; total: number };
  /** null = không cần duyệt (hoặc đã duyệt). */
  approval: { value: number; approverRole: 'CM' | 'AM'; reasons: Array<'EXTRA_DISCOUNT' | 'EXTRA_SCHOLARSHIP'> } | null;
}

export class PricingError extends Error {
  constructor(
    readonly code: 'EXTRA_DISCOUNT_TOO_LARGE' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

const isWhole = (n: number) => Number.isInteger(n) && n >= 0;

export function promotionDiscount(listPrice: number, promo: QuotePromotion): number {
  let discount = promo.discountType === 'PERCENT' ? Math.round((listPrice * promo.discountValue) / 100) : promo.discountValue;
  if (promo.discountType === 'PERCENT' && promo.maxDiscount != null) discount = Math.min(discount, promo.maxDiscount);
  return Math.max(0, Math.min(discount, listPrice));
}

export function computeQuote(input: QuoteInput): Quote {
  for (const [k, v] of Object.entries({
    listPrice: input.listPrice,
    packageMonths: input.packageMonths,
    packageSessions: input.packageSessions,
    defaultScholarshipMonths: input.defaultScholarshipMonths,
    extraDiscount: input.extraDiscount,
    scholarshipMonths: input.scholarshipMonths,
    sessionsPerMonth: input.sessionsPerMonth,
  })) {
    if (!isWhole(v)) throw new PricingError('INVALID_INPUT', `${k} phải là số nguyên không âm`);
  }

  const listPrice = input.listPrice;
  const promo = input.promotion ? { ...input.promotion, discount: promotionDiscount(listPrice, input.promotion) } : null;
  const afterPromotion = listPrice - (promo?.discount ?? 0);

  if (input.extraDiscount > afterPromotion) {
    throw new PricingError('EXTRA_DISCOUNT_TOO_LARGE', `Giảm thêm tối đa ${afterPromotion}đ (giá sau khuyến mại)`);
  }

  const extraScholarship = Math.max(0, input.scholarshipMonths - input.defaultScholarshipMonths);
  const needsApproval = input.extraDiscount > 0 || extraScholarship > 0;
  const approved = needsApproval && input.approved;

  const extraApplied = approved ? input.extraDiscount : 0;
  const grantedMonths = Math.min(input.scholarshipMonths, input.defaultScholarshipMonths) + (approved ? extraScholarship : 0);
  const pendingMonths = needsApproval && !approved ? extraScholarship : 0;

  // Quy đổi tháng học bổng vượt mức ra tiền để so với hạn mức duyệt của CM.
  const monthlyValue = input.packageMonths > 0 ? listPrice / input.packageMonths : 0;
  const approvalValue = input.extraDiscount + Math.round(monthlyValue * extraScholarship);

  const scholarshipSessions = grantedMonths * input.sessionsPerMonth;
  return {
    listPrice,
    promotion: promo,
    extraDiscount: { requested: input.extraDiscount, applied: extraApplied },
    amountDue: Math.max(0, afterPromotion - extraApplied),
    amountDueIfApproved: Math.max(0, afterPromotion - input.extraDiscount),
    scholarship: {
      defaultMonths: input.defaultScholarshipMonths,
      requestedMonths: input.scholarshipMonths,
      grantedMonths,
      pendingMonths,
    },
    sessions: { package: input.packageSessions, scholarship: scholarshipSessions, total: input.packageSessions + scholarshipSessions },
    months: { package: input.packageMonths, scholarship: grantedMonths, total: input.packageMonths + grantedMonths },
    approval:
      needsApproval && !approved
        ? {
            value: approvalValue,
            approverRole: approvalValue <= input.cmApprovalLimit ? 'CM' : 'AM',
            reasons: [
              ...(input.extraDiscount > 0 ? (['EXTRA_DISCOUNT'] as const) : []),
              ...(extraScholarship > 0 ? (['EXTRA_SCHOLARSHIP'] as const) : []),
            ],
          }
        : null,
  };
}
