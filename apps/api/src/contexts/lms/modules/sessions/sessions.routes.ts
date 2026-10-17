import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { requireFile, uploadSingle } from '../../../../platform/http/upload.js';
import { ATTENDANCE_STATUSES, SESSION_STATUSES } from '../../db/schema.js';
import type { AssignmentsService } from '../assignments/assignments.service.js';
import type { SessionsService } from './sessions.service.js';

const ulid = z.string().length(26);
const instant = z.iso
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .openapi({ type: 'string', example: '2026-10-12T18:00:00+07:00' });

const SessionSchema = z
  .object({
    id: z.string(),
    classId: z.string(),
    classCode: z.string(),
    className: z.string(),
    levelName: z.string().nullable(),
    branchId: z.string(),
    indexNo: z.number().int(),
    totalSessions: z.number().int(),
    startsAt: z.string(),
    endsAt: z.string(),
    status: z.enum(SESSION_STATUSES),
    topic: z.string().nullable(),
    teacherId: z.string(),
    teacherName: z.string().nullable(),
    substitute: z.boolean().openapi({ description: 'GV dạy thay (khác GV của lớp)' }),
    taId: z.string().nullable(),
    taName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    learnerCount: z.number().int(),
    attendanceCount: z.number().int(),
    trialGuestCount: z.number().int(),
  })
  .openapi('ClassSession');

const RatingsSchema = z
  .object({
    focus: z.number().int().min(1).max(5).optional(),
    creativity: z.number().int().min(1).max(5).optional(),
    teamwork: z.number().int().min(1).max(5).optional(),
    skill: z.number().int().min(1).max(5).optional(),
  })
  .openapi('FeedbackRatings', { description: 'Thang 1–5: tập trung, sáng tạo, làm việc nhóm, kỹ năng' });

const SessionDetailSchema = SessionSchema.extend({
  consumingStatuses: z.array(z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).openapi({ description: 'Trạng thái điểm danh bị trừ buổi (cài đặt của trung tâm)' }),
  teacherNote: z.string().nullable(),
  cancelReason: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  learners: z.array(
    z.object({
      learnerId: z.string(),
      code: z.string(),
      fullName: z.string(),
      avatarUrl: z.string().nullable(),
      membershipStatus: z.string(),
      sessionsRemaining: z.number().int(),
      attendance: z.object({ status: z.enum(ATTENDANCE_STATUSES), note: z.string().nullable(), consumesSession: z.boolean() }).nullable(),
      feedback: z.object({ ratings: RatingsSchema, comment: z.string() }).nullable(),
    }),
  ),
  trialGuests: z.array(
    z.object({
      id: z.string(),
      appointmentId: z.string(),
      childName: z.string(),
      birthYear: z.number().int().nullable(),
      parentName: z.string(),
      parentPhone: z.string(),
      result: z.enum(['PENDING', 'ATTENDED', 'NO_SHOW']),
      note: z.string().nullable(),
    }),
  ),
}).openapi('ClassSessionDetail');

const AssignmentSchema = z
  .object({
    id: z.string(),
    classId: z.string(),
    classCode: z.string(),
    className: z.string(),
    sessionId: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    dueAt: z.string().nullable(),
    maxScore: z.number().int(),
    attachments: z.array(z.object({ name: z.string(), url: z.string(), mimeType: z.string(), size: z.number().int() })),
    learnerCount: z.number().int(),
    submittedCount: z.number().int(),
    gradedCount: z.number().int(),
    missingCount: z.number().int(),
    createdAt: z.string(),
  })
  .openapi('Assignment');

const AssignmentDetailSchema = AssignmentSchema.extend({
  submissions: z.array(
    z.object({
      learnerId: z.string(),
      code: z.string(),
      fullName: z.string(),
      status: z.enum(['SUBMITTED', 'GRADED', 'MISSING']).nullable(),
      submittedAt: z.string().nullable(),
      score: z.number().int().nullable(),
      comment: z.string().nullable(),
      gradedByName: z.string().nullable(),
    }),
  ),
}).openapi('AssignmentDetail');

