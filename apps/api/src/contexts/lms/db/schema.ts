import { boolean, date, index, int, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { defineEventTables } from '../../../platform/events/tables.js';
import { instant, jsonb, timestamps, ulid } from '../../../platform/db/columns.js';

// Bảng sự kiện của database zero1_lms (docs/events.md §1).
export const { outboxEvents, processedEvents } = defineEventTables();

/** Môn học, ví dụ Robotics, Lập trình Scratch. */
export const subjects = mysqlTable(
  'subjects',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 1000 }),
    sortOrder: int('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('subjects_code_uq').on(t.code)],
);

/** Cấp độ trong một môn; `sortOrder` là thứ tự lên lớp. */
export const levels = mysqlTable(
  'levels',
  {
    id: ulid('id').primaryKey(),
    subjectId: ulid('subject_id').notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 1000 }),
    /** Số buổi của cấp độ — CRM dùng làm số buổi mặc định khi tạo gói học phí. */
    sessionsCount: int('sessions_count').notNull(),
    sessionMinutes: int('session_minutes').notNull().default(90),
    sortOrder: int('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('levels_subject_code_uq').on(t.subjectId, t.code), index('levels_subject_order_idx').on(t.subjectId, t.sortOrder)],
);

/** Bản sao học viên từ CRM (cùng id với `students`). Chỉ cập nhật qua sự kiện CRM + lên lớp. */
export const learners = mysqlTable(
  'learners',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    branchId: ulid('branch_id').notNull(),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    birthDate: date('birth_date', { mode: 'string' }),
    gender: varchar('gender', { length: 6, enum: ['MALE', 'FEMALE'] }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    status: varchar('status', { length: 10, enum: ['ACTIVE', 'PAUSED', 'STOPPED'] }).notNull().default('ACTIVE'),
    currentLevelId: ulid('current_level_id'),
    ...timestamps,
  },
  (t) => [index('learners_branch_idx').on(t.branchId, t.status)],
);

