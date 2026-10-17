import type { BadgeProps } from '@zero1/ui';

type Tone = NonNullable<BadgeProps['tone']>;
type Labels<K extends string> = Record<K, { label: string; tone: Tone }>;

export const LEAD_STATUS: Labels<'NEW' | 'CONTACTING' | 'SCHEDULED' | 'ATTENDED' | 'NO_SHOW' | 'CONVERTED' | 'LOST'> = {
  NEW: { label: 'Mới', tone: 'info' },
  CONTACTING: { label: 'Đang liên hệ', tone: 'brand' },
  SCHEDULED: { label: 'Đã hẹn', tone: 'warning' },
  ATTENDED: { label: 'Đã đến', tone: 'success' },
  NO_SHOW: { label: 'Không đến', tone: 'danger' },
  CONVERTED: { label: 'Đã đăng ký', tone: 'success' },
  LOST: { label: 'Thất bại', tone: 'neutral' },
};

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
