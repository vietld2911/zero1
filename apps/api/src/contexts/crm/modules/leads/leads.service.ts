import { and, asc, count, desc, eq, inArray, isNull, like, lt, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { csvList, likeContains, pageMeta, pageOffset, parseSort } from '../../../../platform/http/list.js';
import { can, canAccessBranch, type Principal } from '../../../../platform/auth/principal.js';
import { scopeWhere } from '../../../../platform/auth/scope-sql.js';
import { normalizePhone } from '../../../../platform/text.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { CoreContract } from '../../../core/contract/index.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { CRM_EVENTS, type LeadCreatedV1 } from '../../../../contracts/events/crm.js';
import type { CrmDb, CrmExecutor } from '../../db/types.js';
import type { LEAD_SOURCES } from '../../db/schema.js';
import { guardians, leadAppointments, leadCallLogs, leads, leadStatusLogs, LEAD_STATUSES, outboxEvents, processedEvents, students } from '../../db/schema.js';
import { S1B_WINDOW_DAYS } from '../../settings.js';
import { isOpen, isStopped, MANUAL_STATUSES, NEEDS_S4, OPEN_STATUSES, stageOf, STOPPED_STATUSES, type LeadStatus, type LeadStatusSource } from './stages.js';

const eventTables = { outboxEvents, processedEvents };

export type LeadRow = typeof leads.$inferSelect;
export type { LeadStatus } from './stages.js';
export type LeadSource = (typeof LEAD_SOURCES)[number];
export { OPEN_STATUSES } from './stages.js';
/** Vai trò được giao phụ trách lead. */
export const LEAD_OWNER_ROLES = ['SALE', 'SL', 'CS', 'CM'];

/** Lịch hẹn còn hiệu lực (chưa diễn ra, chưa huỷ). */
const PENDING_APPOINTMENT = ['SCHEDULED', 'CONFIRMED'] as const;
/** Đổi tay → xoá đánh dấu "đăng ký đã huỷ". */
const MANUAL_SOURCES: LeadStatusSource[] = ['CALL', 'MANUAL', 'REOPEN'];
const REACHED = [
  [2, 'reachedS2At'],
  [3, 'reachedS3At'],
  [4, 'reachedS4At'],
  [5, 'reachedS5At'],
] as const;

export interface TransitionOptions {
  source: LeadStatusSource;
  note?: string | null;
  /** null = hệ thống tự đổi. */
  actorId?: string | null;
  callLogId?: string | null;
  /** Cột khác ghi cùng lúc (cuộc gọi, lý do dừng…) — vẫn ghi khi trạng thái không đổi. */
  set?: Partial<typeof leads.$inferInsert>;
  now?: Date;
}

/**
 * Chỗ DUY NHẤT đổi trạng thái lead: trạng thái, thời điểm đổi, mốc "lần đầu đạt bước"
 * (điền luôn các bước thấp hơn còn trống), version, lịch sử. Không đổi trạng thái → không ghi lịch sử.
 * Gọi trong transaction, với dòng lead vừa đọc (nên khoá `for update`).
 */
export async function transition(tx: CrmExecutor, lead: LeadRow, to: LeadStatus, opts: TransitionOptions): Promise<boolean> {
  const now = opts.now ?? new Date();
  const changed = to !== lead.status;
  if (!changed && !opts.set) return false;
  const patch: Partial<typeof leads.$inferInsert> = {};
  if (changed) {
    patch.status = to;
    patch.statusChangedAt = now;
    for (const [stage, col] of REACHED) if (stage <= stageOf(to) && !lead[col]) patch[col] = now;
    if (!isStopped(to)) patch.lostReason = null;
    if (MANUAL_SOURCES.includes(opts.source)) patch.enrollmentCancelledAt = null;
  }
  await tx
    .update(leads)
    .set({ ...patch, ...opts.set, version: sql`${leads.version} + 1` })
    .where(eq(leads.id, lead.id));
  if (changed) {
    await tx.insert(leadStatusLogs).values({
      id: newId(),
      leadId: lead.id,
      fromStatus: lead.status,
      toStatus: to,
      source: opts.source,
      note: opts.note ?? null,
      callLogId: opts.callLogId ?? null,
      actorId: opts.actorId ?? null,
      createdAt: now,
    });
  }
  return changed;
}

/** Khoá lead nguồn của học viên (nếu có) để đổi trạng thái theo đăng ký. */
async function leadOfStudent(tx: CrmExecutor, studentId: string) {
  const [lead] = await tx.select().from(leads).where(eq(leads.convertedStudentId, studentId)).for('update');
  return lead;
}

/** Trạng thái lead đi theo đăng ký của học viên (gọi từ enrollments, trong transaction). */
export const leadEnrollmentHooks = {
  /** Đăng ký mới cho học viên có lead nguồn đã huỷ đăng ký (hoặc đã bị chọn lùi bước) → S5A, bỏ đánh dấu. */
  async created(tx: CrmExecutor, studentId: string, enrollmentCode: string, actorId: string) {
    const lead = await leadOfStudent(tx, studentId);
    if (!lead || (!lead.enrollmentCancelledAt && stageOf(lead.status) === 5)) return;
    await transition(tx, lead, 'S5A', { source: 'ENROLLMENT', note: `Đăng ký mới ${enrollmentCode}`, actorId, set: { enrollmentCancelledAt: null } });
  },
  /** Khoản thu đầu tiên được xác nhận → S5B. */
  async activated(tx: CrmExecutor, studentId: string, enrollmentCode: string, actorId: string) {
    const lead = await leadOfStudent(tx, studentId);
    if (lead?.status !== 'S5A') return;
    await transition(tx, lead, 'S5B', { source: 'PAYMENT', note: `Đăng ký ${enrollmentCode} đã có khoản thu`, actorId });
  },
  /** Huỷ đăng ký: học viên không còn đăng ký nào chưa huỷ → S5A + đánh dấu "đăng ký đã huỷ". */
  async cancelled(tx: CrmExecutor, studentId: string, enrollmentCode: string, reason: string, actorId: string, remaining: number) {
    if (remaining > 0) return;
    const lead = await leadOfStudent(tx, studentId);
    if (!lead || stageOf(lead.status) !== 5) return;
    await transition(tx, lead, 'S5A', { source: 'ENROLLMENT', note: `Huỷ đăng ký ${enrollmentCode}: ${reason}`.slice(0, 1000), actorId, set: { enrollmentCancelledAt: new Date() } });
  },
};

/** Thông tin đi kèm khi chọn trạng thái tay. */
export interface ManualStatusInput {
  status: LeadStatus;
  note: string;
  lostReason?: string | null;
  nextFollowUpAt?: Date | null;
}

/**
 * Quy tắc chọn trạng thái tay (ghi cuộc gọi / đổi trạng thái / mở lại) — docs/gd7-lead-stages.md §3.
 * `reopen`: chỉ cho lead đã dừng, chọn trạng thái tay chưa dừng.
 */
function assertManualStatus(lead: LeadRow, input: ManualStatusInput, ctx: { pendingAppointment: boolean; reopen?: boolean }) {
  const to = input.status;
  if (ctx.reopen) {
    if (!isStopped(lead.status)) throw Errors.conflict('LEAD_NOT_STOPPED', 'Chỉ mở lại được lead đã dừng');
    if (!MANUAL_STATUSES.includes(to) || isStopped(to)) {
      throw Errors.validation([{ path: 'body.status', message: 'Mở lại về S1B, S2A, S2B hoặc S4B' }]);
    }
  } else {
    if (isStopped(lead.status)) throw Errors.conflict('LEAD_CLOSED', 'Lead đã dừng', 'Người có quyền mở lại lead trước');
    if (to === lead.status) return;
    if (stageOf(lead.status) === 5 && !lead.enrollmentCancelledAt) {
      throw Errors.conflict('LEAD_ENROLLED', 'Lead đã đăng ký — trạng thái đi theo đăng ký', 'Chỉ chọn lại khi đăng ký bị huỷ');
    }
    if (!MANUAL_STATUSES.includes(to)) {
      throw Errors.validation([{ path: 'body.status', message: 'S3, S4A, S5 không chọn tay được — đi theo lịch hẹn, điểm danh và đăng ký' }]);
    }
  }
  if (NEEDS_S4.includes(to) && !lead.reachedS4At) {
    throw Errors.validation([{ path: 'body.status', message: 'S4B / S4C chỉ chọn được khi khách đã trial (từng đạt S4)' }]);
  }
  if (isStopped(to) && !input.lostReason?.trim()) throw Errors.validation([{ path: 'body.lostReason', message: 'Ghi lý do dừng' }]);
  if (to === 'S4B' && !input.nextFollowUpAt) throw Errors.validation([{ path: 'body.nextFollowUpAt', message: 'Chọn ngày hẹn đóng phí' }]);
  if (ctx.pendingAppointment && stageOf(to) < 3) {
    throw Errors.conflict('LEAD_HAS_APPOINTMENT', 'Lead đang có lịch hẹn chờ', 'Huỷ lịch hẹn trước khi chọn trạng thái dưới S3');
  }
}

/** Cho lệch đồng hồ 1 phút. */
function assertFuture(at: Date | null | undefined, path = 'body.nextFollowUpAt') {
  if (at && at.getTime() <= Date.now() - 60_000) throw Errors.validation([{ path, message: 'Thời điểm hẹn phải ở tương lai' }]);
}

export interface LeadInput {
  branchId?: string;
  ownerId?: string | null;
  parentName: string;
  parentPhone: string;
  parentEmail?: string | null;
  childName: string;
  childBirthYear?: number | null;
  school?: string | null;
  interestSubjectId?: string | null;
  source: LeadSource;
  notes?: string | null;
}

export interface ListLeadsQuery {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  status?: string;
  source?: string;
  branchId?: string;
  ownerId?: string;
  followUpDue?: boolean;
  /** Bước 1–5, nhiều giá trị cách nhau dấu phẩy. */
  stage?: string;
  /** true = chỉ lead đã dừng; false = bỏ lead đã dừng. */
  stopped?: boolean;
  /** S1B quá hạn khai thác. */
  stale?: boolean;
}

/** Điều kiện "người gọi thấy lead này" (chi nhánh / đội / của mình). */
export function leadVisibility(actor: Principal): SQL | undefined {
  return scopeWhere(actor.scope, { branch: leads.branchId, owner: leads.ownerId });
}

/** Cùng quy tắc với `leadVisibility`, kiểm tra trên một bản ghi đã đọc. */
export function canSeeLead(actor: Principal, lead: { branchId: string; ownerId: string | null }): boolean {
  const s = actor.scope;
  switch (s.kind) {
    case 'ALL':
      return true;
    case 'BRANCHES':
      return s.branchIds.includes(lead.branchId);
    case 'TEAM':
      return s.branchIds.includes(lead.branchId) && !!lead.ownerId && s.userIds.includes(lead.ownerId);
    case 'OWN':
      return s.branchIds.includes(lead.branchId) && lead.ownerId === s.userId;
    case 'TEACHING':
      return false;
  }
}

export function createLeadsService(db: CrmDb, core: CoreContract) {
  /** Mốc "quá hạn khai thác" của S1B theo từng chi nhánh: lần gọi đầu trước mốc này là quá hạn. */
  async function staleCutoffs(branchIds: string[], now = new Date()) {
    const days = await Promise.all(branchIds.map((b) => core.settings.get(S1B_WINDOW_DAYS, b)));
    return new Map(branchIds.map((b, i) => [b, new Date(now.getTime() - days[i]! * 86_400_000)]));
  }

  /** Điều kiện SQL "S1B quá hạn khai thác" trên các chi nhánh đang hoạt động. */
  async function staleWhere(now = new Date()) {
    const branches = await core.branches.listActive();
    const cutoffs = await staleCutoffs(
      branches.map((b) => b.id),
      now,
    );
    const perBranch = [...cutoffs].map(([branchId, cutoff]) => and(eq(leads.branchId, branchId), lt(leads.firstCalledAt, cutoff)));
    return and(eq(leads.status, 'S1B'), perBranch.length ? or(...perBranch) : sql`FALSE`);
  }

  async function toDtos(rows: LeadRow[]) {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))];
    const branchIds = [...new Set(rows.map((r) => r.branchId))];
    const [owners, branches, cutoffs] = await Promise.all([
      core.users.getMany(userIds),
      core.branches.getMany(branchIds),
      rows.some((r) => r.status === 'S1B') ? staleCutoffs(branchIds) : Promise.resolve(new Map<string, Date>()),
    ]);
    const ownerName = new Map(owners.map((u) => [u.id, u.fullName]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    return rows.map((l) => ({
      id: l.id,
      branchId: l.branchId,
      branchName: branchName.get(l.branchId) ?? null,
      ownerId: l.ownerId,
      ownerName: l.ownerId ? (ownerName.get(l.ownerId) ?? null) : null,
      parentName: l.parentName,
      parentPhone: l.parentPhone,
      parentEmail: l.parentEmail,
      childName: l.childName,
      childBirthYear: l.childBirthYear,
      school: l.school,
      interestSubjectId: l.interestSubjectId,
      source: l.source,
      status: l.status,
      statusChangedAt: l.statusChangedAt ? toApiInstant(l.statusChangedAt) : null,
      lostReason: l.lostReason,
      notes: l.notes,
      lastContactedAt: l.lastContactedAt ? toApiInstant(l.lastContactedAt) : null,
      nextFollowUpAt: l.nextFollowUpAt ? toApiInstant(l.nextFollowUpAt) : null,
      firstCalledAt: l.firstCalledAt ? toApiInstant(l.firstCalledAt) : null,
      reachedS2At: l.reachedS2At ? toApiInstant(l.reachedS2At) : null,
      reachedS3At: l.reachedS3At ? toApiInstant(l.reachedS3At) : null,
      reachedS4At: l.reachedS4At ? toApiInstant(l.reachedS4At) : null,
      reachedS5At: l.reachedS5At ? toApiInstant(l.reachedS5At) : null,
      enrollmentCancelled: !!l.enrollmentCancelledAt,
      stale: l.status === 'S1B' && !!l.firstCalledAt && !!cutoffs.get(l.branchId) && l.firstCalledAt < cutoffs.get(l.branchId)!,
      convertedStudentId: l.convertedStudentId,
      createdAt: toApiInstant(l.createdAt),
      version: l.version,
    }));
  }

  /** Lead trong phạm vi người gọi; ngoài phạm vi → 404. */
  async function getVisible(actor: Principal, id: string, exec: CrmExecutor = db, lock = false) {
    const q = exec.select().from(leads).where(and(eq(leads.id, id), leadVisibility(actor)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw Errors.notFound('khách hàng tiềm năng');
    return row;
  }

  /** Người được giao phải đang làm việc, đúng vai trò bán hàng và cùng chi nhánh với lead. */
  async function assertOwner(ownerId: string, branchId: string) {
    const [owner] = await core.users.getMany([ownerId]);
    if (!owner || owner.status !== 'ACTIVE' || !LEAD_OWNER_ROLES.includes(owner.role) || !owner.branchIds.includes(branchId)) {
      throw new AppError(422, 'OWNER_INVALID', 'Người phụ trách không hợp lệ', 'Phải là SALE / SL / CS / CM đang làm việc tại chi nhánh của lead');
    }
  }

  async function openDuplicates(phone: string, exec: CrmExecutor = db, exceptId?: string) {
    return exec
      .select()
      .from(leads)
      .where(and(eq(leads.parentPhone, phone), inArray(leads.status, OPEN_STATUSES), exceptId ? sql`${leads.id} <> ${exceptId}` : undefined));
  }

  async function hasPendingAppointment(exec: CrmExecutor, leadId: string) {
    const [row] = await exec
      .select({ n: count() })
      .from(leadAppointments)
      .where(and(eq(leadAppointments.leadId, leadId), inArray(leadAppointments.status, [...PENDING_APPOINTMENT])));
    return (row?.n ?? 0) > 0;
  }

  function defaultBranch(actor: Principal, requested?: string) {
    const branchId = requested ?? actor.branchIds[0];
    if (!branchId) throw Errors.validation([{ path: 'body.branchId', message: 'Chọn chi nhánh' }]);
    if (!canAccessBranch(actor, branchId)) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
    return branchId;
  }

  /** SALE / SL tự nhận lead mình tạo; quản lý tạo thì để trống (chờ phân công) trừ khi chỉ định. */
  function defaultOwner(actor: Principal, requested: string | null | undefined): string | null {
    if (requested !== undefined) return requested;
    return ['SALE', 'SL'].includes(actor.role) ? actor.userId : null;
  }

  async function duplicateError(dups: LeadRow[]) {
    const [first] = await toDtos(dups.slice(0, 1));
    return new AppError(
      409,
      'LEAD_DUPLICATE',
      'Số điện thoại đã có lead đang chăm sóc',
      `${first?.childName ?? ''} — ${first?.branchName ?? ''}${first?.ownerName ? `, ${first.ownerName} phụ trách` : ', chưa phân công'}`,
    );
  }

  return {
    toDtos,
    getVisible,
    staleWhere,

    async list(actor: Principal, q: ListLeadsQuery) {
      const statuses = csvList(q.status) as LeadStatus[] | undefined;
      const sources = csvList(q.source) as LeadSource[] | undefined;
      const stages = csvList(q.stage)?.map(Number);
      const phone = q.q ? normalizePhone(q.q) : null;
      const where = and(
        leadVisibility(actor),
        q.q
          ? or(like(leads.childName, likeContains(q.q)), like(leads.parentName, likeContains(q.q)), like(leads.parentPhone, likeContains(phone ?? q.q.replace(/\s/g, ''))))
          : undefined,
        statuses ? inArray(leads.status, statuses) : undefined,
        sources ? inArray(leads.source, sources) : undefined,
        q.branchId ? eq(leads.branchId, q.branchId) : undefined,
        q.ownerId === 'none' ? isNull(leads.ownerId) : q.ownerId ? eq(leads.ownerId, q.ownerId) : undefined,
        q.followUpDue ? and(lte(leads.nextFollowUpAt, new Date()), inArray(leads.status, OPEN_STATUSES)) : undefined,
        stages ? inArray(leads.status, LEAD_STATUSES.filter((s) => stages.includes(stageOf(s)))) : undefined,
        q.stopped === true ? inArray(leads.status, STOPPED_STATUSES) : q.stopped === false ? notInArray(leads.status, STOPPED_STATUSES) : undefined,
        q.stale ? await staleWhere() : undefined,
      );
      const orderBy = parseSort(
        q.sort,
        {
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
          nextFollowUpAt: leads.nextFollowUpAt,
          childName: leads.childName,
          status: leads.status,
          statusChangedAt: leads.statusChangedAt,
          firstCalledAt: leads.firstCalledAt,
        },
        [desc(leads.createdAt)],
      );
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db.select().from(leads).where(where).orderBy(...orderBy, desc(leads.id)).limit(limit).offset(offset),
        db.select({ n: count() }).from(leads).where(where),
      ]);
      return { data: await toDtos(rows), meta: pageMeta(q.page, q.pageSize, total?.n ?? 0) };
    },

    /** Số lead theo trạng thái (cho thanh lọc nhanh). */
    async statusCounts(actor: Principal, branchId?: string) {
      const rows = await db
        .select({ status: leads.status, n: count() })
        .from(leads)
        .where(and(leadVisibility(actor), branchId ? eq(leads.branchId, branchId) : undefined))
        .groupBy(leads.status);
      return Object.fromEntries(LEAD_STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.n ?? 0])) as Record<LeadStatus, number>;
    },

    async get(actor: Principal, id: string) {
      const row = await getVisible(actor, id);
      const [[dto], calls, appointments, logs] = await Promise.all([
        toDtos([row]),
        db.select().from(leadCallLogs).where(eq(leadCallLogs.leadId, id)).orderBy(desc(leadCallLogs.calledAt)),
        db.select().from(leadAppointments).where(eq(leadAppointments.leadId, id)).orderBy(desc(leadAppointments.scheduledAt)),
        db.select().from(leadStatusLogs).where(eq(leadStatusLogs.leadId, id)).orderBy(desc(leadStatusLogs.createdAt), desc(leadStatusLogs.id)),
      ]);
      const people = new Map(
        (await core.users.getMany([...new Set([...calls.map((c) => c.userId), ...logs.map((l) => l.actorId).filter((x): x is string => !!x)])])).map((u) => [u.id, u.fullName]),
      );
      /** Trạng thái sau cuộc gọi: log của chính cuộc gọi, không có (giữ nguyên) → trạng thái gần nhất trước đó. */
      const statusAfter = (c: (typeof calls)[number]) => (logs.find((l) => l.callLogId === c.id) ?? logs.find((l) => l.createdAt <= c.calledAt))?.toStatus ?? null;
      return {
        ...dto!,
        calls: calls.map((c) => ({
          id: c.id,
          outcome: c.outcome,
          note: c.note,
          userName: people.get(c.userId) ?? null,
          calledAt: toApiInstant(c.calledAt),
          nextFollowUpAt: c.nextFollowUpAt ? toApiInstant(c.nextFollowUpAt) : null,
          statusAfter: statusAfter(c),
        })),
        statusLogs: logs.map((l) => ({
          id: l.id,
          fromStatus: l.fromStatus,
          toStatus: l.toStatus,
          source: l.source,
          note: l.note,
          actorName: l.actorId ? (people.get(l.actorId) ?? null) : null,
          createdAt: toApiInstant(l.createdAt),
        })),
        appointments: appointments.map((a) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          scheduledAt: toApiInstant(a.scheduledAt),
          lmsSessionId: a.lmsSessionId,
          note: a.note,
          resultNote: a.resultNote,
        })),
      };
    },

    /** Kiểm tra trùng số điện thoại trên toàn hệ thống (lead đang mở + học viên). */
    async checkPhone(actor: Principal, rawPhone: string) {
      const phone = normalizePhone(rawPhone);
      if (!phone) throw Errors.validation([{ path: 'query.phone', message: 'Số điện thoại không hợp lệ' }]);
      const [leadRows, studentRows] = await Promise.all([
        db.select().from(leads).where(eq(leads.parentPhone, phone)).orderBy(desc(leads.createdAt)).limit(20),
        db
          .select({ id: students.id, code: students.code, fullName: students.fullName, branchId: students.branchId, status: students.status })
          .from(guardians)
          .innerJoin(students, eq(students.id, guardians.studentId))
          .where(eq(guardians.phone, phone))
          .limit(20),
      ]);
      const dtos = await toDtos(leadRows);
      return {
        phone,
        leads: dtos.map((l) => {
          // Lead ngoài phạm vi: chỉ cho biết là có (để tránh tranh khách), không trả id.
          return { id: canSeeLead(actor, l) ? l.id : null, childName: l.childName, status: l.status, branchName: l.branchName, ownerName: l.ownerName, open: isOpen(l.status) };
        }),
        students: studentRows.map((s) => ({ id: canAccessBranch(actor, s.branchId) ? s.id : null, code: s.code, fullName: s.fullName, status: s.status })),
      };
    },

    async create(actor: Principal, input: LeadInput, force: boolean) {
      const branchId = defaultBranch(actor, input.branchId);
      const ownerId = defaultOwner(actor, input.ownerId);
      if (ownerId) await assertOwner(ownerId, branchId);
      const id = newId();
      await db.transaction(async (tx) => {
        const dups = await openDuplicates(input.parentPhone, tx);
        // Trùng với lead của chính con này (cùng tên) thì luôn chặn; khác tên (anh chị em) thì cho quản lý ghi đè.
        const sameChild = dups.filter((d) => d.childName.trim().toLowerCase() === input.childName.trim().toLowerCase());
        if (sameChild.length || (dups.length && !(force && can(actor, 'crm.leads.assign')))) throw await duplicateError(sameChild.length ? sameChild : dups);
        const now = new Date();
        await tx.insert(leads).values({
          id,
          branchId,
          ownerId,
          status: 'S1A',
          statusChangedAt: now,
          parentName: input.parentName,
          parentPhone: input.parentPhone,
          parentEmail: input.parentEmail ?? null,
          childName: input.childName,
          childBirthYear: input.childBirthYear ?? null,
          school: input.school ?? null,
          interestSubjectId: input.interestSubjectId ?? null,
          source: input.source,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        });
        await tx.insert(leadStatusLogs).values({ id: newId(), leadId: id, fromStatus: null, toStatus: 'S1A', source: 'CREATE', actorId: actor.userId, createdAt: now });
        const data: LeadCreatedV1 = {
          leadId: id,
          childName: input.childName,
          parentName: input.parentName,
          parentPhone: input.parentPhone,
          source: input.source,
          ownerId,
          via: actor.role === 'INTEGRATION' ? 'API' : 'MANUAL',
        };
        await appendEvent(tx, eventTables, { type: CRM_EVENTS.leadCreated, aggregateId: id, branchId, actorId: actor.userId, data });
      });
      if (ownerId && ownerId !== actor.userId) {
        await core.notifications.send([
          { userId: ownerId, type: 'crm.lead.assigned', app: 'crm', title: 'Bạn được giao khách hàng mới', body: `${input.childName} · ${input.parentPhone}`, link: `/leads/${id}` },
        ]);
      }
      return this.get(actor, id);
    },

    /** Sửa thông tin lead. Trạng thái đổi qua ghi cuộc gọi / đổi trạng thái / mở lại. */
    async update(actor: Principal, id: string, patch: Partial<Omit<LeadInput, 'branchId' | 'ownerId'>>, ifMatch?: number) {
      await db.transaction(async (tx) => {
        const current = await getVisible(actor, id, tx, true);
        if (ifMatch !== undefined && ifMatch !== current.version) throw Errors.conflict('VERSION_CONFLICT', 'Dữ liệu đã bị người khác thay đổi, vui lòng tải lại');
        if (current.convertedStudentId) throw Errors.conflict('LEAD_CONVERTED', 'Lead đã thành học viên — sửa ở hồ sơ học viên');
        if (patch.parentPhone && patch.parentPhone !== current.parentPhone) {
          const dups = await openDuplicates(patch.parentPhone, tx, id);
          if (dups.length) throw await duplicateError(dups);
        }
        await tx
          .update(leads)
          .set({ ...patch, version: sql`${leads.version} + 1` })
          .where(eq(leads.id, id));
      });
      return this.get(actor, id);
    },

    async remove(actor: Principal, id: string) {
      await db.transaction(async (tx) => {
        const current = await getVisible(actor, id, tx, true);
        if (current.convertedStudentId) throw Errors.conflict('LEAD_CONVERTED', 'Không xoá lead đã thành học viên');
        await tx.delete(leadStatusLogs).where(eq(leadStatusLogs.leadId, id));
        await tx.delete(leadCallLogs).where(eq(leadCallLogs.leadId, id));
        await tx.delete(leadAppointments).where(eq(leadAppointments.leadId, id));
        await tx.delete(leads).where(eq(leads.id, id));
      });
    },

    /** Phân công hàng loạt; `ownerId = null` → trả về "chưa phân công". */
    async assign(actor: Principal, leadIds: string[], ownerId: string | null) {
      const rows = await db.select().from(leads).where(and(inArray(leads.id, leadIds), leadVisibility(actor)));
      if (rows.length !== new Set(leadIds).size) throw Errors.notFound('khách hàng tiềm năng');
      if (rows.some((r) => r.convertedStudentId)) throw Errors.conflict('LEAD_CONVERTED', 'Có lead đã thành học viên');
      if (ownerId) for (const branchId of new Set(rows.map((r) => r.branchId))) await assertOwner(ownerId, branchId);
      await db
        .update(leads)
        .set({ ownerId, version: sql`${leads.version} + 1` })
        .where(inArray(leads.id, leadIds));
      const moved = rows.filter((r) => r.ownerId !== ownerId);
      if (ownerId && ownerId !== actor.userId && moved.length) {
        const first = moved[0]!;
        await core.notifications.send([
          moved.length === 1
            ? { userId: ownerId, type: 'crm.lead.assigned', app: 'crm', title: 'Bạn được giao khách hàng mới', body: `${first.childName} · ${first.parentPhone}`, link: `/leads/${first.id}` }
            : { userId: ownerId, type: 'crm.lead.assigned', app: 'crm', title: `Bạn được giao ${moved.length} khách hàng mới`, link: '/leads' },
        ]);
      }
      return { updated: rows.length };
    },

    /**
     * Ghi cuộc gọi + chọn trạng thái lead sau cuộc gọi (bắt buộc, kèm ghi chú).
     * Giao diện gợi ý: không nghe / bận / gọi lại sau → S1B; sai số → S1C; nói chuyện được → S2A.
     */
    async logCall(actor: Principal, id: string, input: ManualStatusInput & { outcome: (typeof leadCallLogs.$inferInsert)['outcome'] }) {
      assertFuture(input.nextFollowUpAt);
      await db.transaction(async (tx) => {
        const lead = await getVisible(actor, id, tx, true);
        assertManualStatus(lead, input, { pendingAppointment: await hasPendingAppointment(tx, id) });
        const now = new Date();
        const callLogId = newId();
        await tx.insert(leadCallLogs).values({
          id: callLogId,
          leadId: id,
          userId: actor.userId,
          outcome: input.outcome,
          note: input.note,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          calledAt: now,
        });
        await transition(tx, lead, input.status, {
          source: 'CALL',
          note: input.note,
          actorId: actor.userId,
          callLogId,
          now,
          set: {
            lastContactedAt: now,
            firstCalledAt: lead.firstCalledAt ?? now,
            nextFollowUpAt: input.nextFollowUpAt ?? null,
            ...(isStopped(input.status) && input.status !== lead.status ? { lostReason: input.lostReason!.trim() } : {}),
          },
        });
      });
      return this.get(actor, id);
    },

    /** Đổi trạng thái không qua cuộc gọi (bắt buộc ghi chú). */
    async changeStatus(actor: Principal, id: string, input: ManualStatusInput) {
      assertFuture(input.nextFollowUpAt);
      await db.transaction(async (tx) => {
        const lead = await getVisible(actor, id, tx, true);
        assertManualStatus(lead, input, { pendingAppointment: await hasPendingAppointment(tx, id) });
        if (input.status === lead.status) return;
        await transition(tx, lead, input.status, {
          source: 'MANUAL',
          note: input.note,
          actorId: actor.userId,
          set: {
            ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : {}),
            ...(isStopped(input.status) ? { lostReason: input.lostReason!.trim() } : {}),
          },
        });
      });
      return this.get(actor, id);
    },

    /** Mở lại lead đã dừng (SL trở lên). */
    async reopen(actor: Principal, id: string, input: ManualStatusInput) {
      assertFuture(input.nextFollowUpAt);
      await db.transaction(async (tx) => {
        const lead = await getVisible(actor, id, tx, true);
        assertManualStatus(lead, input, { pendingAppointment: await hasPendingAppointment(tx, id), reopen: true });
        await transition(tx, lead, input.status, {
          source: 'REOPEN',
          note: input.note,
          actorId: actor.userId,
          set: input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : undefined,
        });
      });
      return this.get(actor, id);
    },

    /** Nhập nhiều lead (dùng cho import Excel). Trả về dòng nào tạo được / bỏ qua vì sao. */
    async bulkCreate(actor: Principal, rows: Array<{ row: number; input: LeadInput }>, branchIdReq: string | undefined, ownerIdReq: string | null | undefined) {
      const branchId = defaultBranch(actor, branchIdReq);
      const ownerId = defaultOwner(actor, ownerIdReq);
      if (ownerId) await assertOwner(ownerId, branchId);
      const phones = [...new Set(rows.map((r) => r.input.parentPhone))];
      const existing = phones.length
        ? await db.select({ phone: leads.parentPhone, childName: leads.childName }).from(leads).where(and(inArray(leads.parentPhone, phones), inArray(leads.status, OPEN_STATUSES)))
        : [];
      const seen = new Set(existing.map((e) => `${e.phone}|${e.childName.trim().toLowerCase()}`));
      const now = new Date();
      const created: number[] = [];
      const skipped: Array<{ row: number; reason: string }> = [];
      const values: Array<typeof leads.$inferInsert> = [];
      for (const { row, input } of rows) {
        const key = `${input.parentPhone}|${input.childName.trim().toLowerCase()}`;
        if (seen.has(key)) {
          skipped.push({ row, reason: 'Trùng lead đang chăm sóc (cùng SĐT + tên con)' });
          continue;
        }
        seen.add(key);
        created.push(row);
        values.push({
          id: newId(),
          branchId,
          ownerId,
          status: 'S1A',
          statusChangedAt: now,
          parentName: input.parentName,
          parentPhone: input.parentPhone,
          parentEmail: input.parentEmail ?? null,
          childName: input.childName,
          childBirthYear: input.childBirthYear ?? null,
          school: input.school ?? null,
          source: input.source,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        });
      }
      await db.transaction(async (tx) => {
        for (let i = 0; i < values.length; i += 500) {
          const chunk = values.slice(i, i + 500);
          await tx.insert(leads).values(chunk);
          await tx
            .insert(leadStatusLogs)
            .values(chunk.map((v) => ({ id: newId(), leadId: v.id!, fromStatus: null, toStatus: 'S1A' as const, source: 'CREATE' as const, actorId: actor.userId, createdAt: now })));
        }
        for (const v of values) {
          const data: LeadCreatedV1 = {
            leadId: v.id!,
            childName: v.childName,
            parentName: v.parentName,
            parentPhone: v.parentPhone,
            source: v.source,
            ownerId: v.ownerId ?? null,
            via: 'IMPORT',
          };
          await appendEvent(tx, eventTables, { type: CRM_EVENTS.leadCreated, aggregateId: v.id!, branchId, actorId: actor.userId, data });
        }
      });
      if (ownerId && ownerId !== actor.userId && values.length) {
        await core.notifications.send([{ userId: ownerId, type: 'crm.lead.assigned', app: 'crm', title: `Bạn được giao ${values.length} khách hàng từ file Excel`, link: '/leads' }]);
      }
      return { created: created.length, skipped };
    },

    /** Lead đã có lịch / đã hẹn — cho bộ lọc nhanh "cần gọi lại hôm nay". */
    async followUps(actor: Principal) {
      const rows = await db
        .select()
        .from(leads)
        .where(and(leadVisibility(actor), inArray(leads.status, OPEN_STATUSES), lte(leads.nextFollowUpAt, new Date(Date.now() + 86_400_000))))
        .orderBy(asc(leads.nextFollowUpAt))
        .limit(50);
      return toDtos(rows);
    },

    /** Dùng khi chuyển thành học viên (khoá dòng lead trong transaction). */
    async lockForConvert(actor: Principal, id: string, tx: CrmExecutor) {
      const lead = await getVisible(actor, id, tx, true);
      if (lead.convertedStudentId) throw Errors.conflict('LEAD_CONVERTED', 'Lead đã được chuyển thành học viên');
      if (isStopped(lead.status)) throw Errors.conflict('LEAD_CLOSED', 'Lead đã dừng — mở lại trước khi chuyển');
      return lead;
    },
  };
}

export type LeadsService = ReturnType<typeof createLeadsService>;
