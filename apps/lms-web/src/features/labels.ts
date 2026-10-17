import type { BadgeProps } from '@zero1/ui';

type Tone = NonNullable<BadgeProps['tone']>;
type Labels<K extends string> = Record<K, { label: string; tone: Tone }>;

export const CLASS_STATUS: Labels<'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED'> = {
  PLANNED: { label: 'Sắp khai giảng', tone: 'info' },
  ONGOING: { label: 'Đang học', tone: 'success' },
  COMPLETED: { label: 'Đã kết thúc', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'danger' },
};

export const SESSION_STATUS: Labels<'SCHEDULED' | 'DONE' | 'CANCELLED'> = {
  SCHEDULED: { label: 'Chưa học', tone: 'info' },
  DONE: { label: 'Đã chốt', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export const ATTENDANCE: Labels<AttendanceStatus> & Record<AttendanceStatus, { short: string; active: string }> = {
  PRESENT: { label: 'Có mặt', short: 'Có', tone: 'success', active: 'bg-success text-white border-success' },
  LATE: { label: 'Đi muộn', short: 'Muộn', tone: 'warning', active: 'bg-warning text-white border-warning' },
  ABSENT: { label: 'Vắng', short: 'Vắng', tone: 'danger', active: 'bg-danger text-white border-danger' },
  EXCUSED: { label: 'Vắng có phép', short: 'Phép', tone: 'info', active: 'bg-info text-white border-info' },
};

export const MEMBERSHIP_STATUS: Labels<'ACTIVE' | 'PAUSED' | 'LEFT' | 'COMPLETED'> = {
  ACTIVE: { label: 'Đang học', tone: 'success' },
  PAUSED: { label: 'Bảo lưu', tone: 'info' },
  LEFT: { label: 'Đã rời lớp', tone: 'neutral' },
  COMPLETED: { label: 'Hoàn thành', tone: 'brand' },
};

export const LEARNER_STATUS: Labels<'ACTIVE' | 'PAUSED' | 'STOPPED'> = {
  ACTIVE: { label: 'Đang học', tone: 'success' },
  PAUSED: { label: 'Bảo lưu', tone: 'info' },
  STOPPED: { label: 'Đã nghỉ', tone: 'neutral' },
};

export const SUBMISSION_STATUS: Labels<'SUBMITTED' | 'GRADED' | 'MISSING'> = {
  SUBMITTED: { label: 'Đã nộp', tone: 'info' },
  GRADED: { label: 'Đã chấm', tone: 'success' },
  MISSING: { label: 'Không nộp', tone: 'danger' },
};

export const RATING_CRITERIA = { focus: 'Tập trung', creativity: 'Sáng tạo', teamwork: 'Làm việc nhóm', skill: 'Kỹ năng' } as const;
export type RatingKey = keyof typeof RATING_CRITERIA;

export const TEACHER_ROLES = ['TEACHER', 'TL'];
export const TA_ROLES = ['TA', 'TEACHER'];

export const lmsKeys = {
  classes: ['lms', 'classes'] as const,
  class: (id: string) => ['lms', 'classes', id] as const,
  sessions: ['lms', 'sessions'] as const,
  session: (id: string) => ['lms', 'sessions', id] as const,
  today: ['lms', 'today'] as const,
  placement: ['lms', 'placement'] as const,
  learners: ['lms', 'learners'] as const,
  learner: (id: string) => ['lms', 'learners', id] as const,
  rooms: ['lms', 'rooms'] as const,
  assignments: ['lms', 'assignments'] as const,
  assignment: (id: string) => ['lms', 'assignments', id] as const,
  materials: ['lms', 'materials'] as const,
  subjects: ['lms', 'subjects'] as const,
};

/** Làm mới mọi dữ liệu lớp / buổi sau khi thay đổi (dữ liệu chéo nhau nhiều). */
export const teachingKeys = [lmsKeys.classes, lmsKeys.sessions, lmsKeys.today, lmsKeys.placement, lmsKeys.learners, lmsKeys.assignments];
