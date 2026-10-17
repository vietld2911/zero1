import { and, asc, count, desc, eq, gt, inArray, like, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { csvList, likeContains } from '../../../../platform/http/list.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import { toApiInstant } from '../../../../platform/time.js';
import { LMS_EVENTS, type ClassCompletedV1, type LearnerPlacedV1 } from '../../../../contracts/events/lms.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { LmsDb, LmsExecutor } from '../../db/types.js';
import type {
  CLASS_STATUSES} from '../../db/schema.js';
import {
  attendance,
  classes,
  classLearners,
  learnerEntitlements,
  learners,
  levels,
  outboxEvents,
  processedEvents,
  rooms,
  sessions,
  subjects,
  type ScheduleSlot,
} from '../../db/schema.js';
import { classVisibility } from '../../access.js';
import { addDays, planSessions, vnDayOf } from '../../schedule.js';
import { sessionHasRoster } from '../sessions/roster-sql.js';

const eventTables = { outboxEvents, processedEvents };
type ClassRow = typeof classes.$inferSelect;
type ClassStatus = (typeof CLASS_STATUSES)[number];

export const TEACHER_ROLES = ['TEACHER', 'TL'];
export const TA_ROLES = ['TA', 'TEACHER', 'TL'];

const TRANSITIONS: Record<ClassStatus, ClassStatus[]> = {
  PLANNED: ['ONGOING', 'CANCELLED'],
  ONGOING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export interface ClassInput {
  code: string;
  name: string;
  branchId: string;
  levelId: string;
  teacherId: string;
  taId?: string | null;
  roomId?: string | null;
  capacity: number;
  startDate: string;
  schedule: ScheduleSlot[];
  totalSessions?: number;
  trialCapacity?: number;
  note?: string | null;
}

export interface Conflict {
  kind: 'TEACHER' | 'ROOM';
  sessionId: string;
  classCode: string;
  startsAt: string;
}

/**
 * Buổi đang lên lịch trùng giờ cùng giáo viên / trợ giảng / phòng (trừ chính các buổi `exclude`).
 * Hai khoảng [a, b) và [c, d) giao nhau khi a < d và c < b.
 */
export async function findConflicts(
  exec: LmsExecutor,
  slot: { startsAt: Date; endsAt: Date; teacherId: string; taId: string | null; roomId: string | null },
  exclude: string[] = [],
): Promise<Conflict[]> {
  const people = [slot.teacherId, slot.taId].filter((x): x is string => !!x);
  const rows = await exec
    .select({ s: sessions, classCode: classes.code })
    .from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId))
    .where(
      and(
        eq(sessions.status, 'SCHEDULED'),
        lt(sessions.startsAt, slot.endsAt),
        gt(sessions.endsAt, slot.startsAt),
        exclude.length ? sql`${sessions.id} NOT IN (${sql.join(exclude.map((e) => sql`${e}`), sql`, `)})` : undefined,
        or(
          inArray(sessions.teacherId, people),
          inArray(sessions.taId, people),
          slot.roomId ? eq(sessions.roomId, slot.roomId) : undefined,
        ),
      ),
    );
  return rows.map(({ s, classCode }) => ({
    kind: slot.roomId && s.roomId === slot.roomId && !people.includes(s.teacherId) && !(s.taId && people.includes(s.taId)) ? 'ROOM' : 'TEACHER',
    sessionId: s.id,
    classCode,
    startsAt: toApiInstant(s.startsAt),
  }));
}

/** Đánh lại số thứ tự buổi (bỏ buổi đã huỷ) theo thời gian. */
export async function renumberSessions(tx: LmsExecutor, classId: string) {
  const rows = await tx
    .select({ id: sessions.id, indexNo: sessions.indexNo })
    .from(sessions)
    .where(and(eq(sessions.classId, classId), ne(sessions.status, 'CANCELLED')))
    .orderBy(asc(sessions.startsAt));
  for (const [i, r] of rows.entries()) {
    if (r.indexNo !== i + 1) await tx.update(sessions).set({ indexNo: i + 1 }).where(eq(sessions.id, r.id));
  }
}

