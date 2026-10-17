import { createHash, randomInt } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import type { ParentPrincipal } from '../../../../platform/auth/principal.js';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item } from '../../../../platform/http/schemas.js';
import { credentialLimits } from '../../../../platform/http/rate-limit.js';
import { normalizePhone, PhoneSchema } from '../../../../platform/text.js';
import { toApiInstant } from '../../../../platform/time.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { CoreDb } from '../../db/types.js';
import { parentAccounts, parentRefreshTokens, parentStudents } from '../../db/schema.js';
import { hashPassword, PasswordSchema, verifyPassword, getDummyHash } from '../auth/password.js';
import { ACCESS_TOKEN_TTL_SECONDS, generateOpaqueToken, hashToken, type AccessTokens } from '../auth/tokens.js';

const CODE_TTL_DAYS = 7;
const MAX_CODE_ATTEMPTS = 5;
const REFRESH_TTL_DAYS = 60;

const codeHash = (parentId: string, code: string) => createHash('sha256').update(`${parentId}:${code}`).digest('hex');
/** SĐT chuẩn hoá; sai định dạng → lỗi nhập liệu. */
function phoneOf(raw: string): string {
  const phone = normalizePhone(raw);
  if (!phone) throw Errors.validation([{ path: 'body.phone', message: 'Số điện thoại không hợp lệ' }]);
  return phone;
}
const invalidLogin = () => new AppError(401, 'INVALID_CREDENTIALS', 'Số điện thoại hoặc mật khẩu không đúng');
const invalidCode = () => new AppError(401, 'INVALID_ACTIVATION_CODE', 'Mã kích hoạt không đúng hoặc đã hết hạn');
const invalidRefresh = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');

export interface ParentAccessStatus {
  phone: string;
  status: 'PENDING' | 'ACTIVE' | 'LOCKED';
  lastLoginAt: string | null;
  activationExpiresAt: string | null;
}

/**
 * Tài khoản phụ huynh: CS cấp mã kích hoạt (6 số, 7 ngày) → phụ huynh nhập SĐT + mã, tự đặt mật khẩu.
 * Con của phụ huynh = học viên CRM có phụ huynh mang SĐT đó (CRM đồng bộ qua core/contract).
 */
