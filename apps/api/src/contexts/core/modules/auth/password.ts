import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { z } from '../../../../platform/openapi/zod.js';

// scrypt của Node, không cần thư viện native. N = 2^15 ≈ 32 MiB bộ nhớ mỗi lần băm.
const LOG_N = 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function scryptAsync(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const options = (logN: number, r: number, p: number): ScryptOptions => ({
  N: 2 ** logN,
  r,
  p,
  maxmem: 256 * 2 ** logN * r,
});

/** Định dạng: `scrypt$<logN>$<r>$<p>$<salt>$<hash>` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, options(LOG_N, R, P));
  return ['scrypt', LOG_N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, logN, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !logN || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), options(Number(logN), Number(r), Number(p)));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash giả để so sánh khi email không tồn tại — thời gian phản hồi không lộ email nào có thật. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

export const PasswordSchema = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(128, 'Mật khẩu tối đa 128 ký tự')
  .regex(/[A-Za-z]/, 'Mật khẩu phải có chữ cái')
  .regex(/\d/, 'Mật khẩu phải có chữ số');

// Bỏ ký tự dễ nhầm (0/O, 1/l/I) để đọc qua điện thoại không sai.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mật khẩu tạm 12 ký tự, luôn có chữ và số (thoả PasswordSchema). */
export function generateTempPassword(): string {
  for (;;) {
    const pw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}
