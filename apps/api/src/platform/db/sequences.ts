import { eq, sql } from 'drizzle-orm';
import { int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';

/** Bộ đếm theo tên (mỗi database một bảng) — sinh mã dễ đọc như HV26-00001. */
export function defineSequenceTable() {
  return mysqlTable('sequences', {
    name: varchar('name', { length: 50 }).primaryKey(),
    value: int('value').notNull(),
  });
}

export type SequenceTable = ReturnType<typeof defineSequenceTable>;
type Executor = Pick<MySql2Database<Record<string, unknown>>, 'insert' | 'select'>;

/**
 * Lấy số tiếp theo của bộ đếm. PHẢI gọi trong transaction: dòng bộ đếm bị khoá
 * tới khi commit nên hai giao dịch đồng thời không nhận trùng số.
 */
export async function nextSequence(tx: Executor, table: SequenceTable, name: string): Promise<number> {
  // INSERT … ON DUPLICATE KEY UPDATE value = value + 1 vừa tạo vừa tăng, và giữ khoá dòng.
  await tx
    .insert(table)
    .values({ name, value: 1 })
    .onDuplicateKeyUpdate({ set: { value: sql`${table.value} + 1` } });
  const [row] = await tx.select({ value: table.value }).from(table).where(eq(table.name, name));
  return row!.value;
}

/** HV + năm (2 số) + số thứ tự 5 chữ số, ví dụ HV26-00042. */
export function yearCode(prefix: string, n: number, date = new Date()) {
  const yy = String(new Date(date.getTime() + 7 * 3_600_000).getUTCFullYear()).slice(2);
  return `${prefix}${yy}-${String(n).padStart(5, '0')}`;
}
