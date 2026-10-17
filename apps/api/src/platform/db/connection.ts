import { createPool, type Pool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import type { DbEnv } from '../env.js';

export type DbConfig = Pick<DbEnv, 'DB_HOST' | 'DB_PORT' | 'DB_USER' | 'DB_PASSWORD'>;

export function createMysqlPool(env: DbConfig, database?: string): Pool {
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z', // mysql2 đổi Date ↔ chuỗi theo UTC; đổi sang +07:00 ở lớp trả response
    connectionLimit: 10,
    supportBigNumbers: true,
  });
  // `timezone` ở trên không đổi múi giờ phiên của server. Thiếu dòng này, NOW()/CURRENT_TIMESTAMP
  // (giá trị mặc định của created_at) sẽ theo giờ máy chủ DB và lệch với dữ liệu app ghi bằng UTC.
  pool.pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

/** Mỗi context nhận một handle riêng, nên không thể JOIN sang database của context khác. */
export function createDb<TSchema extends Record<string, unknown>>(pool: Pool, schema: TSchema) {
  return drizzle({ client: pool, schema, mode: 'default' });
}

const UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR']);

/** Lỗi do không tới được DB (chưa bật, sai cấu hình) — khác với lỗi truy vấn. Trả về mã lỗi nếu đúng. */
export function dbUnavailableCode(err: unknown): string | undefined {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: string }).code;
    if (code && UNAVAILABLE_CODES.has(code)) return code;
  }
  return undefined;
}

/** Hướng dẫn sửa theo mã lỗi kết nối. */
export function dbUnavailableHint(code: string, env: Pick<DbEnv, 'DB_HOST' | 'DB_PORT'>): string {
  const where = `${env.DB_HOST}:${env.DB_PORT}`;
  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
      return `MySQL từ chối đăng nhập — kiểm tra DB_USER / DB_PASSWORD trong apps/api/.env`;
    case 'ER_BAD_DB_ERROR':
      return `Chưa có database — chạy: npm run db:migrate`;
    default:
      return `Không kết nối được MySQL tại ${where} — bật MySQL (XAMPP Control Panel → MySQL → Start) rồi thử lại`;
  }
}

export async function pingPool(pool: Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}
