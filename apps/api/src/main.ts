import { loadEnv } from './platform/env.js';
import { createLogger } from './platform/logger.js';
import { dbUnavailableCode, dbUnavailableHint, pingPool } from './platform/db/connection.js';
import { buildApplication } from './application.js';
import { seedAccess } from './contexts/core/modules/access/seed.js';

const env = loadEnv();
const logger = createLogger(env);
const { app, dispatcher, scheduler, databases, close } = buildApplication(env, logger);

const server = app.listen(env.PORT, () => {
  logger.info(`API chạy tại http://localhost:${env.PORT} — tài liệu: http://localhost:${env.PORT}/docs`);
});
dispatcher.start();
scheduler.start();

// Kiểm tra database ngay khi khởi động để báo lỗi dễ hiểu (API vẫn chạy và tự kết nối lại khi DB sẵn sàng).
void Promise.all(Object.values(databases.pools).map(pingPool)).then(
  async () => {
    logger.info('Đã kết nối database');
    // Đồng bộ danh mục vai trò / quyền (quyền mới của bản cập nhật được gán cho vai trò mặc định).
    const { newPermissions } = await seedAccess(databases.dbs.core);
    if (newPermissions.length) logger.info({ newPermissions }, 'Đã thêm quyền mới');
  },
  (err: unknown) => {
    const code = dbUnavailableCode(err);
    if (code) logger.error(`⚠ ${dbUnavailableHint(code, env)}`);
    else logger.error({ err }, 'Lỗi kết nối database');
  },
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Đang tắt server');
  server.close();
  await close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
