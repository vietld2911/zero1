import type { RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import type { DataScope, ParentPrincipal, Principal } from '../../../../platform/auth/principal.js';
import type { Guards } from '../../../../platform/http/route.js';
import type { CoreDb } from '../../db/types.js';
import { userBranches, users } from '../../db/schema.js';
import type { AccessService } from '../access/access.service.js';
import { roleDef } from '../access/catalog.js';
import { subordinateIds } from '../users/hierarchy.js';
import type { AccessTokens } from './tokens.js';

export interface CorePrincipal extends Principal {
  mustChangePassword: boolean;
}

export function createPrincipalLoader(db: CoreDb, access: AccessService) {
  return async function loadPrincipal(userId: string): Promise<CorePrincipal> {
    const [user] = await db
      .select({ id: users.id, role: users.role, status: users.status, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw Errors.unauthenticated('Tài khoản không tồn tại');
    if (user.status !== 'ACTIVE') throw new AppError(401, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khoá');

    const [permissions, branchRows] = await Promise.all([
      access.permissionsOf(user.role),
      db.select({ branchId: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId)),
    ]);
    const branchIds = branchRows.map((b) => b.branchId);

    return {
      userId,
      role: user.role,
      permissions,
      branchIds,
      scope: await buildScope(db, user.role, userId, branchIds),
      mustChangePassword: user.mustChangePassword,
    };
  };
}

async function buildScope(db: CoreDb, role: string, userId: string, branchIds: string[]): Promise<DataScope> {
  // Vai trò lạ (bị xoá khỏi danh mục) → phạm vi hẹp nhất.
  const kind = roleDef(role)?.scope ?? 'OWN';
  switch (kind) {
    case 'ALL':
      return { kind };
    case 'BRANCHES':
      return { kind, branchIds };
    case 'TEAM':
      return { kind, branchIds, userIds: [userId, ...(await subordinateIds(db, userId))] };
    case 'OWN':
    case 'TEACHING':
      return { kind, branchIds, userId };
  }
}

export interface GuardDeps {
  /** Xác thực API key (`X-Api-Key` hoặc `Bearer z1_…`). */
  apiKeys?: { authenticate(rawKey: string): Promise<CorePrincipal | null> };
  /** Nạp phụ huynh từ token PARENT. */
  parents?: { principalOf(parentId: string): Promise<ParentPrincipal> };
}

export function createGuards(tokens: AccessTokens, loadPrincipal: ReturnType<typeof createPrincipalLoader>, deps: GuardDeps = {}): Guards {
  const bearer = (header: string | undefined) => (header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined);

  const authenticate: RequestHandler = async (req, _res, next) => {
    const token = bearer(req.header('authorization'));
    const apiKey = req.header('x-api-key')?.trim() ?? (token?.startsWith('z1_') ? token : undefined);
    if (apiKey) {
      const principal = deps.apiKeys ? await deps.apiKeys.authenticate(apiKey) : null;
      if (!principal) throw new AppError(401, 'INVALID_API_KEY', 'API key không hợp lệ, đã thu hồi hoặc hết hạn');
      req.principal = principal;
      return next();
    }
    if (!token) throw Errors.unauthenticated();
    const claims = await tokens.verify(token);
    if (claims.role === 'PARENT') throw new AppError(403, 'WRONG_ACCOUNT_TYPE', 'Tài khoản phụ huynh không dùng được API này');
    req.principal = await loadPrincipal(claims.userId);
    next();
  };

  const authorize = (permission: string): RequestHandler => {
    return (req, _res, next) => {
      const principal = req.principal as CorePrincipal | undefined;
      if (!principal) throw Errors.unauthenticated();
      if (principal.mustChangePassword) {
        throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Cần đổi mật khẩu trước khi tiếp tục');
      }
      if (!principal.permissions.has(permission)) {
        throw Errors.forbidden(`Cần quyền ${permission}`);
      }
      next();
    };
  };

  const authenticateParent: RequestHandler = async (req, _res, next) => {
    const token = bearer(req.header('authorization'));
    if (!token || !deps.parents) throw Errors.unauthenticated();
    const claims = await tokens.verify(token);
    if (claims.role !== 'PARENT') throw new AppError(403, 'WRONG_ACCOUNT_TYPE', 'API này chỉ dành cho tài khoản phụ huynh');
    req.parent = await deps.parents.principalOf(claims.userId);
    next();
  };

  return { authenticate, authorize, authenticateParent };
}
