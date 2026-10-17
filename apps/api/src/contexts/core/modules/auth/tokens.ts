import { createHash, randomBytes } from 'node:crypto';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { AppError, Errors } from '../../../../platform/http/errors.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

const ISSUER = 'zero1';
const AUDIENCE = 'zero1-api';

export interface AccessClaims {
  userId: string;
  role: string;
}

export function createAccessTokens(secret: string) {
  const key = new TextEncoder().encode(secret);

  return {
    async sign(claims: AccessClaims): Promise<string> {
      return new SignJWT({ role: claims.role })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(claims.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },

    async verify(token: string): Promise<AccessClaims> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
        if (!payload.sub || typeof payload.role !== 'string') throw Errors.unauthenticated('Token không hợp lệ');
        return { userId: payload.sub, role: payload.role };
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) {
          throw new AppError(401, 'TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn');
        }
        if (err instanceof AppError) throw err;
        throw Errors.unauthenticated('Token không hợp lệ');
      }
    },
  };
}

export type AccessTokens = ReturnType<typeof createAccessTokens>;

/** Token ngẫu nhiên 256 bit cho refresh token / link đặt lại mật khẩu. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Chỉ lưu hash của token, nên lộ DB không dùng được token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
