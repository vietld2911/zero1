import { index, int, mysqlTable, primaryKey, text, varchar } from 'drizzle-orm/mysql-core';
import { instant, jsonb, ulid } from '../db/columns.js';

/**
 * Mỗi database (core/crm/lms) có bộ bảng sự kiện riêng để ghi cùng transaction
 * với thay đổi nghiệp vụ. Schema của từng context gọi hàm này và export kết quả.
 */
export function defineEventTables() {
  const outboxEvents = mysqlTable(
    'outbox_events',
    {
      id: ulid('id').primaryKey(),
      type: varchar('type', { length: 100 }).notNull(),
      version: int('version').notNull().default(1),
      aggregateId: ulid('aggregate_id').notNull(),
      branchId: ulid('branch_id'),
      actorId: ulid('actor_id'),
      data: jsonb('data').notNull(),
      occurredAt: instant('occurred_at').notNull(),
      publishedAt: instant('published_at'),
      attempts: int('attempts').notNull().default(0),
      /** Thời điểm sớm nhất được thử lại (backoff sau mỗi lần lỗi). */
      availableAt: instant('available_at').notNull(),
      lastError: text('last_error'),
    },
    (t) => [index('outbox_pending_idx').on(t.publishedAt, t.availableAt)],
  );

  const processedEvents = mysqlTable(
    'processed_events',
    {
      eventId: ulid('event_id').notNull(),
      handler: varchar('handler', { length: 120 }).notNull(),
      processedAt: instant('processed_at').notNull(),
    },
    (t) => [primaryKey({ columns: [t.eventId, t.handler] })],
  );

  return { outboxEvents, processedEvents };
}

export type EventTables = ReturnType<typeof defineEventTables>;
