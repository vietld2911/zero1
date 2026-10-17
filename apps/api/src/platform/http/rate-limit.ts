import type { Request } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { AppError } from './errors.js';

/** Giới hạn tần suất, trả lỗi đúng chuẩn problem+json qua error handler. */
export function createRateLimit(
  opts: Pick<Options, 'windowMs' | 'limit'> & {
    keyGenerator?: Options['keyGenerator'];
    /** Chỉ đếm request lỗi (status ≥ 400) — dùng cho đăng nhập: đăng nhập đúng không bị khoá. */
    failedOnly?: boolean;
  },
) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: opts.failedOnly ?? false,
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
    handler: (_req, _res, next) => {
      next(new AppError(429, 'TOO_MANY_REQUESTS', 'Thao tác quá nhiều lần, vui lòng thử lại sau ít phút'));
    },
  });
}

/** Khoá theo IP (IPv6 gộp theo dải /56 để không lách bằng cách đổi địa chỉ). */
export const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? '');

/**
 * Bộ giới hạn cho form đăng nhập / nhập mã: theo IP + tài khoản, theo tài khoản (dò từ nhiều IP)
 * và theo IP (dò rải nhiều tài khoản). Chỉ đếm lần thất bại.
 * `account` phải trả về giá trị đã chuẩn hoá — nếu không, đổi cách viết là lách được.
 */
export function credentialLimits(name: string, account: (req: Request) => string, limits = { perAccountIp: 10, perAccount: 30, perIp: 50 }) {
  const windowMs = 15 * 60_000;
  return [
    createRateLimit({ windowMs, limit: limits.perIp, failedOnly: true, keyGenerator: (req) => `${name}:ip:${ipKey(req)}` }),
    createRateLimit({ windowMs, limit: limits.perAccount, failedOnly: true, keyGenerator: (req) => `${name}:acc:${account(req)}` }),
    createRateLimit({ windowMs, limit: limits.perAccountIp, failedOnly: true, keyGenerator: (req) => `${name}:${ipKey(req)}:${account(req)}` }),
  ];
}
