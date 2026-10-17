/**
 * Sự kiện CRM phát ra (docs/events.md §3). LMS và webhooks dùng các kiểu này.
 */

export const CRM_EVENTS = {
  enrollmentActivated: 'crm.enrollment.activated',
  enrollmentAdjusted: 'crm.enrollment.adjusted',
  enrollmentCancelled: 'crm.enrollment.cancelled',
  studentUpdated: 'crm.student.updated',
  studentStatusChanged: 'crm.student.status_changed',
  trialBooked: 'crm.trial.booked',
  trialCancelled: 'crm.trial.cancelled',
  paymentConfirmed: 'crm.payment.confirmed',
  leadConverted: 'crm.lead.converted',
  leadCreated: 'crm.lead.created',
} as const;

export interface StudentSnapshot {
  fullName: string;
  birthDate: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  avatarUrl: string | null;
}

/** Khoản thu đầu tiên được xác nhận → học viên chờ xếp lớp bên LMS. */
export interface EnrollmentActivatedV1 {
  enrollmentId: string;
  enrollmentCode: string;
  studentId: string;
  studentCode: string;
  branchId: string;
  type: 'NEW' | 'RENEWAL';
  subjectId: string;
  startLevelId: string;
  sessionsPurchased: number;
  student: StudentSnapshot;
}

/** Số buổi thay đổi sau khi học bổng vượt mức được duyệt. */
export interface EnrollmentAdjustedV1 {
  enrollmentId: string;
  studentId: string;
  sessionsPurchased: number;
}

export interface EnrollmentCancelledV1 {
  enrollmentId: string;
  studentId: string;
  reason: string;
}

export interface StudentUpdatedV1 extends StudentSnapshot {
  studentId: string;
  branchId: string;
}

export type StudentStatus = 'PENDING' | 'ACTIVE' | 'PAUSED' | 'STOPPED';

export interface StudentStatusChangedV1 {
  studentId: string;
  from: StudentStatus;
  to: StudentStatus;
  effectiveDate: string;
  reason: string | null;
}

export interface TrialBookedV1 {
  appointmentId: string;
  leadId: string;
  lmsSessionId: string;
  branchId: string;
  guest: { childName: string; birthYear: number | null; parentName: string; parentPhone: string };
}

export interface TrialCancelledV1 {
  appointmentId: string;
  lmsSessionId: string;
}

/** Lead mới (nhập tay, import Excel hoặc qua API key — ví dụ form website). */
export interface LeadCreatedV1 {
  leadId: string;
  childName: string;
  parentName: string;
  parentPhone: string;
  source: string;
  ownerId: string | null;
  via: 'MANUAL' | 'IMPORT' | 'API';
}

export interface PaymentConfirmedV1 {
  paymentId: string;
  enrollmentId: string;
  /** Bổ sung 2026-10 (tuỳ chọn để tương thích sự kiện cũ). */
  enrollmentCode?: string;
  studentName?: string;
  studentCode?: string;
  studentId: string;
  amount: number;
  method: 'CASH' | 'TRANSFER' | 'CARD';
}

export interface LeadConvertedV1 {
  leadId: string;
  studentId: string;
  enrollmentId: string;
  ownerId: string | null;
}
