/**
 * Đồng bộ vai trò / quyền và tạo ADMIN đầu tiên. Chạy lại an toàn.
 * Chạy: npm run db:seed
 */
import { loadDbEnv } from '../platform/env.js';
import { z } from 'zod';
import { createDb, createMysqlPool } from '../platform/db/connection.js';
import * as coreSchema from '../contexts/core/db/schema.js';
import { ensureAdmin, seedAccess } from '../contexts/core/modules/access/seed.js';

const env = loadDbEnv();
const admin = z
  .object({ SEED_ADMIN_EMAIL: z.email().default('admin@zero1.local'), SEED_ADMIN_PASSWORD: z.string().min(8).optional() })
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));

const pool = createMysqlPool(env, env.DB_NAME_CORE);
try {
  const db = createDb(pool, coreSchema);
  const { newPermissions } = await seedAccess(db);
  console.log(`✔ Vai trò & quyền đã đồng bộ (${newPermissions.length} quyền mới)`);

  const result = await ensureAdmin(db, { email: admin.SEED_ADMIN_EMAIL, password: admin.SEED_ADMIN_PASSWORD });
  if (!result.created) {
    console.log('✔ Đã có tài khoản ADMIN — bỏ qua');
  } else if (result.generatedPassword) {
    console.log(`✔ Đã tạo ADMIN: ${result.email}`);
    console.log(`  Mật khẩu tạm (chỉ hiện một lần, đổi ở lần đăng nhập đầu): ${result.generatedPassword}`);
  } else {
    console.log(`✔ Đã tạo ADMIN: ${result.email} (mật khẩu theo SEED_ADMIN_PASSWORD)`);
  }
} finally {
  await pool.end();
}
