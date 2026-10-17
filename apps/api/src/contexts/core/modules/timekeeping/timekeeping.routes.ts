import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item, list, nullableRef, PaginationQuery } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { metaOf } from '../auth/auth.routes.js';
import type { TimekeepingService } from './timekeeping.service.js';

const date = z.iso.date().openapi({ example: '2026-10-07' });
const instant = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .openapi({ type: 'string', example: '2026-10-07T08:00:00+07:00' });

const EntrySchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    userFullName: z.string().nullable(),
    branchId: z.string().nullable(),
    branchName: z.string().nullable(),
    workDate: z.string(),
    checkInAt: z.string(),
    checkOutAt: z.string().nullable(),
    durationMinutes: z.number().int().nullable(),
    checkInSource: z.enum(['WEB', 'MOBILE', 'DEVICE', 'MANUAL']),
    checkOutSource: z.enum(['WEB', 'MOBILE', 'DEVICE', 'MANUAL']).nullable(),
    status: z.enum(['OPEN', 'CLOSED', 'ADJUSTED']),
    missingCheckout: z.boolean().openapi({ description: 'Quên check-out ở ngày trước' }),
    note: z.string().nullable(),
  })
  .openapi('TimekeepingEntry');

const StatusSchema = z
  .object({
    workDate: z.string(),
    /** Lượt đang mở (đã check-in, chưa check-out). */
    current: nullableRef(EntrySchema),
    today: z.array(EntrySchema),
    missingCheckoutCount: z.number().int(),
  })
  .openapi('TimekeepingStatus');

const SummaryRowSchema = z
  .object({
    userId: z.string(),
    fullName: z.string(),
    role: z.string(),
    workDays: z.number().int(),
    totalMinutes: z.number().int(),
    missingCheckouts: z.number().int(),
    adjustedEntries: z.number().int(),
  })
  .openapi('TimekeepingSummaryRow');

const AdjustmentSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    userFullName: z.string().nullable(),
    entryId: z.string().nullable(),
    workDate: z.string(),
    checkInAt: z.string(),
    checkOutAt: z.string(),
    reason: z.string(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    reviewedBy: z.object({ id: z.string(), fullName: z.string().nullable() }).nullable(),
    reviewedAt: z.string().nullable(),
    reviewNote: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('TimekeepingAdjustment');

const PunchBody = z.object({
  source: z.enum(['WEB', 'MOBILE', 'DEVICE']).default('WEB'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  note: z.string().trim().max(255).optional(),
});

const RangeQuery = z.object({ from: date, to: date });

export function registerTimekeepingRoutes(route: RouteRegistrar, service: TimekeepingService) {
  const self = { permission: 'core.timekeeping.self' } as const;

  route({
    method: 'get',
    path: '/core/timekeeping/me',
    tags: ['core'],
    summary: 'Trạng thái chấm công hôm nay của tôi',
    access: self,
    responses: { 200: { description: 'Trạng thái', schema: item(StatusSchema) } },
    handler: async ({ principal }) => ({ data: await service.status(principal) }),
  });

  route({
    method: 'post',
    path: '/core/timekeeping/check-in',
    tags: ['core'],
    summary: 'Check-in',
    description: 'Không gửi `branchId` → chi nhánh chính. Lưu IP, thiết bị, toạ độ (nếu có) để đối soát.',
    access: self,
    request: { body: PunchBody.extend({ branchId: z.string().length(26).optional() }) },
    responses: { 201: { description: 'Đã check-in', schema: item(EntrySchema) } },
    errorCodes: ['ALREADY_CHECKED_IN', 'BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, body, req }) => ({ data: await service.checkIn(principal, body, metaOf(req)) }),
  });

  route({
    method: 'post',
    path: '/core/timekeeping/check-out',
    tags: ['core'],
    summary: 'Check-out',
    access: self,
    request: { body: PunchBody },
    responses: { 200: { description: 'Đã check-out', schema: item(EntrySchema) } },
    errorCodes: ['NOT_CHECKED_IN'],
    handler: async ({ principal, body, req }) => ({ data: await service.checkOut(principal, body, metaOf(req)) }),
  });

  route({
    method: 'get',
    path: '/core/timekeeping/entries',
    tags: ['core'],
    summary: 'Lịch sử chấm công',
    description: 'Không có quyền `core.timekeeping.read` → chỉ thấy của bản thân. Tối đa 62 ngày mỗi lần.',
    access: self,
    request: {
      query: PaginationQuery.omit({ sort: true }).extend(RangeQuery.shape).extend({
        userId: z.string().length(26).optional(),
        branchId: z.string().length(26).optional(),
      }),
    },
    responses: { 200: { description: 'Lượt chấm công', schema: list(EntrySchema) } },
    handler: ({ principal, query }) => service.listEntries(principal, query),
  });

  route({
    method: 'get',
    path: '/core/timekeeping/summary',
    tags: ['core'],
    summary: 'Bảng công tổng hợp theo nhân sự',
    access: { permission: 'core.timekeeping.read' },
    request: { query: RangeQuery.extend({ branchId: z.string().length(26).optional() }) },
    responses: { 200: { description: 'Tổng hợp', schema: item(z.array(SummaryRowSchema)) } },
    handler: async ({ principal, query }) => ({ data: await service.summary(principal, query) }),
  });

  route({
    method: 'post',
    path: '/core/timekeeping/adjustments',
    tags: ['core'],
    summary: 'Yêu cầu sửa công',
    description:
      'Không có `userId` → yêu cầu cho bản thân (chờ duyệt). Quản lý (`core.timekeeping.adjust`) gửi cho cấp dưới → có hiệu lực ngay. ' +
      'Có `entryId` → sửa lượt đó; không có → thêm lượt mới.',
    access: self,
    request: {
      body: z.object({
        userId: z.string().length(26).optional(),
        entryId: z.string().length(26).optional(),
        checkInAt: instant,
        checkOutAt: instant,
        reason: z.string().trim().min(5, 'Ghi rõ lý do (tối thiểu 5 ký tự)').max(500),
      }),
    },
    responses: { 201: { description: 'Đã tạo', schema: item(AdjustmentSchema) } },
    errorCodes: ['CANNOT_APPROVE_SELF'],
    handler: async ({ principal, body, req }) => ({ data: await service.createAdjustment(principal, body, metaOf(req).ip) }),
  });

  route({
    method: 'get',
    path: '/core/timekeeping/adjustments',
    tags: ['core'],
    summary: 'Danh sách yêu cầu sửa công',
    description: '`view=mine`: của tôi. `view=review`: của người tôi được duyệt (cần `core.timekeeping.adjust`).',
    access: self,
    request: {
      query: PaginationQuery.omit({ sort: true }).extend({
        view: z.enum(['mine', 'review']).default('mine'),
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
      }),
    },
    responses: { 200: { description: 'Yêu cầu', schema: list(AdjustmentSchema) } },
    handler: ({ principal, query }) => service.listAdjustments(principal, query),
  });

  for (const [action, decision] of [
    ['approve', 'APPROVE'],
    ['reject', 'REJECT'],
  ] as const) {
    route({
      method: 'post',
      path: `/core/timekeeping/adjustments/:id/${action}`,
      tags: ['core'],
      summary: decision === 'APPROVE' ? 'Duyệt yêu cầu sửa công' : 'Từ chối yêu cầu sửa công',
      access: { permission: 'core.timekeeping.adjust' },
      request: { params: IdParams, body: z.object({ note: z.string().trim().max(500).optional() }) },
      responses: { 200: { description: 'Sau khi xử lý', schema: item(AdjustmentSchema) } },
      errorCodes: ['ADJUSTMENT_ALREADY_REVIEWED', 'CANNOT_APPROVE_SELF'],
      handler: async ({ principal, params, body, req }) => ({
        data: await service.review(principal, params.id, decision, body.note, metaOf(req).ip),
      }),
    });
  }
}
