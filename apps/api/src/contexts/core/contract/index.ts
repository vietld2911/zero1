/**
 * Phần DUY NHẤT của Core mà CRM / LMS được import (docs/architecture.md §3).
 */
import type { ZodType } from 'zod';

export type { Principal, DataScope } from '../../../platform/auth/principal.js';

export type SettingInput =
  | { kind: 'number'; unit?: string; min?: number; max?: number; step?: number }
  | { kind: 'boolean' }
  | { kind: 'text' }
  | { kind: 'multiselect'; options: Array<{ value: string; label: string }> };

export interface SettingDefinition<T = unknown> {
  /** `<app>.<nhóm>.<tên>`, ví dụ `crm.renewal.remaining_threshold`. */
  key: string;
  app: 'core' | 'crm' | 'lms';
  label: string;
  description: string;
  schema: ZodType<T>;
  defaultValue: T;
  /** Cho phép từng chi nhánh đặt giá trị riêng. */
  branchOverride: boolean;
  input: SettingInput;
}

export function defineSetting<T>(def: SettingDefinition<T>): SettingDefinition<T> {
  return def;
}

/** Đọc cấu hình: giá trị của chi nhánh → giá trị chung → mặc định. */
export interface SettingsReader {
  get<T>(def: SettingDefinition<T>, branchId?: string | null): Promise<T>;
}

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Tra cứu chi nhánh (chỉ đọc) cho CRM / LMS. */
export interface BranchDirectory {
  getMany(ids: string[]): Promise<BranchSummary[]>;
  /** Mọi chi nhánh đang hoạt động. */
  listActive(): Promise<BranchSummary[]>;
}

export interface UserSummary {
  id: string;
  fullName: string;
  role: string;
  status: 'ACTIVE' | 'LOCKED';
  branchIds: string[];
  managerId: string | null;
}

/** Tra cứu nhân sự (chỉ đọc) — kiểm tra người được phân công / giáo viên. */
export interface UserDirectory {
  getMany(ids: string[]): Promise<UserSummary[]>;
  /** Nhân sự đang hoạt động theo vai trò trong một chi nhánh. */
  listByBranch(branchId: string, roles: string[]): Promise<UserSummary[]>;
}

/** Những gì Core cung cấp cho các context khác. */
export interface NotificationInput {
  userId: string;
  /** Mã loại, ví dụ `crm.lead.assigned`. */
  type: string;
  app: 'core' | 'crm' | 'lms';
  title: string;
  body?: string | null;
  /** Đường dẫn trong app, ví dụ `/leads/01J…`. */
  link?: string | null;
  /** Cùng người + cùng khoá → chỉ gửi một lần. */
  dedupeKey?: string | null;
}

/**
 * Gửi thông báo trong app. Không nằm trong transaction của CRM / LMS (khác database):
 * gọi sau khi ghi xong; lỗi gửi thông báo không làm hỏng nghiệp vụ.
 */
export interface NotificationSender {
  send(items: NotificationInput[]): Promise<void>;
  /** Gửi cho mọi nhân sự đang hoạt động có vai trò `roles` tại chi nhánh. */
  sendToRoles(target: { branchId: string; roles: string[]; exceptUserId?: string | null }, item: Omit<NotificationInput, 'userId'>): Promise<void>;
}

/** Tài khoản phụ huynh (Core) — CRM cấp mã kích hoạt và đồng bộ danh sách con. */
export interface ParentAccess {
  issueActivation(input: { phone: string; fullName: string; studentIds: string[] }): Promise<{ code: string; expiresAt: string; status: 'PENDING' | 'ACTIVE' | 'LOCKED' }>;
  /** Thay danh sách con của SĐT; SĐT chưa có tài khoản → bỏ qua. */
  syncLinks(phone: string, studentIds: string[]): Promise<void>;
  statusOf(phones: string[]): Promise<Array<{ phone: string; status: 'PENDING' | 'ACTIVE' | 'LOCKED'; lastLoginAt: string | null; activationExpiresAt: string | null }>>;
}

export interface CoreContract {
  settings: SettingsReader;
  branches: BranchDirectory;
  users: UserDirectory;
  notifications: NotificationSender;
  parents: ParentAccess;
}
