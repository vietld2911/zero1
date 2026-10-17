import { boolean, date, index, int, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { defineEventTables } from '../../../platform/events/tables.js';
import { defineSequenceTable } from '../../../platform/db/sequences.js';
import { instant, jsonb, money, timestamps, ulid } from '../../../platform/db/columns.js';

// Bảng sự kiện của database zero1_crm (docs/events.md §1).
export const { outboxEvents, processedEvents } = defineEventTables();

/**
 * Bản sao danh mục cấp độ của LMS (cập nhật từ sự kiện `lms.level.changed`).
 * CRM chỉ đọc bảng này — không bao giờ ghi trực tiếp, không JOIN sang zero1_lms.
 */
export const catalogLevels = mysqlTable(
  'catalog_levels',
  {
    levelId: ulid('level_id').primaryKey(),
    subjectId: ulid('subject_id').notNull(),
    subjectCode: varchar('subject_code', { length: 20 }).notNull(),
    subjectName: varchar('subject_name', { length: 150 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    sessionsCount: int('sessions_count').notNull(),
    sessionMinutes: int('session_minutes').notNull(),
    sortOrder: int('sort_order').notNull(),
    isActive: boolean('is_active').notNull(),
    /** ID (ULID, tăng dần) của sự kiện đã áp dụng — sự kiện cũ hơn đến sau sẽ bị bỏ qua. */
    sourceEventId: ulid('source_event_id').notNull(),
    syncedAt: instant('synced_at').notNull(),
  },
  (t) => [index('catalog_levels_subject_idx').on(t.subjectId, t.sortOrder)],
);

/** Gói học phí: thuộc một môn (theo bản sao catalog), số buổi + số tháng hiệu lực. */
export const packages = mysqlTable(
  'packages',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    subjectId: ulid('subject_id').notNull(),
    months: int('months').notNull(),
    sessionsCount: int('sessions_count').notNull(),
    sessionsPerWeek: int('sessions_per_week').notNull().default(2),
    basePrice: money('base_price').notNull(),
    defaultScholarshipMonths: int('default_scholarship_months').notNull().default(0),
    description: varchar('description', { length: 1000 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('packages_code_uq').on(t.code), index('packages_subject_idx').on(t.subjectId)],
);

/** Giá riêng của chi nhánh; không có dòng → dùng giá gốc. */
export const packageBranchPrices = mysqlTable(
  'package_branch_prices',
  {
    packageId: ulid('package_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    price: money('price').notNull(),
    updatedBy: ulid('updated_by'),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.packageId, t.branchId] })],
);

export const promotionPrograms = mysqlTable(
  'promotion_programs',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 30 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: varchar('description', { length: 1000 }),
    discountType: varchar('discount_type', { length: 10, enum: ['PERCENT', 'AMOUNT'] }).notNull(),
    discountValue: money('discount_value').notNull(),
    maxDiscount: money('max_discount'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** null = mọi chi nhánh / mọi gói. */
    branchIds: jsonb('branch_ids').$type<string[] | null>(),
    packageIds: jsonb('package_ids').$type<string[] | null>(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('promotion_programs_code_uq').on(t.code)],
);

/** Quà tặng (vật phẩm). Tồn kho theo chi nhánh = tổng `promotion_stock_moves.quantity`. */
export const promotionItems = mysqlTable(
  'promotion_items',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 30 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull().default('cái'),
    minStock: int('min_stock').notNull().default(5),
    description: varchar('description', { length: 1000 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('promotion_items_code_uq').on(t.code)],
);

export const promotionStockMoves = mysqlTable(
  'promotion_stock_moves',
  {
    id: ulid('id').primaryKey(),
    itemId: ulid('item_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    /** Dương = nhập / trả lại, âm = xuất / tặng. */
    quantity: int('quantity').notNull(),
    kind: varchar('kind', { length: 10, enum: ['IN', 'OUT', 'ADJUST', 'GIFT', 'RETURN'] }).notNull(),
    /** Liên kết nghiệp vụ (vd: enrollment_gift) khi kind = GIFT / RETURN. */
    refId: ulid('ref_id'),
    note: varchar('note', { length: 500 }),
    createdBy: ulid('created_by').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('promotion_stock_item_branch_idx').on(t.itemId, t.branchId)],
);

export const sequences = defineSequenceTable();

export const LEAD_STATUSES = ['NEW', 'CONTACTING', 'SCHEDULED', 'ATTENDED', 'NO_SHOW', 'CONVERTED', 'LOST'] as const;
export const LEAD_SOURCES = ['FACEBOOK', 'ZALO', 'WEBSITE', 'HOTLINE', 'REFERRAL', 'WALK_IN', 'EVENT', 'OTHER'] as const;

/** Khách hàng tiềm năng: phụ huynh + con. Một số điện thoại có thể có nhiều con (nhiều lead). */
export const leads = mysqlTable(
  'leads',
  {
    id: ulid('id').primaryKey(),
    branchId: ulid('branch_id').notNull(),
    /** Sale phụ trách; null = chưa phân công. */
    ownerId: ulid('owner_id'),
    parentName: varchar('parent_name', { length: 150 }).notNull(),
    parentPhone: varchar('parent_phone', { length: 15 }).notNull(),
    parentEmail: varchar('parent_email', { length: 191 }),
    childName: varchar('child_name', { length: 150 }).notNull(),
    childBirthYear: int('child_birth_year'),
    school: varchar('school', { length: 200 }),
    interestSubjectId: ulid('interest_subject_id'),
    source: varchar('source', { length: 20, enum: LEAD_SOURCES }).notNull(),
    status: varchar('status', { length: 20, enum: LEAD_STATUSES }).notNull().default('NEW'),
    lostReason: varchar('lost_reason', { length: 500 }),
    notes: varchar('notes', { length: 2000 }),
    lastContactedAt: instant('last_contacted_at'),
    nextFollowUpAt: instant('next_follow_up_at'),
    convertedStudentId: ulid('converted_student_id'),
    createdBy: ulid('created_by').notNull(),
    version: int('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('leads_branch_status_idx').on(t.branchId, t.status),
    index('leads_owner_idx').on(t.ownerId, t.status),
    index('leads_phone_idx').on(t.parentPhone),
    index('leads_follow_up_idx').on(t.nextFollowUpAt),
  ],
);

export const leadCallLogs = mysqlTable(
  'lead_call_logs',
  {
    id: ulid('id').primaryKey(),
    leadId: ulid('lead_id').notNull(),
    userId: ulid('user_id').notNull(),
    outcome: varchar('outcome', { length: 20, enum: ['TALKED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'CALL_BACK'] }).notNull(),
    note: varchar('note', { length: 1000 }),
    nextFollowUpAt: instant('next_follow_up_at'),
    calledAt: instant('called_at').notNull(),
  },
  (t) => [index('lead_call_logs_lead_idx').on(t.leadId, t.calledAt)],
);

export const APPOINTMENT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'] as const;

/** Lịch trải nghiệm (tại trung tâm) / học thử (ngồi trong một buổi học LMS). */
export const leadAppointments = mysqlTable(
  'lead_appointments',
  {
    id: ulid('id').primaryKey(),
    leadId: ulid('lead_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    type: varchar('type', { length: 12, enum: ['EXPERIENCE', 'TRIAL'] }).notNull(),
    scheduledAt: instant('scheduled_at').notNull(),
    /** Buổi học LMS khi type = TRIAL. */
    lmsSessionId: ulid('lms_session_id'),
    status: varchar('status', { length: 12, enum: APPOINTMENT_STATUSES }).notNull().default('SCHEDULED'),
    note: varchar('note', { length: 1000 }),
    resultNote: varchar('result_note', { length: 1000 }),
    createdBy: ulid('created_by').notNull(),
    ...timestamps,
  },
  (t) => [index('lead_appointments_lead_idx').on(t.leadId), index('lead_appointments_branch_time_idx').on(t.branchId, t.scheduledAt)],
);

export const STUDENT_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'STOPPED'] as const;

/** Học viên — hồ sơ khách hàng. Trạng thái học tập chi tiết nằm ở LMS. */
export const students = mysqlTable(
  'students',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    branchId: ulid('branch_id').notNull(),
    /** Sale phụ trách (doanh số, tái phí). */
    ownerId: ulid('owner_id'),
    /** CS chăm sóc. */
    careId: ulid('care_id'),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    birthDate: date('birth_date', { mode: 'string' }),
    gender: varchar('gender', { length: 6, enum: ['MALE', 'FEMALE'] }),
    school: varchar('school', { length: 200 }),
    address: varchar('address', { length: 300 }),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    notes: varchar('notes', { length: 2000 }),
    status: varchar('status', { length: 10, enum: STUDENT_STATUSES }).notNull().default('PENDING'),
    sourceLeadId: ulid('source_lead_id'),
    /** Từ sự kiện LMS (xếp lớp / lên lớp) — chỉ để hiển thị. */
    currentClassName: varchar('current_class_name', { length: 150 }),
    currentLevelName: varchar('current_level_name', { length: 150 }),
    version: int('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex('students_code_uq').on(t.code), index('students_branch_status_idx').on(t.branchId, t.status), index('students_owner_idx').on(t.ownerId)],
);

export const guardians = mysqlTable(
  'guardians',
  {
    id: ulid('id').primaryKey(),
    studentId: ulid('student_id').notNull(),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    relation: varchar('relation', { length: 30 }).notNull(),
    phone: varchar('phone', { length: 15 }).notNull(),
    email: varchar('email', { length: 191 }),
    job: varchar('job', { length: 150 }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [index('guardians_student_idx').on(t.studentId), index('guardians_phone_idx').on(t.phone)],
);

export const studentDocuments = mysqlTable(
  'student_documents',
  {
    id: ulid('id').primaryKey(),
    studentId: ulid('student_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: int('size').notNull(),
    uploadedBy: ulid('uploaded_by').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('student_documents_student_idx').on(t.studentId)],
);

export const studentStatusLogs = mysqlTable(
  'student_status_logs',
  {
    id: ulid('id').primaryKey(),
    studentId: ulid('student_id').notNull(),
    fromStatus: varchar('from_status', { length: 10 }).notNull(),
    toStatus: varchar('to_status', { length: 10 }).notNull(),
    reason: varchar('reason', { length: 500 }),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    actorId: ulid('actor_id').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (t) => [index('student_status_logs_student_idx').on(t.studentId)],
);

export const ENROLLMENT_STATUSES = ['AWAITING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

/**
 * Đăng ký học (mới / tái phí). Giá được CHỐT CỨNG lúc tạo (docs/pricing-rules.md §2.3):
 * mọi thành phần tính giá nằm trong các cột + `pricingInput` để tính lại khi duyệt.
 */
export const enrollments = mysqlTable(
  'enrollments',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    studentId: ulid('student_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    type: varchar('type', { length: 10, enum: ['NEW', 'RENEWAL'] }).notNull(),
    /** Sale được ghi nhận doanh số. */
    saleId: ulid('sale_id'),
    /** Người được tính doanh thu / KPI: đăng ký mới → sale; tái phí → CS chăm sóc (chốt lúc tạo). */
    creditUserId: ulid('credit_user_id'),
    packageId: ulid('package_id').notNull(),
    packageCode: varchar('package_code', { length: 20 }).notNull(),
    packageName: varchar('package_name', { length: 150 }).notNull(),
    subjectId: ulid('subject_id').notNull(),
    startLevelId: ulid('start_level_id').notNull(),
    startLevelName: varchar('start_level_name', { length: 150 }).notNull(),
    promotionId: ulid('promotion_id'),
    promotionCode: varchar('promotion_code', { length: 30 }),
    listPrice: money('list_price').notNull(),
    promotionDiscount: money('promotion_discount').notNull(),
    extraDiscountRequested: money('extra_discount_requested').notNull(),
    extraDiscountApplied: money('extra_discount_applied').notNull(),
    extraDiscountReason: varchar('extra_discount_reason', { length: 500 }),
    scholarshipMonthsRequested: int('scholarship_months_requested').notNull(),
    scholarshipMonthsGranted: int('scholarship_months_granted').notNull(),
    /** Số phải thu theo những gì đã được cấp (giảm khi phần chờ duyệt được duyệt). */
    amountDue: money('amount_due').notNull(),
    /** Tổng các khoản thu đã xác nhận. */
    amountPaid: money('amount_paid').notNull().default(0),
    sessionsPurchased: int('sessions_purchased').notNull(),
    /** Cập nhật từ điểm danh LMS. */
    sessionsUsed: int('sessions_used').notNull().default(0),
    approvalStatus: varchar('approval_status', { length: 10, enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] }).notNull(),
    status: varchar('status', { length: 20, enum: ENROLLMENT_STATUSES }).notNull().default('AWAITING_PAYMENT'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /** Đầu vào của computeQuote (giá niêm yết, KM, cấu hình…) — tính lại khi duyệt mà không đọc giá hiện tại. */
    pricingInput: jsonb('pricing_input').notNull(),
    activatedAt: instant('activated_at'),
    cancelledAt: instant('cancelled_at'),
    cancelReason: varchar('cancel_reason', { length: 500 }),
    note: varchar('note', { length: 1000 }),
    /** Header Idempotency-Key của lần tạo — gửi lại cùng key trả về đăng ký đã có. */
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    createdBy: ulid('created_by').notNull(),
    version: int('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('enrollments_code_uq').on(t.code),
    uniqueIndex('enrollments_idem_uq').on(t.idempotencyKey),
    index('enrollments_student_idx').on(t.studentId),
    index('enrollments_branch_status_idx').on(t.branchId, t.status),
    index('enrollments_sale_idx').on(t.saleId),
    index('enrollments_credit_idx').on(t.creditUserId),
  ],
);

/** Yêu cầu duyệt (giảm thêm + học bổng vượt mức) của một đăng ký. */
export const discountApprovals = mysqlTable(
  'discount_approvals',
  {
    id: ulid('id').primaryKey(),
    enrollmentId: ulid('enrollment_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    value: money('value').notNull(),
    approverRole: varchar('approver_role', { length: 4, enum: ['CM', 'AM'] }).notNull(),
    extraDiscount: money('extra_discount').notNull(),
    extraScholarshipMonths: int('extra_scholarship_months').notNull(),
    reason: varchar('reason', { length: 500 }),
    status: varchar('status', { length: 10, enum: ['PENDING', 'APPROVED', 'REJECTED'] }).notNull().default('PENDING'),
    requestedBy: ulid('requested_by').notNull(),
    reviewedBy: ulid('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    reviewNote: varchar('review_note', { length: 500 }),
    ...timestamps,
  },
  (t) => [index('discount_approvals_status_idx').on(t.branchId, t.status), index('discount_approvals_enrollment_idx').on(t.enrollmentId)],
);

export const payments = mysqlTable(
  'payments',
  {
    id: ulid('id').primaryKey(),
    enrollmentId: ulid('enrollment_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    amount: money('amount').notNull(),
    method: varchar('method', { length: 10, enum: ['CASH', 'TRANSFER', 'CARD'] }).notNull(),
    status: varchar('status', { length: 10, enum: ['PENDING', 'CONFIRMED', 'CANCELLED'] }).notNull(),
    reference: varchar('reference', { length: 100 }),
    note: varchar('note', { length: 500 }),
    paidAt: instant('paid_at').notNull(),
    recordedBy: ulid('recorded_by').notNull(),
    confirmedBy: ulid('confirmed_by'),
    confirmedAt: instant('confirmed_at'),
    idempotencyKey: varchar('idempotency_key', { length: 64 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('payments_idem_uq').on(t.idempotencyKey), index('payments_enrollment_idx').on(t.enrollmentId), index('payments_branch_status_idx').on(t.branchId, t.status), index('payments_paid_idx').on(t.status, t.paidAt)],
);

/** Tài khoản nhận tiền theo chi nhánh — nguồn DUY NHẤT cho mã VietQR. */
export const branchPaymentAccounts = mysqlTable('branch_payment_accounts', {
  branchId: ulid('branch_id').primaryKey(),
  bankBin: varchar('bank_bin', { length: 10 }).notNull(),
  bankName: varchar('bank_name', { length: 100 }).notNull(),
  accountNo: varchar('account_no', { length: 30 }).notNull(),
  accountName: varchar('account_name', { length: 100 }).notNull(),
  updatedBy: ulid('updated_by'),
  updatedAt: instant('updated_at').notNull(),
});

export const enrollmentGifts = mysqlTable(
  'enrollment_gifts',
  {
    id: ulid('id').primaryKey(),
    enrollmentId: ulid('enrollment_id').notNull(),
    itemId: ulid('item_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    quantity: int('quantity').notNull(),
    /** Giao ngay / sau khi có khoản thu đầu tiên. */
    deliveryCondition: varchar('delivery_condition', { length: 10, enum: ['IMMEDIATE', 'ON_PAID'] }).notNull(),
    status: varchar('status', { length: 10, enum: ['PENDING', 'DELIVERED', 'RETURNED'] }).notNull().default('PENDING'),
    deliveredBy: ulid('delivered_by'),
    deliveredAt: instant('delivered_at'),
    ...timestamps,
  },
  (t) => [index('enrollment_gifts_enrollment_idx').on(t.enrollmentId)],
);

/** Mỗi buổi học đã tính vào một đăng ký (từ sự kiện điểm danh LMS) — trừ buổi đúng một lần. */
export const sessionUsages = mysqlTable(
  'session_usages',
  {
    enrollmentId: ulid('enrollment_id').notNull(),
    lmsSessionId: ulid('lms_session_id').notNull(),
    learnerId: ulid('learner_id').notNull(),
    attendanceStatus: varchar('attendance_status', { length: 10 }).notNull(),
    consumed: boolean('consumed').notNull(),
    sessionStartsAt: instant('session_starts_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.enrollmentId, t.lmsSessionId] })],
);

/** Mục tiêu doanh thu theo tháng của từng nhân sự (sale: đăng ký mới, CS: tái phí). */
export const kpiTargets = mysqlTable(
  'kpi_targets',
  {
    userId: ulid('user_id').notNull(),
    /** YYYY-MM theo giờ Việt Nam. */
    month: varchar('month', { length: 7 }).notNull(),
    branchId: ulid('branch_id').notNull(),
    targetRevenue: money('target_revenue').notNull(),
    updatedBy: ulid('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] }), index('kpi_targets_branch_month_idx').on(t.branchId, t.month)],
);
