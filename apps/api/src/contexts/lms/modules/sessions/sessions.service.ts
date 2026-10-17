import { and, asc, between, count, desc, eq, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { runOnce } from '../../../../platform/events/run-once.js';
import { can, canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import { toApiInstant, vnDate } from '../../../../platform/time.js';
import { CRM_EVENTS, type TrialBookedV1, type TrialCancelledV1 } from '../../../../contracts/events/crm.js';
import {
  LMS_EVENTS,
  type AttendanceCorrectedV1,
  type AttendanceRecordedV1,
  type SessionFinalizedV1,
  type AttendanceStatus,
  type FeedbackPublishedV1,
  type TrialCheckedV1,
  type TrialRejectedV1,
} from '../../../../contracts/events/lms.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { LmsDb, LmsExecutor } from '../../db/types.js';
import {
  assignments,
  attendance,
  classes,
  classLearners,
  learnerEntitlements,
  learners,
  levels,
  outboxEvents,
  processedEvents,
  rooms,
  sessionFeedbacks,
  sessions,
  submissions,
  trialGuests,
  type FeedbackRatings,
} from '../../db/schema.js';
import { classVisibility, sessionVisibility } from '../../access.js';
import { ABSENCE_ALERT_THRESHOLD, CONSUMING_STATUSES } from '../../settings.js';
import { addDays, vnDateTime, vnDayOf } from '../../schedule.js';
import { findConflicts, renumberSessions, TA_ROLES, TEACHER_ROLES } from '../classes/classes.service.js';
import { sessionHasRoster } from './roster-sql.js';

const eventTables = { outboxEvents, processedEvents };
type SessionRow = typeof sessions.$inferSelect;

export interface AttendanceInput {
  learnerId: string;
  status: AttendanceStatus;
  note?: string | null;
}

export function createSessionsService(db: LmsDb, core: CoreContract) {
  async function getVisible(actor: Principal, id: string, exec: LmsExecutor = db, lock = false) {
    const q = exec
      .select({ s: sessions, c: classes })
      .from(sessions)
      .innerJoin(classes, eq(classes.id, sessions.classId))
      .where(and(eq(sessions.id, id), sessionVisibility(actor)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw Errors.notFound('buổi học');
    return row;
  }

  /**
   * Học viên của buổi: vào lớp trong hoặc trước ngày học (giờ VN — xếp lớp muộn trong ngày vẫn điểm danh được),
   * chưa rời lớp trước giờ học.
   */
  async function roster(exec: LmsExecutor, s: SessionRow) {
    const dayEnd = vnDateTime(addDays(vnDayOf(s.startsAt), 1), '00:00');
    const rows = await exec
      .select({ m: classLearners, learner: learners, ent: learnerEntitlements })
      .from(classLearners)
      .innerJoin(learners, eq(learners.id, classLearners.learnerId))
      .innerJoin(learnerEntitlements, eq(learnerEntitlements.enrollmentId, classLearners.enrollmentId))
      .where(
        and(
          eq(classLearners.classId, s.classId),
          lt(classLearners.joinedAt, dayEnd),
          or(sql`${classLearners.leftAt} IS NULL`, gt(classLearners.leftAt, s.startsAt)),
        ),
      )
      .orderBy(asc(learners.fullName));
    // Một học viên có thể vào / ra / vào lại lớp — giữ lần gần nhất.
    const byLearner = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prev = byLearner.get(r.learner.id);
      if (!prev || prev.m.joinedAt < r.m.joinedAt) byLearner.set(r.learner.id, r);
    }
    return [...byLearner.values()];
  }

  /** Đăng ký sẽ bị trừ buổi: đăng ký của lớp; hết buổi → đăng ký còn buổi khác cùng môn. */
  async function chargeableEnrollment(tx: LmsExecutor, learnerId: string, subjectId: string, preferred: string) {
    const ents = await tx
      .select()
      .from(learnerEntitlements)
      .where(and(eq(learnerEntitlements.learnerId, learnerId), eq(learnerEntitlements.subjectId, subjectId)))
      .orderBy(asc(learnerEntitlements.activatedAt));
    const usable = (e: (typeof ents)[number]) => e.status === 'ACTIVE' && e.sessionsUsed < e.sessionsPurchased;
    const pref = ents.find((e) => e.enrollmentId === preferred);
    return (pref && usable(pref) ? pref : ents.find(usable)) ?? pref ?? ents[0];
  }

  async function recountEntitlement(tx: LmsExecutor, enrollmentId: string) {
    const [used] = await tx
      .select({ n: count() })
      .from(attendance)
      .where(and(eq(attendance.enrollmentId, enrollmentId), eq(attendance.consumesSession, true)));
    const [e] = await tx.select().from(learnerEntitlements).where(eq(learnerEntitlements.enrollmentId, enrollmentId));
    if (!e) return;
    const sessionsUsed = used?.n ?? 0;
    const status = e.status === 'LOCKED' ? 'LOCKED' : sessionsUsed >= e.sessionsPurchased ? 'EXHAUSTED' : 'ACTIVE';
    await tx.update(learnerEntitlements).set({ sessionsUsed, status }).where(eq(learnerEntitlements.enrollmentId, enrollmentId));
  }

  async function rejectTrial(tx: LmsExecutor, guest: { appointmentId: string; sessionId: string; branchId: string }, reason: string) {
    const data: TrialRejectedV1 = { appointmentId: guest.appointmentId, lmsSessionId: guest.sessionId, reason };
    await appendEvent(tx, eventTables, { type: LMS_EVENTS.trialRejected, aggregateId: guest.appointmentId, branchId: guest.branchId, data });
  }

  async function assertStaff(userId: string, branchId: string, roles: string[], field: string) {
    const [u] = await core.users.getMany([userId]);
    if (!u || u.status !== 'ACTIVE' || !roles.includes(u.role) || !u.branchIds.includes(branchId)) {
      throw new AppError(422, 'STAFF_INVALID', 'Nhân sự không hợp lệ', `${field}: phải là ${roles.join(' / ')} tại chi nhánh`);
    }
  }

  async function calendarDtos(rows: Array<{ s: SessionRow; c: typeof classes.$inferSelect }>) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.s.id);
    const [users, roomRows, levelRows, attCounts, guestCounts, rosterCounts] = await Promise.all([
      core.users.getMany([...new Set(rows.flatMap((r) => [r.s.teacherId, r.s.taId]).filter((x): x is string => !!x))]),
      db.select({ id: rooms.id, name: rooms.name }).from(rooms),
      db.select({ id: levels.id, name: levels.name }).from(levels),
      db.select({ sessionId: attendance.sessionId, n: count() }).from(attendance).where(inArray(attendance.sessionId, ids)).groupBy(attendance.sessionId),
      db.select({ sessionId: trialGuests.sessionId, n: count() }).from(trialGuests).where(inArray(trialGuests.sessionId, ids)).groupBy(trialGuests.sessionId),
      db
        .select({ classId: classLearners.classId, n: count() })
        .from(classLearners)
        .where(and(inArray(classLearners.classId, [...new Set(rows.map((r) => r.c.id))]), eq(classLearners.status, 'ACTIVE')))
        .groupBy(classLearners.classId),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const roomName = new Map(roomRows.map((r) => [r.id, r.name]));
    const levelName = new Map(levelRows.map((l) => [l.id, l.name]));
    return rows.map(({ s, c }) => ({
      id: s.id,
      classId: c.id,
      classCode: c.code,
      className: c.name,
      levelName: levelName.get(c.levelId) ?? null,
      branchId: s.branchId,
      indexNo: s.indexNo,
      totalSessions: c.totalSessions,
      startsAt: toApiInstant(s.startsAt),
      endsAt: toApiInstant(s.endsAt),
      status: s.status,
      topic: s.topic,
      teacherId: s.teacherId,
      teacherName: userName.get(s.teacherId) ?? null,
      substitute: s.teacherId !== c.teacherId,
      taId: s.taId,
      taName: s.taId ? (userName.get(s.taId) ?? null) : null,
      roomId: s.roomId,
      roomName: s.roomId ? (roomName.get(s.roomId) ?? null) : null,
      // Buổi đã chốt: số học viên đã điểm danh; buổi khác: sĩ số hiện tại của lớp.
      learnerCount: s.status === 'DONE' ? (attCounts.find((a) => a.sessionId === s.id)?.n ?? 0) : (rosterCounts.find((r) => r.classId === c.id)?.n ?? 0),
      attendanceCount: attCounts.find((a) => a.sessionId === s.id)?.n ?? 0,
      trialGuestCount: guestCounts.find((g) => g.sessionId === s.id)?.n ?? 0,
    }));
  }

  return {
    getVisible,

    async calendar(actor: Principal, q: { from: Date; to: Date; branchId?: string; teacherId?: string; roomId?: string; classId?: string; includeCancelled?: boolean }) {
      const rows = await db
        .select({ s: sessions, c: classes })
        .from(sessions)
        .innerJoin(classes, eq(classes.id, sessions.classId))
        .where(
          and(
            gte(sessions.startsAt, q.from),
            lt(sessions.startsAt, q.to),
            sessionVisibility(actor),
            q.includeCancelled ? undefined : ne(sessions.status, 'CANCELLED'),
            q.branchId ? eq(sessions.branchId, q.branchId) : undefined,
            q.teacherId ? or(eq(sessions.teacherId, q.teacherId), eq(sessions.taId, q.teacherId)) : undefined,
            q.roomId ? eq(sessions.roomId, q.roomId) : undefined,
            q.classId ? eq(sessions.classId, q.classId) : undefined,
          ),
        )
        .orderBy(asc(sessions.startsAt))
        .limit(1000);
      return calendarDtos(rows);
    },

    /** Chi tiết buổi: danh sách học viên + điểm danh + nhận xét + khách học thử. */
    async get(actor: Principal, id: string) {
      const row = await getVisible(actor, id);
      const [[dto], members, att, fb, guests, consuming] = await Promise.all([
        calendarDtos([row]),
        roster(db, row.s),
        db.select().from(attendance).where(eq(attendance.sessionId, id)),
        db.select().from(sessionFeedbacks).where(eq(sessionFeedbacks.sessionId, id)),
        db.select().from(trialGuests).where(eq(trialGuests.sessionId, id)),
        core.settings.get(CONSUMING_STATUSES),
      ]);
      const learners = members.filter(({ m, learner }) => m.status !== 'LEFT' || att.some((a) => a.learnerId === learner.id));
      return {
        ...dto!,
        // Sĩ số của chính buổi này (không phải sĩ số lớp hiện tại).
        learnerCount: learners.filter(({ m, learner }) => m.status === 'ACTIVE' || att.some((a) => a.learnerId === learner.id)).length,
        // Để giao diện báo trước khi chốt: bao nhiêu học viên sẽ bị trừ buổi.
        consumingStatuses: consuming,
        teacherNote: row.s.teacherNote,
        cancelReason: row.s.cancelReason,
        finalizedAt: row.s.finalizedAt ? toApiInstant(row.s.finalizedAt) : null,
        learners: learners.map(({ m, learner, ent }) => {
          const a = att.find((x) => x.learnerId === learner.id);
          const f = fb.find((x) => x.learnerId === learner.id);
          return {
            learnerId: learner.id,
            code: learner.code,
            fullName: learner.fullName,
            avatarUrl: learner.avatarUrl,
            membershipStatus: m.status,
            sessionsRemaining: Math.max(0, ent.sessionsPurchased - ent.sessionsUsed),
            attendance: a ? { status: a.status, note: a.note, consumesSession: a.consumesSession } : null,
            feedback: f ? { ratings: f.ratings, comment: f.comment } : null,
          };
        }),
        trialGuests: guests.map((g) => ({
          id: g.id,
          appointmentId: g.appointmentId,
          childName: g.childName,
          birthYear: g.birthYear,
          parentName: g.parentName,
          parentPhone: g.parentPhone,
          result: g.result,
          note: g.note,
        })),
      };
    },

    /**
     * Dời buổi / đổi GV dạy thay / đổi phòng (lms.sessions.reschedule);
     * chủ đề + ghi chú buổi: GV của buổi (lms.attendance.record).
     * Trùng lịch → 409, gửi `force: true` để vẫn lưu.
     */
    async update(
      actor: Principal,
      id: string,
      patch: { startsAt?: Date; endsAt?: Date; teacherId?: string; taId?: string | null; roomId?: string | null; topic?: string | null; teacherNote?: string | null; force?: boolean },
    ) {
      const { force, topic, teacherNote, ...schedule } = patch;
      const reschedule = Object.keys(schedule).length > 0;
      if (reschedule && !can(actor, 'lms.sessions.reschedule')) throw Errors.forbidden('Cần quyền lms.sessions.reschedule');
      if (!reschedule && !can(actor, 'lms.attendance.record') && !can(actor, 'lms.sessions.reschedule')) throw Errors.forbidden();

      await db.transaction(async (tx) => {
        const { s } = await getVisible(actor, id, tx, true);
        if (s.status === 'CANCELLED') throw Errors.conflict('SESSION_CANCELLED', 'Buổi đã huỷ');
        if (reschedule && s.status === 'DONE') throw Errors.conflict('SESSION_DONE', 'Buổi đã chốt — không dời được');
        const next = {
          startsAt: schedule.startsAt ?? s.startsAt,
          endsAt: schedule.endsAt ?? (schedule.startsAt ? new Date(schedule.startsAt.getTime() + (s.endsAt.getTime() - s.startsAt.getTime())) : s.endsAt),
          teacherId: schedule.teacherId ?? s.teacherId,
          taId: schedule.taId !== undefined ? schedule.taId : s.taId,
          roomId: schedule.roomId !== undefined ? schedule.roomId : s.roomId,
        };
        if (next.endsAt <= next.startsAt) throw Errors.validation([{ path: 'body.endsAt', message: 'Giờ kết thúc phải sau giờ bắt đầu' }]);
        if (schedule.teacherId && schedule.teacherId !== s.teacherId) await assertStaff(schedule.teacherId, s.branchId, TEACHER_ROLES, 'teacherId');
        if (schedule.taId && schedule.taId !== s.taId) await assertStaff(schedule.taId, s.branchId, TA_ROLES, 'taId');
        if (schedule.roomId && schedule.roomId !== s.roomId) {
          const [r] = await tx.select().from(rooms).where(eq(rooms.id, schedule.roomId));
          if (!r || r.branchId !== s.branchId || !r.isActive) throw Errors.validation([{ path: 'body.roomId', message: 'Phòng không hợp lệ' }]);
        }
        if (reschedule && !force) {
          const conflicts = await findConflicts(tx, next, [id]);
          if (conflicts.length) {
            const first = conflicts[0]!;
            throw new AppError(409, 'SCHEDULE_CONFLICT', 'Trùng lịch', `${first.kind === 'ROOM' ? 'Phòng' : 'Giáo viên'} đang có buổi của lớp ${first.classCode} — gửi force để vẫn lưu`);
          }
        }
        await tx
          .update(sessions)
          .set({ ...next, ...(topic !== undefined ? { topic } : {}), ...(teacherNote !== undefined ? { teacherNote } : {}) })
          .where(eq(sessions.id, id));
        if (schedule.startsAt) await renumberSessions(tx, s.classId);
      });
      return this.get(actor, id);
    },

    /** Huỷ buổi (nghỉ lễ, GV ốm…). Khách học thử của buổi được báo về CRM. Sinh buổi bù bằng "Sinh buổi". */
    async cancel(actor: Principal, id: string, reason: string) {
      await db.transaction(async (tx) => {
        const { s } = await getVisible(actor, id, tx, true);
        if (s.status !== 'SCHEDULED') throw Errors.conflict('INVALID_STATE_TRANSITION', 'Chỉ huỷ được buổi chưa diễn ra');
        await tx.update(sessions).set({ status: 'CANCELLED', cancelReason: reason }).where(eq(sessions.id, id));
        await renumberSessions(tx, s.classId);
        const guests = await tx.select().from(trialGuests).where(and(eq(trialGuests.sessionId, id), eq(trialGuests.result, 'PENDING')));
        for (const g of guests) {
          await rejectTrial(tx, g, `Buổi học bị huỷ: ${reason}`);
          await tx.delete(trialGuests).where(eq(trialGuests.id, g.id));
        }
      });
    },

    /**
     * Lưu điểm danh. `finalize = true` → chốt buổi: trừ buổi, báo CRM (lms.attendance.recorded).
     * Buổi đã chốt: sửa cần lms.attendance.correct, phát lms.attendance.corrected cho dòng thay đổi.
     */
    async saveAttendance(actor: Principal, id: string, records: AttendanceInput[], finalize: boolean) {
      const consuming = new Set<string>(await core.settings.get(CONSUMING_STATUSES));
      return db.transaction(async (tx) => {
        const { s, c } = await getVisible(actor, id, tx, true);
        if (s.status === 'CANCELLED') throw Errors.conflict('SESSION_CANCELLED', 'Buổi đã huỷ');
        const done = s.status === 'DONE';
        if (done && !can(actor, 'lms.attendance.correct')) throw new AppError(403, 'SESSION_FINALIZED', 'Buổi đã chốt — cần TL / CM sửa');
        if (s.startsAt.getTime() - Date.now() > 60 * 60_000) throw new AppError(422, 'SESSION_NOT_STARTED', 'Chưa đến giờ học — điểm danh từ 1 giờ trước buổi học');

        const members = await roster(tx, s);
        const memberOf = new Map(members.map((r) => [r.learner.id, r]));
        for (const r of records) {
          if (!memberOf.has(r.learnerId)) throw Errors.validation([{ path: 'body.records', message: `Học viên ${r.learnerId} không thuộc buổi học` }]);
        }
        const existing = await tx.select().from(attendance).where(eq(attendance.sessionId, id));
        const now = new Date();
        const touched = new Set<string>();

        for (const r of records) {
          const prev = existing.find((a) => a.learnerId === r.learnerId);
          const ent = await chargeableEnrollment(tx, r.learnerId, c.subjectId, prev?.enrollmentId ?? memberOf.get(r.learnerId)!.m.enrollmentId);
          const enrollmentId = prev?.enrollmentId ?? ent!.enrollmentId;
          const consumes = (done || finalize) && consuming.has(r.status);
          const row = { enrollmentId, status: r.status, note: r.note ?? null, consumesSession: consumes, recordedBy: actor.userId, recordedAt: now };
          await tx
            .insert(attendance)
            .values({ sessionId: id, learnerId: r.learnerId, ...row })
            .onDuplicateKeyUpdate({ set: row });
          touched.add(enrollmentId);

          if (done && prev && (prev.status !== r.status || prev.consumesSession !== consumes)) {
            const data: AttendanceCorrectedV1 = {
              sessionId: id,
              classId: c.id,
              learnerId: r.learnerId,
              enrollmentId,
              status: r.status,
              fromStatus: prev.status,
              consumesSession: consumes,
              sessionStartsAt: toApiInstant(s.startsAt),
            };
            await appendEvent(tx, eventTables, { type: LMS_EVENTS.attendanceCorrected, aggregateId: id, branchId: s.branchId, actorId: actor.userId, data });
          }
        }

        if (finalize && !done) {
          const recorded = new Set([...existing.map((a) => a.learnerId), ...records.map((r) => r.learnerId)]);
          const missing = members.filter(({ m, learner }) => m.status === 'ACTIVE' && !recorded.has(learner.id));
          if (missing.length) {
            throw new AppError(422, 'ATTENDANCE_INCOMPLETE', 'Chưa điểm danh đủ học viên', missing.map(({ learner }) => learner.fullName).join(', '));
          }
          // Dòng đã lưu nháp trước đó cũng được tính buổi khi chốt.
          const all = await tx.select().from(attendance).where(eq(attendance.sessionId, id));
          for (const a of all) {
            const consumes = consuming.has(a.status);
            if (a.consumesSession !== consumes) {
              await tx.update(attendance).set({ consumesSession: consumes }).where(and(eq(attendance.sessionId, id), eq(attendance.learnerId, a.learnerId)));
            }
            touched.add(a.enrollmentId);
            const data: AttendanceRecordedV1 = {
              sessionId: id,
              classId: c.id,
              learnerId: a.learnerId,
              enrollmentId: a.enrollmentId,
              status: a.status,
              consumesSession: consumes,
              sessionStartsAt: toApiInstant(s.startsAt),
            };
            await appendEvent(tx, eventTables, { type: LMS_EVENTS.attendanceRecorded, aggregateId: id, branchId: s.branchId, actorId: actor.userId, data });
          }
          await tx.update(sessions).set({ status: 'DONE', finalizedAt: now, finalizedBy: actor.userId }).where(eq(sessions.id, id));
          const nameOf = new Map(members.map(({ learner }) => [learner.id, learner.fullName]));
          const counts = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 };
          for (const a of all) counts[a.status]++;
          const summary: SessionFinalizedV1 = {
            sessionId: id,
            classId: c.id,
            classCode: c.code,
            className: c.name,
            indexNo: s.indexNo,
            sessionStartsAt: toApiInstant(s.startsAt),
            teacherId: s.teacherId,
            counts,
            absent: all
              .filter((a) => a.status === 'ABSENT' || a.status === 'EXCUSED')
              .map((a) => ({ learnerId: a.learnerId, fullName: nameOf.get(a.learnerId) ?? '', status: a.status as 'ABSENT' | 'EXCUSED' })),
          };
          await appendEvent(tx, eventTables, { type: LMS_EVENTS.sessionFinalized, aggregateId: id, branchId: s.branchId, actorId: actor.userId, data: summary });
          if (c.status === 'PLANNED') await tx.update(classes).set({ status: 'ONGOING' }).where(eq(classes.id, c.id));
        }
        for (const e of touched) await recountEntitlement(tx, e);
        return { finalized: finalize || done };
      });
    },

    /** Nhận xét từng học viên (lưu / sửa). Mỗi nhận xét mới hoặc đổi nội dung → phát lms.feedback.published. */
    async saveFeedback(actor: Principal, id: string, items: Array<{ learnerId: string; ratings: FeedbackRatings; comment: string }>) {
      await db.transaction(async (tx) => {
        const { s } = await getVisible(actor, id, tx);
        if (s.status === 'CANCELLED') throw Errors.conflict('SESSION_CANCELLED', 'Buổi đã huỷ');
        const members = new Set((await roster(tx, s)).map((r) => r.learner.id));
        // Học viên vắng (có / không phép) không học buổi này → không nhận xét (nhận xét gửi tới phụ huynh).
        const absent = new Set(
          (
            await tx
              .select({ learnerId: attendance.learnerId })
              .from(attendance)
              .where(and(eq(attendance.sessionId, id), inArray(attendance.status, ['ABSENT', 'EXCUSED'])))
          ).map((a) => a.learnerId),
        );
        const existing = await tx.select().from(sessionFeedbacks).where(eq(sessionFeedbacks.sessionId, id));
        const now = new Date();
        for (const item of items) {
          if (!members.has(item.learnerId)) throw Errors.validation([{ path: 'body.items', message: 'Học viên không thuộc buổi học' }]);
          if (absent.has(item.learnerId)) throw new AppError(422, 'LEARNER_ABSENT', 'Học viên vắng buổi này — không nhận xét');
          const prev = existing.find((f) => f.learnerId === item.learnerId);
          await tx
            .insert(sessionFeedbacks)
            .values({ sessionId: id, learnerId: item.learnerId, ratings: item.ratings, comment: item.comment, authorId: actor.userId, publishedAt: now, updatedAt: now })
            .onDuplicateKeyUpdate({ set: { ratings: item.ratings, comment: item.comment, authorId: actor.userId, updatedAt: now } });
          if (!prev || prev.comment !== item.comment) {
            const data: FeedbackPublishedV1 = { sessionId: id, learnerId: item.learnerId, comment: item.comment };
            await appendEvent(tx, eventTables, { type: LMS_EVENTS.feedbackPublished, aggregateId: id, branchId: s.branchId, actorId: actor.userId, data });
          }
        }
      });
    },

    /** Giáo viên điểm danh khách học thử → báo CRM cập nhật lịch hẹn. */
    async checkTrialGuest(actor: Principal, guestId: string, result: 'ATTENDED' | 'NO_SHOW', note?: string | null) {
      await db.transaction(async (tx) => {
        const [g] = await tx.select().from(trialGuests).where(eq(trialGuests.id, guestId)).for('update');
        if (!g) throw Errors.notFound('khách học thử');
        await getVisible(actor, g.sessionId, tx);
        await tx.update(trialGuests).set({ result, note: note ?? null, checkedBy: actor.userId, checkedAt: new Date() }).where(eq(trialGuests.id, guestId));
        const data: TrialCheckedV1 = { appointmentId: g.appointmentId, lmsSessionId: g.sessionId, result, note: note ?? null, childName: g.childName };
        await appendEvent(tx, eventTables, { type: LMS_EVENTS.trialChecked, aggregateId: g.appointmentId, branchId: g.branchId, actorId: actor.userId, data });
      });
    },

    /** Buổi còn chỗ học thử (cho CRM đặt lịch) — chỉ buổi tương lai của chi nhánh người gọi. */
    async trialSlots(actor: Principal, q: { branchId: string; subjectId?: string; from?: Date; to?: Date }) {
      if (!canAccessBranch(actor, q.branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
      const from = q.from && q.from > new Date() ? q.from : new Date();
      const to = q.to ?? new Date(from.getTime() + 30 * 86_400_000);
      const rows = await db
        .select({ s: sessions, c: classes, levelName: levels.name, guests: sql<number>`(SELECT COUNT(*) FROM ${trialGuests} WHERE ${trialGuests.sessionId} = ${sessions.id})`.mapWith(Number) })
        .from(sessions)
        .innerJoin(classes, eq(classes.id, sessions.classId))
        .innerJoin(levels, eq(levels.id, classes.levelId))
        .where(
          and(
            eq(sessions.branchId, q.branchId),
            eq(sessions.status, 'SCHEDULED'),
            between(sessions.startsAt, from, to),
            gt(sessions.trialCapacity, 0),
            q.subjectId ? eq(classes.subjectId, q.subjectId) : undefined,
          ),
        )
        .orderBy(asc(sessions.startsAt))
        .limit(300);
      const users = new Map((await core.users.getMany([...new Set(rows.map((r) => r.s.teacherId))])).map((u) => [u.id, u.fullName]));
      return rows
        .filter((r) => r.guests < r.s.trialCapacity)
        .map(({ s, c, levelName, guests }) => ({
          sessionId: s.id,
          classCode: c.code,
          className: c.name,
          levelName,
          startsAt: toApiInstant(s.startsAt),
          endsAt: toApiInstant(s.endsAt),
          teacherName: users.get(s.teacherId) ?? null,
          remaining: s.trialCapacity - guests,
        }));
    },

    /** Màn "Hôm nay": buổi trong ngày + việc cần xử lý. */
    async today(actor: Principal, branchId?: string) {
      const date = vnDate();
      const from = vnDateTime(date, '00:00');
      const to = new Date(from.getTime() + 86_400_000);
      const todays = await this.calendar(actor, { from, to, branchId });

      // Buổi đã qua mà chưa chốt điểm danh (bỏ qua buổi không có học viên)
      const overdue = await db
        .select({ s: sessions, c: classes })
        .from(sessions)
        .innerJoin(classes, eq(classes.id, sessions.classId))
        .where(
          and(
            eq(sessions.status, 'SCHEDULED'),
            lt(sessions.endsAt, from),
            gt(sessions.endsAt, new Date(from.getTime() - 14 * 86_400_000)),
            sessionHasRoster,
            sessionVisibility(actor),
            branchId ? eq(sessions.branchId, branchId) : undefined,
          ),
        )
        .orderBy(desc(sessions.startsAt))
        .limit(50);

      // Học viên vắng liên tiếp ≥ ngưỡng (xét các buổi đã chốt gần nhất của lớp đang học)
      const threshold = await core.settings.get(ABSENCE_ALERT_THRESHOLD, branchId ?? null);
      const recent = await db
        .select({ learnerId: attendance.learnerId, status: attendance.status, startsAt: sessions.startsAt, classCode: classes.code, fullName: learners.fullName })
        .from(attendance)
        .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
        .innerJoin(classes, eq(classes.id, sessions.classId))
        .innerJoin(learners, eq(learners.id, attendance.learnerId))
        .where(and(eq(sessions.status, 'DONE'), gt(sessions.startsAt, new Date(Date.now() - 60 * 86_400_000)), sessionVisibility(actor), branchId ? eq(sessions.branchId, branchId) : undefined))
        .orderBy(desc(sessions.startsAt));
      const streaks = new Map<string, { learnerId: string; fullName: string; classCode: string; streak: number; broken: boolean }>();
      for (const r of recent) {
        const cur = streaks.get(r.learnerId) ?? { learnerId: r.learnerId, fullName: r.fullName, classCode: r.classCode, streak: 0, broken: false };
        if (!cur.broken) {
          if (r.status === 'ABSENT' || r.status === 'EXCUSED') cur.streak++;
          else cur.broken = true;
        }
        streaks.set(r.learnerId, cur);
      }
      const absent = [...streaks.values()].filter((s) => s.streak >= threshold).map(({ broken: _b, ...s }) => s);

      // Học viên sắp hết buổi (≤ 2) trong lớp đang học
      const lowRemaining = await db
        .select({ learnerId: learners.id, fullName: learners.fullName, classCode: classes.code, purchased: learnerEntitlements.sessionsPurchased, used: learnerEntitlements.sessionsUsed })
        .from(classLearners)
        .innerJoin(classes, eq(classes.id, classLearners.classId))
        .innerJoin(learners, eq(learners.id, classLearners.learnerId))
        .innerJoin(learnerEntitlements, eq(learnerEntitlements.enrollmentId, classLearners.enrollmentId))
        .where(
          and(
            eq(classLearners.status, 'ACTIVE'),
            sql`${learnerEntitlements.sessionsPurchased} - ${learnerEntitlements.sessionsUsed} <= 2`,
            classVisibility(actor),
            branchId ? eq(classes.branchId, branchId) : undefined,
          ),
        )
        .limit(100);

      // Bài chờ chấm
      const [pending] = await db
        .select({ n: count() })
        .from(submissions)
        .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
        .innerJoin(classes, eq(classes.id, assignments.classId))
        .where(and(eq(submissions.status, 'SUBMITTED'), classVisibility(actor), branchId ? eq(classes.branchId, branchId) : undefined));

      return {
        date,
        sessions: todays,
        overdueSessions: (await calendarDtos(overdue)).map((s) => ({ id: s.id, classCode: s.classCode, indexNo: s.indexNo, startsAt: s.startsAt, teacherName: s.teacherName })),
        absenceAlerts: absent,
        lowRemaining: lowRemaining.map((l) => ({ learnerId: l.learnerId, fullName: l.fullName, classCode: l.classCode, remaining: Math.max(0, l.purchased - l.used) })),
        pendingGrading: pending?.n ?? 0,
      };
    },

    /** Khách học thử từ CRM. */
    subscriptions(): Subscription[] {
      return [
        {
          name: 'lms.sessions.onTrialBooked',
          type: CRM_EVENTS.trialBooked,
          async handle(event: EventEnvelope) {
            const d = event.data as TrialBookedV1;
            const accepted: { teacherId: string | null; startsAt: Date | null } = { teacherId: null, startsAt: null };
            await runOnce(db, eventTables, event, 'lms.sessions.onTrialBooked', async (tx) => {
              const [s] = await tx.select().from(sessions).where(eq(sessions.id, d.lmsSessionId)).for('update');
              const guest = { appointmentId: d.appointmentId, sessionId: d.lmsSessionId, branchId: d.branchId };
              if (!s || s.status !== 'SCHEDULED' || s.startsAt < new Date()) return rejectTrial(tx, guest, 'Buổi học không tồn tại, đã huỷ hoặc đã diễn ra');
              if (s.branchId !== d.branchId) return rejectTrial(tx, guest, 'Buổi học thuộc chi nhánh khác');
              const [n] = await tx.select({ n: count() }).from(trialGuests).where(eq(trialGuests.sessionId, s.id));
              if ((n?.n ?? 0) >= s.trialCapacity) return rejectTrial(tx, guest, 'Buổi học đã đủ khách học thử');
              await tx
                .insert(trialGuests)
                .values({
                  id: newId(),
                  sessionId: s.id,
                  appointmentId: d.appointmentId,
                  branchId: d.branchId,
                  childName: d.guest.childName,
                  birthYear: d.guest.birthYear,
                  parentName: d.guest.parentName,
                  parentPhone: d.guest.parentPhone,
                  createdAt: new Date(),
                })
                .onDuplicateKeyUpdate({ set: { sessionId: s.id } });
              accepted.teacherId = s.teacherId;
              accepted.startsAt = s.startsAt;
            });
            // Báo giáo viên của buổi có khách học thử.
            if (accepted.teacherId && accepted.startsAt) {
              await core.notifications.send([
                {
                  userId: accepted.teacherId,
                  type: 'lms.trial.booked',
                  app: 'lms',
                  title: 'Có khách học thử trong buổi của bạn',
                  body: `${d.guest.childName} · ${toApiInstant(accepted.startsAt).slice(0, 16).replace('T', ' ')}`,
                  link: `/sessions/${d.lmsSessionId}`,
                },
              ]);
            }
          },
        },
        {
          name: 'lms.sessions.onTrialCancelled',
          type: CRM_EVENTS.trialCancelled,
          async handle(event: EventEnvelope) {
            const d = event.data as TrialCancelledV1;
            await runOnce(db, eventTables, event, 'lms.sessions.onTrialCancelled', async (tx) => {
              await tx.delete(trialGuests).where(and(eq(trialGuests.appointmentId, d.appointmentId), eq(trialGuests.result, 'PENDING')));
            });
          },
        },
      ];
    },
  };
}

export type SessionsService = ReturnType<typeof createSessionsService>;