export function createClassesService(db: LmsDb, core: CoreContract) {
  function assertBranch(actor: Principal, branchId: string) {
    if (!canAccessBranch(actor, branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
  }

  async function assertStaff(userId: string, branchId: string, roles: string[], field: string) {
    const [u] = await core.users.getMany([userId]);
    if (!u || u.status !== 'ACTIVE' || !roles.includes(u.role) || !u.branchIds.includes(branchId)) {
      throw new AppError(422, 'STAFF_INVALID', 'Nhân sự không hợp lệ', `${field}: phải là ${roles.join(' / ')} đang làm việc tại chi nhánh`);
    }
  }

  async function assertRoom(roomId: string, branchId: string, exec: LmsExecutor = db) {
    const [r] = await exec.select().from(rooms).where(eq(rooms.id, roomId));
    if (!r || r.branchId !== branchId || !r.isActive) throw Errors.validation([{ path: 'body.roomId', message: 'Phòng không thuộc chi nhánh hoặc đã ngừng' }]);
  }

  function validateSchedule(schedule: ScheduleSlot[]) {
    const seen = new Set<string>();
    for (const [i, s] of schedule.entries()) {
      const key = `${s.weekday}-${s.startTime}`;
      if (seen.has(key)) throw Errors.validation([{ path: `body.schedule.${i}`, message: 'Trùng khung giờ' }]);
      seen.add(key);
    }
  }

  async function getVisible(actor: Principal, id: string, exec: LmsExecutor = db, lock = false) {
    const q = exec.select().from(classes).where(and(eq(classes.id, id), classVisibility(actor)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw Errors.notFound('lớp học');
    return row;
  }

  async function toDtos(rows: ClassRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [levelRows, roomRows, users, memberCounts, sessionStats, nextSessions] = await Promise.all([
      db
        .select({ id: levels.id, name: levels.name, subjectName: subjects.name })
        .from(levels)
        .innerJoin(subjects, eq(subjects.id, levels.subjectId))
        .where(inArray(levels.id, [...new Set(rows.map((r) => r.levelId))])),
      db.select({ id: rooms.id, name: rooms.name }).from(rooms),
      core.users.getMany([...new Set(rows.flatMap((r) => [r.teacherId, r.taId]).filter((x): x is string => !!x))]),
      db
        .select({ classId: classLearners.classId, n: count() })
        .from(classLearners)
        .where(and(inArray(classLearners.classId, ids), eq(classLearners.status, 'ACTIVE')))
        .groupBy(classLearners.classId),
      db
        .select({
          classId: sessions.classId,
          done: sql<number>`SUM(CASE WHEN ${sessions.status} = 'DONE' THEN 1 ELSE 0 END)`.mapWith(Number),
          planned: sql<number>`SUM(CASE WHEN ${sessions.status} <> 'CANCELLED' THEN 1 ELSE 0 END)`.mapWith(Number),
        })
        .from(sessions)
        .where(inArray(sessions.classId, ids))
        .groupBy(sessions.classId),
      db
        .select({ classId: sessions.classId, startsAt: sql<Date>`MIN(${sessions.startsAt})`.mapWith(sessions.startsAt) })
        .from(sessions)
        .where(and(inArray(sessions.classId, ids), eq(sessions.status, 'SCHEDULED'), gt(sessions.endsAt, new Date())))
        .groupBy(sessions.classId),
    ]);
    const level = new Map(levelRows.map((l) => [l.id, l]));
    const roomName = new Map(roomRows.map((r) => [r.id, r.name]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((c) => {
      const stat = sessionStats.find((s) => s.classId === c.id);
      const next = nextSessions.find((s) => s.classId === c.id);
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        branchId: c.branchId,
        subjectId: c.subjectId,
        subjectName: level.get(c.levelId)?.subjectName ?? null,
        levelId: c.levelId,
        levelName: level.get(c.levelId)?.name ?? null,
        teacherId: c.teacherId,
        teacherName: userName.get(c.teacherId) ?? null,
        taId: c.taId,
        taName: c.taId ? (userName.get(c.taId) ?? null) : null,
        roomId: c.roomId,
        roomName: c.roomId ? (roomName.get(c.roomId) ?? null) : null,
        capacity: c.capacity,
        learnerCount: memberCounts.find((m) => m.classId === c.id)?.n ?? 0,
        startDate: c.startDate,
        schedule: c.schedule,
        totalSessions: c.totalSessions,
        sessionsDone: stat?.done ?? 0,
        sessionsPlanned: stat?.planned ?? 0,
        nextSessionAt: next?.startsAt ? toApiInstant(next.startsAt) : null,
        trialCapacity: c.trialCapacity,
        status: c.status,
        note: c.note,
        version: c.version,
      };
    });
  }

  return {
    toDtos,
    getVisible,

    // ─────────── Phòng học

    async listRooms(actor: Principal, branchId?: string, includeInactive = false) {
      const rows = await db
        .select()
        .from(rooms)
        .where(and(branchId ? eq(rooms.branchId, branchId) : undefined, includeInactive ? undefined : eq(rooms.isActive, true)))
        .orderBy(asc(rooms.name));
      return rows.filter((r) => canAccessBranch(actor, r.branchId)).map(({ createdAt: _c, updatedAt: _u, ...r }) => r);
    },

    async createRoom(actor: Principal, input: { branchId: string; name: string; capacity: number }) {
      assertBranch(actor, input.branchId);
      const [branch] = await core.branches.getMany([input.branchId]);
      if (!branch) throw Errors.validation([{ path: 'body.branchId', message: 'Chi nhánh không tồn tại' }]);
      const [dup] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.branchId, input.branchId), eq(rooms.name, input.name)));
      if (dup) throw Errors.conflict('ROOM_NAME_TAKEN', 'Chi nhánh đã có phòng tên này');
      const id = newId();
      await db.insert(rooms).values({ id, ...input });
      return id;
    },

    async updateRoom(actor: Principal, id: string, patch: { name?: string; capacity?: number; isActive?: boolean }) {
      const [r] = await db.select().from(rooms).where(eq(rooms.id, id));
      if (!r) throw Errors.notFound('phòng học');
      assertBranch(actor, r.branchId);
      if (patch.name && patch.name !== r.name) {
        const [dup] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.branchId, r.branchId), eq(rooms.name, patch.name)));
        if (dup) throw Errors.conflict('ROOM_NAME_TAKEN', 'Chi nhánh đã có phòng tên này');
      }
      await db.update(rooms).set(patch).where(eq(rooms.id, id));
    },

    // ─────────── Lớp học

    async list(actor: Principal, q: { status?: string; branchId?: string; levelId?: string; teacherId?: string; q?: string }) {
      const statuses = csvList(q.status) as ClassStatus[] | undefined;
      const rows = await db
        .select()
        .from(classes)
        .where(
          and(
            classVisibility(actor),
            statuses ? inArray(classes.status, statuses) : undefined,
            q.branchId ? eq(classes.branchId, q.branchId) : undefined,
            q.levelId ? eq(classes.levelId, q.levelId) : undefined,
            q.teacherId ? or(eq(classes.teacherId, q.teacherId), eq(classes.taId, q.teacherId)) : undefined,
            q.q ? or(like(classes.code, likeContains(q.q)), like(classes.name, likeContains(q.q))) : undefined,
          ),
        )
        .orderBy(asc(classes.status), desc(classes.startDate))
        .limit(500);
      return toDtos(rows);
    },

    /** Chi tiết lớp: học viên (tỉ lệ đi học, buổi còn lại), danh sách buổi. */
    async get(actor: Principal, id: string) {
      const c = await getVisible(actor, id);
      const [[dto], members, sessionRows] = await Promise.all([
        toDtos([c]),
        db
          .select({ m: classLearners, learner: learners, ent: learnerEntitlements })
          .from(classLearners)
          .innerJoin(learners, eq(learners.id, classLearners.learnerId))
          .innerJoin(learnerEntitlements, eq(learnerEntitlements.enrollmentId, classLearners.enrollmentId))
          .where(eq(classLearners.classId, id))
          .orderBy(asc(learners.fullName)),
        db.select().from(sessions).where(eq(sessions.classId, id)).orderBy(asc(sessions.startsAt)),
      ]);
      const sessionIds = sessionRows.map((s) => s.id);
      const att = sessionIds.length ? await db.select().from(attendance).where(inArray(attendance.sessionId, sessionIds)) : [];
      const userIds = [...new Set(sessionRows.flatMap((s) => [s.teacherId, s.taId]).filter((x): x is string => !!x))];
      const userName = new Map((await core.users.getMany(userIds)).map((u) => [u.id, u.fullName]));
      return {
        ...dto!,
        learners: members.map(({ m, learner, ent }) => {
          const mine = att.filter((a) => a.learnerId === learner.id);
          const attended = mine.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
          return {
            membershipId: m.id,
            learnerId: learner.id,
            code: learner.code,
            fullName: learner.fullName,
            avatarUrl: learner.avatarUrl,
            status: m.status,
            enrollmentId: m.enrollmentId,
            enrollmentCode: ent.enrollmentCode,
            sessionsRemaining: Math.max(0, ent.sessionsPurchased - ent.sessionsUsed),
            attended,
            recorded: mine.length,
            attendanceRate: mine.length ? Math.round((attended / mine.length) * 100) : null,
            joinedAt: toApiInstant(m.joinedAt),
            leftAt: m.leftAt ? toApiInstant(m.leftAt) : null,
          };
        }),
        sessions: sessionRows.map((s) => ({
          id: s.id,
          indexNo: s.indexNo,
          startsAt: toApiInstant(s.startsAt),
          endsAt: toApiInstant(s.endsAt),
          status: s.status,
          topic: s.topic,
          teacherName: userName.get(s.teacherId) ?? null,
          substitute: s.teacherId !== c.teacherId,
          attendanceCount: att.filter((a) => a.sessionId === s.id).length,
        })),
      };
    },

    async create(actor: Principal, input: ClassInput) {
      assertBranch(actor, input.branchId);
      const [level] = await db.select().from(levels).where(eq(levels.id, input.levelId));
      if (!level || !level.isActive) throw Errors.validation([{ path: 'body.levelId', message: 'Cấp độ không tồn tại hoặc đã ngừng' }]);
      await assertStaff(input.teacherId, input.branchId, TEACHER_ROLES, 'teacherId');
      if (input.taId) await assertStaff(input.taId, input.branchId, TA_ROLES, 'taId');
      if (input.roomId) await assertRoom(input.roomId, input.branchId);
      validateSchedule(input.schedule);
      const [dup] = await db.select({ id: classes.id }).from(classes).where(eq(classes.code, input.code));
      if (dup) throw Errors.conflict('CLASS_CODE_TAKEN', 'Mã lớp đã tồn tại');
      const id = newId();
      await db.insert(classes).values({
        id,
        code: input.code,
        name: input.name,
        branchId: input.branchId,
        subjectId: level.subjectId,
        levelId: level.id,
        teacherId: input.teacherId,
        taId: input.taId ?? null,
        roomId: input.roomId ?? null,
        capacity: input.capacity,
        startDate: input.startDate,
        schedule: input.schedule,
        totalSessions: input.totalSessions ?? level.sessionsCount,
        trialCapacity: input.trialCapacity ?? 2,
        note: input.note ?? null,
      });
      return id;
    },

    /**
     * Sửa lớp. Đổi GV / TA / phòng áp dụng cho các buổi CHƯA diễn ra đang theo lớp (buổi dạy thay giữ nguyên).
     * Kết thúc lớp → học viên đang học chuyển "hoàn thành", phát lms.class.completed.
     */
    async update(actor: Principal, id: string, patch: Partial<Omit<ClassInput, 'branchId' | 'levelId'>> & { status?: ClassStatus }) {
      await db.transaction(async (tx) => {
        const c = await getVisible(actor, id, tx, true);
        if (patch.teacherId && patch.teacherId !== c.teacherId) await assertStaff(patch.teacherId, c.branchId, TEACHER_ROLES, 'teacherId');
        if (patch.taId && patch.taId !== c.taId) await assertStaff(patch.taId, c.branchId, TA_ROLES, 'taId');
        if (patch.roomId && patch.roomId !== c.roomId) await assertRoom(patch.roomId, c.branchId, tx);
        if (patch.schedule) validateSchedule(patch.schedule);
        if (patch.code && patch.code !== c.code) {
          const [dup] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.code, patch.code));
          if (dup) throw Errors.conflict('CLASS_CODE_TAKEN', 'Mã lớp đã tồn tại');
        }
        if (patch.capacity !== undefined && patch.capacity < c.capacity) {
          const [active] = await tx
            .select({ n: count() })
            .from(classLearners)
            .where(and(eq(classLearners.classId, id), eq(classLearners.status, 'ACTIVE')));
          const n = active?.n ?? 0;
          if (patch.capacity < n) throw Errors.conflict('CAPACITY_BELOW_ENROLLED', 'Sĩ số tối đa nhỏ hơn số học viên đang học', `Lớp đang có ${n} học viên`);
        }
        if (patch.status && patch.status !== c.status && !TRANSITIONS[c.status].includes(patch.status)) {
          throw Errors.conflict('INVALID_STATE_TRANSITION', 'Không đổi được trạng thái lớp', `${c.status} → ${patch.status}`);
        }
        await tx.update(classes).set({ ...patch, version: sql`${classes.version} + 1` }).where(eq(classes.id, id));

        const future = and(eq(sessions.classId, id), eq(sessions.status, 'SCHEDULED'), gt(sessions.startsAt, new Date()));
        if (patch.teacherId !== undefined && patch.teacherId !== c.teacherId) {
          await tx.update(sessions).set({ teacherId: patch.teacherId }).where(and(future, eq(sessions.teacherId, c.teacherId)));
        }
        if (patch.taId !== undefined && patch.taId !== c.taId) {
          await tx.update(sessions).set({ taId: patch.taId ?? null }).where(and(future, c.taId ? eq(sessions.taId, c.taId) : sql`${sessions.taId} IS NULL`));
        }
        if (patch.roomId !== undefined && patch.roomId !== c.roomId) {
          await tx.update(sessions).set({ roomId: patch.roomId ?? null }).where(and(future, c.roomId ? eq(sessions.roomId, c.roomId) : sql`${sessions.roomId} IS NULL`));
        }

        if (patch.status === 'COMPLETED' || patch.status === 'CANCELLED') {
          const active = await tx
            .select({ learnerId: classLearners.learnerId })
            .from(classLearners)
            .where(and(eq(classLearners.classId, id), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])));
          await tx
            .update(classLearners)
            .set({ status: patch.status === 'COMPLETED' ? 'COMPLETED' : 'LEFT', leftAt: new Date(), ...(patch.status === 'CANCELLED' ? { leftReason: 'Lớp bị huỷ' } : {}) })
            .where(and(eq(classLearners.classId, id), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])));
          await tx.update(sessions).set({ status: 'CANCELLED', cancelReason: 'Lớp đã kết thúc' }).where(future);
          // Buổi đã qua mà không có học viên nào → đóng luôn (không còn gì để điểm danh).
          await tx
            .update(sessions)
            .set({ status: 'CANCELLED', cancelReason: 'Không có học viên' })
            .where(and(eq(sessions.classId, id), eq(sessions.status, 'SCHEDULED'), lte(sessions.startsAt, new Date()), not(sessionHasRoster)));
          if (patch.status === 'COMPLETED') {
            const data: ClassCompletedV1 = { classId: id, learnerIds: active.map((a) => a.learnerId) };
            await appendEvent(tx, eventTables, { type: LMS_EVENTS.classCompleted, aggregateId: id, branchId: c.branchId, actorId: actor.userId, data });
          }
        }
      });
      return this.get(actor, id);
    },

    /**
     * Sinh buổi học theo lịch tuần cho đủ `totalSessions` (không tính buổi đã huỷ).
     * Bắt đầu từ sau buổi cuối cùng (hoặc ngày khai giảng). Trùng lịch → vẫn tạo, trả cảnh báo.
     */
    async generateSessions(actor: Principal, id: string, fromDate?: string) {
      return db.transaction(async (tx) => {
        const c = await getVisible(actor, id, tx, true);
        if (c.status === 'COMPLETED' || c.status === 'CANCELLED') throw Errors.conflict('CLASS_CLOSED', 'Lớp đã kết thúc');
        const existing = await tx
          .select({ startsAt: sessions.startsAt })
          .from(sessions)
          .where(and(eq(sessions.classId, id), ne(sessions.status, 'CANCELLED')))
          .orderBy(desc(sessions.startsAt));
        const need = c.totalSessions - existing.length;
        if (need <= 0) return { created: 0, warnings: [] as Conflict[] };
        const afterLast = existing[0] ? addDays(vnDayOf(existing[0].startsAt), 1) : c.startDate;
        const from = fromDate && fromDate > afterLast ? fromDate : afterLast;
        const plan = planSessions(c.schedule, from, need);
        const warnings: Conflict[] = [];
        for (const p of plan) {
          const slot = { ...p, teacherId: c.teacherId, taId: c.taId, roomId: c.roomId };
          warnings.push(...(await findConflicts(tx, slot)));
          await tx.insert(sessions).values({
            id: newId(),
            classId: id,
            branchId: c.branchId,
            indexNo: 0,
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            teacherId: c.teacherId,
            taId: c.taId,
            roomId: c.roomId,
            trialCapacity: c.trialCapacity,
          });
        }
        await renumberSessions(tx, id);
        return { created: plan.length, warnings };
      });
    },

    /**
     * Xếp học viên vào lớp bằng một quyền học (đăng ký) cùng môn.
     * Đang học lớp khác cùng môn → chuyển lớp (rời lớp cũ).
     */
    async place(actor: Principal, classId: string, input: { learnerId: string; enrollmentId: string }) {
      return db.transaction(async (tx) => {
        const c = await getVisible(actor, classId, tx, true);
        if (c.status === 'COMPLETED' || c.status === 'CANCELLED') throw Errors.conflict('CLASS_CLOSED', 'Lớp đã kết thúc');
        const [learner] = await tx.select().from(learners).where(eq(learners.id, input.learnerId));
        if (!learner || !canAccessBranch(actor, learner.branchId)) throw Errors.notFound('học viên');
        if (learner.status !== 'ACTIVE') throw Errors.conflict('LEARNER_NOT_ACTIVE', 'Học viên đang bảo lưu / đã nghỉ');
        const [ent] = await tx.select().from(learnerEntitlements).where(eq(learnerEntitlements.enrollmentId, input.enrollmentId));
        if (!ent || ent.learnerId !== learner.id) throw Errors.validation([{ path: 'body.enrollmentId', message: 'Đăng ký không thuộc học viên' }]);
        if (ent.status !== 'ACTIVE') throw Errors.conflict('ENTITLEMENT_INACTIVE', 'Đăng ký đã hết buổi hoặc bị huỷ');
        if (ent.subjectId !== c.subjectId) throw new AppError(422, 'SUBJECT_MISMATCH', 'Đăng ký không cùng môn với lớp');

        const [active] = await tx
          .select({ n: count() })
          .from(classLearners)
          .where(and(eq(classLearners.classId, classId), eq(classLearners.status, 'ACTIVE')));
        if ((active?.n ?? 0) >= c.capacity) throw Errors.conflict('CLASS_FULL', 'Lớp đã đủ sĩ số');

        const current = await tx
          .select({ m: classLearners })
          .from(classLearners)
          .innerJoin(classes, eq(classes.id, classLearners.classId))
          .where(and(eq(classLearners.learnerId, learner.id), eq(classes.subjectId, c.subjectId), inArray(classLearners.status, ['ACTIVE', 'PAUSED'])));
        if (current.some(({ m }) => m.classId === classId)) throw Errors.conflict('ALREADY_IN_CLASS', 'Học viên đã ở lớp này');
        const fromClassId = current[0]?.m.classId ?? null;
        for (const { m } of current) {
          await tx.update(classLearners).set({ status: 'LEFT', leftAt: new Date(), leftReason: `Chuyển sang lớp ${c.code}` }).where(eq(classLearners.id, m.id));
        }

        const membershipId = newId();
        await tx.insert(classLearners).values({ id: membershipId, classId, learnerId: learner.id, enrollmentId: ent.enrollmentId, joinedAt: new Date() });
        const data: LearnerPlacedV1 = { learnerId: learner.id, enrollmentId: ent.enrollmentId, classId, classCode: c.code, className: c.name, fromClassId };
        await appendEvent(tx, eventTables, { type: LMS_EVENTS.learnerPlaced, aggregateId: learner.id, branchId: c.branchId, actorId: actor.userId, data });
        return { membershipId, fromClassId };
      });
    },

    async removeLearner(actor: Principal, membershipId: string, reason: string) {
      await db.transaction(async (tx) => {
        const [m] = await tx.select().from(classLearners).where(eq(classLearners.id, membershipId)).for('update');
        if (!m) throw Errors.notFound('học viên trong lớp');
        await getVisible(actor, m.classId, tx);
        if (m.status === 'LEFT' || m.status === 'COMPLETED') return;
        await tx.update(classLearners).set({ status: 'LEFT', leftAt: new Date(), leftReason: reason }).where(eq(classLearners.id, membershipId));
      });
    },
  };
}

export type ClassesService = ReturnType<typeof createClassesService>;
