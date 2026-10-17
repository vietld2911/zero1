import { and, asc, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { Errors } from '../../../../platform/http/errors.js';
import type { ParentPrincipal } from '../../../../platform/auth/principal.js';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { toApiInstant } from '../../../../platform/time.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { LmsDb } from '../../db/types.js';
import { assignments, attendance, classes, classLearners, learners, levels, rooms, sessionFeedbacks, sessions, submissions } from '../../db/schema.js';

const DAY = 86_400_000;

/** Cổng phụ huynh (phần LMS): lớp, lịch sắp tới, điểm danh, nhận xét, bài tập của con. Chỉ đọc. */
export function createLmsParentPortal(db: LmsDb, core: CoreContract) {
  return {
    async learning(parent: ParentPrincipal, studentId: string) {
      if (!parent.studentIds.includes(studentId)) throw Errors.notFound('học viên');
      const [learner] = await db.select().from(learners).where(eq(learners.id, studentId));
      // Chưa đóng tiền / chưa sang LMS → chưa có dữ liệu học tập.
      if (!learner) return { enrolled: false, currentLevelName: null, classes: [], summary: null, upcoming: [], attendance: [], feedback: [], assignments: [] };

      const memberships = await db
        .select({ m: classLearners, c: classes })
        .from(classLearners)
        .innerJoin(classes, eq(classes.id, classLearners.classId))
        .where(and(eq(classLearners.learnerId, studentId), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])));
      const classIds = memberships.map((x) => x.c.id);
      const now = new Date();

      const [levelRow, upcoming, att, fb, subs, roomRows] = await Promise.all([
        learner.currentLevelId ? db.select({ name: levels.name }).from(levels).where(eq(levels.id, learner.currentLevelId)) : Promise.resolve([]),
        classIds.length
          ? db
              .select({ s: sessions, code: classes.code, name: classes.name })
              .from(sessions)
              .innerJoin(classes, eq(classes.id, sessions.classId))
              .where(and(inArray(sessions.classId, classIds), ne(sessions.status, 'CANCELLED'), gte(sessions.endsAt, now), lt(sessions.startsAt, new Date(now.getTime() + 14 * DAY))))
              .orderBy(asc(sessions.startsAt))
              .limit(20)
          : Promise.resolve([]),
        db
          .select({ a: attendance, startsAt: sessions.startsAt, indexNo: sessions.indexNo, topic: sessions.topic, code: classes.code })
          .from(attendance)
          .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
          .innerJoin(classes, eq(classes.id, sessions.classId))
          .where(and(eq(attendance.learnerId, studentId), eq(sessions.status, 'DONE')))
          .orderBy(desc(sessions.startsAt))
          .limit(30),
        db
          .select({ f: sessionFeedbacks, startsAt: sessions.startsAt, code: classes.code, topic: sessions.topic })
          .from(sessionFeedbacks)
          .innerJoin(sessions, eq(sessions.id, sessionFeedbacks.sessionId))
          .innerJoin(classes, eq(classes.id, sessions.classId))
          .where(eq(sessionFeedbacks.learnerId, studentId))
          .orderBy(desc(sessions.startsAt))
          .limit(20),
        classIds.length
          ? db
              .select({ asg: assignments, sub: submissions, code: classes.code })
              .from(assignments)
              .innerJoin(classes, eq(classes.id, assignments.classId))
              .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.learnerId, studentId)))
              .where(inArray(assignments.classId, classIds))
              .orderBy(desc(assignments.createdAt))
              .limit(20)
          : Promise.resolve([]),
        db.select({ id: rooms.id, name: rooms.name }).from(rooms),
      ]);

      const people = await core.users.getMany([...new Set([...memberships.map((x) => x.c.teacherId), ...fb.map((x) => x.f.authorId)])]);
      const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.fullName ?? null) : null);
      const roomOf = (id: string | null) => (id ? (roomRows.find((r) => r.id === id)?.name ?? null) : null);
      const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
      for (const x of att) counts[x.a.status]++;
      const total = att.length;

      return {
        enrolled: true,
        currentLevelName: levelRow[0]?.name ?? null,
        classes: memberships.map(({ m, c }) => ({
          classId: c.id,
          code: c.code,
          name: c.name,
          status: m.status,
          schedule: c.schedule,
          teacherName: nameOf(c.teacherId),
          roomName: roomOf(c.roomId),
        })),
        summary: { ...counts, total, attendanceRate: total ? Math.round(((counts.PRESENT + counts.LATE) / total) * 100) : null },
        upcoming: upcoming.map(({ s, code, name }) => ({
          sessionId: s.id,
          classCode: code,
          className: name,
          indexNo: s.indexNo,
          startsAt: toApiInstant(s.startsAt),
          endsAt: toApiInstant(s.endsAt),
          roomName: roomOf(s.roomId),
          topic: s.topic,
        })),
        attendance: att.map((x) => ({ classCode: x.code, indexNo: x.indexNo, startsAt: toApiInstant(x.startsAt), topic: x.topic, status: x.a.status, note: x.a.note })),
        feedback: fb.map((x) => ({ classCode: x.code, startsAt: toApiInstant(x.startsAt), topic: x.topic, ratings: x.f.ratings, comment: x.f.comment, teacherName: nameOf(x.f.authorId) })),
        assignments: subs.map(({ asg, sub, code }) => ({
          title: asg.title,
          classCode: code,
          dueAt: asg.dueAt ? toApiInstant(asg.dueAt) : null,
          maxScore: asg.maxScore,
          status: sub?.status ?? null,
          score: sub?.status === 'GRADED' ? sub.score : null,
          comment: sub?.comment ?? null,
        })),
      };
    },
  };
}

