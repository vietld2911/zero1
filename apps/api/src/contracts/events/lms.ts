/**
 * Sự kiện LMS phát ra — "ngôn ngữ công bố" giữa các context (docs/events.md §4).
 * Nằm ngoài contexts/ để CRM dùng được kiểu dữ liệu mà không import code của LMS.
 */

export const LMS_LEVEL_CHANGED = 'lms.level.changed';

export const LMS_EVENTS = {
  levelChanged: LMS_LEVEL_CHANGED,
  learnerPlaced: 'lms.learner.placed',
  learnerPromoted: 'lms.learner.promoted',
  attendanceRecorded: 'lms.attendance.recorded',
  attendanceCorrected: 'lms.attendance.corrected',
  trialChecked: 'lms.trial.checked',
  trialRejected: 'lms.trial.rejected',
  feedbackPublished: 'lms.feedback.published',
  assignmentGraded: 'lms.assignment.graded',
  classCompleted: 'lms.class.completed',
  sessionFinalized: 'lms.session.finalized',
} as const;

/**
 * Ảnh chụp đầy đủ một cấp độ sau mỗi thay đổi (của chính cấp độ hoặc của môn chứa nó).
 * Bên nhận ghi đè theo `levelId` — không cần ghép từ nhiều sự kiện.
 */
export interface LevelChangedV1 {
  levelId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  code: string;
  name: string;
  sessionsCount: number;
  sessionMinutes: number;
  sortOrder: number;
  /** Đang mở bán / mở lớp: cấp độ VÀ môn đều đang hoạt động. */
  isActive: boolean;
}

export interface LearnerPlacedV1 {
  learnerId: string;
  enrollmentId: string;
  classId: string;
  classCode: string;
  className: string;
  fromClassId: string | null;
}

export interface LearnerPromotedV1 {
  learnerId: string;
  fromLevelId: string | null;
  toLevelId: string;
  toLevelName: string;
}

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

/** Chốt điểm danh một học viên trong một buổi. */
export interface AttendanceRecordedV1 {
  sessionId: string;
  classId: string;
  learnerId: string;
  /** Đăng ký bị trừ buổi (CRM `enrollments.id`). */
  enrollmentId: string;
  status: AttendanceStatus;
  consumesSession: boolean;
  sessionStartsAt: string;
}

export interface AttendanceCorrectedV1 extends AttendanceRecordedV1 {
  fromStatus: AttendanceStatus;
}

export interface TrialCheckedV1 {
  appointmentId: string;
  lmsSessionId: string;
  result: 'ATTENDED' | 'NO_SHOW';
  note: string | null;
  /** Bổ sung 2026-10 (tuỳ chọn). */
  childName?: string;
}

export interface TrialRejectedV1 {
  appointmentId: string;
  lmsSessionId: string;
  reason: string;
}

export interface FeedbackPublishedV1 {
  sessionId: string;
  learnerId: string;
  comment: string;
}

export interface AssignmentGradedV1 {
  assignmentId: string;
  learnerId: string;
  score: number | null;
  maxScore: number;
}

export interface ClassCompletedV1 {
  classId: string;
  learnerIds: string[];
}

/** Chốt điểm danh một buổi — một sự kiện / buổi (tóm tắt), bên cạnh lms.attendance.recorded / học viên. */
export interface SessionFinalizedV1 {
  sessionId: string;
  classId: string;
  classCode: string;
  className: string;
  indexNo: number;
  sessionStartsAt: string;
  teacherId: string;
  counts: Record<AttendanceStatus, number>;
  absent: Array<{ learnerId: string; fullName: string; status: 'ABSENT' | 'EXCUSED' }>;
}
