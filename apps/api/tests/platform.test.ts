import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/platform/env.js';
import { toApiInstant } from '../src/platform/time.js';
import { newId } from '../src/platform/ids.js';

const base = { DB_HOST: 'localhost', DB_USER: 'root', JWT_ACCESS_SECRET: 'a'.repeat(32) };

describe('env', () => {
  it('từ chối khởi động khi thiếu JWT secret (không có fallback)', () => {
    expect(() => loadEnv({ DB_HOST: 'localhost', DB_USER: 'root' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('từ chối JWT secret ngắn', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'secret' })).toThrow(/32 ký tự/);
  });

  it('từ chối tên database có ký tự nguy hiểm', () => {
    expect(() => loadEnv({ ...base, DB_NAME_CRM: 'crm`; DROP DATABASE x; --' })).toThrow(/DB_NAME_CRM/);
  });

  it('tách CORS_ORIGINS và áp giá trị mặc định', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.DB_NAME_LMS).toBe('zero1_lms');
    expect(env.PORT).toBe(4000);
  });
});

describe('time', () => {
  it('đổi UTC sang +07:00', () => {
    expect(toApiInstant(new Date('2026-10-07T11:30:00.000Z'))).toBe('2026-10-07T18:30:00.000+07:00');
    expect(toApiInstant(new Date('2026-10-07T20:00:00.000Z'))).toBe('2026-10-08T03:00:00.000+07:00');
  });
});

describe('ids', () => {
  it('ULID 26 ký tự, tăng dần', () => {
    const a = newId();
    const b = newId();
    expect(a).toHaveLength(26);
    expect(b > a).toBe(true);
  });
});
