import { z } from './openapi/zod.js';

/**
 * Chuẩn hoá số điện thoại Việt Nam để so trùng: bỏ ký tự thừa, +84 / 84 → 0.
 * "+84 912-345-678" → "0912345678". Trả null nếu không giống số VN.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 9 && !digits.startsWith('0')) digits = `0${digits}`;
  return /^0\d{9}$/.test(digits) ? digits : null;
}

/** Schema zod: nhận số điện thoại nhiều định dạng, trả về dạng chuẩn 0xxxxxxxxx. */
export const PhoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0)' });
      return z.NEVER;
    }
    return n;
  })
  .openapi({ type: 'string', example: '0912345678' });
