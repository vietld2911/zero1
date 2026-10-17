import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import type { Logger } from '../../../../platform/logger.js';
import type { Env } from '../../../../platform/env.js';
import type { Mailer } from '../../../../integrations/mailer.js';
import type { CoreDb } from '../../db/types.js';
import { branches, passwordResets, refreshTokens, roles, userBranches, users } from '../../db/schema.js';
import { appsOf } from '../access/catalog.js';
import { writeAudit } from '../audit/audit.js';
import type { CorePrincipal, createPrincipalLoader } from './guards.js';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_DAYS,
  generateOpaqueToken,
  hashToken,
  type AccessTokens,
} from './tokens.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Hai tab cùng refresh một lúc: token vừa bị xoay trong khoảng này không bị coi là đánh cắp. */
const ROTATION_GRACE_MS = 10_000;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

interface Deps {
  db: CoreDb;
  tokens: AccessTokens;
  loadPrincipal: ReturnType<typeof createPrincipalLoader>;
  mailer: Mailer;
  env: Pick<Env, 'CRM_WEB_URL' | 'LMS_WEB_URL'>;
  logger: Logger;
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');
const invalidRefresh = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại');

export function createAuthService({ db, tokens, loadPrincipal, mailer, env, logger }: Deps) {
  async function issueSession(userId: string, role: string, familyId: string, meta: RequestMeta, tx: Pick<CoreDb, 'insert'> = db) {
    const refreshToken = generateOpaqueToken();
    await tx.insert(refreshTokens).values({
      id: newId(),
      userId,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: meta.ip,
    });
    const accessToken = await tokens.sign({ userId, role });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async function me(principal: CorePrincipal) {
    const [[user], branchRows, [role]] = await Promise.all([
      db.select().from(users).where(eq(users.id, principal.userId)),
      db
        .select({ id: branches.id, code: branches.code, name: branches.name, isPrimary: userBranches.isPrimary })
        .from(userBranches)
        .innerJoin(branches, eq(branches.id, userBranches.branchId))
        .where(eq(userBranches.userId, principal.userId))
        .orderBy(asc(branches.name)),
      db.select({ name: roles.name }).from(roles).where(eq(roles.code, principal.role)),
    ]);
    if (!user) throw Errors.unauthenticated();
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      roleName: role?.name ?? user.role,
      apps: appsOf(principal.permissions),
      permissions: [...principal.permissions].sort(),
      branches: branchRows,
      scope: principal.scope.kind,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async function revokeAll(userId: string, exceptFamilyId?: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          exceptFamilyId ? ne(refreshTokens.familyId, exceptFamilyId) : undefined,
        ),
      );
  }

  async function findRefresh(refreshToken: string) {
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    return row;
  }

  return {
    me,
    revokeAll,

    async login(email: string, password: string, meta: RequestMeta) {
      const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
      // Luôn băm để thời gian phản hồi như nhau dù email có tồn tại hay không.
      const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !ok) throw invalidCredentials();
      if (user.status !== 'ACTIVE') throw new AppError(401, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khoá');

      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      const session = await issueSession(user.id, user.role, newId(), meta);
      return { ...session, user: await me(await loadPrincipal(user.id)) };
    },

    async refresh(refreshToken: string, meta: RequestMeta) {
      const row = await findRefresh(refreshToken);
      if (!row) throw invalidRefresh();
      if (row.revokedAt) {
        if (Date.now() - row.revokedAt.getTime() <= ROTATION_GRACE_MS) {
          // Vừa xoay (hai tab / CRM + LMS cùng refresh — khác origin nên không khoá chung được):
          // phiên còn token sống → cấp thêm token cùng phiên. Phiên đã đăng xuất / bị huỷ → từ chối.
          const [alive] = await db
            .select({ id: refreshTokens.id })
            .from(refreshTokens)
            .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
            .limit(1);
          if (!alive) throw invalidRefresh();
          const principal = await loadPrincipal(row.userId);
          const session = await issueSession(row.userId, principal.role, row.familyId, meta);
          return { ...session, user: await me(principal) };
        }
        // Token đã xoay bị dùng lại sau thời gian ân hạn → khả năng bị đánh cắp: huỷ cả phiên.
        await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        logger.warn({ userId: row.userId, familyId: row.familyId }, 'Refresh token reuse detected');
        throw invalidRefresh();
      }
      if (row.expiresAt.getTime() <= Date.now()) throw invalidRefresh();

      const principal = await loadPrincipal(row.userId); // ném lỗi nếu tài khoản bị khoá
      const session = await db.transaction(async (tx) => {
        // Chỉ một request xoay được token này (điều kiện revoked_at IS NULL).
        const [res] = await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)));
        if (res.affectedRows !== 1) throw invalidRefresh();
        return issueSession(row.userId, principal.role, row.familyId, meta, tx);
      });
      return { ...session, user: await me(principal) };
    },

    async logout(refreshToken: string | undefined) {
      if (!refreshToken) return;
      const row = await findRefresh(refreshToken);
      if (!row) return;
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
    },

    async changePassword(principal: CorePrincipal, currentPassword: string, newPassword: string, currentRefresh: string | undefined, meta: RequestMeta) {
      const [user] = await db.select().from(users).where(eq(users.id, principal.userId));
      if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new AppError(422, 'WRONG_CURRENT_PASSWORD', 'Mật khẩu hiện tại không đúng');
      }
      if (currentPassword === newPassword) {
        throw new AppError(422, 'PASSWORD_UNCHANGED', 'Mật khẩu mới phải khác mật khẩu hiện tại');
      }
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, version: sql`${users.version} + 1` })
          .where(eq(users.id, user.id));
        await writeAudit(tx, { actorId: user.id, action: 'user.password_changed', entityType: 'user', entityId: user.id, ip: meta.ip });
      });
      // Đăng xuất mọi thiết bị khác, giữ phiên hiện tại.
      const current = currentRefresh ? await findRefresh(currentRefresh) : undefined;
      await revokeAll(user.id, current?.userId === user.id ? current.familyId : undefined);
    },

    async updateProfile(principal: CorePrincipal, patch: { fullName?: string; phone?: string | null }) {
      if (Object.keys(patch).length) {
        await db
          .update(users)
          .set({ ...patch, version: sql`${users.version} + 1` })
          .where(eq(users.id, principal.userId));
      }
      return me(principal);
    },

    async forgotPassword(email: string, app: 'crm' | 'lms') {
      const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
      if (!user || user.status !== 'ACTIVE') return; // không tiết lộ email có tồn tại hay không

      const token = generateOpaqueToken();
      await db.insert(passwordResets).values({
        id: newId(),
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });
      const base = app === 'lms' ? env.LMS_WEB_URL : env.CRM_WEB_URL;
      const link = `${base.replace(/\/$/, '')}/reset-password?token=${token}`;
      try {
        await mailer.send({
          to: user.email,
          subject: 'Zero1 — Đặt lại mật khẩu',
          text: `Xin chào ${user.fullName},\n\nMở liên kết sau để đặt lại mật khẩu (hiệu lực 60 phút):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
        });
      } catch (err) {
        logger.error({ err, userId: user.id }, 'Không gửi được email đặt lại mật khẩu');
      }
    },

    async resetPassword(token: string, newPassword: string, meta: RequestMeta) {
      const [reset] = await db
        .select()
        .from(passwordResets)
        .where(and(eq(passwordResets.tokenHash, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
      if (!reset) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn');

      await db.transaction(async (tx) => {
        const [res] = await tx
          .update(passwordResets)
          .set({ usedAt: new Date() })
          .where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)));
        if (res.affectedRows !== 1) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Liên kết đã được sử dụng');
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, version: sql`${users.version} + 1` })
          .where(eq(users.id, reset.userId));
        await writeAudit(tx, { actorId: reset.userId, action: 'user.password_reset', entityType: 'user', entityId: reset.userId, ip: meta.ip });
      });
      await revokeAll(reset.userId);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
