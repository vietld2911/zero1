/**
 * Xuất openapi.json mà không cần DB — đầu vào để sinh packages/api-client.
 * Chạy: npm run api-client:generate (ở thư mục gốc)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { loadEnv } from '../src/platform/env.js';
import { buildApplication } from '../src/application.js';

// Pool mysql2 chỉ kết nối khi có truy vấn, nên giá trị giả ở đây không chạm tới DB.
const env = loadEnv({
  DB_HOST: 'unused',
  DB_USER: 'unused',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
});
const { app, close } = buildApplication(env, pino({ level: 'silent' }));

const out = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(out, JSON.stringify(app.locals.openApiDocument, null, 2) + '\n');
await close();
console.log(`✔ ${out}`);
