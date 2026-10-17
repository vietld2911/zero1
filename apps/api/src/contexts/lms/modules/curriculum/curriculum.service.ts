import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { Errors } from '../../../../platform/http/errors.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import { LMS_LEVEL_CHANGED, type LevelChangedV1 } from '../../../../contracts/events/lms.js';
import type { LmsDb, LmsExecutor } from '../../db/types.js';
import { levels, outboxEvents, processedEvents, subjects } from '../../db/schema.js';

const eventTables = { outboxEvents, processedEvents };

type SubjectRow = typeof subjects.$inferSelect;
type LevelRow = typeof levels.$inferSelect;

export interface SubjectInput {
  code: string;
  name: string;
  description?: string | null;
}

export interface LevelInput {
  code: string;
  name: string;
  description?: string | null;
  sessionsCount: number;
  sessionMinutes: number;
}

function levelDto(l: LevelRow) {
  return {
    id: l.id,
    subjectId: l.subjectId,
    code: l.code,
    name: l.name,
    description: l.description,
    sessionsCount: l.sessionsCount,
    sessionMinutes: l.sessionMinutes,
    sortOrder: l.sortOrder,
    isActive: l.isActive,
  };
}

/** Phát ảnh chụp các cấp độ (của một môn, hoặc chỉ một số cấp độ) — gọi trong transaction. */
async function publishLevels(tx: LmsExecutor, actorId: string, subject: SubjectRow, only?: string[]) {
  const rows = await tx
    .select()
    .from(levels)
    .where(and(eq(levels.subjectId, subject.id), only ? inArray(levels.id, only) : undefined));
  for (const l of rows) {
    const data: LevelChangedV1 = {
      levelId: l.id,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      code: l.code,
      name: l.name,
      sessionsCount: l.sessionsCount,
      sessionMinutes: l.sessionMinutes,
      sortOrder: l.sortOrder,
      isActive: l.isActive && subject.isActive,
    };
    await appendEvent(tx, eventTables, { type: LMS_LEVEL_CHANGED, aggregateId: l.id, actorId, data });
  }
}

export function createCurriculumService(db: LmsDb) {
  async function getSubjectRow(id: string, exec: LmsExecutor = db) {
    const [row] = await exec.select().from(subjects).where(eq(subjects.id, id));
    if (!row) throw Errors.notFound('môn học');
    return row;
  }

  async function assertSubjectCodeFree(code: string, exceptId: string | null, exec: LmsExecutor) {
    const [taken] = await exec.select({ id: subjects.id }).from(subjects).where(eq(subjects.code, code));
    if (taken && taken.id !== exceptId) throw Errors.conflict('SUBJECT_CODE_TAKEN', 'Mã môn học đã tồn tại');
  }

  async function assertLevelCodeFree(subjectId: string, code: string, exceptId: string | null, exec: LmsExecutor) {
    const [taken] = await exec
      .select({ id: levels.id })
      .from(levels)
      .where(and(eq(levels.subjectId, subjectId), eq(levels.code, code)));
    if (taken && taken.id !== exceptId) throw Errors.conflict('LEVEL_CODE_TAKEN', 'Mã cấp độ đã tồn tại trong môn này');
  }

  return {
    /** Toàn bộ chương trình (ít dữ liệu) — môn kèm cấp độ theo thứ tự lên lớp. */
    async list(includeInactive: boolean) {
      const [subjectRows, levelRows] = await Promise.all([
        db
          .select()
          .from(subjects)
          .where(includeInactive ? undefined : eq(subjects.isActive, true))
          .orderBy(asc(subjects.sortOrder), asc(subjects.name)),
        db
          .select()
          .from(levels)
          .where(includeInactive ? undefined : eq(levels.isActive, true))
          .orderBy(asc(levels.sortOrder), asc(levels.code)),
      ]);
      return subjectRows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        description: s.description,
        sortOrder: s.sortOrder,
        isActive: s.isActive,
        levels: levelRows.filter((l) => l.subjectId === s.id).map(levelDto),
      }));
    },

    async createSubject(_actor: Principal, input: SubjectInput) {
      const id = newId();
      await db.transaction(async (tx) => {
        await assertSubjectCodeFree(input.code, null, tx);
        const [last] = await tx.select({ m: max(subjects.sortOrder) }).from(subjects);
        await tx.insert(subjects).values({ id, ...input, description: input.description ?? null, sortOrder: (last?.m ?? 0) + 1 });
      });
      return id;
    },

    async updateSubject(actor: Principal, id: string, patch: Partial<SubjectInput> & { isActive?: boolean }) {
      await db.transaction(async (tx) => {
        const current = await getSubjectRow(id, tx);
        if (patch.code && patch.code !== current.code) await assertSubjectCodeFree(patch.code, id, tx);
        await tx.update(subjects).set(patch).where(eq(subjects.id, id));
        // Đổi tên / mã / trạng thái môn → ảnh chụp của mọi cấp độ trong môn đều đổi.
        if (patch.code !== undefined || patch.name !== undefined || patch.isActive !== undefined) {
          await publishLevels(tx, actor.userId, await getSubjectRow(id, tx));
        }
      });
    },

    async createLevel(actor: Principal, subjectId: string, input: LevelInput) {
      const id = newId();
      await db.transaction(async (tx) => {
        const subject = await getSubjectRow(subjectId, tx);
        await assertLevelCodeFree(subjectId, input.code, null, tx);
        const [last] = await tx.select({ m: max(levels.sortOrder) }).from(levels).where(eq(levels.subjectId, subjectId));
        await tx.insert(levels).values({ id, subjectId, ...input, description: input.description ?? null, sortOrder: (last?.m ?? 0) + 1 });
        await publishLevels(tx, actor.userId, subject, [id]);
      });
      return id;
    },

    async updateLevel(actor: Principal, id: string, patch: Partial<LevelInput> & { isActive?: boolean }) {
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(levels).where(eq(levels.id, id));
        if (!current) throw Errors.notFound('cấp độ');
        if (patch.code && patch.code !== current.code) await assertLevelCodeFree(current.subjectId, patch.code, id, tx);
        await tx.update(levels).set(patch).where(eq(levels.id, id));
        await publishLevels(tx, actor.userId, await getSubjectRow(current.subjectId, tx), [id]);
      });
    },

    /** Sắp lại thứ tự lên lớp: gửi đủ mọi cấp độ của môn theo thứ tự mới. */
    async reorderLevels(actor: Principal, subjectId: string, levelIds: string[]) {
      await db.transaction(async (tx) => {
        const subject = await getSubjectRow(subjectId, tx);
        const existing = (await tx.select({ id: levels.id }).from(levels).where(eq(levels.subjectId, subjectId))).map((l) => l.id);
        const sameSet = existing.length === levelIds.length && new Set(levelIds).size === levelIds.length && levelIds.every((x) => existing.includes(x));
        if (!sameSet) {
          throw Errors.validation([{ path: 'body.levelIds', message: 'Phải gửi đủ và đúng các cấp độ của môn học' }]);
        }
        for (const [i, levelId] of levelIds.entries()) {
          await tx.update(levels).set({ sortOrder: i + 1 }).where(eq(levels.id, levelId));
        }
        await publishLevels(tx, actor.userId, subject);
      });
    },

    async getLevel(id: string) {
      const [row] = await db.select().from(levels).where(eq(levels.id, id));
      if (!row) throw Errors.notFound('cấp độ');
      return levelDto(row);
    },
  };
}

export type CurriculumService = ReturnType<typeof createCurriculumService>;