export function createParentsService(db: CoreDb, tokens: AccessTokens) {
  async function issueSession(parentId: string, familyId = newId()) {
    const refreshToken = generateOpaqueToken();
    await db.insert(parentRefreshTokens).values({
      id: newId(),
      parentId,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
    });
    return { accessToken: await tokens.sign({ userId: parentId, role: 'PARENT' }), expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }

  async function principalOf(parentId: string): Promise<ParentPrincipal> {
    const [p] = await db.select().from(parentAccounts).where(eq(parentAccounts.id, parentId));
    if (!p || p.status !== 'ACTIVE') throw new AppError(401, 'ACCOUNT_LOCKED', 'Tài khoản phụ huynh chưa kích hoạt hoặc đã bị khoá');
    const links = await db.select({ studentId: parentStudents.studentId }).from(parentStudents).where(eq(parentStudents.parentId, parentId));
    return { parentId, phone: p.phone, studentIds: links.map((l) => l.studentId) };
  }

  async function replaceLinks(parentId: string, studentIds: string[]) {
    await db.delete(parentStudents).where(eq(parentStudents.parentId, parentId));
    const ids = [...new Set(studentIds)];
    if (ids.length) await db.insert(parentStudents).values(ids.map((studentId) => ({ parentId, studentId })));
  }

  return {
    principalOf,

    // ── Cho CRM (core/contract)

    /** Tạo / cấp lại mã kích hoạt. Tài khoản đã kích hoạt: mã dùng để đặt lại mật khẩu. */
    async issueActivation(input: { phone: string; fullName: string; studentIds: string[] }) {
      const phone = phoneOf(input.phone);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 86_400_000);
      const [existing] = await db.select().from(parentAccounts).where(eq(parentAccounts.phone, phone));
      const id = existing?.id ?? newId();
      if (existing) {
        if (existing.status === 'LOCKED') throw new AppError(409, 'PARENT_LOCKED', 'Tài khoản phụ huynh đang bị khoá');
        await db
          .update(parentAccounts)
          .set({ fullName: input.fullName, activationCodeHash: codeHash(id, code), activationExpiresAt: expiresAt, activationAttempts: 0 })
          .where(eq(parentAccounts.id, id));
      } else {
        await db.insert(parentAccounts).values({ id, phone, fullName: input.fullName, activationCodeHash: codeHash(id, code), activationExpiresAt: expiresAt });
      }
      await replaceLinks(id, input.studentIds);
      return { code, expiresAt: toApiInstant(expiresAt), status: existing?.status ?? 'PENDING' };
    },

    /** Cập nhật danh sách con theo SĐT (khi CRM sửa phụ huynh). Chưa có tài khoản → bỏ qua. */
    async syncLinks(phone: string, studentIds: string[]) {
      const [p] = await db.select({ id: parentAccounts.id }).from(parentAccounts).where(eq(parentAccounts.phone, phoneOf(phone)));
      if (p) await replaceLinks(p.id, studentIds);
    },

    async statusOf(phones: string[]): Promise<ParentAccessStatus[]> {
      const list = [...new Set(phones.map(normalizePhone).filter((p): p is string => !!p))];
      if (!list.length) return [];
      const rows = await db.select().from(parentAccounts).where(inArray(parentAccounts.phone, list));
      return rows.map((r) => ({
        phone: r.phone,
        status: r.status,
        lastLoginAt: r.lastLoginAt ? toApiInstant(r.lastLoginAt) : null,
        activationExpiresAt: r.status !== 'ACTIVE' && r.activationExpiresAt ? toApiInstant(r.activationExpiresAt) : null,
      }));
    },

    // ── Đăng nhập phụ huynh

    async activate(input: { phone: string; code: string; password: string }) {
      const [p] = await db.select().from(parentAccounts).where(eq(parentAccounts.phone, phoneOf(input.phone)));
      if (!p || p.status === 'LOCKED' || !p.activationCodeHash || !p.activationExpiresAt || p.activationExpiresAt <= new Date()) throw invalidCode();
      // Giữ một lượt thử bằng một câu UPDATE nguyên tử TRƯỚC khi so mã — gửi song song không vượt được giới hạn.
      const [slot] = await db
        .update(parentAccounts)
        .set({ activationAttempts: sql`${parentAccounts.activationAttempts} + 1` })
        .where(and(eq(parentAccounts.id, p.id), eq(parentAccounts.activationCodeHash, p.activationCodeHash), lt(parentAccounts.activationAttempts, MAX_CODE_ATTEMPTS)));
      if (slot.affectedRows !== 1) {
        throw new AppError(429, 'ACTIVATION_LOCKED', 'Nhập sai mã quá nhiều lần — liên hệ trung tâm để được cấp mã mới');
      }
      if (codeHash(p.id, input.code) !== p.activationCodeHash) throw invalidCode();
      const passwordHash = await hashPassword(input.password);
      // Chỉ một request dùng được mã (mã bị xoá ngay khi dùng).
      const [used] = await db
        .update(parentAccounts)
        .set({ passwordHash, status: 'ACTIVE', activationCodeHash: null, activationExpiresAt: null, activationAttempts: 0, lastLoginAt: new Date() })
        .where(and(eq(parentAccounts.id, p.id), eq(parentAccounts.activationCodeHash, p.activationCodeHash)));
      if (used.affectedRows !== 1) throw invalidCode();
      // Đặt lại mật khẩu → huỷ các phiên cũ
      await db.update(parentRefreshTokens).set({ revokedAt: new Date() }).where(and(eq(parentRefreshTokens.parentId, p.id), isNull(parentRefreshTokens.revokedAt)));
      return issueSession(p.id);
    },

    async login(input: { phone: string; password: string }) {
      const [p] = await db.select().from(parentAccounts).where(eq(parentAccounts.phone, phoneOf(input.phone)));
      // So mật khẩu cả khi không có tài khoản để thời gian phản hồi như nhau.
      const ok = await verifyPassword(input.password, p?.passwordHash ?? (await getDummyHash()));
      if (!p || !p.passwordHash || !ok) throw invalidLogin();
      if (p.status !== 'ACTIVE') throw new AppError(401, 'ACCOUNT_LOCKED', 'Tài khoản phụ huynh đã bị khoá');
      await db.update(parentAccounts).set({ lastLoginAt: new Date() }).where(eq(parentAccounts.id, p.id));
      return issueSession(p.id);
    },

    async refresh(refreshToken: string) {
      const [row] = await db.select().from(parentRefreshTokens).where(eq(parentRefreshTokens.tokenHash, hashToken(refreshToken)));
      if (!row || row.expiresAt <= new Date()) throw invalidRefresh();
      if (row.revokedAt) {
        // Token cũ bị dùng lại → huỷ cả phiên.
        await db.update(parentRefreshTokens).set({ revokedAt: new Date() }).where(and(eq(parentRefreshTokens.familyId, row.familyId), isNull(parentRefreshTokens.revokedAt)));
        throw invalidRefresh();
      }
      await principalOf(row.parentId);
      const [res] = await db
        .update(parentRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(parentRefreshTokens.id, row.id), isNull(parentRefreshTokens.revokedAt), gt(parentRefreshTokens.expiresAt, new Date())));
      if (res.affectedRows !== 1) throw invalidRefresh();
      return issueSession(row.parentId, row.familyId);
    },

    async logout(refreshToken: string) {
      const [row] = await db.select().from(parentRefreshTokens).where(eq(parentRefreshTokens.tokenHash, hashToken(refreshToken)));
      if (row) await db.update(parentRefreshTokens).set({ revokedAt: new Date() }).where(eq(parentRefreshTokens.familyId, row.familyId));
    },

    async me(parent: ParentPrincipal) {
      const [p] = await db.select().from(parentAccounts).where(eq(parentAccounts.id, parent.parentId));
      if (!p) throw Errors.unauthenticated();
      return { id: p.id, phone: p.phone, fullName: p.fullName, studentIds: parent.studentIds };
    },
  };
}