const MaterialSchema = z
  .object({
    id: z.string(),
    levelId: z.string().nullable(),
    levelName: z.string().nullable(),
    classId: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    url: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    size: z.number().int(),
    uploadedByName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Material');

const DOCS = ['image/', 'video/', 'application/pdf', 'application/vnd.openxmlformats-officedocument', 'application/msword', 'application/vnd.ms-', 'application/zip', 'text/plain'];

export function registerSessionRoutes(route: RouteRegistrar, sessions: SessionsService, assignments: AssignmentsService) {
  const read = { permission: 'lms.learners.read' } as const;

  route({
    method: 'get',
    path: '/lms/sessions',
    tags: ['lms'],
    summary: 'Lịch học theo khoảng thời gian',
    description: 'GV / TA thấy buổi của lớp mình và buổi mình dạy thay.',
    access: read,
    request: {
      query: z.object({
        from: instant,
        to: instant,
        branchId: ulid.optional(),
        teacherId: ulid.optional(),
        roomId: ulid.optional(),
        classId: ulid.optional(),
        includeCancelled: z.stringbool().default(false).openapi({ type: 'boolean' }),
      }),
    },
    responses: { 200: { description: 'Buổi học', schema: item(z.array(SessionSchema)) } },
    handler: async ({ principal, query }) => ({ data: await sessions.calendar(principal, query) }),
  });

  route({
    method: 'get',
    path: '/lms/today',
    tags: ['lms'],
    summary: 'Hôm nay: buổi học + việc cần xử lý',
    description: 'Buổi hôm nay, buổi quá hạn chưa chốt điểm danh, học viên vắng liên tiếp, sắp hết buổi, bài chờ chấm.',
    access: read,
    request: { query: z.object({ branchId: ulid.optional() }) },
    responses: {
      200: {
        description: 'Tổng hợp',
        schema: item(
          z.object({
            date: z.string(),
            sessions: z.array(SessionSchema),
            overdueSessions: z.array(z.object({ id: z.string(), classCode: z.string(), indexNo: z.number().int(), startsAt: z.string(), teacherName: z.string().nullable() })),
            absenceAlerts: z.array(z.object({ learnerId: z.string(), fullName: z.string(), classCode: z.string(), streak: z.number().int() })),
            lowRemaining: z.array(z.object({ learnerId: z.string(), fullName: z.string(), classCode: z.string(), remaining: z.number().int() })),
            pendingGrading: z.number().int(),
          }),
        ),
      },
    },
    handler: async ({ principal, query }) => ({ data: await sessions.today(principal, query.branchId) }),
  });

  route({
    method: 'get',
    path: '/lms/trial-slots',
    tags: ['lms'],
    summary: 'Buổi còn chỗ học thử',
    description: 'Dùng cho CRM khi đặt lịch học thử (mọi nhân sự của chi nhánh xem được).',
    access: { authenticated: true },
    request: { query: z.object({ branchId: ulid, subjectId: ulid.optional(), from: instant.optional(), to: instant.optional() }) },
    responses: {
      200: {
        description: 'Buổi học',
        schema: item(
          z.array(
            z.object({
              sessionId: z.string(),
              classCode: z.string(),
              className: z.string(),
              levelName: z.string(),
              startsAt: z.string(),
              endsAt: z.string(),
              teacherName: z.string().nullable(),
              remaining: z.number().int(),
            }),
          ),
        ),
      },
    },
    handler: async ({ principal, query }) => ({ data: await sessions.trialSlots(principal, query) }),
  });

  route({
    method: 'get',
    path: '/lms/sessions/:id',
    tags: ['lms'],
    summary: 'Chi tiết buổi: điểm danh, nhận xét, khách học thử',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Buổi học', schema: item(SessionDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await sessions.get(principal, params.id) }),
  });

  route({
    method: 'patch',
    path: '/lms/sessions/:id',
    tags: ['lms'],
    summary: 'Dời buổi / dạy thay / đổi phòng / ghi chủ đề',
    description: 'Đổi giờ / GV / phòng cần lms.sessions.reschedule. Trùng lịch → 409 `SCHEDULE_CONFLICT`, gửi `force: true` để vẫn lưu.',
    access: read,
    request: {
      params: IdParams,
      body: z
        .object({
          startsAt: instant.optional(),
          endsAt: instant.optional(),
          teacherId: ulid.optional(),
          taId: ulid.nullable().optional(),
          roomId: ulid.nullable().optional(),
          topic: z.string().trim().max(200).nullable().optional(),
          teacherNote: z.string().trim().max(2000).nullable().optional(),
          force: z.boolean().optional(),
        })
        .strict(),
    },
    responses: { 200: { description: 'Buổi học', schema: item(SessionDetailSchema) } },
    errorCodes: ['SCHEDULE_CONFLICT', 'SESSION_DONE', 'SESSION_CANCELLED', 'STAFF_INVALID'],
    handler: async ({ principal, params, body }) => ({ data: await sessions.update(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/lms/sessions/:id/cancel',
    tags: ['lms'],
    summary: 'Huỷ buổi',
    description: 'Khách học thử của buổi được báo về CRM. Sinh buổi bù bằng generate-sessions.',
    access: { permission: 'lms.sessions.reschedule' },
    request: { params: IdParams, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
    responses: { 204: { description: 'Đã huỷ' } },
    errorCodes: ['INVALID_STATE_TRANSITION'],
    async handler({ principal, params, body }) {
      await sessions.cancel(principal, params.id, body.reason);
    },
  });

  route({
    method: 'post',
    path: '/lms/sessions/:id/attendance',
    tags: ['lms'],
    summary: 'Điểm danh (lưu nháp / chốt buổi)',
    description:
      '`finalize: true` → chốt buổi: cần đủ học viên, trừ buổi theo cấu hình `lms.attendance.consuming_statuses`, ' +
      'báo CRM (lms.attendance.recorded). Buổi đã chốt: sửa cần lms.attendance.correct (phát lms.attendance.corrected).',
    access: { permission: 'lms.attendance.record' },
    request: {
      params: IdParams,
      body: z.object({
        records: z.array(z.object({ learnerId: ulid, status: z.enum(ATTENDANCE_STATUSES), note: z.string().trim().max(300).nullable().optional() })).max(60),
        finalize: z.boolean().default(false),
      }),
    },
    responses: { 200: { description: 'Đã lưu', schema: item(z.object({ finalized: z.boolean() })) } },
    errorCodes: ['ATTENDANCE_INCOMPLETE', 'SESSION_FINALIZED', 'SESSION_CANCELLED', 'SESSION_NOT_STARTED'],
    handler: async ({ principal, params, body }) => ({ data: await sessions.saveAttendance(principal, params.id, body.records, body.finalize) }),
  });

  route({
    method: 'post',
    path: '/lms/sessions/:id/feedback',
    tags: ['lms'],
    summary: 'Nhận xét học viên trong buổi',
    description: 'Không nhận xét học viên có điểm danh vắng (ABSENT / EXCUSED) — 422 LEARNER_ABSENT.',
    access: { permission: 'lms.feedback.write' },
    request: {
      params: IdParams,
      body: z.object({ items: z.array(z.object({ learnerId: ulid, ratings: RatingsSchema, comment: z.string().trim().min(3).max(2000) })).min(1).max(60) }),
    },
    responses: { 204: { description: 'Đã lưu' } },
    errorCodes: ['SESSION_CANCELLED', 'LEARNER_ABSENT'],
    async handler({ principal, params, body }) {
      await sessions.saveFeedback(principal, params.id, body.items);
    },
  });

  route({
    method: 'post',
    path: '/lms/trial-guests/:id/check',
    tags: ['lms'],
    summary: 'Điểm danh khách học thử',
    description: 'Kết quả đồng bộ về lịch hẹn bên CRM.',
    access: { permission: 'lms.attendance.record' },
    request: { params: IdParams, body: z.object({ result: z.enum(['ATTENDED', 'NO_SHOW']), note: z.string().trim().max(500).nullable().optional() }) },
    responses: { 204: { description: 'Đã ghi' } },
    async handler({ principal, params, body }) {
      await sessions.checkTrialGuest(principal, params.id, body.result, body.note);
    },
  });

  // ─────────── Bài tập

  route({
    method: 'get',
    path: '/lms/assignments',
    tags: ['lms'],
    summary: 'Bài tập',
    access: read,
    request: { query: z.object({ classId: ulid.optional(), pendingGrading: z.stringbool().optional().openapi({ type: 'boolean' }) }) },
    responses: { 200: { description: 'Bài tập', schema: item(z.array(AssignmentSchema)) } },
    handler: async ({ principal, query }) => ({ data: await assignments.list(principal, query) }),
  });

  route({
    method: 'get',
    path: '/lms/assignments/:id',
    tags: ['lms'],
    summary: 'Bài tập + bài nộp từng học viên',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Bài tập', schema: item(AssignmentDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await assignments.get(principal, params.id) }),
  });

  route({
    method: 'post',
    path: '/lms/classes/:id/assignments',
    tags: ['lms'],
    summary: 'Giao bài tập cho lớp',
    access: { permission: 'lms.assignments.manage' },
    request: {
      params: IdParams,
      body: z.object({
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(4000).nullable().optional(),
        dueAt: z.union([instant, z.null()]).optional(),
        maxScore: z.number().int().min(1).max(100).default(10),
        sessionId: ulid.nullable().optional(),
      }),
    },
    responses: { 201: { description: 'Đã giao', schema: item(AssignmentDetailSchema) } },
    handler: async ({ principal, params, body }) => ({ data: await assignments.create(principal, params.id, body) }),
  });

  route({
    method: 'patch',
    path: '/lms/assignments/:id',
    tags: ['lms'],
    summary: 'Sửa bài tập',
    access: { permission: 'lms.assignments.manage' },
    request: {
      params: IdParams,
      body: z
        .object({
          title: z.string().trim().min(2).max(200).optional(),
          description: z.string().trim().max(4000).nullable().optional(),
          dueAt: z.union([instant, z.null()]).optional(),
          maxScore: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
    },
    responses: { 200: { description: 'Bài tập', schema: item(AssignmentDetailSchema) } },
    errorCodes: ['MAX_SCORE_TOO_LOW'],
    handler: async ({ principal, params, body }) => ({ data: await assignments.update(principal, params.id, body) }),
  });

  route({
    method: 'delete',
    path: '/lms/assignments/:id',
    tags: ['lms'],
    summary: 'Xoá bài tập (chưa chấm)',
    access: { permission: 'lms.assignments.manage' },
    request: { params: IdParams },
    responses: { 204: { description: 'Đã xoá' } },
    errorCodes: ['ASSIGNMENT_GRADED'],
    async handler({ principal, params }) {
      await assignments.remove(principal, params.id);
    },
  });

  route({
    method: 'post',
    path: '/lms/assignments/:id/attachments',
    tags: ['lms'],
    summary: 'Đính kèm file vào bài tập',
    access: { permission: 'lms.assignments.manage' },
    upload: { handler: uploadSingle({ field: 'file', maxBytes: 20 * 1_048_576, accept: DOCS }), field: 'file', description: 'Tối đa 20 MB' },
    request: { params: IdParams },
    responses: { 201: { description: 'Bài tập', schema: item(AssignmentDetailSchema) } },
    errorCodes: ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'TOO_MANY_ATTACHMENTS'],
    handler: async ({ principal, params, req }) => ({ data: await assignments.addAttachment(principal, params.id, requireFile(req, 'file')) }),
  });

  route({
    method: 'post',
    path: '/lms/assignments/:id/grades',
    tags: ['lms'],
    summary: 'Ghi nhận nộp bài / chấm điểm',
    description: 'Học viên không tự đăng nhập — giáo viên nhập thay. `GRADED` cần `score`. Chấm điểm → phát lms.assignment.graded.',
    access: { permission: 'lms.assignments.grade' },
    request: {
      params: IdParams,
      body: z.object({
        items: z
          .array(
            z.object({
              learnerId: ulid,
              status: z.enum(['SUBMITTED', 'GRADED', 'MISSING']),
              score: z.number().int().min(0).nullable().optional(),
              comment: z.string().trim().max(1000).nullable().optional(),
            }),
          )
          .min(1)
          .max(60),
      }),
    },
    responses: { 200: { description: 'Bài tập', schema: item(AssignmentDetailSchema) } },
    handler: async ({ principal, params, body }) => ({ data: await assignments.grade(principal, params.id, body.items) }),
  });

  // ─────────── Học liệu

  route({
    method: 'get',
    path: '/lms/materials',
    tags: ['lms'],
    summary: 'Học liệu',
    description: 'Theo cấp độ (dùng chung) hoặc theo lớp (gồm cả học liệu chung của cấp độ của lớp).',
    access: read,
    request: { query: z.object({ levelId: ulid.optional(), classId: ulid.optional() }) },
    responses: { 200: { description: 'Học liệu', schema: item(z.array(MaterialSchema)) } },
    handler: async ({ principal, query }) => ({ data: await assignments.listMaterials(principal, query) }),
  });

  route({
    method: 'post',
    path: '/lms/materials',
    tags: ['lms'],
    summary: 'Tải học liệu lên',
    access: { permission: 'lms.materials.manage' },
    upload: { handler: uploadSingle({ field: 'file', maxBytes: 50 * 1_048_576, accept: DOCS }), field: 'file', description: 'Tối đa 50 MB' },
    request: {
      body: z.object({
        title: z.string().trim().min(2).max(200),
        description: z.string().trim().max(1000).optional(),
        levelId: ulid.optional(),
        classId: ulid.optional(),
      }),
    },
    responses: { 201: { description: 'Đã tải lên', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE'],
    handler: async ({ principal, body, req }) => ({ data: { id: await assignments.uploadMaterial(principal, body, requireFile(req, 'file')) } }),
  });

  route({
    method: 'delete',
    path: '/lms/materials/:id',
    tags: ['lms'],
    summary: 'Xoá học liệu',
    access: { permission: 'lms.materials.manage' },
    request: { params: IdParams },
    responses: { 204: { description: 'Đã xoá' } },
    async handler({ principal, params }) {
      await assignments.removeMaterial(principal, params.id);
    },
  });
}
