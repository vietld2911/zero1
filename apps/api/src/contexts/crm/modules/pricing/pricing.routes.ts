import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item, nullableRef } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { PricingService } from './pricing.service.js';

const ulid = z.string().length(26);

const QuotePromotionSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    discountType: z.enum(['PERCENT', 'AMOUNT']),
    discountValue: z.number().int(),
    maxDiscount: z.number().int().nullable(),
    discount: z.number().int().openapi({ description: 'Số tiền giảm thực tế' }),
  })
  .openapi('QuotePromotion');

const QuoteSchema = z
  .object({
    date: z.string(),
    package: z.object({ id: z.string(), code: z.string(), name: z.string(), subjectId: z.string() }),
    priceSource: z.enum(['BRANCH', 'BASE']).openapi({ description: 'Giá lấy từ giá chi nhánh hay giá gốc' }),
    listPrice: z.number().int(),
    promotion: nullableRef(QuotePromotionSchema),
    extraDiscount: z.object({ requested: z.number().int(), applied: z.number().int() }),
    amountDue: z.number().int().openapi({ description: 'Số phải thu với những gì đã được cấp' }),
    amountDueIfApproved: z.number().int().openapi({ description: 'Số phải thu nếu phần chờ duyệt được duyệt' }),
    scholarship: z.object({
      defaultMonths: z.number().int(),
      requestedMonths: z.number().int(),
      grantedMonths: z.number().int(),
      pendingMonths: z.number().int(),
    }),
    sessions: z.object({ package: z.number().int(), scholarship: z.number().int(), total: z.number().int() }),
    months: z.object({ package: z.number().int(), scholarship: z.number().int(), total: z.number().int() }),
    approval: z
      .object({
        value: z.number().int().openapi({ description: 'Giá trị quy đổi cần duyệt (VNĐ)' }),
        approverRole: z.enum(['CM', 'AM']),
        reasons: z.array(z.enum(['EXTRA_DISCOUNT', 'EXTRA_SCHOLARSHIP'])),
      })
      .nullable(),
  })
  .openapi('Quote');

export function registerPricingRoutes(route: RouteRegistrar, service: PricingService) {
  route({
    method: 'post',
    path: '/crm/pricing/quote',
    tags: ['crm'],
    summary: 'Tính học phí (xem trước)',
    description:
      'Một công thức duy nhất cho mọi luồng — docs/pricing-rules.md. Giá, khuyến mại, học bổng mặc định đều lấy từ DB; ' +
      'client chỉ gửi lựa chọn. Không gửi `scholarshipMonths` → dùng học bổng mặc định của gói.',
    access: { permission: 'crm.enrollments.create' },
    request: {
      body: z.object({
        packageId: ulid,
        branchId: ulid,
        promotionId: ulid.nullable().optional(),
        scholarshipMonths: z.number().int().min(0).max(24).optional(),
        extraDiscount: z.number().int().min(0).optional(),
        date: z.iso.date().optional(),
      }),
    },
    responses: { 200: { description: 'Chi tiết học phí', schema: item(QuoteSchema) } },
    errorCodes: ['PROMOTION_NOT_APPLICABLE', 'EXTRA_DISCOUNT_TOO_LARGE', 'PACKAGE_INACTIVE', 'BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, body }) => {
      const { input: _input, ...quote } = await service.quote(principal, body);
      return { data: quote };
    },
  });
}
