import type { ScopeKind } from '../../../../platform/auth/principal.js';

/**
 * Danh mục vai trò & quyền mặc định — bản code của docs/roles-permissions.md.
 * Dùng để seed DB lần đầu; sau đó ADMIN chỉnh role_permissions trong hệ thống.
 */

export const ROLE_CODES = ['ADMIN', 'AM', 'CM', 'SL', 'SALE', 'CS', 'TL', 'TEACHER', 'TA'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * Tổ chức (docs/roles-permissions.md §1):
 * - Ngoài cơ sở (nhiều chi nhánh): ADMIN, AM.
 * - Trong cơ sở (đúng một chi nhánh): CM đứng đầu, quản lý 3 team —
 *   Kinh doanh (SL → SALE), Vận hành (CS, báo cáo thẳng CM; sau này có OM), Học thuật (TL → GV, TA).
 */
export const TEAMS = ['MANAGEMENT', 'SALES', 'OPERATIONS', 'ACADEMIC'] as const;
export type Team = (typeof TEAMS)[number];
export const TEAM_NAMES: Record<Team, string> = {
  MANAGEMENT: 'Quản lý',
  SALES: 'Kinh doanh',
  OPERATIONS: 'Vận hành',
  ACADEMIC: 'Học thuật',
};

export interface RoleDef {
  code: RoleCode;
  name: string;
  description: string;
  /** Cấp bậc: chỉ quản lý được người có cấp thấp hơn mình (trừ ADMIN). */
  rank: number;
  scope: ScopeKind;
  team: Team;
  /** true = nhân sự ngoài cơ sở, gán được nhiều chi nhánh; false = thuộc đúng một chi nhánh. */
  multiBranch: boolean;
  /** Vai trò được làm quản lý trực tiếp (thứ tự ưu tiên). Rỗng = không có quản lý. */
  managerRoles: RoleCode[];
}

export const ROLES: readonly RoleDef[] = [
  { code: 'ADMIN', name: 'Quản trị hệ thống', description: 'Toàn quyền hệ thống', rank: 100, scope: 'ALL', team: 'MANAGEMENT', multiBranch: true, managerRoles: [] },
  { code: 'AM', name: 'Arena Manager', description: 'Quản lý khu vực (nhiều cơ sở)', rank: 80, scope: 'BRANCHES', team: 'MANAGEMENT', multiBranch: true, managerRoles: ['ADMIN'] },
  { code: 'CM', name: 'Center Manager', description: 'Quản lý cơ sở — phụ trách cả 3 team', rank: 60, scope: 'BRANCHES', team: 'MANAGEMENT', multiBranch: false, managerRoles: ['AM'] },
  { code: 'SL', name: 'Sale Leader', description: 'Trưởng nhóm kinh doanh (mỗi nhóm sale một SL)', rank: 40, scope: 'TEAM', team: 'SALES', multiBranch: false, managerRoles: ['CM'] },
  { code: 'TL', name: 'Teaching Leader', description: 'Trưởng team học thuật', rank: 40, scope: 'BRANCHES', team: 'ACADEMIC', multiBranch: false, managerRoles: ['CM'] },
  { code: 'CS', name: 'Customer Service', description: 'Team vận hành — kiểm soát chất lượng, báo cáo thẳng CM', rank: 30, scope: 'BRANCHES', team: 'OPERATIONS', multiBranch: false, managerRoles: ['CM'] },
  { code: 'SALE', name: 'Nhân viên kinh doanh', description: 'Tư vấn tuyển sinh', rank: 20, scope: 'OWN', team: 'SALES', multiBranch: false, managerRoles: ['SL'] },
  { code: 'TEACHER', name: 'Giáo viên', description: 'Giảng dạy', rank: 20, scope: 'TEACHING', team: 'ACADEMIC', multiBranch: false, managerRoles: ['TL'] },
  { code: 'TA', name: 'Trợ giảng', description: 'Trợ giảng', rank: 10, scope: 'TEACHING', team: 'ACADEMIC', multiBranch: false, managerRoles: ['TL'] },
];

export interface PermissionDef {
  code: string;
  app: 'core' | 'crm' | 'lms';
  description: string;
  roles: RoleCode[];
}

const ALL_ROLES: RoleCode[] = [...ROLE_CODES];

export const PERMISSIONS: readonly PermissionDef[] = [
  // Core
  { code: 'core.branches.manage', app: 'core', description: 'Tạo / sửa chi nhánh', roles: ['ADMIN'] },
  { code: 'core.users.read', app: 'core', description: 'Xem nhân sự', roles: ['ADMIN', 'AM', 'CM', 'SL', 'CS', 'TL'] },
  { code: 'core.users.manage', app: 'core', description: 'Tạo / sửa / khoá tài khoản nhân sự cấp dưới', roles: ['ADMIN', 'AM', 'CM'] },
  { code: 'core.roles.manage', app: 'core', description: 'Chỉnh quyền của vai trò', roles: ['ADMIN'] },
  { code: 'core.settings.manage', app: 'core', description: 'Cấu hình hệ thống', roles: ['ADMIN'] },
  { code: 'core.timekeeping.self', app: 'core', description: 'Chấm công bản thân', roles: ALL_ROLES },
  { code: 'core.timekeeping.read', app: 'core', description: 'Xem công của người khác', roles: ['ADMIN', 'AM', 'CM', 'SL', 'TL'] },
  { code: 'core.timekeeping.adjust', app: 'core', description: 'Duyệt / sửa công', roles: ['ADMIN', 'AM', 'CM'] },
  { code: 'core.integrations.manage', app: 'core', description: 'API key, webhook, Telegram', roles: ['ADMIN'] },

  // CRM
  { code: 'crm.leads.read', app: 'crm', description: 'Xem lead', roles: ['ADMIN', 'AM', 'CM', 'SL', 'SALE', 'CS'] },
  { code: 'crm.leads.write', app: 'crm', description: 'Tạo / sửa lead, call log, lịch hẹn', roles: ['ADMIN', 'CM', 'SL', 'SALE', 'CS'] },
  { code: 'crm.leads.import', app: 'crm', description: 'Import lead', roles: ['ADMIN', 'CM', 'SL'] },
  { code: 'crm.leads.assign', app: 'crm', description: 'Phân công lead', roles: ['ADMIN', 'AM', 'CM', 'SL'] },
  { code: 'crm.leads.delete', app: 'crm', description: 'Xoá lead', roles: ['ADMIN', 'CM'] },
  { code: 'crm.students.read', app: 'crm', description: 'Xem học viên', roles: ['ADMIN', 'AM', 'CM', 'SL', 'SALE', 'CS'] },
  { code: 'crm.students.write', app: 'crm', description: 'Sửa hồ sơ, phụ huynh, giấy tờ', roles: ['ADMIN', 'CM', 'SL', 'SALE', 'CS'] },
  { code: 'crm.students.status', app: 'crm', description: 'Bảo lưu / nghỉ / đổi người phụ trách', roles: ['ADMIN', 'CM', 'CS'] },
  { code: 'crm.enrollments.create', app: 'crm', description: 'Đăng ký mới / tái phí', roles: ['ADMIN', 'CM', 'SL', 'SALE', 'CS'] },
  { code: 'crm.payments.confirm', app: 'crm', description: 'Xác nhận thanh toán', roles: ['ADMIN', 'CM', 'CS'] },
  { code: 'crm.approvals.review', app: 'crm', description: 'Duyệt học bổng / giảm giá', roles: ['ADMIN', 'AM', 'CM'] },
  { code: 'crm.catalog.manage', app: 'crm', description: 'Quản lý gói học phí, giá gốc', roles: ['ADMIN'] },
  { code: 'crm.catalog.branch_prices', app: 'crm', description: 'Giá gói theo chi nhánh', roles: ['ADMIN', 'AM'] },
  { code: 'crm.promotions.manage', app: 'crm', description: 'Chương trình khuyến mại, học bổng', roles: ['ADMIN', 'AM'] },
  { code: 'crm.promotions.stock', app: 'crm', description: 'Nhập / xuất kho quà tặng', roles: ['ADMIN', 'AM', 'CM'] },
  { code: 'crm.kpi.manage', app: 'crm', description: 'Đặt mục tiêu KPI', roles: ['ADMIN', 'AM', 'CM', 'SL'] },
  { code: 'crm.reports.read', app: 'crm', description: 'Xem báo cáo kinh doanh', roles: ['ADMIN', 'AM', 'CM', 'SL', 'SALE', 'CS'] },
  { code: 'crm.payment_accounts.manage', app: 'crm', description: 'Tài khoản nhận tiền theo chi nhánh', roles: ['ADMIN', 'AM'] },

  // LMS
  { code: 'lms.curriculum.manage', app: 'lms', description: 'Môn học, cấp độ', roles: ['ADMIN'] },
  { code: 'lms.learners.read', app: 'lms', description: 'Xem học viên (học tập)', roles: ['ADMIN', 'AM', 'CM', 'CS', 'TL', 'TEACHER', 'TA'] },
  { code: 'lms.rooms.manage', app: 'lms', description: 'Phòng học', roles: ['ADMIN', 'CM', 'TL'] },
  { code: 'lms.classes.manage', app: 'lms', description: 'Tạo lớp, gán GV/TA, sinh buổi', roles: ['ADMIN', 'CM', 'TL'] },
  { code: 'lms.classes.place', app: 'lms', description: 'Xếp / chuyển lớp học viên', roles: ['ADMIN', 'CM', 'CS', 'TL'] },
  { code: 'lms.sessions.reschedule', app: 'lms', description: 'Dời buổi, dạy thay', roles: ['ADMIN', 'CM', 'CS', 'TL'] },
  { code: 'lms.attendance.record', app: 'lms', description: 'Điểm danh', roles: ['ADMIN', 'CM', 'TL', 'TEACHER', 'TA'] },
  { code: 'lms.attendance.correct', app: 'lms', description: 'Sửa điểm danh đã chốt', roles: ['ADMIN', 'CM', 'TL'] },
  { code: 'lms.feedback.write', app: 'lms', description: 'Nhận xét buổi học', roles: ['ADMIN', 'TL', 'TEACHER', 'TA'] },
  { code: 'lms.assignments.manage', app: 'lms', description: 'Giao bài tập', roles: ['ADMIN', 'TL', 'TEACHER'] },
  { code: 'lms.assignments.grade', app: 'lms', description: 'Chấm bài', roles: ['ADMIN', 'TL', 'TEACHER', 'TA'] },
  { code: 'lms.materials.manage', app: 'lms', description: 'Học liệu', roles: ['ADMIN', 'TL', 'TEACHER'] },
  { code: 'lms.learners.promote', app: 'lms', description: 'Lên lớp', roles: ['ADMIN', 'CM', 'TL'] },
  { code: 'lms.reports.read', app: 'lms', description: 'Xem báo cáo học tập', roles: ['ADMIN', 'AM', 'CM', 'CS', 'TL', 'TEACHER', 'TA'] },
];

const roleIndex = new Map(ROLES.map((r) => [r.code, r]));

export function roleDef(code: string): RoleDef | undefined {
  return roleIndex.get(code as RoleCode);
}

export function isRoleCode(code: string): code is RoleCode {
  return roleIndex.has(code as RoleCode);
}

/**
 * Người có vai trò `actor` có được quản lý người có vai trò `target` không.
 * ADMIN quản lý mọi vai trò; còn lại chỉ vai trò có cấp thấp hơn.
 */
export function canManageRole(actor: string, target: string): boolean {
  const a = roleDef(actor);
  const t = roleDef(target);
  if (!a || !t) return false;
  return a.code === 'ADMIN' || a.rank > t.rank;
}

/** App mà vai trò truy cập được, suy từ quyền (docs/roles-permissions.md §4). */
export function appsOf(permissions: Iterable<string>): Array<'crm' | 'lms'> {
  const apps = new Set<'crm' | 'lms'>();
  for (const p of permissions) {
    if (p.startsWith('crm.')) apps.add('crm');
    if (p.startsWith('lms.')) apps.add('lms');
  }
  return [...apps].sort();
}
