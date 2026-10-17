import { sql } from 'drizzle-orm';
import type { CoreExecutor } from '../../db/types.js';

/**
 * Toàn bộ cấp dưới (mọi tầng) của một người. UNION (không ALL) tự dừng nếu dữ liệu lỡ có vòng lặp.
 * MariaDB ≥ 10.2 / MySQL 8 hỗ trợ CTE đệ quy.
 */
export async function subordinateIds(db: CoreExecutor, userId: string): Promise<string[]> {
  const [rows] = (await db.execute(sql`
    WITH RECURSIVE sub (id) AS (
      SELECT id FROM users WHERE manager_id = ${userId}
      UNION
      SELECT u.id FROM users u JOIN sub s ON u.manager_id = s.id
    )
    SELECT id FROM sub
  `)) as unknown as [Array<{ id: string }>];
  return rows.map((r) => r.id).filter((id) => id !== userId);
}
