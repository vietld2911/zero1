import type { BadgeProps } from '@zero1/ui';

type Tone = NonNullable<BadgeProps['tone']>;
type Labels<K extends string> = Record<K, { label: string; tone: Tone }>;

/** Trạng thái lead S1–S5 (docs/roadmap.md GĐ7). A = đang xử lý, B = chờ việc cụ thể, C = dừng. */
export type LeadStatus = 'S1A' | 'S1B' | 'S1C' | 'S2A' | 'S2B' | 'S2C' | 'S3A' | 'S3B' | 'S3C' | 'S4A' | 'S4B' | 'S4C' | 'S5A' | 'S5B';
export const LEAD_STATUS: Labels<LeadStatus> = {
  S1A: { label: 'Lead mới', tone: 'info' },
  S1B: { label: 'Chưa liên lạc được', tone: 'warning' },
  S1C: { label: 'Không nhu cầu / sai số', tone: 'neutral' },
  S2A: { label: 'Quan tâm', tone: 'brand' },
  S2B: { label: 'Đang cân nhắc', tone: 'brand' },
  S2C: { label: 'Từ chối sau tư vấn', tone: 'neutral' },
  S3A: { label: 'Đã đặt lịch', tone: 'info' },
  S3B: { label: 'Đã xác nhận lịch', tone: 'info' },
  S3C: { label: 'Không đến', tone: 'danger' },
  S4A: { label: 'Đã trial, cân nhắc', tone: 'warning' },
  S4B: { label: 'Hẹn đóng phí', tone: 'warning' },
  S4C: { label: 'Từ chối sau trial', tone: 'neutral' },
  S5A: { label: 'Đã đăng ký, chờ đóng tiền', tone: 'success' },
  S5B: { label: 'Đã đóng tiền', tone: 'success' },
};
/** "S2A · Quan tâm" */
export const leadStatusText = (s: LeadStatus) => `${s} · ${LEAD_STATUS[s].label}`;
export const LEAD_STAGES = {
  1: 'Chưa khai thác',
  2: 'Đã khai thác',
  3: 'Đã hẹn trial',
  4: 'Đã trial + tư vấn',
  5: 'Đã đăng ký',
} as const;
export type LeadStage = keyof typeof LEAD_STAGES;
export const stageOf = (s: LeadStatus) => Number(s[1]) as LeadStage;
/** Lead đã dừng (S3C không phải dừng — cần hẹn lại). */
export const STOPPED_STATUSES: LeadStatus[] = ['S1C', 'S2C', 'S4C'];
export const isStopped = (s: LeadStatus) => STOPPED_STATUSES.includes(s);
/** Trạng thái chọn tay được; S3 / S4A / S5 chỉ đi theo lịch hẹn, điểm danh, đăng ký. */
export const MANUAL_STATUSES: LeadStatus[] = ['S1B', 'S1C', 'S2A', 'S2B', 'S2C', 'S4B', 'S4C'];

export const LEAD_STATUS_SOURCES = {
  CREATE: 'Tạo lead',
  CALL: 'Cuộc gọi',
  MANUAL: 'Đổi tay',
  REOPEN: 'Mở lại',
  APPOINTMENT: 'Lịch hẹn',
  ENROLLMENT: 'Đăng ký',
  PAYMENT: 'Thu tiền',
} as const;

export const LEAD_SOURCES = {
  FACEBOOK: 'Facebook',
  ZALO: 'Zalo',
  WEBSITE: 'Website',
  HOTLINE: 'Hotline',
  REFERRAL: 'Giới thiệu',
  WALK_IN: 'Đến trực tiếp',
  EVENT: 'Sự kiện',
  OTHER: 'Khác',
} as const;
export type LeadSource = keyof typeof LEAD_SOURCES;

export const CALL_OUTCOMES = {
  TALKED: 'Đã trao đổi',
  NO_ANSWER: 'Không nghe máy',
  BUSY: 'Máy bận',
  WRONG_NUMBER: 'Sai số',
  CALL_BACK: 'Hẹn gọi lại',
} as const;

export const APPOINTMENT_TYPES = { EXPERIENCE: 'Trải nghiệm', TRIAL: 'Học thử' } as const;

export const APPOINTMENT_STATUS: Labels<'SCHEDULED' | 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED'> = {
  SCHEDULED: { label: 'Đã hẹn', tone: 'info' },
  CONFIRMED: { label: 'Đã xác nhận', tone: 'brand' },
  ATTENDED: { label: 'Đã đến', tone: 'success' },
  NO_SHOW: { label: 'Không đến', tone: 'danger' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export const STUDENT_STATUS: Labels<'PENDING' | 'ACTIVE' | 'PAUSED' | 'STOPPED'> = {
  PENDING: { label: 'Chờ đóng tiền', tone: 'warning' },
  ACTIVE: { label: 'Đang học', tone: 'success' },
  PAUSED: { label: 'Bảo lưu', tone: 'info' },
  STOPPED: { label: 'Đã nghỉ', tone: 'neutral' },
};

export const ENROLLMENT_STATUS: Labels<'AWAITING_PAYMENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'> = {
  AWAITING_PAYMENT: { label: 'Chờ thu tiền', tone: 'warning' },
  ACTIVE: { label: 'Đang hiệu lực', tone: 'success' },
  COMPLETED: { label: 'Đã hoàn thành', tone: 'neutral' },
  CANCELLED: { label: 'Đã huỷ', tone: 'danger' },
};

export const PAYMENT_STATE: Labels<'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID'> = {
  UNPAID: { label: 'Chưa thu', tone: 'danger' },
  PARTIAL: { label: 'Thu một phần', tone: 'warning' },
  PAID: { label: 'Đã đủ', tone: 'success' },
  OVERPAID: { label: 'Thu dư', tone: 'info' },
};

export const APPROVAL_STATUS: Labels<'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'> = {
  NONE: { label: 'Không cần duyệt', tone: 'neutral' },
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

export const PAYMENT_METHODS = { CASH: 'Tiền mặt', TRANSFER: 'Chuyển khoản', CARD: 'Quẹt thẻ' } as const;

export const PAYMENT_STATUS: Labels<'PENDING' | 'CONFIRMED' | 'CANCELLED'> = {
  PENDING: { label: 'Chờ xác nhận', tone: 'warning' },
  CONFIRMED: { label: 'Đã nhận', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ', tone: 'neutral' },
};

export const GIFT_STATUS: Labels<'PENDING' | 'DELIVERED' | 'RETURNED'> = {
  PENDING: { label: 'Chưa giao', tone: 'warning' },
  DELIVERED: { label: 'Đã giao', tone: 'success' },
  RETURNED: { label: 'Đã thu hồi', tone: 'neutral' },
};

export const GENDERS = { MALE: 'Nam', FEMALE: 'Nữ' } as const;

/** Vai trò được giao phụ trách lead / học viên. */
export const OWNER_ROLES = ['SALE', 'SL', 'CS', 'CM'];

export const crmKeys = {
  leads: ['crm', 'leads'] as const,
  lead: (id: string) => ['crm', 'leads', id] as const,
  appointments: ['crm', 'appointments'] as const,
  students: ['crm', 'students'] as const,
  student: (id: string) => ['crm', 'students', id] as const,
  enrollments: ['crm', 'enrollments'] as const,
  enrollment: (id: string) => ['crm', 'enrollments', id] as const,
  approvals: ['crm', 'approvals'] as const,
  paymentAccounts: ['crm', 'payment-accounts'] as const,
  reports: ['crm', 'reports'] as const,
  renewals: ['crm', 'renewals'] as const,
};
