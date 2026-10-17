import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { can, type Principal } from '../../../../platform/auth/principal.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { FileStorage } from '../../../../integrations/storage.js';
import { LMS_EVENTS, type AssignmentGradedV1 } from '../../../../contracts/events/lms.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { LmsDb } from '../../db/types.js';
import { assignments, classes, classLearners, learners, levels, materials, outboxEvents, processedEvents, sessions, submissions } from '../../db/schema.js';
import { classVisibility } from '../../access.js';

const eventTables = { outboxEvents, processedEvents };
type AssignmentRow = typeof assignments.$inferSelect;
type File = { buffer: Buffer; name: string; mimeType: string };

export function createAssignmentsService(db: LmsDb, core: CoreContract, storage: FileStorage) {
  async function visibleClass(actor: Principal, classId: string) {
    const [c] = await db.select().from(classes).where(and(eq(classes.id, classId), classVisibility(actor)));
    if (!c) throw Errors.notFound('lớp học');
    return c;
  }

  async function getVisible(actor: Principal, id: string) {
    const [row] = await db
      .select({ a: assignments, c: classes })
      .from(assignments)
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .where(and(eq(assignments.id, id), classVisibility(actor)));
    if (!row) throw Errors.notFound('bài tập');
    return row;
  }

  async function toDtos(rows: Array<{ a: AssignmentRow; c: typeof classes.$inferSelect }>) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.a.id);
    const [stats, members] = await Promise.all([
      db
        .select({
          assignmentId: submissions.assignmentId,
          submitted: sql<number>`SUM(CASE WHEN ${submissions.status} = 'SUBMITTED' THEN 1 ELSE 0 END)`.mapWith(Number),
          graded: sql<number>`SUM(CASE WHEN ${submissions.status} = 'GRADED' THEN 1 ELSE 0 END)`.mapWith(Number),
          missing: sql<number>`SUM(CASE WHEN ${submissions.status} = 'MISSING' THEN 1 ELSE 0 END)`.mapWith(Number),
        })
        .from(submissions)
        .where(inArray(submissions.assignmentId, ids))
        .groupBy(submissions.assignmentId),
      db
        .select({ classId: classLearners.classId, n: count() })
        .from(classLearners)
        .where(and(inArray(classLearners.classId, [...new Set(rows.map((r) => r.c.id))]), eq(classLearners.status, 'ACTIVE')))
        .groupBy(classLearners.classId),
    ]);
    return rows.map(({ a, c }) => {
      const st = stats.find((s) => s.assignmentId === a.id);
      return {
        id: a.id,
        classId: c.id,
        classCode: c.code,
        className: c.name,
        sessionId: a.sessionId,
        title: a.title,
        description: a.description,
        dueAt: a.dueAt ? toApiInstant(a.dueAt) : null,
        maxScore: a.maxScore,
        attachments: a.attachments,
        learnerCount: members.find((m) => m.classId === c.id)?.n ?? 0,
        submittedCount: st?.submitted ?? 0,
        gradedCount: st?.graded ?? 0,
        missingCount: st?.missing ?? 0,
        createdAt: toApiInstant(a.createdAt),
      };
    });
  }

  return {
    async list(actor: Principal, q: { classId?: string; pendingGrading?: boolean }) {
      const rows = await db
        .select({ a: assignments, c: classes })
        .from(assignments)
        .innerJoin(classes, eq(classes.id, assignments.classId))
        .where(
          and(
            classVisibility(actor),
            q.classId ? eq(assignments.classId, q.classId) : undefined,
            q.pendingGrading
              ? inArray(assignments.id, sql`(SELECT ${submissions.assignmentId} FROM ${submissions} WHERE ${submissions.status} = 'SUBMITTED')`)
              : undefined,
          ),
        )
        .orderBy(desc(assignments.createdAt))
        .limit(300);
      return toDtos(rows);
    },

    /** Bài tập + bài nộp của từng học viên trong lớp. */
    async get(actor: Principal, id: string) {
      const row = await getVisible(actor, id);
      const [[dto], members, subs] = await Promise.all([
        toDtos([row]),
        db
          .select({ learner: learners, status: classLearners.status })
          .from(classLearners)
          .innerJoin(learners, eq(learners.id, classLearners.learnerId))
          .where(and(eq(classLearners.classId, row.c.id), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])))
          .orderBy(asc(learners.fullName)),
        db.select().from(submissions).where(eq(submissions.assignmentId, id)),
      ]);
      const graders = new Map((await core.users.getMany([...new Set(subs.map((s) => s.gradedBy).filter((x): x is string => !!x))])).map((u) => [u.id, u.fullName]));
      return {
        ...dto!,
        submissions: members.map(({ learner }) => {
          const s = subs.find((x) => x.learnerId === learner.id);
          return {
            learnerId: learner.id,
            code: learner.code,
            fullName: learner.fullName,
            status: s?.status ?? null,
            submittedAt: s?.submittedAt ? toApiInstant(s.submittedAt) : null,
            score: s?.score ?? null,
            comment: s?.comment ?? null,
            gradedByName: s?.gradedBy ? (graders.get(s.gradedBy) ?? null) : null,
          };
        }),
      };
    },

    async create(actor: Principal, classId: string, input: { title: string; description?: string | null; dueAt?: Date | null; maxScore: number; sessionId?: string | null }) {
      const c = await visibleClass(actor, classId);
      if (input.sessionId) {
        const [s] = await db.select({ classId: sessions.classId }).from(sessions).where(eq(sessions.id, input.sessionId));
        if (s?.classId !== classId) throw Errors.validation([{ path: 'body.sessionId', message: 'Buổi học không thuộc lớp' }]);
      }
      const id = newId();
      await db.insert(assignments).values({
        id,
        classId: c.id,
        sessionId: input.sessionId ?? null,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        maxScore: input.maxScore,
        attachments: [],
        createdBy: actor.userId,
      });
      return this.get(actor, id);
    },

    async update(actor: Principal, id: string, patch: { title?: string; description?: string | null; dueAt?: Date | null; maxScore?: number }) {
      const { a } = await getVisible(actor, id);
      if (patch.maxScore !== undefined) {
        const [over] = await db
          .select({ n: count() })
          .from(submissions)
          .where(and(eq(submissions.assignmentId, a.id), sql`${submissions.score} > ${patch.maxScore}`));
        if ((over?.n ?? 0) > 0) throw new AppError(422, 'MAX_SCORE_TOO_LOW', 'Đã có bài chấm điểm cao hơn thang điểm mới');
      }
      await db.update(assignments).set(patch).where(eq(assignments.id, id));
      return this.get(actor, id);
    },

    async remove(actor: Principal, id: string) {
      await getVisible(actor, id);
      const [graded] = await db.select({ n: count() }).from(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.status, 'GRADED')));
      if ((graded?.n ?? 0) > 0) throw Errors.conflict('ASSIGNMENT_GRADED', 'Bài tập đã có điểm — không xoá được');
      await db.transaction(async (tx) => {
        await tx.delete(submissions).where(eq(submissions.assignmentId, id));
        await tx.delete(assignments).where(eq(assignments.id, id));
      });
    },

    async addAttachment(actor: Principal, id: string, file: File) {
      const { a } = await getVisible(actor, id);
      if (a.attachments.length >= 10) throw new AppError(422, 'TOO_MANY_ATTACHMENTS', 'Tối đa 10 file đính kèm');
      const stored = await storage.save(file, `assignments/${id}`);
      await db
        .update(assignments)
        .set({ attachments: [...a.attachments, { name: stored.name, url: stored.url, mimeType: stored.mimeType, size: stored.size }] })
        .where(eq(assignments.id, id));
      return this.get(actor, id);
    },

    /**
     * Ghi nhận nộp bài / chấm điểm / đánh dấu không nộp cho nhiều học viên.
     * Học viên không tự đăng nhập — giáo viên nhập thay. Chấm điểm → phát lms.assignment.graded.
     */
    async grade(actor: Principal, id: string, items: Array<{ learnerId: string; status: 'SUBMITTED' | 'GRADED' | 'MISSING'; score?: number | null; comment?: string | null }>) {
      const { a, c } = await getVisible(actor, id);
      const members = new Set(
        (
          await db
            .select({ learnerId: classLearners.learnerId })
            .from(classLearners)
            .where(eq(classLearners.classId, c.id))
        ).map((m) => m.learnerId),
      );
      await db.transaction(async (tx) => {
        const now = new Date();
        for (const [i, it] of items.entries()) {
          if (!members.has(it.learnerId)) throw Errors.validation([{ path: `body.items.${i}.learnerId`, message: 'Học viên không thuộc lớp' }]);
          if (it.status === 'GRADED') {
            if (it.score == null) throw Errors.validation([{ path: `body.items.${i}.score`, message: 'Nhập điểm' }]);
            if (it.score > a.maxScore) throw Errors.validation([{ path: `body.items.${i}.score`, message: `Tối đa ${a.maxScore} điểm` }]);
          }
          const row = {
            status: it.status,
            submittedAt: it.status === 'MISSING' ? null : now,
            score: it.status === 'GRADED' ? (it.score ?? null) : null,
            comment: it.comment ?? null,
            gradedBy: it.status === 'GRADED' ? actor.userId : null,
            gradedAt: it.status === 'GRADED' ? now : null,
            updatedAt: now,
          };
          const [prev] = await tx.select().from(submissions).where(and(eq(submissions.assignmentId, id), eq(submissions.learnerId, it.learnerId)));
          await tx
            .insert(submissions)
            .values({ assignmentId: id, learnerId: it.learnerId, ...row, submittedAt: prev?.submittedAt ?? row.submittedAt })
            .onDuplicateKeyUpdate({ set: { ...row, submittedAt: prev?.submittedAt ?? row.submittedAt } });
          if (it.status === 'GRADED' && (prev?.status !== 'GRADED' || prev.score !== it.score)) {
            const data: AssignmentGradedV1 = { assignmentId: id, learnerId: it.learnerId, score: it.score ?? null, maxScore: a.maxScore };
            await appendEvent(tx, eventTables, { type: LMS_EVENTS.assignmentGraded, aggregateId: id, branchId: c.branchId, actorId: actor.userId, data });
          }
        }
      });
      return this.get(actor, id);
    },

    // ─────────── Học liệu

    /** Học liệu của cấp độ (dùng chung mọi lớp) + của lớp. */
    async listMaterials(actor: Principal, q: { levelId?: string; classId?: string }) {
      let levelId = q.levelId;
      if (q.classId) levelId = (await visibleClass(actor, q.classId)).levelId;
      const rows = await db
        .select({ m: materials, levelName: levels.name })
        .from(materials)
        .leftJoin(levels, eq(levels.id, materials.levelId))
        .where(
          q.classId
            ? or(eq(materials.classId, q.classId), and(eq(materials.levelId, levelId!), isNull(materials.classId)))
            : levelId
              ? eq(materials.levelId, levelId)
              : undefined,
        )
        .orderBy(desc(materials.createdAt))
        .limit(500);
      // Học liệu riêng của lớp ngoài phạm vi thì ẩn.
      const classIds = [...new Set(rows.map((r) => r.m.classId).filter((x): x is string => !!x))];
      const visible = new Set(
        classIds.length ? (await db.select({ id: classes.id }).from(classes).where(and(inArray(classes.id, classIds), classVisibility(actor)))).map((c) => c.id) : [],
      );
      const uploaders = new Map((await core.users.getMany([...new Set(rows.map((r) => r.m.uploadedBy))])).map((u) => [u.id, u.fullName]));
      return rows
        .filter((r) => !r.m.classId || visible.has(r.m.classId))
        .map(({ m, levelName }) => ({
          id: m.id,
          levelId: m.levelId,
          levelName,
          classId: m.classId,
          title: m.title,
          description: m.description,
          url: m.url,
          fileName: m.fileName,
          mimeType: m.mimeType,
          size: m.size,
          uploadedByName: uploaders.get(m.uploadedBy) ?? null,
          createdAt: toApiInstant(m.createdAt),
        }));
    },

    async uploadMaterial(actor: Principal, input: { title: string; description?: string | null; levelId?: string | null; classId?: string | null }, file: File) {
      if (!input.levelId && !input.classId) throw Errors.validation([{ path: 'body.levelId', message: 'Chọn cấp độ hoặc lớp' }]);
      let levelId = input.levelId ?? null;
      if (input.classId) levelId = (await visibleClass(actor, input.classId)).levelId;
      else {
        const [l] = await db.select({ id: levels.id }).from(levels).where(eq(levels.id, levelId!));
        if (!l) throw Errors.validation([{ path: 'body.levelId', message: 'Cấp độ không tồn tại' }]);
      }
      const stored = await storage.save(file, `materials/${levelId}`);
      const id = newId();
      await db.insert(materials).values({
        id,
        levelId,
        classId: input.classId ?? null,
        title: input.title,
        description: input.description ?? null,
        url: stored.url,
        fileName: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        uploadedBy: actor.userId,
        createdAt: new Date(),
      });
      return id;
    },

    async removeMaterial(actor: Principal, id: string) {
      const [m] = await db.select().from(materials).where(eq(materials.id, id));
      if (!m) throw Errors.notFound('học liệu');
      if (m.uploadedBy !== actor.userId && !['ADMIN', 'TL', 'CM'].includes(actor.role) && !can(actor, 'lms.curriculum.manage')) {
        throw Errors.forbidden('Chỉ người tải lên hoặc TL / CM được xoá');
      }
      if (m.classId) await visibleClass(actor, m.classId);
      await db.delete(materials).where(eq(materials.id, id));
    },
  };
}

export type AssignmentsService = ReturnType<typeof createAssignmentsService>;
