import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item, list, PaginationQuery } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { PhoneSchema } from '../../../../platform/text.js';
import { requireFile, uploadSingle } from '../../../../platform/http/upload.js';
import { ifMatchVersion } from '../../../../platform/http/headers.js';
import { APPOINTMENT_STATUSES, LEAD_SOURCES, LEAD_STATUS_SOURCES, LEAD_STATUSES } from '../../db/schema.js';
import type { AppointmentsService } from './appointments.service.js';
import { buildLeadTemplate, parseLeadWorkbook } from './leads.excel.js';
import type { LeadsService } from './leads.service.js';

const ulid = z.string().length(26);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const LeadSchema = z
  .object({
    id: z.string(),
    branchId: z.string(),
    branchName: z.string().nullable(),
    ownerId: z.string().nullable(),
    ownerName: z.string().nullable(),
    parentName: z.string(),
    parentPhone: z.string(),
    parentEmail: z.string().nullable(),
    childName: z.string(),
    childBirthYear: z.number().int().nullable(),
    school: z.string().nullable(),
    interestSubjectId: z.string().nullable(),
    source: z.enum(LEAD_SOURCES),
    status: z.enum(LEAD_STATUSES),
    statusChangedAt: z.string().nullable(),
    lostReason: z.string().nullable(),
    notes: z.string().nullable(),
    lastContactedAt: z.string().nullable(),
    nextFollowUpAt: z.string().nullable(),
    firstCalledAt: z.string().nullable(),
    reachedS2At: z.string().nullable(),
    reachedS3At: z.string().nullable(),
    reachedS4At: z.string().nullable(),
    reachedS5At: z.string().nullable(),
    enrollmentCancelled: z.boolean().openapi({ description: 'Đăng ký của lead đã bị huỷ — chờ sale chọn lại trạng thái' }),
    stale: z.boolean().openapi({ description: 'S1B quá hạn khai thác (cài đặt `crm.leads.s1b_window_days`)' }),
    convertedStudentId: z.string().nullable(),
    createdAt: z.string(),
    version: z.number().int(),
  })
  .openapi('Lead');

