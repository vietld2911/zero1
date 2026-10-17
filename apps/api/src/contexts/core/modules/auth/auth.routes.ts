import type { CookieOptions, Request, Response } from 'express';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import type { Env } from '../../../../platform/env.js';
import { Errors } from '../../../../platform/http/errors.js';
import { createRateLimit, credentialLimits } from '../../../../platform/http/rate-limit.js';
import { item } from '../../../../platform/http/schemas.js';
import type { CorePrincipal } from './guards.js';
import type { AuthService, RequestMeta } from './auth.service.js';
import {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  MeSchema,
  RefreshBody,
  ResetPasswordBody,
  SessionSchema,
  UpdateProfileBody,
} from './auth.schemas.js';
import { REFRESH_TOKEN_TTL_DAYS } from './tokens.js';

const COOKIE = 'z1_rt';
const COOKIE_PATH = '/api/v1/core/auth';

interface Options {
  env: Pick<Env, 'NODE_ENV' | 'COOKIE_DOMAIN' | 'CORS_ORIGINS'>;
  /** Tắt trong test. */
  rateLimit: boolean;
}

export function metaOf(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

export function registerAuthRoutes(route: RouteRegistrar, auth: AuthService, { env, rateLimit }: Options) {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
  const isMobile = (req: Request) => req.header('x-client') === 'mobile';

  function sendSession(req: Request, res: Response, session: { accessToken: string; refreshToken: string; expiresIn: number; user: unknown }) {
    const { refreshToken, ...rest } = session;
    if (isMobile(req)) return { data: { ...rest, refreshToken } };
    res.cookie(COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_DAYS * 86_400_000 });
    return { data: rest };
  }

  function readRefresh(req: Request): string | undefined {
    if (isMobile(req)) return (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    return (req.cookies as Record<string, string> | undefined)?.[COOKIE];
  }

  /** Endpoint dựa vào cookie: chặn request từ trang lạ (bổ sung cho SameSite=Strict). */
  function assertOrigin(req: Request) {
    const origin = req.header('origin');
    if (origin && !env.CORS_ORIGINS.includes(origin)) throw Errors.forbidden('Origin không được phép');
  }

  const loginLimit = rateLimit
    ? credentialLimits('login', (req) => String((req.body as { email?: unknown })?.email ?? '').trim().toLowerCase())
    : [];
  const forgotLimit = rateLimit ? [createRateLimit({ windowMs: 60 * 60_000, limit: 5 })] : [];

  route({
    method: 'post',
    path: '/core/auth/login',
    tags: ['core'],
    summary: 'Đăng nhập',
    description: 'Sai quá 10 lần / 15 phút cho mỗi IP + email (30 lần cho mỗi email, 50 lần cho mỗi IP) → 429. Lần đúng không bị tính.',
    access: { public: true },
    middlewares: loginLimit,
    request: { body: LoginBody },
    responses: { 200: { description: 'Đăng nhập thành công', schema: item(SessionSchema) } },
    errorCodes: ['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'TOO_MANY_REQUESTS'],
    async handler({ body, req, res }) {
      return sendSession(req, res, await auth.login(body.email, body.password, metaOf(req)));
    },
  });

  route({
    method: 'post',
    path: '/core/auth/refresh',
    tags: ['core'],
    summary: 'Cấp lại access token',
    description: 'Web: dùng cookie httpOnly `z1_rt`. Mobile: gửi `X-Client: mobile` và `refreshToken` trong body. Refresh token được xoay vòng mỗi lần gọi.',
    access: { public: true },
    request: { body: RefreshBody },
    responses: { 200: { description: 'Phiên mới', schema: item(SessionSchema) } },
    errorCodes: ['INVALID_REFRESH_TOKEN', 'ACCOUNT_LOCKED'],
    async handler({ req, res }) {
      assertOrigin(req);
      const token = readRefresh(req);
      if (!token) throw Errors.unauthenticated('Không có phiên đăng nhập');
      try {
        return sendSession(req, res, await auth.refresh(token, metaOf(req)));
      } catch (err) {
        if (!isMobile(req)) res.clearCookie(COOKIE, cookieOptions);
        throw err;
      }
    },
  });

  route({
    method: 'post',
    path: '/core/auth/logout',
    tags: ['core'],
    summary: 'Đăng xuất thiết bị hiện tại',
    access: { public: true },
    request: { body: RefreshBody },
    responses: { 204: { description: 'Đã đăng xuất' } },
    async handler({ req, res }) {
      assertOrigin(req);
      await auth.logout(readRefresh(req));
      res.clearCookie(COOKIE, cookieOptions);
    },
  });

  route({
    method: 'get',
    path: '/core/auth/me',
    tags: ['core'],
    summary: 'Thông tin người đang đăng nhập',
    description: 'Gồm vai trò, quyền, chi nhánh, app được vào.',
    access: { authenticated: true },
    responses: { 200: { description: 'Người dùng hiện tại', schema: item(MeSchema) } },
    async handler({ principal }) {
      return { data: await auth.me(principal as CorePrincipal) };
    },
  });

  route({
    method: 'patch',
    path: '/core/auth/me',
    tags: ['core'],
    summary: 'Cập nhật hồ sơ cá nhân',
    access: { authenticated: true },
    request: { body: UpdateProfileBody },
    responses: { 200: { description: 'Hồ sơ sau khi cập nhật', schema: item(MeSchema) } },
    async handler({ principal, body }) {
      return { data: await auth.updateProfile(principal as CorePrincipal, body) };
    },
  });

  route({
    method: 'post',
    path: '/core/auth/change-password',
    tags: ['core'],
    summary: 'Đổi mật khẩu',
    description: 'Đăng xuất mọi thiết bị khác, giữ phiên hiện tại.',
    access: { authenticated: true },
    request: { body: ChangePasswordBody },
    responses: { 204: { description: 'Đã đổi mật khẩu' } },
    errorCodes: ['WRONG_CURRENT_PASSWORD', 'PASSWORD_UNCHANGED'],
    async handler({ principal, body, req }) {
      await auth.changePassword(principal as CorePrincipal, body.currentPassword, body.newPassword, readRefresh(req), metaOf(req));
    },
  });

  route({
    method: 'post',
    path: '/core/auth/forgot-password',
    tags: ['core'],
    summary: 'Gửi email đặt lại mật khẩu',
    description: 'Luôn trả 204 (không tiết lộ email có tồn tại). Giới hạn 5 lần / giờ / IP.',
    access: { public: true },
    middlewares: forgotLimit,
    request: { body: ForgotPasswordBody },
    responses: { 204: { description: 'Đã tiếp nhận' } },
    async handler({ body }) {
      await auth.forgotPassword(body.email, body.app);
    },
  });

  route({
    method: 'post',
    path: '/core/auth/reset-password',
    tags: ['core'],
    summary: 'Đặt lại mật khẩu bằng link trong email',
    description: 'Đăng xuất mọi thiết bị.',
    access: { public: true },
    request: { body: ResetPasswordBody },
    responses: { 204: { description: 'Đã đặt lại mật khẩu' } },
    errorCodes: ['INVALID_RESET_TOKEN'],
    async handler({ body, req }) {
      await auth.resetPassword(body.token, body.newPassword, metaOf(req));
    },
  });
}
