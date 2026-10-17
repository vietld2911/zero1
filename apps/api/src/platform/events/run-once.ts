import type { MySql2Database } from 'drizzle-orm/mysql2';
import { isDuplicateKey } from '../db/errors.js';
import type { EventTables } from './tables.js';
import type { EventEnvelope } from './types.js';

type TxOf<TDb extends MySql2Database<Record<string, unknown>>> = Parameters<Parameters<TDb['transaction']>[0]>[0];

/**
 * Chạy handler đúng một lần cho mỗi (sự kiện, handler), trong transaction của database bên nhận.
 * Đánh dấu và thay đổi dữ liệu cùng commit, nên gửi lại sự kiện không gây trùng.
 */
export async function runOnce<TSchema extends Record<string, unknown>, TDb extends MySql2Database<TSchema>>(
  db: TDb,
  tables: EventTables,
  event: EventEnvelope,
  handlerName: string,
  fn: (tx: TxOf<TDb>) => Promise<void>,
): Promise<'processed' | 'skipped'> {
  let skipped = false;
  await db.transaction(async (tx) => {
    try {
      await tx.insert(tables.processedEvents).values({
        eventId: event.id,
        handler: handlerName,
        processedAt: new Date(),
      });
    } catch (err) {
      // Chỉ bỏ qua khi chính dòng đánh dấu bị trùng; lỗi trùng khóa trong `fn` vẫn được ném ra.
      if (isDuplicateKey(err)) {
        skipped = true;
        return;
      }
      throw err;
    }
    await fn(tx as TxOf<TDb>);
  });
  return skipped ? 'skipped' : 'processed';
}
