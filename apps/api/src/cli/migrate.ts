/**
 * Tạo 3 database (nếu chưa có) và chạy migration của từng context.
 * Chạy: npm run db:migrate
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { loadDbEnv } from '../platform/env.js';
import { createDb, createMysqlPool } from '../platform/db/connection.js';

const env = loadDbEnv();
const targets = [
  { context: 'core', database: env.DB_NAME_CORE },
  { context: 'crm', database: env.DB_NAME_CRM },
  { context: 'lms', database: env.DB_NAME_LMS },
];

const admin = createMysqlPool(env);
try {
  for (const { context, database } of targets) {
    // Tên database đã được env.ts giới hạn ở [A-Za-z0-9_].
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    const pool = createMysqlPool(env, database);
    try {
      const migrationsFolder = fileURLToPath(new URL(`../../drizzle/${context}`, import.meta.url));
      await migrate(createDb(pool, {}), { migrationsFolder });
      console.log(`✔ ${context} → ${database}`);
    } finally {
      await pool.end();
    }
  }
} finally {
  await admin.end();
}
