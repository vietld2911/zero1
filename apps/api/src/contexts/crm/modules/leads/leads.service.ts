import { and, asc, count, desc, eq, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
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
import type { LEAD_SOURCES} from '../../db/schema.js';
import { guardians, leadAppointments, leadCallLogs, leads, LEAD_STATUSES, outboxEvents, processedEvents, students } from '../../db/schema.js';

const eventTables = { outboxEvents, processedEvents };

type LeadRow = typeof leads.$inferSelect;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Lead còn "mở" — đang được chăm sóc, chưa chốt / chưa mất. */
export const OPEN_STATUSES: LeadStatus[] = ['NEW', 'CONTACTING', 'SCHEDULED', 'ATTENDED', 'NO_SHOW'];
/** Vai trò được giao phụ trách lead. */
export const LEAD_OWNER_ROLES = ['SALE', 'SL', 'CS', 'CM'];

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
  async function toDtos(rows: LeadRow[]) {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))];
    const [owners, branches] = await Promise.all([core.users.getMany(userIds), core.branches.getMany([...new Set(rows.map((r) => r.branchId))])]);
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
      lostReason: l.lostReason,
      notes: l.notes,
      lastContactedAt: l.lastContactedAt ? toApiInstant(l.lastContactedAt) : null,
      nextFollowUpAt: l.nextFollowUpAt ? toApiInstant(l.nextFollowUpAt) : null,
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

    async list(actor: Principal, q: ListLeadsQuery) {
      const statuses = csvList(q.status) as LeadStatus[] | undefined;
      const sources = csvList(q.source) as LeadSource[] | undefined;
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
      );
      const orderBy = parseSort(
        q.sort,
        { createdAt: leads.createdAt, updatedAt: leads.updatedAt, nextFollowUpAt: leads.nextFollowUpAt, childName: leads.childName, status: leads.status },
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
      const [[dto], calls, appointments] = await Promise.all([
        toDtos([row]),
        db.select().from(leadCallLogs).where(eq(leadCallLogs.leadId, id)).orderBy(desc(leadCallLogs.calledAt)),
        db.select().from(leadAppointments).where(eq(leadAppointments.leadId, id)).orderBy(desc(leadAppointments.scheduledAt)),
      ]);
      const callers = new Map((await core.users.getMany([...new Set(calls.map((c) => c.userId))])).map((u) => [u.id, u.fullName]));
      return {
        ...dto!,
        calls: calls.map((c) => ({
          id: c.id,
          outcome: c.outcome,
          note: c.note,
          userName: callers.get(c.userId) ?? null,
          calledAt: toApiInstant(c.calledAt),
          nextFollowUpAt: c.nextFollowUpAt ? toApiInstant(c.nextFollowUpAt) : null,
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
          return { id: canSeeLead(actor, l) ? l.id : null, childName: l.childName, status: l.status, branchName: l.branchName, ownerName: l.ownerName, open: OPEN_STATUSES.includes(l.status) };
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
        await tx.insert(leads).values({
          id,
          branchId,
          ownerId,
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

    async update(
      actor: Principal,
      id: string,
      patch: Partial<Omit<LeadInput, 'branchId' | 'ownerId'>> & { status?: 'NEW' | 'CONTACTING' | 'LOST'; lostReason?: string | null },
      ifMatch?: number,
    ) {
      await db.transaction(async (tx) => {
        const current = await getVisible(actor, id, tx, true);
        if (ifMatch !== undefined && ifMatch !== current.version) throw Errors.conflict('VERSION_CONFLICT', 'Dữ liệu đã bị người khác thay đổi, vui lòng tải lại');
        if (current.status === 'CONVERTED') throw Errors.conflict('LEAD_CONVERTED', 'Lead đã thành học viên — sửa ở hồ sơ học viên');
        if (patch.status === 'LOST' && !(patch.lostReason ?? current.lostReason)) {
          throw Errors.validation([{ path: 'body.lostReason', message: 'Ghi lý do không chốt được' }]);
        }
        if (patch.parentPhone && patch.parentPhone !== current.parentPhone) {
          const dups = await openDuplicates(patch.parentPhone, tx, id);
          if (dups.length) throw await duplicateError(dups);
        }
        const { status, lostReason, ...fields } = patch;
        await tx
          .update(leads)
          .set({
            ...fields,
            ...(status ? { status, lostReason: status === 'LOST' ? (lostReason ?? current.lostReason) : null } : {}),
            version: sql`${leads.version} + 1`,
          })
          .where(eq(leads.id, id));
      });
      return this.get(actor, id);
    },

    async remove(actor: Principal, id: string) {
      await db.transaction(async (tx) => {
        const current = await getVisible(actor, id, tx, true);
        if (current.status === 'CONVERTED') throw Errors.conflict('LEAD_CONVERTED', 'Không xoá lead đã thành học viên');
        await tx.delete(leadCallLogs).where(eq(leadCallLogs.leadId, id));
        await tx.delete(leadAppointments).where(eq(leadAppointments.leadId, id));
        await tx.delete(leads).where(eq(leads.id, id));
      });
    },

    /** Phân công hàng loạt; `ownerId = null` → trả về "chưa phân công". */
    async assign(actor: Principal, leadIds: string[], ownerId: string | null) {
      const rows = await db.select().from(leads).where(and(inArray(leads.id, leadIds), leadVisibility(actor)));
      if (rows.length !== new Set(leadIds).size) throw Errors.notFound('khách hàng tiềm năng');
      if (rows.some((r) => r.status === 'CONVERTED')) throw Errors.conflict('LEAD_CONVERTED', 'Có lead đã thành học viên');
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

    async logCall(actor: Principal, id: string, input: { outcome: (typeof leadCallLogs.$inferInsert)['outcome']; note?: string | null; nextFollowUpAt?: Date | null }) {
      // Cho lệch đồng hồ 1 phút.
      if (input.nextFollowUpAt && input.nextFollowUpAt.getTime() <= Date.now() - 60_000) {
        throw Errors.validation([{ path: 'body.nextFollowUpAt', message: 'Lịch gọi lại phải ở tương lai' }]);
      }
      await db.transaction(async (tx) => {
        const lead = await getVisible(actor, id, tx, true);
        if (!OPEN_STATUSES.includes(lead.status)) throw Errors.conflict('LEAD_CLOSED', 'Lead đã chốt hoặc đã mất');
        const now = new Date();
        await tx.insert(leadCallLogs).values({
          id: newId(),
          leadId: id,
          userId: actor.userId,
          outcome: input.outcome,
          note: input.note ?? null,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          calledAt: now,
        });
        await tx
          .update(leads)
          .set({
            lastContactedAt: now,
            nextFollowUpAt: input.nextFollowUpAt ?? null,
            ...(lead.status === 'NEW' ? { status: 'CONTACTING' as const } : {}),
            version: sql`${leads.version} + 1`,
          })
          .where(eq(leads.id, id));
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
        for (let i = 0; i < values.length; i += 500) await tx.insert(leads).values(values.slice(i, i + 500));
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
      if (lead.status === 'CONVERTED') throw Errors.conflict('LEAD_CONVERTED', 'Lead đã được chuyển thành học viên');
      if (lead.status === 'LOST') throw Errors.conflict('LEAD_CLOSED', 'Lead đã đánh dấu mất — mở lại trước khi chuyển');
      return lead;
    },
  };
}

export type LeadsService = ReturnType<typeof createLeadsService>;
