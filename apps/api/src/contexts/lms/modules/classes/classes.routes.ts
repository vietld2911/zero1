import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item, list, PaginationQuery } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { CLASS_STATUSES } from '../../db/schema.js';
import type { LearnersService } from '../learners/learners.service.js';
import type { ClassesService } from './classes.service.js';

const ulid = z.string().length(26);

const SlotSchema = z
  .object({
    weekday: z.number().int().min(1).max(7).openapi({ description: '1 = Thứ 2 … 7 = Chủ nhật' }),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ dạng HH:MM'),
    minutes: z.number().int().min(30).max(300),
  })
  .openapi('ScheduleSlot');

const ClassSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    branchId: z.string(),
    subjectId: z.string(),
    subjectName: z.string().nullable(),
    levelId: z.string(),
    levelName: z.string().nullable(),
    teacherId: z.string(),
    teacherName: z.string().nullable(),
    taId: z.string().nullable(),
    taName: z.string().nullable(),
    roomId: z.string().nullable(),
    roomName: z.string().nullable(),
    capacity: z.number().int(),
    learnerCount: z.number().int(),
    startDate: z.string(),
    schedule: z.array(SlotSchema),
    totalSessions: z.number().int(),
    sessionsDone: z.number().int(),
    sessionsPlanned: z.number().int(),
    nextSessionAt: z.string().nullable(),
    trialCapacity: z.number().int(),
    status: z.enum(CLASS_STATUSES),
    note: z.string().nullable(),
    version: z.number().int(),
  })
  .openapi('Class');

const ClassDetailSchema = ClassSchema.extend({
  learners: z.array(
    z.object({
      membershipId: z.string(),
      learnerId: z.string(),
      code: z.string(),
      fullName: z.string(),
      avatarUrl: z.string().nullable(),
      status: z.enum(['ACTIVE', 'PAUSED', 'LEFT', 'COMPLETED']),
      enrollmentId: z.string(),
      enrollmentCode: z.string(),
      sessionsRemaining: z.number().int(),
      attended: z.number().int(),
      recorded: z.number().int(),
      attendanceRate: z.number().int().nullable().openapi({ description: '% có mặt / muộn trên số buổi đã điểm danh' }),
      joinedAt: z.string(),
      leftAt: z.string().nullable(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      indexNo: z.number().int(),
      startsAt: z.string(),
      endsAt: z.string(),
      status: z.enum(['SCHEDULED', 'DONE', 'CANCELLED']),
      topic: z.string().nullable(),
      teacherName: z.string().nullable(),
      substitute: z.boolean(),
      attendanceCount: z.number().int(),
    }),
  ),
}).openapi('ClassDetail');

const RoomSchema = z
  .object({ id: z.string(), branchId: z.string(), name: z.string(), capacity: z.number().int(), isActive: z.boolean() })
  .openapi('Room');

const LearnerSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    branchId: z.string(),
    fullName: z.string(),
    birthDate: z.string().nullable(),
    gender: z.enum(['MALE', 'FEMALE']).nullable(),
    avatarUrl: z.string().nullable(),
    status: z.enum(['ACTIVE', 'PAUSED', 'STOPPED']),
    currentLevelId: z.string().nullable(),
    currentLevelName: z.string().nullable(),
    classes: z.array(z.object({ classId: z.string(), code: z.string(), name: z.string(), status: z.string() })),
    sessionsRemaining: z.number().int(),
  })
  .openapi('Learner');

const LearnerDetailSchema = LearnerSchema.extend({
  entitlements: z.array(
    z.object({
      enrollmentId: z.string(),
      enrollmentCode: z.string(),
      subjectId: z.string(),
      startLevelId: z.string(),
      startLevelName: z.string().nullable(),
      sessionsPurchased: z.number().int(),
      sessionsUsed: z.number().int(),
      status: z.enum(['ACTIVE', 'LOCKED', 'EXHAUSTED']),
      activatedAt: z.string(),
    }),
  ),
  memberships: z.array(
    z.object({
      id: z.string(),
      classId: z.string(),
      classCode: z.string(),
      className: z.string(),
      status: z.string(),
      joinedAt: z.string(),
      leftAt: z.string().nullable(),
      leftReason: z.string().nullable(),
    }),
  ),
  attendanceSummary: z.object({ PRESENT: z.number().int(), LATE: z.number().int(), ABSENT: z.number().int(), EXCUSED: z.number().int(), total: z.number().int() }),
  attendance: z.array(z.object({ sessionId: z.string(), classCode: z.string(), indexNo: z.number().int(), startsAt: z.string(), status: z.string(), note: z.string().nullable() })),
  grades: z.array(
    z.object({
      assignmentId: z.string(),
      title: z.string(),
      classCode: z.string(),
      status: z.string(),
      score: z.number().int().nullable(),
      maxScore: z.number().int(),
      comment: z.string().nullable(),
    }),
  ),
  feedback: z.array(z.object({ sessionId: z.string(), classCode: z.string(), startsAt: z.string(), ratings: z.record(z.string(), z.number()), comment: z.string() })),
  levelHistory: z.array(z.object({ fromLevelName: z.string().nullable(), toLevelName: z.string().nullable(), note: z.string().nullable(), createdAt: z.string() })),
}).openapi('LearnerDetail');

const classFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,30}$/, 'Mã 2–30 ký tự: chữ, số, - hoặc _'),
  name: z.string().trim().min(2).max(150),
  teacherId: ulid,
  taId: ulid.nullable().optional(),
  roomId: ulid.nullable().optional(),
  capacity: z.number().int().min(1).max(50),
  startDate: z.iso.date(),
  schedule: z.array(SlotSchema).min(1).max(7),
  totalSessions: z.number().int().min(1).max(200).optional(),
  trialCapacity: z.number().int().min(0).max(10).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
};

export function registerClassRoutes(route: RouteRegistrar, classes: ClassesService, learners: LearnersService) {
  const read = { permission: 'lms.learners.read' } as const;
  const manage = { permission: 'lms.classes.manage' } as const;

  // ─────────── Phòng

  route({
    method: 'get',
    path: '/lms/rooms',
    tags: ['lms'],
    summary: 'Phòng học',
    access: read,
    request: { query: z.object({ branchId: ulid.optional(), includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }) }) },
    responses: { 200: { description: 'Phòng', schema: item(z.array(RoomSchema)) } },
    handler: async ({ principal, query }) => ({ data: await classes.listRooms(principal, query.branchId, query.includeInactive) }),
  });

  route({
    method: 'post',
    path: '/lms/rooms',
    tags: ['lms'],
    summary: 'Thêm phòng học',
    access: { permission: 'lms.rooms.manage' },
    request: { body: z.object({ branchId: ulid, name: z.string().trim().min(1).max(100), capacity: z.number().int().min(1).max(100) }) },
    responses: { 201: { description: 'Đã tạo', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['ROOM_NAME_TAKEN'],
    handler: async ({ principal, body }) => ({ data: { id: await classes.createRoom(principal, body) } }),
  });

  route({
    method: 'patch',
    path: '/lms/rooms/:id',
    tags: ['lms'],
    summary: 'Sửa / ngừng phòng học',
    access: { permission: 'lms.rooms.manage' },
    request: {
      params: IdParams,
      body: z.object({ name: z.string().trim().min(1).max(100).optional(), capacity: z.number().int().min(1).max(100).optional(), isActive: z.boolean().optional() }),
    },
    responses: { 204: { description: 'Đã lưu' } },
    async handler({ principal, params, body }) {
      await classes.updateRoom(principal, params.id, body);
    },
  });

  // ─────────── Lớp

  route({
    method: 'get',
    path: '/lms/classes',
    tags: ['lms'],
    summary: 'Danh sách lớp',
    description: 'GV / TA chỉ thấy lớp mình dạy.',
    access: read,
    request: {
      query: z.object({
        status: z.string().optional(),
        branchId: ulid.optional(),
        levelId: ulid.optional(),
        teacherId: ulid.optional(),
        q: z.string().trim().optional(),
      }),
    },
    responses: { 200: { description: 'Lớp', schema: item(z.array(ClassSchema)) } },
    handler: async ({ principal, query }) => ({ data: await classes.list(principal, query) }),
  });

  route({
    method: 'get',
    path: '/lms/classes/:id',
    tags: ['lms'],
    summary: 'Chi tiết lớp: học viên, tiến độ, buổi học',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Lớp', schema: item(ClassDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await classes.get(principal, params.id) }),
  });

  route({
    method: 'post',
    path: '/lms/classes',
    tags: ['lms'],
    summary: 'Tạo lớp',
    description: 'Không gửi `totalSessions` → lấy số buổi của cấp độ. Sinh buổi học bằng POST /lms/classes/{id}/generate-sessions.',
    access: manage,
    request: { body: z.object({ ...classFields, branchId: ulid, levelId: ulid }) },
    responses: { 201: { description: 'Đã tạo', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['CLASS_CODE_TAKEN', 'STAFF_INVALID'],
    handler: async ({ principal, body }) => ({ data: { id: await classes.create(principal, body) } }),
  });

  route({
    method: 'patch',
    path: '/lms/classes/:id',
    tags: ['lms'],
    summary: 'Sửa lớp / đổi trạng thái',
    description: 'Đổi GV / TA / phòng áp dụng cho buổi chưa diễn ra. `COMPLETED` → học viên hoàn thành, phát lms.class.completed.',
    access: manage,
    request: { params: IdParams, body: z.object(classFields).partial().extend({ status: z.enum(CLASS_STATUSES).optional() }).strict() },
    responses: { 200: { description: 'Lớp', schema: item(ClassDetailSchema) } },
    errorCodes: ['CLASS_CODE_TAKEN', 'STAFF_INVALID', 'INVALID_STATE_TRANSITION', 'CAPACITY_BELOW_ENROLLED'],
    handler: async ({ principal, params, body }) => ({ data: await classes.update(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/lms/classes/:id/generate-sessions',
    tags: ['lms'],
    summary: 'Sinh buổi học theo lịch tuần',
    description: 'Sinh cho đủ số buổi (bỏ buổi đã huỷ), nối tiếp sau buổi cuối. Trùng GV / phòng → vẫn tạo, trả cảnh báo.',
    access: manage,
    request: { params: IdParams, body: z.object({ fromDate: z.iso.date().optional() }) },
    responses: {
      200: {
        description: 'Kết quả',
        schema: item(
          z.object({
            created: z.number().int(),
            warnings: z.array(z.object({ kind: z.enum(['TEACHER', 'ROOM']), sessionId: z.string(), classCode: z.string(), startsAt: z.string() })),
          }),
        ),
      },
    },
    errorCodes: ['CLASS_CLOSED'],
    handler: async ({ principal, params, body }) => ({ data: await classes.generateSessions(principal, params.id, body.fromDate) }),
  });

  // ─────────── Xếp lớp

  route({
    method: 'get',
    path: '/lms/placement',
    tags: ['lms'],
    summary: 'Học viên chờ xếp lớp',
    description: 'Đã có khoản thu đầu tiên bên CRM, chưa có lớp của môn đó.',
    access: { permission: 'lms.classes.place' },
    request: { query: z.object({ branchId: ulid.optional() }) },
    responses: {
      200: {
        description: 'Chờ xếp lớp',
        schema: item(
          z.array(
            z.object({
              learnerId: z.string(),
              learnerCode: z.string(),
              fullName: z.string(),
              birthDate: z.string().nullable(),
              branchId: z.string(),
              enrollmentId: z.string(),
              enrollmentCode: z.string(),
              subjectId: z.string(),
              subjectName: z.string(),
              startLevelId: z.string(),
              startLevelName: z.string(),
              sessionsRemaining: z.number().int(),
              waitingSince: z.string(),
            }),
          ),
        ),
      },
    },
    handler: async ({ principal, query }) => ({ data: await learners.waiting(principal, query.branchId) }),
  });

  route({
    method: 'post',
    path: '/lms/classes/:id/learners',
    tags: ['lms'],
    summary: 'Xếp học viên vào lớp',
    description: 'Đang học lớp khác cùng môn → chuyển lớp. Phát lms.learner.placed.',
    access: { permission: 'lms.classes.place' },
    request: { params: IdParams, body: z.object({ learnerId: ulid, enrollmentId: ulid }) },
    responses: { 201: { description: 'Đã xếp', schema: item(z.object({ membershipId: z.string(), fromClassId: z.string().nullable() })) } },
    errorCodes: ['CLASS_FULL', 'CLASS_CLOSED', 'ALREADY_IN_CLASS', 'SUBJECT_MISMATCH', 'ENTITLEMENT_INACTIVE', 'LEARNER_NOT_ACTIVE'],
    handler: async ({ principal, params, body }) => ({ data: await classes.place(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/lms/class-learners/:id/leave',
    tags: ['lms'],
    summary: 'Cho học viên rời lớp',
    access: { permission: 'lms.classes.place' },
    request: { params: IdParams, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
    responses: { 204: { description: 'Đã rời lớp' } },
    async handler({ principal, params, body }) {
      await classes.removeLearner(principal, params.id, body.reason);
    },
  });

  // ─────────── Học viên

  route({
    method: 'get',
    path: '/lms/learners',
    tags: ['lms'],
    summary: 'Học viên (học tập)',
    access: read,
    request: {
      query: PaginationQuery.omit({ sort: true }).extend({
        q: z.string().trim().optional(),
        status: z.string().optional(),
        branchId: ulid.optional(),
        classId: ulid.optional(),
      }),
    },
    responses: { 200: { description: 'Học viên', schema: list(LearnerSchema) } },
    handler: ({ principal, query }) => learners.list(principal, query),
  });

  route({
    method: 'get',
    path: '/lms/learners/:id',
    tags: ['lms'],
    summary: 'Hồ sơ học tập',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Học viên', schema: item(LearnerDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await learners.get(principal, params.id) }),
  });

  route({
    method: 'post',
    path: '/lms/learners/:id/promote',
    tags: ['lms'],
    summary: 'Lên cấp độ',
    access: { permission: 'lms.learners.promote' },
    request: { params: IdParams, body: z.object({ toLevelId: ulid, note: z.string().trim().max(500).nullable().optional() }) },
    responses: { 200: { description: 'Học viên', schema: item(LearnerDetailSchema) } },
    errorCodes: ['LEVEL_SUBJECT_MISMATCH', 'SAME_LEVEL'],
    handler: async ({ principal, params, body }) => ({ data: await learners.promote(principal, params.id, body.toLevelId, body.note) }),
  });
}
