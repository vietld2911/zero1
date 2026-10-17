import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { newId } from '../ids.js';
import { toApiInstant } from '../time.js';
import type { EventTables } from './tables.js';
import type { EventEnvelope, EventSource, OutboxSource } from './types.js';

/** Sau số lần này, sự kiện lỗi không được thử lại tự động nữa (cần xử lý tay). */
export const MAX_ATTEMPTS = 10;

/** Lần lỗi thứ n chờ 2^n giây, tối đa 1 giờ: 2s, 4s, 8s, … */
export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 60 * 60 * 1000);
}

// Chấp nhận cả db lẫn transaction của drizzle.
type Executor = Pick<MySql2Database<Record<string, unknown>>, 'insert' | 'select' | 'update'>;

export interface NewEvent<TData> {
  type: string;
  version?: number;
  aggregateId: string;
  branchId?: string | null;
  actorId?: string | null;
  data: TData;
}

/**
 * Ghi sự kiện vào outbox. PHẢI gọi với `tx` của transaction nghiệp vụ
 * để sự kiện và thay đổi dữ liệu cùng thành công hoặc cùng thất bại.
 */
export async function appendEvent<TData>(tx: Executor, tables: EventTables, event: NewEvent<TData>): Promise<string> {
  const id = newId();
  const now = new Date();
  await tx.insert(tables.outboxEvents).values({
    id,
    type: event.type,
    version: event.version ?? 1,
    aggregateId: event.aggregateId,
    branchId: event.branchId ?? null,
    actorId: event.actorId ?? null,
    data: event.data as unknown,
    occurredAt: now,
    availableAt: now,
  });
  return id;
}

export function createDrizzleOutboxSource(name: EventSource, db: Executor, tables: EventTables): OutboxSource {
  const t = tables.outboxEvents;
  return {
    name,
    async fetchPending(limit) {
      const rows = await db
        .select()
        .from(t)
        .where(and(isNull(t.publishedAt), lt(t.attempts, MAX_ATTEMPTS), lte(t.availableAt, new Date())))
        .orderBy(asc(t.id))
        .limit(limit);
      return rows.map(
        (r): EventEnvelope => ({
          id: r.id,
          type: r.type,
          version: r.version,
          occurredAt: toApiInstant(r.occurredAt),
          source: name,
          aggregateId: r.aggregateId,
          branchId: r.branchId,
          actorId: r.actorId,
          data: r.data,
        }),
      );
    },
    async markPublished(id) {
      await db.update(t).set({ publishedAt: new Date(), lastError: null }).where(eq(t.id, id));
    },
    async markFailed(id, error) {
      const [row] = await db.select({ attempts: t.attempts }).from(t).where(eq(t.id, id));
      const attempts = (row?.attempts ?? 0) + 1;
      await db
        .update(t)
        .set({
          attempts,
          availableAt: new Date(Date.now() + retryDelayMs(attempts)),
          lastError: error.slice(0, 2000),
        })
        .where(eq(t.id, id));
    },
  };
}
