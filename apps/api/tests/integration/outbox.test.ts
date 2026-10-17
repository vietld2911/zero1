import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { loadDbEnv } from '../../src/platform/env.js';
import { createDb, createMysqlPool } from '../../src/platform/db/connection.js';
import { appendEvent, createDrizzleOutboxSource } from '../../src/platform/events/outbox.js';
import { runOnce } from '../../src/platform/events/run-once.js';
import * as schema from '../../src/contexts/core/db/schema.js';

/**
 * Chạy trên database tạm (tạo rồi xóa). Cần MySQL/MariaDB theo cấu hình .env.
 * Chạy: npm run test:integration
 */
const env = loadDbEnv();
const database = `zero1_it_${Date.now()}`;
let admin: Pool;
let pool: Pool;
let db: ReturnType<typeof createDb<typeof schema>>;

beforeAll(async () => {
  admin = createMysqlPool(env);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  pool = createMysqlPool(env, database);
  db = createDb(pool, schema);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle/core', import.meta.url)) });
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin?.end();
});

const AGG = '01JAAAAAAAAAAAAAAAAAAAAAAA';

describe('kết nối', () => {
  it('phiên DB chạy UTC, nên NOW() khớp với thời gian app ghi', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()) AS diff',
    );
    expect(rows[0]?.diff).toBe(0);
  });
});

describe('outbox (DB thật)', () => {
  it('transaction rollback thì sự kiện cũng mất', async () => {
    await expect(
      db.transaction(async (tx) => {
        await appendEvent(tx, schema, { type: 'test.rolled_back', aggregateId: AGG, data: {} });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const source = createDrizzleOutboxSource('core', db, schema);
    expect((await source.fetchPending(10)).map((e) => e.type)).not.toContain('test.rolled_back');
  });

  it('commit → đọc ra đúng envelope; lỗi → lùi lịch; publish → không đọc lại', async () => {
    const id = await db.transaction((tx) =>
      appendEvent(tx, schema, { type: 'test.committed', aggregateId: AGG, data: { amount: 1_500_000, name: 'Nguyễn Văn An' } }),
    );
    const source = createDrizzleOutboxSource('core', db, schema);

    const [event] = (await source.fetchPending(10)).filter((e) => e.id === id);
    expect(event).toMatchObject({ type: 'test.committed', source: 'core', data: { amount: 1_500_000, name: 'Nguyễn Văn An' } });
    expect(event?.occurredAt).toMatch(/\+07:00$/);

    await source.markFailed(id, 'tạm lỗi');
    expect((await source.fetchPending(10)).map((e) => e.id)).not.toContain(id);
    const [row] = await pool.query<RowDataPacket[]>('SELECT attempts, last_error FROM outbox_events WHERE id = ?', [id]);
    expect(row).toMatchObject([{ attempts: 1, last_error: 'tạm lỗi' }]);

    await pool.query('UPDATE outbox_events SET available_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?', [id]);
    expect((await source.fetchPending(10)).map((e) => e.id)).toContain(id);

    await source.markPublished(id);
    expect((await source.fetchPending(10)).map((e) => e.id)).not.toContain(id);
  });
});

describe('runOnce (DB thật)', () => {
  const event = {
    id: '01JBBBBBBBBBBBBBBBBBBBBBBB',
    type: 'test.x',
    version: 1,
    occurredAt: '',
    source: 'crm' as const,
    aggregateId: AGG,
    branchId: null,
    actorId: null,
    data: {},
  };

  it('xử lý đúng một lần cho mỗi handler', async () => {
    let count = 0;
    expect(await runOnce(db, schema, event, 'h1', async () => void count++)).toBe('processed');
    expect(await runOnce(db, schema, event, 'h1', async () => void count++)).toBe('skipped');
    expect(await runOnce(db, schema, event, 'h2', async () => void count++)).toBe('processed');
    expect(count).toBe(2);
  });

  it('handler lỗi thì không đánh dấu, lần sau chạy lại được', async () => {
    const e = { ...event, id: '01JCCCCCCCCCCCCCCCCCCCCCCC' };
    await expect(
      runOnce(db, schema, e, 'h', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(await runOnce(db, schema, e, 'h', async () => {})).toBe('processed');
  });
});