/** Quyền học theo từng đăng ký CRM: số buổi được học / đã học. */
export const learnerEntitlements = mysqlTable(
  'learner_entitlements',
  {
    enrollmentId: ulid('enrollment_id').primaryKey(),
    enrollmentCode: varchar('enrollment_code', { length: 20 }).notNull(),
    learnerId: ulid('learner_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    subjectId: ulid('subject_id').notNull(),
    startLevelId: ulid('start_level_id').notNull(),
    sessionsPurchased: int('sessions_purchased').notNull(),
    sessionsUsed: int('sessions_used').notNull().default(0),
    /** LOCKED: đăng ký bị huỷ. EXHAUSTED: hết buổi. */
    status: varchar('status', { length: 10, enum: ['ACTIVE', 'LOCKED', 'EXHAUSTED'] }).notNull().default('ACTIVE'),
    activatedAt: instant('activated_at').notNull(),
  },
  (t) => [index('learner_entitlements_learner_idx').on(t.learnerId, t.status)],
);

export const learnerLevelHistory = mysqlTable(
  'learner_level_history',
  {
    id: ulid('id').primaryKey(),
    learnerId: ulid('learner_id').notNull(),
    fromLevelId: ulid('from_level_id'),
    toLevelId: ulid('to_level_id').notNull(),
    note: varchar('note', { length: 500 }),
    promotedBy: ulid('promoted_by').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('learner_level_history_learner_idx').on(t.learnerId)],
);

export const rooms = mysqlTable(
  'rooms',
  {
    id: ulid('id').primaryKey(),
    branchId: ulid('branch_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    capacity: int('capacity').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('rooms_branch_name_uq').on(t.branchId, t.name)],
);

export interface ScheduleSlot {
  /** 1 = Thứ 2 … 7 = Chủ nhật. */
  weekday: number;
  /** HH:MM giờ Việt Nam. */
  startTime: string;
  minutes: number;
}

export const CLASS_STATUSES = ['PLANNED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;

export const classes = mysqlTable(
  'classes',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 30 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    branchId: ulid('branch_id').notNull(),
    subjectId: ulid('subject_id').notNull(),
    levelId: ulid('level_id').notNull(),
    teacherId: ulid('teacher_id').notNull(),
    taId: ulid('ta_id'),
    roomId: ulid('room_id'),
    capacity: int('capacity').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    schedule: jsonb('schedule').$type<ScheduleSlot[]>().notNull(),
    totalSessions: int('total_sessions').notNull(),
    /** Số khách học thử tối đa mỗi buổi (mặc định cho buổi mới sinh). */
    trialCapacity: int('trial_capacity').notNull().default(2),
    status: varchar('status', { length: 10, enum: CLASS_STATUSES }).notNull().default('PLANNED'),
    note: varchar('note', { length: 1000 }),
    version: int('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('classes_code_uq').on(t.code),
    index('classes_branch_status_idx').on(t.branchId, t.status),
    index('classes_teacher_idx').on(t.teacherId),
    index('classes_ta_idx').on(t.taId),
  ],
);

export const classLearners = mysqlTable(
  'class_learners',
  {
    id: ulid('id').primaryKey(),
    classId: ulid('class_id').notNull(),
    learnerId: ulid('learner_id').notNull(),
    /** Đăng ký đang được trừ buổi khi học lớp này. */
    enrollmentId: ulid('enrollment_id').notNull(),
    status: varchar('status', { length: 10, enum: ['ACTIVE', 'PAUSED', 'LEFT', 'COMPLETED'] }).notNull().default('ACTIVE'),
    joinedAt: instant('joined_at').notNull(),
    leftAt: instant('left_at'),
    leftReason: varchar('left_reason', { length: 300 }),
  },
  (t) => [index('class_learners_class_idx').on(t.classId, t.status), index('class_learners_learner_idx').on(t.learnerId, t.status)],
);

export const SESSION_STATUSES = ['SCHEDULED', 'DONE', 'CANCELLED'] as const;

export const sessions = mysqlTable(
  'sessions',
  {
    id: ulid('id').primaryKey(),
    classId: ulid('class_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    /** Thứ tự buổi trong lớp (1…n), không tính buổi đã huỷ. */
    indexNo: int('index_no').notNull(),
    startsAt: instant('starts_at').notNull(),
    endsAt: instant('ends_at').notNull(),
    /** Giáo viên / trợ giảng thực tế của buổi (dạy thay thì khác lớp). */
    teacherId: ulid('teacher_id').notNull(),
    taId: ulid('ta_id'),
    roomId: ulid('room_id'),
    status: varchar('status', { length: 10, enum: SESSION_STATUSES }).notNull().default('SCHEDULED'),
    topic: varchar('topic', { length: 200 }),
    teacherNote: varchar('teacher_note', { length: 2000 }),
    trialCapacity: int('trial_capacity').notNull(),
    cancelReason: varchar('cancel_reason', { length: 300 }),
    finalizedAt: instant('finalized_at'),
    finalizedBy: ulid('finalized_by'),
    ...timestamps,
  },
  (t) => [
    index('sessions_class_idx').on(t.classId, t.startsAt),
    index('sessions_branch_time_idx').on(t.branchId, t.startsAt),
    index('sessions_teacher_time_idx').on(t.teacherId, t.startsAt),
    index('sessions_room_time_idx').on(t.roomId, t.startsAt),
  ],
);

export const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const;

export const attendance = mysqlTable(
  'attendance',
  {
    sessionId: ulid('session_id').notNull(),
    learnerId: ulid('learner_id').notNull(),
    enrollmentId: ulid('enrollment_id').notNull(),
    status: varchar('status', { length: 10, enum: ATTENDANCE_STATUSES }).notNull(),
    note: varchar('note', { length: 300 }),
    /** Đã trừ buổi (theo cấu hình lms.attendance.consuming_statuses lúc chốt). */
    consumesSession: boolean('consumes_session').notNull().default(false),
    recordedBy: ulid('recorded_by').notNull(),
    recordedAt: instant('recorded_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.learnerId] }), index('attendance_learner_idx').on(t.learnerId), index('attendance_enrollment_idx').on(t.enrollmentId)],
);

export const trialGuests = mysqlTable(
  'trial_guests',
  {
    id: ulid('id').primaryKey(),
    sessionId: ulid('session_id').notNull(),
    appointmentId: ulid('appointment_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    childName: varchar('child_name', { length: 150 }).notNull(),
    birthYear: int('birth_year'),
    parentName: varchar('parent_name', { length: 150 }).notNull(),
    parentPhone: varchar('parent_phone', { length: 15 }).notNull(),
    result: varchar('result', { length: 10, enum: ['PENDING', 'ATTENDED', 'NO_SHOW'] }).notNull().default('PENDING'),
    note: varchar('note', { length: 500 }),
    checkedBy: ulid('checked_by'),
    checkedAt: instant('checked_at'),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [uniqueIndex('trial_guests_appointment_uq').on(t.appointmentId), index('trial_guests_session_idx').on(t.sessionId)],
);

export interface FeedbackRatings {
  focus?: number;
  creativity?: number;
  teamwork?: number;
  skill?: number;
}

export const sessionFeedbacks = mysqlTable(
  'session_feedbacks',
  {
    sessionId: ulid('session_id').notNull(),
    learnerId: ulid('learner_id').notNull(),
    ratings: jsonb('ratings').$type<FeedbackRatings>().notNull(),
    comment: varchar('comment', { length: 2000 }).notNull(),
    authorId: ulid('author_id').notNull(),
    publishedAt: instant('published_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.learnerId] }), index('session_feedbacks_learner_idx').on(t.learnerId)],
);

export interface Attachment {
  name: string;
  url: string;
  mimeType: string;
  size: number;
}

export const assignments = mysqlTable(
  'assignments',
  {
    id: ulid('id').primaryKey(),
    classId: ulid('class_id').notNull(),
    sessionId: ulid('session_id'),
    title: varchar('title', { length: 200 }).notNull(),
    description: varchar('description', { length: 4000 }),
    dueAt: instant('due_at'),
    maxScore: int('max_score').notNull().default(10),
    attachments: jsonb('attachments').$type<Attachment[]>().notNull(),
    createdBy: ulid('created_by').notNull(),
    ...timestamps,
  },
  (t) => [index('assignments_class_idx').on(t.classId)],
);

export const submissions = mysqlTable(
  'assignment_submissions',
  {
    assignmentId: ulid('assignment_id').notNull(),
    learnerId: ulid('learner_id').notNull(),
    status: varchar('status', { length: 10, enum: ['SUBMITTED', 'GRADED', 'MISSING'] }).notNull(),
    submittedAt: instant('submitted_at'),
    score: int('score'),
    comment: varchar('comment', { length: 1000 }),
    gradedBy: ulid('graded_by'),
    gradedAt: instant('graded_at'),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.assignmentId, t.learnerId] }), index('submissions_learner_idx').on(t.learnerId)],
);

export const materials = mysqlTable(
  'materials',
  {
    id: ulid('id').primaryKey(),
    /** Học liệu chung của cấp độ (mọi lớp) hoặc riêng một lớp. */
    levelId: ulid('level_id'),
    classId: ulid('class_id'),
    title: varchar('title', { length: 200 }).notNull(),
    description: varchar('description', { length: 1000 }),
    url: varchar('url', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: int('size').notNull(),
    uploadedBy: ulid('uploaded_by').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('materials_level_idx').on(t.levelId), index('materials_class_idx').on(t.classId)],
);
