import { and, asc, count, desc, eq, inArray, like, notExists, or, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { csvList, likeContains, pageMeta, pageOffset } from '../../../../platform/http/list.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { runOnce } from '../../../../platform/events/run-once.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import { toApiInstant } from '../../../../platform/time.js';
import {
  CRM_EVENTS,
  type EnrollmentActivatedV1,
  type EnrollmentAdjustedV1,
  type EnrollmentCancelledV1,
  type StudentStatusChangedV1,
  type StudentUpdatedV1,
} from '../../../../contracts/events/crm.js';
import { LMS_EVENTS, type LearnerPromotedV1 } from '../../../../contracts/events/lms.js';
import type { LmsDb } from '../../db/types.js';
import {
  assignments,
  attendance,
  classes,
  classLearners,
  learnerEntitlements,
  learnerLevelHistory,
  learners,
  levels,
  outboxEvents,
  processedEvents,
  sessionFeedbacks,
  sessions,
  subjects,
  submissions,
} from '../../db/schema.js';
import { learnerVisibility } from '../../access.js';
import type { NotificationSender } from '../../../core/contract/index.js';

const eventTables = { outboxEvents, processedEvents };
type LearnerRow = typeof learners.$inferSelect;

export function createLearnersService(db: LmsDb, notifications?: NotificationSender) {
  async function toDtos(rows: LearnerRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [ents, memberships, levelRows] = await Promise.all([
      db.select().from(learnerEntitlements).where(and(inArray(learnerEntitlements.learnerId, ids), eq(learnerEntitlements.status, 'ACTIVE'))),
      db
        .select({ learnerId: classLearners.learnerId, classId: classes.id, code: classes.code, name: classes.name, status: classLearners.status })
        .from(classLearners)
        .innerJoin(classes, eq(classes.id, classLearners.classId))
        .where(and(inArray(classLearners.learnerId, ids), inArray(classLearners.status, ['ACTIVE', 'PAUSED']))),
      db.select({ id: levels.id, name: levels.name }).from(levels),
    ]);
    const levelName = new Map(levelRows.map((l) => [l.id, l.name]));
    return rows.map((l) => ({
      id: l.id,
      code: l.code,
      branchId: l.branchId,
      fullName: l.fullName,
      birthDate: l.birthDate,
      gender: l.gender,
      avatarUrl: l.avatarUrl,
      status: l.status,
      currentLevelId: l.currentLevelId,
      currentLevelName: l.currentLevelId ? (levelName.get(l.currentLevelId) ?? null) : null,
      classes: memberships.filter((m) => m.learnerId === l.id).map(({ learnerId: _l, ...m }) => m),
      sessionsRemaining: ents.filter((e) => e.learnerId === l.id).reduce((s, e) => s + Math.max(0, e.sessionsPurchased - e.sessionsUsed), 0),
    }));
  }

  async function getVisible(actor: Principal, id: string) {
    const [row] = await db.select().from(learners).where(and(eq(learners.id, id), learnerVisibility(actor)));
    if (!row) throw Errors.notFound('học viên');
    return row;
  }

  // ─────────── Sự kiện từ CRM

  function on<T>(name: string, type: string, fn: (tx: Parameters<Parameters<LmsDb['transaction']>[0]>[0], data: T, event: EventEnvelope) => Promise<void>): Subscription {
    return {
      name,
      type,
      async handle(event) {
        await runOnce(db, eventTables, event, name, (tx) => fn(tx, event.data as T, event));
      },
    };
  }

  /** Đăng ký được kích hoạt bên CRM → tạo / cập nhật học viên + quyền học. */
  async function activatedTx(tx: Parameters<Parameters<LmsDb['transaction']>[0]>[0], d: EnrollmentActivatedV1) {
    const snapshot = { code: d.studentCode, branchId: d.branchId, ...d.student };
    await tx
      .insert(learners)
      .values({ id: d.studentId, ...snapshot, currentLevelId: d.startLevelId })
      .onDuplicateKeyUpdate({ set: { ...snapshot, status: 'ACTIVE' } });
    await tx
      .insert(learnerEntitlements)
      .values({
        enrollmentId: d.enrollmentId,
        enrollmentCode: d.enrollmentCode,
        learnerId: d.studentId,
        branchId: d.branchId,
        subjectId: d.subjectId,
        startLevelId: d.startLevelId,
        sessionsPurchased: d.sessionsPurchased,
        activatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({ set: { sessionsPurchased: d.sessionsPurchased } });
  }

  const subscriptions: Subscription[] = [
    {
      name: 'lms.learners.onEnrollmentActivated',
      type: CRM_EVENTS.enrollmentActivated,
      // Học viên vừa đóng tiền → báo người xếp lớp của chi nhánh (sau khi ghi xong, chỉ lần đầu).
      async handle(event) {
        const handled = await runOnce(db, eventTables, event, 'lms.learners.onEnrollmentActivated', async (tx) => {
          await activatedTx(tx, event.data as EnrollmentActivatedV1);
        });
        const d = event.data as EnrollmentActivatedV1;
        if (handled === 'processed' && notifications) {
          await notifications.sendToRoles(
            { branchId: d.branchId, roles: ['CM', 'CS', 'TL'] },
            {
              type: 'lms.learner.waiting',
              app: 'lms',
              title: d.type === 'RENEWAL' ? 'Học viên tái phí chờ xếp lớp' : 'Học viên mới chờ xếp lớp',
              body: `${d.student.fullName} · ${d.studentCode}`,
              link: '/placement',
            },
          );
        }
      },
    },

    on<EnrollmentAdjustedV1>('lms.learners.onEnrollmentAdjusted', CRM_EVENTS.enrollmentAdjusted, async (tx, d) => {
      const [e] = await tx.select().from(learnerEntitlements).where(eq(learnerEntitlements.enrollmentId, d.enrollmentId)).for('update');
      if (!e) return;
      const status = e.status === 'LOCKED' ? 'LOCKED' : e.sessionsUsed >= d.sessionsPurchased ? 'EXHAUSTED' : 'ACTIVE';
      await tx.update(learnerEntitlements).set({ sessionsPurchased: d.sessionsPurchased, status }).where(eq(learnerEntitlements.enrollmentId, d.enrollmentId));
    }),

    on<EnrollmentCancelledV1>('lms.learners.onEnrollmentCancelled', CRM_EVENTS.enrollmentCancelled, async (tx, d) => {
      await tx.update(learnerEntitlements).set({ status: 'LOCKED' }).where(eq(learnerEntitlements.enrollmentId, d.enrollmentId));
      await tx
        .update(classLearners)
        .set({ status: 'LEFT', leftAt: new Date(), leftReason: `Đăng ký bị huỷ: ${d.reason}`.slice(0, 300) })
        .where(and(eq(classLearners.enrollmentId, d.enrollmentId), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])));
    }),

    on<StudentUpdatedV1>('lms.learners.onStudentUpdated', CRM_EVENTS.studentUpdated, async (tx, d) => {
      await tx
        .update(learners)
        .set({ fullName: d.fullName, birthDate: d.birthDate, gender: d.gender, avatarUrl: d.avatarUrl, branchId: d.branchId })
        .where(eq(learners.id, d.studentId));
    }),

    /** Bảo lưu → tạm dừng trong lớp; nghỉ → rời lớp; học lại → trở lại lớp đang tạm dừng. */
    on<StudentStatusChangedV1>('lms.learners.onStudentStatusChanged', CRM_EVENTS.studentStatusChanged, async (tx, d) => {
      if (d.to === 'PENDING') return;
      await tx.update(learners).set({ status: d.to }).where(eq(learners.id, d.studentId));
      if (d.to === 'PAUSED') {
        await tx.update(classLearners).set({ status: 'PAUSED' }).where(and(eq(classLearners.learnerId, d.studentId), eq(classLearners.status, 'ACTIVE')));
      } else if (d.to === 'STOPPED') {
        await tx
          .update(classLearners)
          .set({ status: 'LEFT', leftAt: new Date(), leftReason: `Nghỉ học${d.reason ? `: ${d.reason}` : ''}`.slice(0, 300) })
          .where(and(eq(classLearners.learnerId, d.studentId), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])));
      } else if (d.to === 'ACTIVE') {
        await tx.update(classLearners).set({ status: 'ACTIVE' }).where(and(eq(classLearners.learnerId, d.studentId), eq(classLearners.status, 'PAUSED')));
      }
    }),
  ];

  return {
    toDtos,
    getVisible,
    subscriptions,

    async list(actor: Principal, q: { page: number; pageSize: number; q?: string; status?: string; branchId?: string; classId?: string }) {
      const statuses = csvList(q.status) as Array<LearnerRow['status']> | undefined;
      const where = and(
        learnerVisibility(actor),
        q.q ? or(like(learners.fullName, likeContains(q.q)), like(learners.code, likeContains(q.q))) : undefined,
        statuses ? inArray(learners.status, statuses) : undefined,
        q.branchId ? eq(learners.branchId, q.branchId) : undefined,
        q.classId
          ? inArray(
              learners.id,
              sql`(SELECT ${classLearners.learnerId} FROM ${classLearners} WHERE ${and(eq(classLearners.classId, q.classId), inArray(classLearners.status, ['ACTIVE', 'PAUSED']))})`,
            )
          : undefined,
      );
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db.select().from(learners).where(where).orderBy(asc(learners.fullName)).limit(limit).offset(offset),
        db.select({ n: count() }).from(learners).where(where),
      ]);
      return { data: await toDtos(rows), meta: pageMeta(q.page, q.pageSize, total?.n ?? 0) };
    },

    /** Hồ sơ học tập: quyền học, lớp, điểm danh, điểm bài tập, nhận xét, lịch sử lên lớp. */
    async get(actor: Principal, id: string) {
      const row = await getVisible(actor, id);
      const [[dto], ents, memberships, att, grades, feedback, history, levelRows] = await Promise.all([
        toDtos([row]),
        db.select().from(learnerEntitlements).where(eq(learnerEntitlements.learnerId, id)).orderBy(desc(learnerEntitlements.activatedAt)),
        db
          .select({ m: classLearners, code: classes.code, name: classes.name })
          .from(classLearners)
          .innerJoin(classes, eq(classes.id, classLearners.classId))
          .where(eq(classLearners.learnerId, id))
          .orderBy(desc(classLearners.joinedAt)),
        db
          .select({ a: attendance, startsAt: sessions.startsAt, indexNo: sessions.indexNo, classCode: classes.code })
          .from(attendance)
          .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
          .innerJoin(classes, eq(classes.id, sessions.classId))
          .where(eq(attendance.learnerId, id))
          .orderBy(desc(sessions.startsAt))
          .limit(60),
        db
          .select({ s: submissions, title: assignments.title, maxScore: assignments.maxScore, classCode: classes.code })
          .from(submissions)
          .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
          .innerJoin(classes, eq(classes.id, assignments.classId))
          .where(eq(submissions.learnerId, id))
          .orderBy(desc(submissions.updatedAt))
          .limit(30),
        db
          .select({ f: sessionFeedbacks, startsAt: sessions.startsAt, classCode: classes.code })
          .from(sessionFeedbacks)
          .innerJoin(sessions, eq(sessions.id, sessionFeedbacks.sessionId))
          .innerJoin(classes, eq(classes.id, sessions.classId))
          .where(eq(sessionFeedbacks.learnerId, id))
          .orderBy(desc(sessions.startsAt))
          .limit(20),
        db.select().from(learnerLevelHistory).where(eq(learnerLevelHistory.learnerId, id)).orderBy(desc(learnerLevelHistory.createdAt)),
        db.select({ id: levels.id, name: levels.name }).from(levels),
      ]);
      const levelName = new Map(levelRows.map((l) => [l.id, l.name]));
      const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
      for (const r of att) counts[r.a.status]++;
      return {
        ...dto!,
        entitlements: ents.map((e) => ({
          enrollmentId: e.enrollmentId,
          enrollmentCode: e.enrollmentCode,
          subjectId: e.subjectId,
          startLevelId: e.startLevelId,
          startLevelName: levelName.get(e.startLevelId) ?? null,
          sessionsPurchased: e.sessionsPurchased,
          sessionsUsed: e.sessionsUsed,
          status: e.status,
          activatedAt: toApiInstant(e.activatedAt),
        })),
        memberships: memberships.map(({ m, code, name }) => ({
          id: m.id,
          classId: m.classId,
          classCode: code,
          className: name,
          status: m.status,
          joinedAt: toApiInstant(m.joinedAt),
          leftAt: m.leftAt ? toApiInstant(m.leftAt) : null,
          leftReason: m.leftReason,
        })),
        attendanceSummary: { ...counts, total: att.length },
        attendance: att.map(({ a, startsAt, indexNo, classCode }) => ({
          sessionId: a.sessionId,
          classCode,
          indexNo,
          startsAt: toApiInstant(startsAt),
          status: a.status,
          note: a.note,
        })),
        grades: grades.map(({ s, title, maxScore, classCode }) => ({
          assignmentId: s.assignmentId,
          title,
          classCode,
          status: s.status,
          score: s.score,
          maxScore,
          comment: s.comment,
        })),
        feedback: feedback.map(({ f, startsAt, classCode }) => ({
          sessionId: f.sessionId,
          classCode,
          startsAt: toApiInstant(startsAt),
          ratings: f.ratings,
          comment: f.comment,
        })),
        levelHistory: history.map((h) => ({
          fromLevelName: h.fromLevelId ? (levelName.get(h.fromLevelId) ?? null) : null,
          toLevelName: levelName.get(h.toLevelId) ?? null,
          note: h.note,
          createdAt: toApiInstant(h.createdAt),
        })),
      };
    },

    /** Học viên đã đóng tiền (quyền học còn hiệu lực) nhưng chưa có lớp của môn đó. */
    async waiting(actor: Principal, branchId?: string) {
      const rows = await db
        .select({ e: learnerEntitlements, learner: learners, subjectName: subjects.name, levelName: levels.name })
        .from(learnerEntitlements)
        .innerJoin(learners, eq(learners.id, learnerEntitlements.learnerId))
        .innerJoin(subjects, eq(subjects.id, learnerEntitlements.subjectId))
        .innerJoin(levels, eq(levels.id, learnerEntitlements.startLevelId))
        .where(
          and(
            eq(learnerEntitlements.status, 'ACTIVE'),
            eq(learners.status, 'ACTIVE'),
            learnerVisibility(actor),
            branchId ? eq(learnerEntitlements.branchId, branchId) : undefined,
            notExists(
              db
                .select({ x: sql`1` })
                .from(classLearners)
                .innerJoin(classes, eq(classes.id, classLearners.classId))
                .where(
                  and(
                    eq(classLearners.learnerId, learnerEntitlements.learnerId),
                    eq(classes.subjectId, learnerEntitlements.subjectId),
                    inArray(classLearners.status, ['ACTIVE', 'PAUSED']),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(learnerEntitlements.activatedAt));
      return rows.map(({ e, learner, subjectName, levelName }) => ({
        learnerId: learner.id,
        learnerCode: learner.code,
        fullName: learner.fullName,
        birthDate: learner.birthDate,
        branchId: e.branchId,
        enrollmentId: e.enrollmentId,
        enrollmentCode: e.enrollmentCode,
        subjectId: e.subjectId,
        subjectName,
        startLevelId: e.startLevelId,
        startLevelName: levelName,
        sessionsRemaining: e.sessionsPurchased - e.sessionsUsed,
        waitingSince: toApiInstant(e.activatedAt),
      }));
    },

    /** Lên cấp độ (cùng môn). */
    async promote(actor: Principal, id: string, toLevelId: string, note?: string | null) {
      const learner = await getVisible(actor, id);
      await db.transaction(async (tx) => {
        const [to] = await tx.select().from(levels).where(eq(levels.id, toLevelId));
        if (!to || !to.isActive) throw Errors.validation([{ path: 'body.toLevelId', message: 'Cấp độ không tồn tại hoặc đã ngừng' }]);
        if (learner.currentLevelId) {
          const [from] = await tx.select().from(levels).where(eq(levels.id, learner.currentLevelId));
          if (from && from.subjectId !== to.subjectId) throw new AppError(422, 'LEVEL_SUBJECT_MISMATCH', 'Cấp độ mới phải cùng môn');
          if (from?.id === to.id) throw new AppError(422, 'SAME_LEVEL', 'Học viên đang ở cấp độ này');
        }
        await tx.update(learners).set({ currentLevelId: toLevelId }).where(eq(learners.id, id));
        await tx.insert(learnerLevelHistory).values({
          id: newId(),
          learnerId: id,
          fromLevelId: learner.currentLevelId,
          toLevelId,
          note: note ?? null,
          promotedBy: actor.userId,
          createdAt: new Date(),
        });
        const data: LearnerPromotedV1 = { learnerId: id, fromLevelId: learner.currentLevelId, toLevelId, toLevelName: to.name };
        await appendEvent(tx, eventTables, { type: LMS_EVENTS.learnerPromoted, aggregateId: id, branchId: learner.branchId, actorId: actor.userId, data });
      });
      return this.get(actor, id);
    },
  };
}

export type LearnersService = ReturnType<typeof createLearnersService>;
