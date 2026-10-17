import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item, list, nullableRef, PaginationQuery } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { idempotencyKey } from '../../../../platform/http/headers.js';
import type { BranchDirectory } from '../../../core/contract/index.js';
import { profileFields, GuardianInputSchema } from '../students/students.routes.js';
import type { StudentsService } from '../students/students.service.js';
import type { ApprovalsService } from './approvals.service.js';
import { buildEnrollmentForm } from './enrollment-form.js';
import type { EnrollmentsService } from './enrollments.service.js';
import { BANKS, type PaymentsService } from './payments.service.js';

const ulid = z.string().length(26);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IDEM = 'Bắt buộc header `Idempotency-Key` (UUID do client sinh) — gửi lại cùng key không tạo trùng.';

export const EnrollmentSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    studentId: z.string(),
    studentCode: z.string(),
    studentName: z.string(),
    branchId: z.string(),
    type: z.enum(['NEW', 'RENEWAL']),
    saleId: z.string().nullable(),
    saleName: z.string().nullable(),
    creditUserId: z.string().nullable().openapi({ description: 'Người được tính doanh thu: đăng ký mới → sale, tái phí → CS chăm sóc' }),
    creditName: z.string().nullable(),
    packageId: z.string(),
    packageCode: z.string(),
    packageName: z.string(),
    startLevelId: z.string(),
    startLevelName: z.string(),
    promotionCode: z.string().nullable(),
    listPrice: z.number().int(),
    promotionDiscount: z.number().int(),
    extraDiscountRequested: z.number().int(),
    extraDiscountApplied: z.number().int(),
    extraDiscountReason: z.string().nullable(),
    scholarshipMonthsRequested: z.number().int(),
    scholarshipMonthsGranted: z.number().int(),
    amountDue: z.number().int(),
    amountPaid: z.number().int(),
    balance: z.number().int().openapi({ description: 'Còn phải thu (âm = thu dư)' }),
    paymentState: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID']),
    sessionsPurchased: z.number().int(),
    sessionsUsed: z.number().int(),
    sessionsRemaining: z.number().int(),
    approvalStatus: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED']),
    status: z.enum(['AWAITING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
    startDate: z.string(),
    endDate: z.string(),
    activatedAt: z.string().nullable(),
    cancelReason: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Enrollment');

const PaymentSchema = z
  .object({
    id: z.string(),
    amount: z.number().int(),
    method: z.enum(['CASH', 'TRANSFER', 'CARD']),
    status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']),
    reference: z.string().nullable(),
    note: z.string().nullable(),
    paidAt: z.string(),
    recordedByName: z.string().nullable(),
    confirmedByName: z.string().nullable(),
    confirmedAt: z.string().nullable(),
  })
  .openapi('Payment');

const EnrollmentApprovalSchema = z
  .object({
    id: z.string(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    approverRole: z.enum(['CM', 'AM']),
    value: z.number().int(),
    requestedByName: z.string().nullable(),
    reviewedByName: z.string().nullable(),
    reviewNote: z.string().nullable(),
  })
  .openapi('EnrollmentApproval');

const EnrollmentDetailSchema = EnrollmentSchema.extend({
  payments: z.array(PaymentSchema),
  gifts: z.array(
    z.object({
      id: z.string(),
      itemId: z.string(),
      itemName: z.string(),
      unit: z.string(),
      quantity: z.number().int(),
      deliveryCondition: z.enum(['IMMEDIATE', 'ON_PAID']),
      status: z.enum(['PENDING', 'DELIVERED', 'RETURNED']),
      deliveredAt: z.string().nullable(),
    }),
  ),
  approval: nullableRef(EnrollmentApprovalSchema),
}).openapi('EnrollmentDetail');

export const EnrollmentRequestSchema = z.object({
  packageId: ulid,
  startLevelId: ulid,
  promotionId: ulid.nullable().optional(),
  scholarshipMonths: z.number().int().min(0).max(24).optional(),
  extraDiscount: z.number().int().min(0).optional(),
  extraDiscountReason: z.string().trim().max(500).nullable().optional(),
  startDate: z.iso.date().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  gifts: z
    .array(z.object({ itemId: ulid, quantity: z.number().int().min(1).max(100), deliveryCondition: z.enum(['IMMEDIATE', 'ON_PAID']) }))
    .max(20)
    .optional(),
});

const CreatedSchema = item(z.object({ studentId: z.string(), enrollmentId: z.string() }));

export function registerEnrollmentRoutes(
  route: RouteRegistrar,
  deps: { enrollments: EnrollmentsService; payments: PaymentsService; approvals: ApprovalsService; students: StudentsService; branches: BranchDirectory },
) {
  const { enrollments, payments, approvals, students } = deps;
  const read = { permission: 'crm.students.read' } as const;
  const create = { permission: 'crm.enrollments.create' } as const;

  route({
    method: 'post',
    path: '/crm/leads/:id/convert',
    tags: ['crm'],
    summary: 'Chuyển lead thành học viên + đăng ký',
    description: `Tạo học viên, phụ huynh (mặc định lấy từ lead), đăng ký với giá chốt cứng (docs/pricing-rules.md). ${IDEM}`,
    access: create,
    request: {
      params: IdParams,
      body: z.object({ student: z.object(profileFields), guardians: z.array(GuardianInputSchema).max(5).optional(), enrollment: EnrollmentRequestSchema }),
    },
    responses: { 201: { description: 'Đã tạo', schema: CreatedSchema } },
    errorCodes: ['LEAD_CONVERTED', 'LEAD_CLOSED', 'PROMOTION_NOT_APPLICABLE', 'EXTRA_DISCOUNT_TOO_LARGE', 'PACKAGE_INACTIVE', 'IDEMPOTENCY_KEY_REUSED'],
    handler: async ({ principal, params, body, req }) => ({ data: await enrollments.convertLead(principal, params.id, body, idempotencyKey(req)!) }),
  });

  route({
    method: 'post',
    path: '/crm/students/:id/enrollments',
    tags: ['crm'],
    summary: 'Đăng ký thêm / tái phí cho học viên',
    description: `Đã từng có đăng ký → loại RENEWAL. ${IDEM}`,
    access: create,
    request: { params: IdParams, body: EnrollmentRequestSchema },
    responses: { 201: { description: 'Đã tạo', schema: CreatedSchema } },
    errorCodes: ['STUDENT_STOPPED', 'PROMOTION_NOT_APPLICABLE', 'EXTRA_DISCOUNT_TOO_LARGE', 'IDEMPOTENCY_KEY_REUSED'],
    handler: async ({ principal, params, body, req }) => ({ data: await enrollments.createForStudent(principal, params.id, body, idempotencyKey(req)!) }),
  });

  route({
    method: 'get',
    path: '/crm/enrollments',
    tags: ['crm'],
    summary: 'Danh sách đăng ký',
    access: read,
    request: {
      query: PaginationQuery.omit({ sort: true }).extend({
        q: z.string().trim().optional().openapi({ description: 'Mã đăng ký, mã / tên học viên' }),
        status: z.string().optional(),
        approvalStatus: z.string().optional(),
        paymentState: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID']).optional(),
        branchId: ulid.optional(),
        studentId: ulid.optional(),
      }),
    },
    responses: { 200: { description: 'Đăng ký', schema: list(EnrollmentSchema) } },
    handler: ({ principal, query }) => enrollments.list(principal, query),
  });

  route({
    method: 'get',
    path: '/crm/enrollments/:id',
    tags: ['crm'],
    summary: 'Chi tiết đăng ký (khoản thu, quà, duyệt)',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Đăng ký', schema: item(EnrollmentDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await enrollments.get(principal, params.id) }),
  });

  route({
    method: 'post',
    path: '/crm/enrollments/:id/cancel',
    tags: ['crm'],
    summary: 'Huỷ đăng ký (chưa có khoản thu)',
    access: { permission: 'crm.students.status' },
    request: { params: IdParams, body: z.object({ reason: z.string().trim().min(3).max(500) }) },
    responses: { 204: { description: 'Đã huỷ' } },
    errorCodes: ['ENROLLMENT_HAS_PAYMENTS'],
    async handler({ principal, params, body }) {
      await enrollments.cancel(principal, params.id, body.reason);
    },
  });

  route({
    method: 'get',
    path: '/crm/enrollments/:id/form.docx',
    tags: ['crm'],
    summary: 'Phiếu đăng ký (Word)',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'File .docx', fileType: DOCX } },
    async handler({ principal, params, res }) {
      const e = await enrollments.get(principal, params.id);
      const s = await students.get(principal, e.studentId);
      const [branch] = await deps.branches.getMany([e.branchId]);
      const buffer = await buildEnrollmentForm({
        branchName: branch ? `Zero1 — ${branch.name}` : 'Zero1',
        enrollmentCode: e.code,
        createdDate: e.createdAt.slice(0, 10),
        student: { code: s.code, fullName: s.fullName, birthDate: s.birthDate, gender: s.gender, school: s.school, address: s.address },
        guardians: s.guardians,
        course: {
          packageName: e.packageName,
          startLevelName: e.startLevelName,
          sessions: e.sessionsPurchased,
          scholarshipMonths: e.scholarshipMonthsGranted,
          startDate: e.startDate,
          endDate: e.endDate,
        },
        fees: {
          listPrice: e.listPrice,
          promotionCode: e.promotionCode,
          promotionDiscount: e.promotionDiscount,
          extraDiscount: e.extraDiscountApplied,
          amountDue: e.amountDue,
          amountPaid: e.amountPaid,
        },
        gifts: e.gifts.filter((g) => g.status !== 'RETURNED').map((g) => ({ name: g.itemName, quantity: g.quantity, unit: g.unit })),
        saleName: e.saleName,
      });
      res.setHeader('Content-Type', DOCX);
      res.setHeader('Content-Disposition', `attachment; filename="phieu-dang-ky-${e.code}.docx"`);
      res.send(buffer);
    },
  });

  route({
    method: 'post',
    path: '/crm/enrollment-gifts/:id/status',
    tags: ['crm'],
    summary: 'Giao / nhận lại quà tặng',
    description: 'Trừ / cộng tồn kho quà của chi nhánh. Quà "khi đóng tiền" chỉ giao sau khoản thu đầu tiên.',
    access: { permission: 'crm.students.write' },
    request: { params: IdParams, body: z.object({ status: z.enum(['DELIVERED', 'RETURNED']) }) },
    responses: { 204: { description: 'Đã cập nhật' } },
    errorCodes: ['INSUFFICIENT_STOCK', 'GIFT_NOT_YET', 'INVALID_STATE_TRANSITION'],
    async handler({ principal, params, body }) {
      await enrollments.setGiftStatus(principal, params.id, body.status);
    },
  });

  // ─────────── Thu tiền

  route({
    method: 'post',
    path: '/crm/enrollments/:id/payments',
    tags: ['crm'],
    summary: 'Ghi nhận khoản thu',
    description: `CS / CM ghi → xác nhận ngay; người khác ghi → chờ CS / CM xác nhận. Khoản thu đầu tiên được xác nhận → đăng ký kích hoạt, học viên chuyển sang LMS chờ xếp lớp. ${IDEM}`,
    access: create,
    request: {
      params: IdParams,
      body: z.object({
        amount: z.number().int().min(1),
        method: z.enum(['CASH', 'TRANSFER', 'CARD']),
        reference: z.string().trim().max(100).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
        paidAt: z.iso
          .datetime({ offset: true })
          .transform((s) => new Date(s))
          // Cho lệch đồng hồ vài phút; ngày thu tương lai làm sai doanh thu theo tháng.
          .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'Ngày thu không được ở tương lai')
          .optional()
          .openapi({ type: 'string', description: 'Mặc định: bây giờ. Không nhận thời điểm tương lai' }),
      }),
    },
    responses: { 201: { description: 'Đã ghi nhận', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['PAYMENT_EXCEEDS_DUE', 'ENROLLMENT_CANCELLED', 'IDEMPOTENCY_KEY_REUSED'],
    handler: async ({ principal, params, body, req }) => ({ data: { id: await payments.record(principal, params.id, body, idempotencyKey(req)!) } }),
  });

  route({
    method: 'post',
    path: '/crm/payments/:id/confirm',
    tags: ['crm'],
    summary: 'Xác nhận đã nhận tiền',
    access: { permission: 'crm.payments.confirm' },
    request: { params: IdParams },
    responses: { 204: { description: 'Đã xác nhận' } },
    errorCodes: ['PAYMENT_NOT_PENDING'],
    async handler({ principal, params }) {
      await payments.confirm(principal, params.id);
    },
  });

  route({
    method: 'post',
    path: '/crm/payments/:id/cancel',
    tags: ['crm'],
    summary: 'Huỷ khoản thu',
    access: create,
    request: { params: IdParams, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
    responses: { 204: { description: 'Đã huỷ' } },
    async handler({ principal, params, body }) {
      await payments.cancel(principal, params.id, body.reason);
    },
  });

  route({
    method: 'get',
    path: '/crm/enrollments/:id/payment-qr',
    tags: ['crm'],
    summary: 'Mã VietQR chuyển khoản',
    description: 'Tài khoản lấy theo chi nhánh của đăng ký. Không gửi `amount` → số còn phải thu.',
    access: read,
    request: { params: IdParams, query: z.object({ amount: z.coerce.number().int().min(1).optional() }) },
    responses: {
      200: {
        description: 'Thông tin QR',
        schema: item(
          z.object({
            imageUrl: z.string(),
            bankBin: z.string(),
            bankName: z.string(),
            accountNo: z.string(),
            accountName: z.string(),
            amount: z.number().int(),
            content: z.string().openapi({ description: 'Nội dung chuyển khoản' }),
          }),
        ),
      },
    },
    errorCodes: ['PAYMENT_ACCOUNT_MISSING'],
    handler: async ({ principal, params, query }) => ({ data: await payments.qr(principal, params.id, query.amount) }),
  });

  route({
    method: 'get',
    path: '/crm/payment-accounts',
    tags: ['crm'],
    summary: 'Tài khoản nhận tiền theo chi nhánh',
    access: { authenticated: true },
    responses: {
      200: {
        description: 'Tài khoản + danh sách ngân hàng',
        schema: item(
          z.object({
            accounts: z.array(z.object({ branchId: z.string(), bankBin: z.string(), bankName: z.string(), accountNo: z.string(), accountName: z.string() })),
            banks: z.array(z.object({ bin: z.string(), name: z.string() })),
          }),
        ),
      },
    },
    handler: async ({ principal }) => ({ data: { accounts: await payments.listAccounts(principal), banks: [...BANKS] } }),
  });

  route({
    method: 'patch',
    path: '/crm/payment-accounts/:branchId',
    tags: ['crm'],
    summary: 'Đặt tài khoản nhận tiền cho chi nhánh',
    description: 'Gửi `null` để xoá. Tên chủ tài khoản tự chuyển in hoa không dấu (theo VietQR).',
    access: { permission: 'crm.payment_accounts.manage' },
    request: {
      params: z.object({ branchId: ulid }),
      body: z.object({
        account: z
          .object({
            bankBin: z.string().regex(/^\d{6}$/),
            accountNo: z.string().trim().regex(/^[0-9]{4,30}$/, 'Chỉ gồm chữ số'),
            accountName: z.string().trim().min(2).max(100),
          })
          .nullable(),
      }),
    },
    responses: { 204: { description: 'Đã lưu' } },
    async handler({ principal, params, body }) {
      await payments.setAccount(principal, params.branchId, body.account);
    },
  });

  // ─────────── Duyệt giảm giá

  route({
    method: 'get',
    path: '/crm/approvals',
    tags: ['crm'],
    summary: 'Yêu cầu duyệt giảm thêm / học bổng vượt mức',
    description: '`canReview` cho biết người gọi duyệt được yêu cầu đó không (đúng cấp, không phải người xin).',
    access: { permission: 'crm.approvals.review' },
    request: { query: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }) },
    responses: {
      200: {
        description: 'Yêu cầu',
        schema: item(
          z.array(
            z
              .object({
                id: z.string(),
                enrollmentId: z.string(),
                enrollmentCode: z.string(),
                studentName: z.string(),
                studentCode: z.string(),
                branchId: z.string(),
                packageName: z.string(),
                listPrice: z.number().int(),
                promotionDiscount: z.number().int(),
                extraDiscount: z.number().int(),
                extraScholarshipMonths: z.number().int(),
                value: z.number().int(),
                approverRole: z.enum(['CM', 'AM']),
                reason: z.string().nullable(),
                status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
                requestedByName: z.string().nullable(),
                reviewedByName: z.string().nullable(),
                reviewNote: z.string().nullable(),
                createdAt: z.string(),
                reviewedAt: z.string().nullable(),
                canReview: z.boolean(),
              })
              .openapi('DiscountApproval'),
          ),
        ),
      },
    },
    handler: async ({ principal, query }) => ({ data: await approvals.list(principal, query.status) }),
  });

  for (const [action, decision] of [
    ['approve', 'APPROVE'],
    ['reject', 'REJECT'],
  ] as const) {
    route({
      method: 'post',
      path: `/crm/approvals/:id/${action}`,
      tags: ['crm'],
      summary: decision === 'APPROVE' ? 'Duyệt giảm giá / học bổng' : 'Từ chối giảm giá / học bổng',
      description: 'Duyệt → số phải thu, số buổi, hạn học được tính lại từ giá đã chốt. Đã thu dư → đăng ký hiện "thu dư".',
      access: { permission: 'crm.approvals.review' },
      request: { params: IdParams, body: z.object({ note: z.string().trim().max(500).nullable().optional() }) },
      responses: { 204: { description: 'Đã xử lý' } },
      errorCodes: ['APPROVAL_ALREADY_REVIEWED', 'CANNOT_APPROVE_SELF', 'APPROVER_LEVEL_TOO_LOW'],
      async handler({ principal, params, body }) {
        await approvals.review(principal, params.id, decision, body.note);
      },
    });
  }
}
