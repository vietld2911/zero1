import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { pino } from 'pino';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { loadEnv } from '../../src/platform/env.js';
import { createDb, createMysqlPool } from '../../src/platform/db/connection.js';
import { createMemoryMailer } from '../../src/integrations/mailer.js';
import { createMemoryStorage } from '../../src/integrations/storage.js';
import { buildApplication } from '../../src/application.js';
import { ensureAdmin, seedAccess } from '../../src/contexts/core/modules/access/seed.js';
import type { HttpSender } from '../../src/contexts/core/modules/integrations/integrations.service.js';

/** Một lần gửi HTTP ra ngoài (webhook / Telegram) do server thực hiện trong test. */
export interface OutboundCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export const ADMIN = { email: 'admin@test.local', password: 'Admin12345' };
export const PASSWORD = 'Matkhau123';

/**
 * Ứng dụng thật trên 3 database tạm (tạo mới cho mỗi file test, xoá khi xong).
 * Cần MySQL/MariaDB theo apps/api/.env.
 */
export async function createTestApp(opts: { env?: Record<string, string> } = {}) {
  const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    DB_NAME_CORE: `z1t_core_${suffix}`,
    DB_NAME_CRM: `z1t_crm_${suffix}`,
    DB_NAME_LMS: `z1t_lms_${suffix}`,
    ...opts.env,
  });
  const dbs = [
    ['core', env.DB_NAME_CORE],
    ['crm', env.DB_NAME_CRM],
    ['lms', env.DB_NAME_LMS],
  ] as const;

  const admin = createMysqlPool(env);
  for (const [context, name] of dbs) {
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const pool = createMysqlPool(env, name);
    await migrate(createDb(pool, {}), { migrationsFolder: fileURLToPath(new URL(`../../drizzle/${context}`, import.meta.url)) });
    await pool.end();
  }

  const mailer = createMemoryMailer();
  const storage = createMemoryStorage();
  // Không gọi mạng thật: ghi lại mọi lần gửi, trả lời theo `outbound.respond`.
  const outbound = {
    calls: [] as OutboundCall[],
    respond: (_call: OutboundCall): { status: number; body: string } => ({ status: 200, body: '{"ok":true}' }),
  };
  const http: HttpSender = async (url, init) => {
    const call = { url, headers: init.headers, body: init.body };
    outbound.calls.push(call);
    return outbound.respond(call);
  };
  const built = buildApplication(env, pino({ level: 'silent' }), { mailer, storage, rateLimit: false, http });
  await seedAccess(built.databases.dbs.core);
  await ensureAdmin(built.databases.dbs.core, ADMIN);

  const api = request(built.app);

  async function login(email: string, password: string) {
    const res = await api.post('/api/v1/core/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`Login ${email} thất bại: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.data.accessToken as string, cookie: res.headers['set-cookie'] as unknown as string[], body: res.body };
  }

  const adminToken = (await login(ADMIN.email, ADMIN.password)).token;

  /** Tạo nhân sự bằng tài khoản ADMIN, đổi mật khẩu lần đầu, trả về token sẵn dùng. */
  async function makeUser(input: { email: string; fullName?: string; role: string; branchIds: string[]; managerId?: string }) {
    const res = await api
      .post('/api/v1/core/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: input.email.split('@')[0], ...input, password: 'TamThoi123' });
    if (res.status !== 201) throw new Error(`Tạo ${input.email} thất bại: ${res.status} ${JSON.stringify(res.body)}`);
    const { token } = await login(input.email, 'TamThoi123');
    const changed = await api
      .post('/api/v1/core/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'TamThoi123', newPassword: PASSWORD });
    if (changed.status !== 204) throw new Error(`Đổi mật khẩu ${input.email} thất bại: ${changed.status}`);
    return { id: res.body.data.user.id as string, token, email: input.email };
  }

  async function makeBranch(code: string) {
    const res = await api.post('/api/v1/core/branches').set('Authorization', `Bearer ${adminToken}`).send({ code, name: `Chi nhánh ${code}` });
    if (res.status !== 201) throw new Error(`Tạo chi nhánh ${code} thất bại: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.id as string;
  }

  /** Gọi API với token. */
  const as = (token: string) => ({
    get: (url: string) => api.get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => api.post(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    patch: (url: string, body?: object) => api.patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {}),
    delete: (url: string) => api.delete(url).set('Authorization', `Bearer ${token}`),
  });

  return {
    api,
    app: built.app,
    core: built.core,
    db: built.databases.dbs.core,
    crmDb: built.databases.dbs.crm,
    lmsDb: built.databases.dbs.lms,
    /** Phát hết sự kiện đang chờ (thay cho vòng lặp nền trong test). */
    drainEvents: () => built.dispatcher.drain(),
    /** Chạy mọi việc định kỳ ngay (nhắc việc…). */
    runJobs: (now?: Date) => built.scheduler.runAll(now),
    crmSubscriptions: built.crm.subscriptions,
    lmsSubscriptions: built.lms.subscriptions,
    storage,
    mailer,
    outbound,
    adminToken,
    login,
    makeUser,
    makeBranch,
    as,
    async close() {
      await built.close();
      for (const [, name] of dbs) await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.end();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Lấy giá trị cookie refresh từ header Set-Cookie. */
export function refreshCookie(setCookie: string[] | undefined): string {
  const c = setCookie?.find((x) => x.startsWith('z1_rt='));
  if (!c) throw new Error('Không có cookie z1_rt');
  return c.split(';')[0]!;
}
