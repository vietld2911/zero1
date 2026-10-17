import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AppError } from '../../../../platform/http/errors.js';
import { canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import type { Job } from '../../../../platform/jobs.js';
import { monthRange, shiftDate, toApiInstant, vnDayStart } from '../../../../platform/time.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { LmsDb } from '../../db/types.js';
import { assignments, attendance, classes, classLearners, sessionFeedbacks, sessions, submissions } from '../../db/schema.js';
import { classVisibility } from '../../access.js';
import { sessionHasRoster } from '../sessions/roster-sql.js';

const ATTENDED = new Set(['PRESENT', 'LATE']);
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 100) : null);

/**
 * Báo cáo học tập theo tháng: khối lượng giảng dạy từng GV / TA, chất lượng từng lớp
 * (tỉ lệ đi học, nhận xét, chấm bài). GV / TA chỉ thấy lớp mình dạy.
 */
export function createLmsReportsService(db: LmsDb, core: CoreContract) {
  return {
    async teaching(actor: Principal, q: { month: string; branchId?: string }) {
      if (q.branchId && !canAccessBranch(actor, q.branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
      const { from, to } = monthRange(q.month);
      const start = vnDayStart(from);
      const end = vnDayStart(shiftDate(to, 1));

      const rows = await db
        .select({
          s: sessions,
          c: { id: classes.id, code: classes.code, name: classes.name, teacherId: classes.teacherId, status: classes.status, branchId: classes.branchId },
          hasRoster: sql<number>`${sessionHasRoster}`.mapWith(Number),
        })
        .from(sessions)
        .innerJoin(classes, eq(classes.id, sessions.classId))
        .where(and(classVisibility(actor), q.branchId ? eq(sessions.branchId, q.branchId) : undefined, gte(sessions.startsAt, start), lt(sessions.startsAt, end)));
      const sessionIds = rows.map((r) => r.s.id);
      const classIds = [...new Set(rows.map((r) => r.c.id))];

      const [att, fb, members, asg] = await Promise.all([
        sessionIds.length ? db.select({ sessionId: attendance.sessionId, learnerId: attendance.learnerId, status: attendance.status }).from(attendance).where(inArray(attendance.sessionId, sessionIds)) : [],
        sessionIds.length ? db.select({ sessionId: sessionFeedbacks.sessionId, learnerId: sessionFeedbacks.learnerId }).from(sessionFeedbacks).where(inArray(sessionFeedbacks.sessionId, sessionIds)) : [],
        classIds.length
          ? db
              .select({ classId: classLearners.classId, n: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(classLearners)
              .where(and(inArray(classLearners.classId, classIds), eq(classLearners.status, 'ACTIVE')))
              .groupBy(classLearners.classId)
          : [],
        classIds.length
          ? db
              .select({
                classId: assignments.classId,
                assignments: sql<number>`COUNT(DISTINCT ${assignments.id})`.mapWith(Number),
                submitted: sql<number>`COALESCE(SUM(CASE WHEN ${submissions.status} IN ('SUBMITTED', 'GRADED') THEN 1 ELSE 0 END), 0)`.mapWith(Number),
                graded: sql<number>`COALESCE(SUM(CASE WHEN ${submissions.status} = 'GRADED' THEN 1 ELSE 0 END), 0)`.mapWith(Number),
              })
              .from(assignments)
              .leftJoin(submissions, eq(submissions.assignmentId, assignments.id))
              .where(and(inArray(assignments.classId, classIds), gte(assignments.createdAt, start), lt(assignments.createdAt, end)))
              .groupBy(assignments.classId)
          : [],
      ]);

      const now = Date.now();
      const minutes = (s: (typeof rows)[number]['s']) => Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
      const attOf = (sessionId: string) => att.filter((a) => a.sessionId === sessionId);
      const fbOf = (sessionId: string) => fb.filter((f) => f.sessionId === sessionId);

      // ── Theo giáo viên / trợ giảng
      const people = new Map<string, { sessions: number; substitute: number; minutes: number; assisted: number; overdue: number; present: number; feedback: number }>();
      const bump = (id: string) => {
        if (!people.has(id)) people.set(id, { sessions: 0, substitute: 0, minutes: 0, assisted: 0, overdue: 0, present: 0, feedback: 0 });
        return people.get(id)!;
      };
      // Quá hạn: đã qua giờ, chưa chốt, có học viên (buổi không ai học thì không có gì để chốt).
      const isOverdue = (r: (typeof rows)[number]) => r.s.status === 'SCHEDULED' && r.s.endsAt.getTime() < now && r.hasRoster > 0;
      for (const r of rows) {
        const { s, c } = r;
        if (s.status === 'CANCELLED') continue;
        const t = bump(s.teacherId);
        if (s.status === 'DONE') {
          t.sessions++;
          t.minutes += minutes(s);
          if (s.teacherId !== c.teacherId) t.substitute++;
          const present = attOf(s.id).filter((a) => ATTENDED.has(a.status));
          const withFb = new Set(fbOf(s.id).map((f) => f.learnerId));
          t.present += present.length;
          t.feedback += present.filter((a) => withFb.has(a.learnerId)).length;
          if (s.taId) bump(s.taId).assisted++;
        } else if (isOverdue(r)) t.overdue++;
      }
      const users = await core.users.getMany([...people.keys()]);
      const teachers = [...people.entries()]
        .map(([userId, p]) => {
          const u = users.find((x) => x.id === userId);
          return {
            userId,
            fullName: u?.fullName ?? '—',
            role: u?.role ?? '',
            sessions: p.sessions,
            substituteSessions: p.substitute,
            hours: Math.round((p.minutes / 60) * 10) / 10,
            assistedSessions: p.assisted,
            overdueSessions: p.overdue,
            feedbackRate: pct(p.feedback, p.present),
          };
        })
        .sort((a, b) => b.sessions - a.sessions || a.fullName.localeCompare(b.fullName, 'vi'));

      // ── Theo lớp
      const classRows = classIds.map((classId) => {
        const list = rows.filter((r) => r.c.id === classId);
        const c = list[0]!.c;
        const done = list.filter((r) => r.s.status === 'DONE');
        const recorded = done.flatMap((r) => attOf(r.s.id));
        const present = recorded.filter((a) => ATTENDED.has(a.status));
        const withFb = done.reduce((n, r) => {
          const ids = new Set(fbOf(r.s.id).map((f) => f.learnerId));
          return n + attOf(r.s.id).filter((a) => ATTENDED.has(a.status) && ids.has(a.learnerId)).length;
        }, 0);
        const a = asg.find((x) => x.classId === classId);
        const learnerCount = members.find((m) => m.classId === classId)?.n ?? 0;
        return {
          classId,
          code: c.code,
          name: c.name,
          status: c.status,
          learners: learnerCount,
          sessionsDone: done.length,
          sessionsCancelled: list.filter((r) => r.s.status === 'CANCELLED').length,
          sessionsOverdue: list.filter(isOverdue).length,
          attendanceRate: pct(present.length, recorded.length),
          absences: recorded.filter((x) => x.status === 'ABSENT').length,
          feedbackRate: pct(withFb, present.length),
          assignments: a?.assignments ?? 0,
          submissionRate: a ? pct(a.submitted, a.assignments * learnerCount) : null,
          gradedRate: a ? pct(a.graded, a.submitted) : null,
        };
      });
      classRows.sort((x, y) => x.code.localeCompare(y.code));

      const done = rows.filter((r) => r.s.status === 'DONE');
      const recorded = done.flatMap((r) => attOf(r.s.id));
      const present = recorded.filter((a) => ATTENDED.has(a.status));
      return {
        month: q.month,
        summary: {
          sessionsDone: done.length,
          sessionsCancelled: rows.filter((r) => r.s.status === 'CANCELLED').length,
          sessionsOverdue: rows.filter(isOverdue).length,
          teachingHours: Math.round((done.reduce((n, r) => n + minutes(r.s), 0) / 60) * 10) / 10,
          attendanceRate: pct(present.length, recorded.length),
          feedbackRate: pct(teachers.reduce((n, t) => n + (people.get(t.userId)?.feedback ?? 0), 0), present.length),
        },
        teachers,
        classes: classRows,
      };
    },
  };
}

export type LmsReportsService = ReturnType<typeof createLmsReportsService>;

/** Nhắc GV chốt điểm danh buổi có học viên đã kết thúc hơn 2 giờ (mỗi buổi nhắc một lần, bỏ qua buổi quá 7 ngày). */
export function overdueAttendanceJob(db: LmsDb, core: CoreContract): Job {
  return {
    name: 'lms.sessions.overdueAttendance',
    everyMinutes: 30,
    async run(now) {
      const rows = await db
        .select({ id: sessions.id, teacherId: sessions.teacherId, startsAt: sessions.startsAt, code: classes.code, indexNo: sessions.indexNo })
        .from(sessions)
        .innerJoin(classes, eq(classes.id, sessions.classId))
        .where(
          and(
            eq(sessions.status, 'SCHEDULED'),
            isNull(sessions.finalizedAt),
            lt(sessions.endsAt, new Date(now.getTime() - 2 * 3_600_000)),
            gte(sessions.endsAt, new Date(now.getTime() - 7 * 86_400_000)),
            sessionHasRoster,
          ),
        )
        .limit(500);
      await core.notifications.send(
        rows.map((s) => ({
          userId: s.teacherId,
          type: 'lms.attendance.overdue',
          app: 'lms' as const,
          title: 'Buổi học chưa chốt điểm danh',
          body: `${s.code} · buổi ${s.indexNo} · ${toApiInstant(s.startsAt).slice(0, 16).replace('T', ' ')}`,
          link: `/sessions/${s.id}`,
          dedupeKey: `attendance-overdue:${s.id}`,
        })),
      );
    },
  };
}
