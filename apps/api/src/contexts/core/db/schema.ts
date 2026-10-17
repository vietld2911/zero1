import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  int,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { defineEventTables } from '../../../platform/events/tables.js';
import { instant, jsonb, timestamps, ulid } from '../../../platform/db/columns.js';

// Bảng sự kiện của database zero1_core (docs/events.md §1).
export const { outboxEvents, processedEvents } = defineEventTables();

export const branches = mysqlTable(
  'branches',
  {
    id: ulid('id').primaryKey(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    address: varchar('address', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('branches_code_uq').on(t.code)],
);

export const users = mysqlTable(
  'users',
  {
    id: ulid('id').primaryKey(),
    email: varchar('email', { length: 191 }).notNull(),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    managerId: ulid('manager_id'),
    status: varchar('status', { length: 10, enum: ['ACTIVE', 'LOCKED'] })
      .notNull()
      .default('ACTIVE'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: instant('last_login_at'),
    /** Khoá lạc quan (If-Match) — docs/api-conventions.md §5. */
    version: int('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    index('users_manager_idx').on(t.managerId),
    index('users_role_idx').on(t.role),
  ],
);

export const userBranches = mysqlTable(
  'user_branches',
  {
    userId: ulid('user_id').notNull(),
    branchId: ulid('branch_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] }), index('user_branches_branch_idx').on(t.branchId)],
);

export const roles = mysqlTable('roles', {
  code: varchar('code', { length: 20 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  rank: int('rank').notNull(),
});

export const permissions = mysqlTable('permissions', {
  code: varchar('code', { length: 64 }).primaryKey(),
  app: varchar('app', { length: 10, enum: ['core', 'crm', 'lms'] }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
});

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleCode: varchar('role_code', { length: 20 }).notNull(),
    permissionCode: varchar('permission_code', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: ulid('id').primaryKey(),
    userId: ulid('user_id').notNull(),
    /** sha256 của token — không lưu token gốc. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** Các token xoay vòng từ cùng một lần đăng nhập; token cũ bị dùng lại → huỷ cả họ. */
    familyId: ulid('family_id').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    userAgent: varchar('user_agent', { length: 255 }),
    ip: varchar('ip', { length: 45 }),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

export const passwordResets = mysqlTable(
  'password_resets',
  {
    id: ulid('id').primaryKey(),
    userId: ulid('user_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: instant('expires_at').notNull(),
    usedAt: instant('used_at'),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('password_resets_hash_uq').on(t.tokenHash), index('password_resets_user_idx').on(t.userId)],
);

export const settings = mysqlTable(
  'settings',
  {
    key: varchar('key', { length: 100 }).notNull(),
    /** '' = toàn hệ thống; còn lại là branch id. */
    branchId: varchar('branch_id', { length: 26 }).notNull().default(''),
    value: jsonb('value').notNull(),
    updatedBy: ulid('updated_by'),
    updatedAt: instant('updated_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [primaryKey({ columns: [t.key, t.branchId] })],
);

export const timekeepingEntries = mysqlTable(
  'timekeeping_entries',
  {
    id: ulid('id').primaryKey(),
    userId: ulid('user_id').notNull(),
    branchId: ulid('branch_id'),
    /** Ngày công theo giờ Việt Nam. */
    workDate: date('work_date', { mode: 'string' }).notNull(),
    checkInAt: instant('check_in_at').notNull(),
    checkOutAt: instant('check_out_at'),
    checkInSource: varchar('check_in_source', { length: 10, enum: ['WEB', 'MOBILE', 'DEVICE', 'MANUAL'] }).notNull(),
    checkOutSource: varchar('check_out_source', { length: 10, enum: ['WEB', 'MOBILE', 'DEVICE', 'MANUAL'] }),
    /** IP, user agent, toạ độ, mã thiết bị — để mở rộng chấm công sau này. */
    checkInMeta: jsonb('check_in_meta'),
    checkOutMeta: jsonb('check_out_meta'),
    status: varchar('status', { length: 10, enum: ['OPEN', 'CLOSED', 'ADJUSTED'] }).notNull(),
    note: varchar('note', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('timekeeping_user_date_idx').on(t.userId, t.workDate),
    index('timekeeping_branch_date_idx').on(t.branchId, t.workDate),
  ],
);

export const timekeepingAdjustments = mysqlTable(
  'timekeeping_adjustments',
  {
    id: ulid('id').primaryKey(),
    userId: ulid('user_id').notNull(),
    entryId: ulid('entry_id'),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    checkInAt: instant('check_in_at').notNull(),
    checkOutAt: instant('check_out_at').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    status: varchar('status', { length: 10, enum: ['PENDING', 'APPROVED', 'REJECTED'] }).notNull(),
    requestedBy: ulid('requested_by').notNull(),
    reviewedBy: ulid('reviewed_by'),
    reviewedAt: instant('reviewed_at'),
    reviewNote: varchar('review_note', { length: 500 }),
    ...timestamps,
  },
  (t) => [index('timekeeping_adj_user_idx').on(t.userId, t.status), index('timekeeping_adj_status_idx').on(t.status)],
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: ulid('id').primaryKey(),
    actorId: ulid('actor_id'),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: varchar('entity_id', { length: 100 }).notNull(),
    branchId: ulid('branch_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: varchar('ip', { length: 45 }),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_actor_idx').on(t.actorId)],
);

/**
 * Thông báo trong app (chuông trên thanh trên cùng). Gửi qua core/contract `notifications`.
 * `dedupeKey` chặn gửi trùng (ví dụ nhắc gọi lại một lead một lần mỗi ngày).
 */
export const notifications = mysqlTable(
  'notifications',
  {
    id: ulid('id').primaryKey(),
    userId: ulid('user_id').notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    app: varchar('app', { length: 10, enum: ['core', 'crm', 'lms'] }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 500 }),
    /** Đường dẫn trong app, ví dụ `/leads/01J…`. */
    link: varchar('link', { length: 300 }),
    dedupeKey: varchar('dedupe_key', { length: 150 }),
    readAt: instant('read_at'),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt), uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey)],
);

// ───────────────────────────── Tích hợp (GĐ6)

/** API key cho hệ thống bên ngoài (form website, n8n…). Chỉ lưu sha256 của key. */
export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: ulid('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    /** Phần đầu key (hiển thị để nhận diện), ví dụ `z1_ab12cd34`. */
    prefix: varchar('prefix', { length: 20 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    permissions: jsonb('permissions').$type<string[]>().notNull(),
    /** Rỗng = mọi chi nhánh. */
    branchIds: jsonb('branch_ids').$type<string[]>().notNull(),
    createdBy: ulid('created_by').notNull(),
    lastUsedAt: instant('last_used_at'),
    expiresAt: instant('expires_at'),
    revokedAt: instant('revoked_at'),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('api_keys_prefix_uq').on(t.prefix)],
);

/** Nơi nhận sự kiện: webhook (HTTP POST có chữ ký) hoặc nhóm Telegram nội bộ. */
export const integrationTargets = mysqlTable('integration_targets', {
  id: ulid('id').primaryKey(),
  kind: varchar('kind', { length: 10, enum: ['WEBHOOK', 'TELEGRAM'] }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  /** Webhook: URL nhận. */
  url: varchar('url', { length: 500 }),
  /** Webhook: khoá ký HMAC. */
  secret: varchar('secret', { length: 100 }),
  /** Telegram: chat_id của nhóm. */
  chatId: varchar('chat_id', { length: 50 }),
  /** Loại sự kiện nhận; `['*']` = tất cả. */
  events: jsonb('events').$type<string[]>().notNull(),
  /** Rỗng = mọi chi nhánh. */
  branchIds: jsonb('branch_ids').$type<string[]>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: ulid('created_by').notNull(),
  ...timestamps,
});

export const integrationDeliveries = mysqlTable(
  'integration_deliveries',
  {
    id: ulid('id').primaryKey(),
    targetId: ulid('target_id').notNull(),
    eventId: varchar('event_id', { length: 40 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 10, enum: ['PENDING', 'SUCCEEDED', 'FAILED'] }).notNull().default('PENDING'),
    attempts: int('attempts').notNull().default(0),
    nextAttemptAt: instant('next_attempt_at').notNull(),
    lastStatusCode: int('last_status_code'),
    lastError: varchar('last_error', { length: 500 }),
    deliveredAt: instant('delivered_at'),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('deliveries_target_event_uq').on(t.targetId, t.eventId),
    index('deliveries_due_idx').on(t.status, t.nextAttemptAt),
    index('deliveries_target_idx').on(t.targetId, t.createdAt),
  ],
);

// ───────────────────────────── Phụ huynh (GĐ6)

/** Tài khoản phụ huynh — đăng nhập bằng SĐT; tách khỏi nhân sự. */
export const parentAccounts = mysqlTable(
  'parent_accounts',
  {
    id: ulid('id').primaryKey(),
    phone: varchar('phone', { length: 15 }).notNull(),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    status: varchar('status', { length: 10, enum: ['PENDING', 'ACTIVE', 'LOCKED'] }).notNull().default('PENDING'),
    /** Mã kích hoạt 6 số (sha256), CS gửi qua Zalo; dùng để kích hoạt lần đầu hoặc đặt lại mật khẩu. */
    activationCodeHash: varchar('activation_code_hash', { length: 64 }),
    activationExpiresAt: instant('activation_expires_at'),
    activationAttempts: int('activation_attempts').notNull().default(0),
    lastLoginAt: instant('last_login_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('parent_accounts_phone_uq').on(t.phone)],
);

/** Con của phụ huynh (học viên CRM có phụ huynh mang SĐT này). CRM đồng bộ qua core/contract. */
export const parentStudents = mysqlTable(
  'parent_students',
  {
    parentId: ulid('parent_id').notNull(),
    studentId: ulid('student_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.parentId, t.studentId] }), index('parent_students_student_idx').on(t.studentId)],
);

export const parentRefreshTokens = mysqlTable(
  'parent_refresh_tokens',
  {
    id: ulid('id').primaryKey(),
    parentId: ulid('parent_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    familyId: ulid('family_id').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [uniqueIndex('parent_refresh_hash_uq').on(t.tokenHash), index('parent_refresh_family_idx').on(t.familyId)],
);
