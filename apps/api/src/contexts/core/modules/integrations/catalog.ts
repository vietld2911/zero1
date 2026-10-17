import { CRM_EVENTS } from '../../../../contracts/events/crm.js';
import { LMS_EVENTS } from '../../../../contracts/events/lms.js';

/** Nhãn tiếng Việt của mọi sự kiện mà webhook / Telegram nhận được (docs/events.md). */
export const EVENT_LABELS: Record<string, string> = {
  [CRM_EVENTS.leadCreated]: 'Khách hàng tiềm năng mới',
  [CRM_EVENTS.leadConverted]: 'Lead đăng ký học',
  [CRM_EVENTS.enrollmentActivated]: 'Học viên đóng tiền (kích hoạt đăng ký)',
  [CRM_EVENTS.enrollmentAdjusted]: 'Đăng ký đổi số buổi (sau duyệt ưu đãi)',
  [CRM_EVENTS.enrollmentCancelled]: 'Huỷ đăng ký',
  [CRM_EVENTS.paymentConfirmed]: 'Xác nhận khoản thu',
  [CRM_EVENTS.studentUpdated]: 'Sửa hồ sơ học viên',
  [CRM_EVENTS.studentStatusChanged]: 'Bảo lưu / nghỉ / học lại',
  [CRM_EVENTS.trialBooked]: 'Đặt lịch học thử',
  [CRM_EVENTS.trialCancelled]: 'Huỷ lịch học thử',
  [LMS_EVENTS.levelChanged]: 'Sửa cấp độ (chương trình học)',
  [LMS_EVENTS.learnerPlaced]: 'Xếp / chuyển lớp',
  [LMS_EVENTS.learnerPromoted]: 'Lên cấp độ',
  [LMS_EVENTS.sessionFinalized]: 'Chốt điểm danh buổi học (tóm tắt)',
  [LMS_EVENTS.attendanceRecorded]: 'Điểm danh từng học viên',
  [LMS_EVENTS.attendanceCorrected]: 'Sửa điểm danh',
  [LMS_EVENTS.trialChecked]: 'Kết quả học thử',
  [LMS_EVENTS.trialRejected]: 'LMS không nhận khách học thử',
  [LMS_EVENTS.feedbackPublished]: 'Nhận xét buổi học',
  [LMS_EVENTS.assignmentGraded]: 'Chấm bài tập',
  [LMS_EVENTS.classCompleted]: 'Kết thúc lớp',
};

/** Sự kiện có mẫu tin nhắn Telegram (nhóm nội bộ). Sự kiện khác chỉ gửi qua webhook. */
export const TELEGRAM_EVENTS = [
  CRM_EVENTS.leadCreated,
  CRM_EVENTS.enrollmentActivated,
  CRM_EVENTS.paymentConfirmed,
  LMS_EVENTS.sessionFinalized,
  LMS_EVENTS.trialChecked,
] as string[];

export function eventCatalog() {
  return Object.entries(EVENT_LABELS).map(([type, label]) => ({
    type,
    label,
    app: type.split('.')[0] as 'crm' | 'lms',
    telegram: TELEGRAM_EVENTS.includes(type),
  }));
}
