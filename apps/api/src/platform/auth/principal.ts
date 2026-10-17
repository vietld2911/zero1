/**
 * Phạm vi dữ liệu của người gọi (docs/roles-permissions.md §2).
 * Core tính ra một lần mỗi request; repository dùng `scopeWhere` để lọc.
 */
export type DataScope =
  | { kind: 'ALL' }
  | { kind: 'BRANCHES'; branchIds: string[] }
  /** Bản thân + toàn bộ cấp dưới, trong các chi nhánh được gán. */
  | { kind: 'TEAM'; branchIds: string[]; userIds: string[] }
  | { kind: 'OWN'; branchIds: string[]; userId: string }
  /** Lớp / buổi mình dạy hoặc trợ giảng. */
  | { kind: 'TEACHING'; branchIds: string[]; userId: string };

export type ScopeKind = DataScope['kind'];

export interface Principal {
  userId: string;
  role: string;
  permissions: ReadonlySet<string>;
  /** Chi nhánh được gán (ADMIN có thể rỗng — phạm vi ALL). */
  branchIds: string[];
  scope: DataScope;
}

export function can(principal: Principal, permission: string): boolean {
  return principal.permissions.has(permission);
}

/** Chi nhánh có nằm trong phạm vi người gọi không. */
export function canAccessBranch(principal: Principal, branchId: string): boolean {
  return principal.scope.kind === 'ALL' || principal.branchIds.includes(branchId);
}

/** Phụ huynh đã đăng nhập (tách khỏi nhân sự): chỉ xem dữ liệu của con mình. */
export interface ParentPrincipal {
  parentId: string;
  phone: string;
  /** Học viên (CRM) là con của phụ huynh này. */
  studentIds: string[];
}