export type ParentsService = ReturnType<typeof createParentsService>;

const SessionSchema = z
  .object({
    accessToken: z.string(),
    expiresIn: z.number().int().openapi({ description: 'Giây' }),
    refreshToken: z.string().openapi({ description: 'Lưu an toàn trên thiết bị; dùng một lần (xoay vòng)' }),
  })
  .openapi('ParentSession');

/** Khoá giới hạn tần suất theo SĐT đã chuẩn hoá — viết SĐT kiểu khác (+84, dấu cách…) vẫn cùng một khoá. */
export function parentLimitKey(phone: unknown) {
  const raw = String(phone ?? '');
  return normalizePhone(raw) ?? raw.replace(/\D/g, '');
}

export function registerParentAuthRoutes(route: RouteRegistrar, parents: ParentsService, { rateLimit }: { rateLimit: boolean }) {
  const limit = rateLimit
    ? credentialLimits('parent', (req) => parentLimitKey((req.body as { phone?: unknown })?.phone))
    : [];

  route({
    method: 'post',
    path: '/parent/auth/activate',
    tags: ['parent'],
    summary: 'Kích hoạt tài khoản / đặt lại mật khẩu bằng mã',
    description: 'Mã 6 số do trung tâm gửi (hiệu lực 7 ngày, sai 5 lần phải xin mã mới). Thành công → đăng nhập luôn.',
    access: { public: true },
    middlewares: limit,
    request: { body: z.object({ phone: PhoneSchema, code: z.string().regex(/^\d{6}$/, 'Mã gồm 6 chữ số'), password: PasswordSchema }) },
    responses: { 200: { description: 'Đã kích hoạt', schema: item(SessionSchema) } },
    errorCodes: ['INVALID_ACTIVATION_CODE', 'ACTIVATION_LOCKED'],
    handler: async ({ body }) => ({ data: await parents.activate(body) }),
  });

  route({
    method: 'post',
    path: '/parent/auth/login',
    tags: ['parent'],
    summary: 'Phụ huynh đăng nhập',
    access: { public: true },
    middlewares: limit,
    request: { body: z.object({ phone: PhoneSchema, password: z.string().min(1).max(200) }) },
    responses: { 200: { description: 'Phiên đăng nhập', schema: item(SessionSchema) } },
    errorCodes: ['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED'],
    handler: async ({ body }) => ({ data: await parents.login(body) }),
  });

  route({
    method: 'post',
    path: '/parent/auth/refresh',
    tags: ['parent'],
    summary: 'Làm mới phiên phụ huynh',
    access: { public: true },
    request: { body: z.object({ refreshToken: z.string().min(20).max(200) }) },
    responses: { 200: { description: 'Phiên mới', schema: item(SessionSchema) } },
    errorCodes: ['INVALID_REFRESH_TOKEN'],
    handler: async ({ body }) => ({ data: await parents.refresh(body.refreshToken) }),
  });

  route({
    method: 'post',
    path: '/parent/auth/logout',
    tags: ['parent'],
    summary: 'Phụ huynh đăng xuất',
    access: { public: true },
    request: { body: z.object({ refreshToken: z.string().min(20).max(200) }) },
    responses: { 204: { description: 'Đã đăng xuất' } },
    async handler({ body }) {
      await parents.logout(body.refreshToken);
    },
  });

  route({
    method: 'get',
    path: '/parent/me',
    tags: ['parent'],
    summary: 'Tài khoản phụ huynh hiện tại',
    access: { parent: true },
    responses: {
      200: { description: 'Phụ huynh', schema: item(z.object({ id: z.string(), phone: z.string(), fullName: z.string(), studentIds: z.array(z.string()) })) },
    },
    handler: async ({ parent }) => ({ data: await parents.me(parent) }),
  });
}
