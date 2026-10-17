import { asc, eq } from 'drizzle-orm';
import { runOnce } from '../../../../platform/events/run-once.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import { LMS_LEVEL_CHANGED, type LevelChangedV1 } from '../../../../contracts/events/lms.js';
import type { CrmDb } from '../../db/types.js';
import { catalogLevels, outboxEvents, processedEvents } from '../../db/schema.js';

const HANDLER = 'crm.catalog.levelProjection';

/** Giữ bản sao danh mục cấp độ của LMS trong zero1_crm. */
export function levelProjection(db: CrmDb): Subscription {
  return {
    name: HANDLER,
    type: LMS_LEVEL_CHANGED,
    async handle(event: EventEnvelope) {
      const data = event.data as LevelChangedV1;
      await runOnce(db, { outboxEvents, processedEvents }, event, HANDLER, async (tx) => {
        const [current] = await tx
          .select({ sourceEventId: catalogLevels.sourceEventId })
          .from(catalogLevels)
          .where(eq(catalogLevels.levelId, data.levelId))
          .for('update');
        // Ảnh chụp đầy đủ: chỉ cần giữ bản mới nhất theo thứ tự sự kiện.
        if (current && current.sourceEventId >= event.id) return;

        const row = {
          subjectId: data.subjectId,
          subjectCode: data.subjectCode,
          subjectName: data.subjectName,
          code: data.code,
          name: data.name,
          sessionsCount: data.sessionsCount,
          sessionMinutes: data.sessionMinutes,
          sortOrder: data.sortOrder,
          isActive: data.isActive,
          sourceEventId: event.id,
          syncedAt: new Date(),
        };
        await tx
          .insert(catalogLevels)
          .values({ levelId: data.levelId, ...row })
          .onDuplicateKeyUpdate({ set: row });
      });
    },
  };
}

/** Danh mục cấp độ CRM đang thấy (dùng khi tạo gói học phí — giai đoạn 3). */
export function createLevelCatalog(db: CrmDb) {
  return {
    async list(includeInactive: boolean) {
      return db
        .select()
        .from(catalogLevels)
        .where(includeInactive ? undefined : eq(catalogLevels.isActive, true))
        .orderBy(asc(catalogLevels.subjectName), asc(catalogLevels.sortOrder));
    },
    async get(levelId: string) {
      const [row] = await db.select().from(catalogLevels).where(eq(catalogLevels.levelId, levelId));
      return row;
    },
  };
}
