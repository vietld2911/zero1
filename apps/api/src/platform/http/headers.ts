import type { Request } from 'express';
import { Errors } from './errors.js';

/** Đọc header If-Match (số version). Không gửi → không kiểm tra (docs/api-conventions.md §5). */
export function ifMatchVersion(req: Request): number | undefined {
  const raw = req.header('if-match');
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(n)) throw Errors.validation([{ path: 'headers.if-match', message: 'If-Match phải là số version' }]);
  return n;
}

/** Header Idempotency-Key (bắt buộc với thao tác tiền / chuyển đổi). */
export function idempotencyKey(req: Request, required = true): string | undefined {
  const key = req.header('idempotency-key')?.trim();
  if (!key) {
    if (required) throw Errors.validation([{ path: 'headers.idempotency-key', message: 'Thiếu header Idempotency-Key' }]);
    return undefined;
  }
  if (!/^[\w-]{8,64}$/.test(key)) throw Errors.validation([{ path: 'headers.idempotency-key', message: '8–64 ký tự chữ, số, - hoặc _' }]);
  return key;
}