const CallSchema = z.object({
  id: z.string(),
  outcome: z.enum(['TALKED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'CALL_BACK']),
  note: z.string().nullable(),
  userName: z.string().nullable(),
  calledAt: z.string(),
  nextFollowUpAt: z.string().nullable(),
  statusAfter: z.enum(LEAD_STATUSES).nullable().openapi({ description: 'Trạng thái lead sau cuộc gọi' }),
});

const StatusLogSchema = z.object({
  id: z.string(),
  fromStatus: z.enum(LEAD_STATUSES).nullable(),
  toStatus: z.enum(LEAD_STATUSES),
  source: z.enum(LEAD_STATUS_SOURCES),
  note: z.string().nullable(),
  actorName: z.string().nullable().openapi({ description: 'null = hệ thống tự đổi' }),
  createdAt: z.string(),
});

const LeadAppointmentSchema = z.object({
  id: z.string(),
  type: z.enum(['EXPERIENCE', 'TRIAL']),
  status: z.enum(APPOINTMENT_STATUSES),
  scheduledAt: z.string(),
  lmsSessionId: z.string().nullable(),
  note: z.string().nullable(),
  resultNote: z.string().nullable(),
});

const LeadDetailSchema = LeadSchema.extend({ calls: z.array(CallSchema), appointments: z.array(LeadAppointmentSchema), statusLogs: z.array(StatusLogSchema) }).openapi('LeadDetail');

const instant = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .openapi({ type: 'string', example: '2026-10-10T09:00:00+07:00' });

const leadFields = {
  parentName: z.string().trim().min(2).max(150),
  parentPhone: PhoneSchema,
  parentEmail: z.email().nullable().optional(),
  childName: z.string().trim().min(1).max(150),
  childBirthYear: z.number().int().min(2000).max(2030).nullable().optional(),
  school: z.string().trim().max(200).nullable().optional(),
  interestSubjectId: ulid.nullable().optional(),
  source: z.enum(LEAD_SOURCES),
  notes: z.string().trim().max(2000).nullable().optional(),
};

/** Chọn trạng thái tay: ghi chú bắt buộc; dừng cần lý do; S4B cần ngày hẹn đóng phí. */
const statusFields = {
  status: z.enum(LEAD_STATUSES),
  note: z.string().trim().min(3).max(1000),
  lostReason: z.string().trim().max(500).nullable().optional(),
  nextFollowUpAt: instant.nullable().optional(),
};
const STATUS_RULES =
  'Chọn được S1B, S1C, S2A, S2B, S2C, S4B, S4C (S4B / S4C khi lead đã từng đạt S4) hoặc giữ nguyên trạng thái hiện tại. ' +
  'S1C / S2C / S4C cần `lostReason`; S4B cần `nextFollowUpAt` (ngày hẹn đóng phí). Lead đang có lịch hẹn chờ không chọn được trạng thái dưới S3. ' +
  'Lead đã đăng ký (S5) chỉ chọn lại được khi đăng ký bị huỷ.';

export function registerLeadRoutes(route: RouteRegistrar, leads: LeadsService, appointments: AppointmentsService) {
  const read = { permission: 'crm.leads.read' } as const;
  const write = { permission: 'crm.leads.write' } as const;

  route({
    method: 'get',
    path: '/crm/leads',
    tags: ['crm'],
    summary: 'Danh sách khách hàng tiềm năng',
    description: 'SALE thấy lead của mình, SL thấy của đội, CM/CS/AM thấy theo chi nhánh. `ownerId=none` → chưa phân công. `sort` nhận thêm `statusChangedAt`, `firstCalledAt`.',
    access: read,
    request: {
      query: PaginationQuery.extend({
        q: z.string().trim().optional().openapi({ description: 'Tên phụ huynh / học sinh / số điện thoại' }),
        status: z.string().optional().openapi({ description: 'Nhiều trạng thái, cách nhau dấu phẩy' }),
        source: z.string().optional(),
        branchId: ulid.optional(),
        ownerId: z.string().optional(),
        followUpDue: z.stringbool().optional().openapi({ type: 'boolean', description: 'Chỉ lead đến hạn gọi lại' }),
        stage: z.string().optional().openapi({ description: 'Bước 1–5, nhiều giá trị cách nhau dấu phẩy' }),
        stopped: z.stringbool().optional().openapi({ type: 'boolean', description: 'true = chỉ lead đã dừng (S1C, S2C, S4C); false = bỏ lead đã dừng' }),
        stale: z.stringbool().optional().openapi({ type: 'boolean', description: 'Chỉ lead S1B quá hạn khai thác' }),
      }),
    },
    responses: { 200: { description: 'Lead', schema: list(LeadSchema) } },
    handler: ({ principal, query }) => leads.list(principal, query),
  });

  route({
    method: 'get',
    path: '/crm/leads/status-counts',
    tags: ['crm'],
    summary: 'Số lead theo trạng thái',
    access: read,
    request: { query: z.object({ branchId: ulid.optional() }) },
    responses: { 200: { description: 'Đếm', schema: item(z.record(z.enum(LEAD_STATUSES), z.number().int())) } },
    handler: async ({ principal, query }) => ({ data: await leads.statusCounts(principal, query.branchId) }),
  });

  route({
    method: 'get',
    path: '/crm/leads/check-phone',
    tags: ['crm'],
    summary: 'Kiểm tra số điện thoại đã có lead / học viên chưa',
    description: 'Lead ngoài phạm vi chỉ cho biết là có (id = null) để tránh tranh khách.',
    access: read,
    request: { query: z.object({ phone: z.string().min(8) }) },
    responses: {
      200: {
        description: 'Kết quả',
        schema: item(
          z.object({
            phone: z.string(),
            leads: z.array(
              z.object({
                id: z.string().nullable(),
                childName: z.string(),
                status: z.enum(LEAD_STATUSES),
                branchName: z.string().nullable(),
                ownerName: z.string().nullable(),
                open: z.boolean(),
              }),
            ),
            students: z.array(z.object({ id: z.string().nullable(), code: z.string(), fullName: z.string(), status: z.string() })),
          }),
        ),
      },
    },
    handler: async ({ principal, query }) => ({ data: await leads.checkPhone(principal, query.phone) }),
  });

  route({
    method: 'get',
    path: '/crm/leads/follow-ups',
    tags: ['crm'],
    summary: 'Lead cần gọi lại (quá hạn hoặc trong 24 giờ tới)',
    access: read,
    responses: { 200: { description: 'Lead', schema: item(z.array(LeadSchema)) } },
    handler: async ({ principal }) => ({ data: await leads.followUps(principal) }),
  });

  route({
    method: 'get',
    path: '/crm/leads/import-template',
    tags: ['crm'],
    summary: 'Tải file Excel mẫu để import lead',
    access: { permission: 'crm.leads.import' },
    responses: { 200: { description: 'File mẫu', fileType: XLSX } },
    async handler({ res }) {
      res.setHeader('Content-Type', XLSX);
      res.setHeader('Content-Disposition', 'attachment; filename="mau-import-lead.xlsx"');
      res.send(await buildLeadTemplate());
    },
  });

  route({
    method: 'post',
    path: '/crm/leads/import',
    tags: ['crm'],
    summary: 'Import lead từ Excel',
    description: 'Đọc theo file mẫu. Dòng lỗi / trùng được bỏ qua và báo lại số dòng; các dòng hợp lệ vẫn được tạo.',
    access: { permission: 'crm.leads.import' },
    upload: { handler: uploadSingle({ field: 'file', maxBytes: 5 * 1_048_576, accept: [XLSX, 'application/octet-stream'] }), field: 'file', description: 'File .xlsx theo mẫu' },
    request: { body: z.object({ branchId: ulid.optional(), ownerId: ulid.optional() }) },
    responses: {
      200: {
        description: 'Kết quả import',
        schema: item(z.object({ created: z.number().int(), skipped: z.array(z.object({ row: z.number().int(), reason: z.string() })) })),
      },
    },
    async handler({ principal, body, req }) {
      const file = requireFile(req, 'file');
      const parsed = await parseLeadWorkbook(file.buffer);
      const result = await leads.bulkCreate(principal, parsed.rows, body.branchId, body.ownerId);
      return { data: { created: result.created, skipped: [...parsed.errors, ...result.skipped].sort((a, b) => a.row - b.row) } };
    },
  });

  route({
    method: 'post',
    path: '/crm/leads',
    tags: ['crm'],
    summary: 'Thêm khách hàng tiềm năng',
    description:
      'SALE / SL tạo thì tự phụ trách. Trùng SĐT với lead đang chăm sóc → 409 `LEAD_DUPLICATE`; ' +
      'nếu là anh/chị em (khác tên) thì người có quyền phân công gửi `force: true` để tạo.',
    access: write,
    request: { body: z.object({ ...leadFields, branchId: ulid.optional(), ownerId: ulid.nullable().optional(), force: z.boolean().default(false) }) },
    responses: { 201: { description: 'Đã tạo', schema: item(LeadDetailSchema) } },
    errorCodes: ['LEAD_DUPLICATE', 'OWNER_INVALID', 'BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, body: { force, ...input } }) => ({ data: await leads.create(principal, input, force) }),
  });

  route({
    method: 'get',
    path: '/crm/leads/:id',
    tags: ['crm'],
    summary: 'Chi tiết lead (kèm lịch sử gọi, lịch hẹn, lịch sử trạng thái)',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Lead', schema: item(LeadDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await leads.get(principal, params.id) }),
  });

  route({
    method: 'patch',
    path: '/crm/leads/:id',
    tags: ['crm'],
    summary: 'Sửa thông tin lead',
    description: 'Gửi `If-Match: <version>`. Trạng thái đổi qua ghi cuộc gọi, `POST /crm/leads/:id/status` hoặc mở lại.',
    access: write,
    request: {
      params: IdParams,
      body: z.object(leadFields).partial().strict(),
    },
    responses: { 200: { description: 'Sau khi sửa', schema: item(LeadDetailSchema) } },
    errorCodes: ['VERSION_CONFLICT', 'LEAD_CONVERTED', 'LEAD_DUPLICATE'],
    handler: async ({ principal, params, body, req }) => ({ data: await leads.update(principal, params.id, body, ifMatchVersion(req)) }),
  });

  route({
    method: 'delete',
    path: '/crm/leads/:id',
    tags: ['crm'],
    summary: 'Xoá lead',
    access: { permission: 'crm.leads.delete' },
    request: { params: IdParams },
    responses: { 204: { description: 'Đã xoá' } },
    errorCodes: ['LEAD_CONVERTED'],
    async handler({ principal, params }) {
      await leads.remove(principal, params.id);
    },
  });

  route({
    method: 'post',
    path: '/crm/leads/assign',
    tags: ['crm'],
    summary: 'Phân công lead hàng loạt',
    description: '`ownerId: null` → trả về chưa phân công. Người nhận phải là SALE/SL/CS/CM tại chi nhánh của lead.',
    access: { permission: 'crm.leads.assign' },
    request: { body: z.object({ leadIds: z.array(ulid).min(1).max(500), ownerId: ulid.nullable() }) },
    responses: { 200: { description: 'Số lead đã cập nhật', schema: item(z.object({ updated: z.number().int() })) } },
    errorCodes: ['OWNER_INVALID', 'LEAD_CONVERTED'],
    handler: async ({ principal, body }) => ({ data: await leads.assign(principal, body.leadIds, body.ownerId) }),
  });

  route({
    method: 'post',
    path: '/crm/leads/:id/calls',
    tags: ['crm'],
    summary: 'Ghi nhận cuộc gọi + trạng thái lead sau cuộc gọi',
    description: `Ghi chú và trạng thái sau cuộc gọi bắt buộc. \`nextFollowUpAt\` đặt lịch gọi lại. ${STATUS_RULES}`,
    access: write,
    request: {
      params: IdParams,
      body: z.object({ outcome: z.enum(['TALKED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'CALL_BACK']), ...statusFields }),
    },
    responses: { 201: { description: 'Lead sau khi ghi', schema: item(LeadDetailSchema) } },
    errorCodes: ['LEAD_CLOSED', 'LEAD_ENROLLED', 'LEAD_HAS_APPOINTMENT'],
    handler: async ({ principal, params, body }) => ({ data: await leads.logCall(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/crm/leads/:id/status',
    tags: ['crm'],
    summary: 'Đổi trạng thái lead (không qua cuộc gọi)',
    description: `Ghi chú bắt buộc. ${STATUS_RULES}`,
    access: write,
    request: { params: IdParams, body: z.object(statusFields) },
    responses: { 200: { description: 'Lead sau khi đổi', schema: item(LeadDetailSchema) } },
    errorCodes: ['LEAD_CLOSED', 'LEAD_ENROLLED', 'LEAD_HAS_APPOINTMENT'],
    handler: async ({ principal, params, body }) => ({ data: await leads.changeStatus(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/crm/leads/:id/reopen',
    tags: ['crm'],
    summary: 'Mở lại lead đã dừng',
    description: 'Chỉ lead S1C / S2C / S4C; chọn S1B, S2A, S2B hoặc S4B (S4B khi đã từng đạt S4, kèm `nextFollowUpAt`). Ghi chú bắt buộc.',
    access: { permission: 'crm.leads.reopen' },
    request: { params: IdParams, body: z.object({ status: statusFields.status, note: statusFields.note, nextFollowUpAt: statusFields.nextFollowUpAt }) },
    responses: { 200: { description: 'Lead sau khi mở lại', schema: item(LeadDetailSchema) } },
    errorCodes: ['LEAD_NOT_STOPPED', 'LEAD_HAS_APPOINTMENT'],
    handler: async ({ principal, params, body }) => ({ data: await leads.reopen(principal, params.id, body) }),
  });

  // ─────────── Lịch hẹn

  route({
    method: 'post',
    path: '/crm/leads/:id/appointments',
    tags: ['crm'],
    summary: 'Đặt lịch trải nghiệm / học thử',
    description:
      'Học thử (`TRIAL`) ngồi trong một buổi học LMS (`lmsSessionId` lấy từ GET /lms/trial-slots). LMS từ chối nếu hết chỗ → lịch tự huỷ. ' +
      'Lead ở S1–S3 lên S3A; lead đã dừng hoặc đã đăng ký → `LEAD_CLOSED`.',
    access: write,
    request: {
      params: IdParams,
      body: z.object({
        type: z.enum(['EXPERIENCE', 'TRIAL']),
        scheduledAt: instant,
        lmsSessionId: ulid.nullable().optional(),
        note: z.string().trim().max(1000).nullable().optional(),
      }),
    },
    responses: { 201: { description: 'Đã đặt', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['LEAD_CLOSED'],
    handler: async ({ principal, params, body }) => ({ data: { id: await appointments.create(principal, params.id, body) } }),
  });

  route({
    method: 'get',
    path: '/crm/appointments',
    tags: ['crm'],
    summary: 'Lịch hẹn theo khoảng thời gian',
    access: read,
    request: {
      query: z.object({
        from: instant,
        to: instant,
        branchId: ulid.optional(),
        type: z.enum(['EXPERIENCE', 'TRIAL']).optional(),
        status: z.string().optional().openapi({ description: 'Nhiều trạng thái, cách nhau dấu phẩy' }),
      }),
    },
    responses: {
      200: {
        description: 'Lịch hẹn',
        schema: item(
          z.array(
            LeadAppointmentSchema.extend({
              branchId: z.string(),
              lead: z.object({
                id: z.string(),
                childName: z.string(),
                parentName: z.string(),
                parentPhone: z.string(),
                ownerName: z.string().nullable(),
                status: z.enum(LEAD_STATUSES),
              }),
            }),
          ),
        ),
      },
    },
    handler: async ({ principal, query }) => ({
      data: await appointments.calendar(principal, {
        ...query,
        statuses: query.status?.split(',').filter((s): s is (typeof APPOINTMENT_STATUSES)[number] => (APPOINTMENT_STATUSES as readonly string[]).includes(s)),
      }),
    }),
  });

  route({
    method: 'post',
    path: '/crm/appointments/:id/status',
    tags: ['crm'],
    summary: 'Xác nhận / đến / không đến / huỷ lịch hẹn',
    description:
      'Lead đang ở S3: xác nhận → S3B, không đến → S3C; đến → S4A (từ S1–S3). Huỷ lịch giữ nguyên trạng thái lead. ' +
      'Học thử thường do giáo viên điểm danh bên LMS (đồng bộ tự động).',
    access: write,
    request: {
      params: IdParams,
      body: z.object({ status: z.enum(['CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED']), resultNote: z.string().trim().max(1000).nullable().optional() }),
    },
    responses: { 204: { description: 'Đã cập nhật' } },
    errorCodes: ['INVALID_STATE_TRANSITION'],
    async handler({ principal, params, body }) {
      await appointments.setStatus(principal, params.id, body.status, body.resultNote);
    },
  });

  route({
    method: 'patch',
    path: '/crm/appointments/:id',
    tags: ['crm'],
    summary: 'Đổi giờ lịch trải nghiệm',
    description: 'Lịch về trạng thái chờ; lead đang ở S3 về S3A.',
    access: write,
    request: { params: IdParams, body: z.object({ scheduledAt: instant, note: z.string().trim().max(1000).nullable().optional() }) },
    responses: { 204: { description: 'Đã đổi' } },
    errorCodes: ['TRIAL_RESCHEDULE', 'INVALID_STATE_TRANSITION'],
    async handler({ principal, params, body }) {
      await appointments.reschedule(principal, params.id, body);
    },
  });
}