const Slot = z.object({ weekday: z.number().int(), startTime: z.string(), minutes: z.number().int() });
const LearningSchema = z
  .object({
    enrolled: z.boolean().openapi({ description: 'false = chưa đóng tiền / chưa có dữ liệu học tập' }),
    currentLevelName: z.string().nullable(),
    classes: z.array(
      z.object({
        classId: z.string(),
        code: z.string(),
        name: z.string(),
        status: z.string(),
        schedule: z.array(Slot).openapi({ description: 'weekday 1 = Thứ 2 … 7 = Chủ nhật' }),
        teacherName: z.string().nullable(),
        roomName: z.string().nullable(),
      }),
    ),
    summary: z
      .object({
        PRESENT: z.number().int(),
        LATE: z.number().int(),
        ABSENT: z.number().int(),
        EXCUSED: z.number().int(),
        total: z.number().int(),
        attendanceRate: z.number().int().nullable(),
      })
      .nullable()
      .openapi({ description: '30 buổi gần nhất' }),
    upcoming: z.array(
      z.object({
        sessionId: z.string(),
        classCode: z.string(),
        className: z.string(),
        indexNo: z.number().int(),
        startsAt: z.string(),
        endsAt: z.string(),
        roomName: z.string().nullable(),
        topic: z.string().nullable(),
      }),
    ),
    attendance: z.array(
      z.object({
        classCode: z.string(),
        indexNo: z.number().int(),
        startsAt: z.string(),
        topic: z.string().nullable(),
        status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']),
        note: z.string().nullable(),
      }),
    ),
    feedback: z.array(
      z.object({
        classCode: z.string(),
        startsAt: z.string(),
        topic: z.string().nullable(),
        ratings: z.record(z.string(), z.number()),
        comment: z.string(),
        teacherName: z.string().nullable(),
      }),
    ),
    assignments: z.array(
      z.object({
        title: z.string(),
        classCode: z.string(),
        dueAt: z.string().nullable(),
        maxScore: z.number().int(),
        status: z.enum(['SUBMITTED', 'GRADED', 'MISSING']).nullable(),
        score: z.number().int().nullable(),
        comment: z.string().nullable(),
      }),
    ),
  })
  .openapi('ParentLearning');

export function registerLmsParentRoutes(route: RouteRegistrar, portal: ReturnType<typeof createLmsParentPortal>) {
  route({
    method: 'get',
    path: '/parent/children/:id/learning',
    tags: ['parent'],
    summary: 'Học tập của con: lớp, lịch 14 ngày tới, điểm danh, nhận xét, bài tập',
    access: { parent: true },
    request: { params: IdParams },
    responses: { 200: { description: 'Học tập', schema: item(LearningSchema) } },
    handler: async ({ parent, params }) => ({ data: await portal.learning(parent, params.id) }),
  });
}
