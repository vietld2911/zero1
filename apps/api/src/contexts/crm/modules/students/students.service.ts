import { and, count, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { csvList, likeContains, pageMeta, pageOffset, parseSort } from '../../../../platform/http/list.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { runOnce } from '../../../../platform/events/run-once.js';
import { scopeWhere } from '../../../../platform/auth/scope-sql.js';
import { nextSequence, yearCode } from '../../../../platform/db/sequences.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import { normalizePhone } from '../../../../platform/text.js';
import { toApiInstant, vnDate } from '../../../../platform/time.js';
import type { FileStorage } from '../../../../integrations/storage.js';
import { CRM_EVENTS, type StudentStatus, type StudentStatusChangedV1, type StudentUpdatedV1 } from '../../../../contracts/events/crm.js';
import { LMS_EVENTS, type LearnerPlacedV1, type LearnerPromotedV1 } from '../../../../contracts/events/lms.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { CrmDb, CrmExecutor } from '../../db/types.js';
import { guardians, outboxEvents, processedEvents, sequences, studentDocuments, students, studentStatusLogs } from '../../db/schema.js';

const eventTables = { outboxEvents, processedEvents };
type StudentRow = typeof students.$inferSelect;

export interface GuardianInput {
  fullName: string;
  relation: string;
  phone: string;
  email?: string | null;
  job?: string | null;
  isPrimary?: boolean;
}

export interface StudentProfileInput {
  fullName: string;
  birthDate?: string | null;
  gender?: 'MALE' | 'FEMALE' | null;
  school?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** Người gọi thấy học viên: theo chi nhánh / đội / mình phụ trách (sale) — CS thấy cả chi nhánh. */
export function studentVisibility(actor: Principal): SQL | undefined {
  return scopeWhere(actor.scope, { branch: students.branchId, owner: students.ownerId });
}

const SALE_ROLES = ['SALE', 'SL', 'CS', 'CM'];
const CARE_ROLES = ['CS', 'CM'];

/** Chuyển trạng thái tay được phép (PENDING ↔ ACTIVE do thanh toán quyết định). */
const MANUAL_TRANSITIONS: Record<StudentStatus, StudentStatus[]> = {
  PENDING: ['STOPPED'],
  ACTIVE: ['PAUSED', 'STOPPED'],
  PAUSED: ['ACTIVE', 'STOPPED'],
  STOPPED: ['ACTIVE'],
};

function snapshot(s: StudentRow) {
  return { fullName: s.fullName, birthDate: s.birthDate, gender: s.gender, avatarUrl: s.avatarUrl };
}

export function createStudentsService(db: CrmDb, core: CoreContract, storage: FileStorage) {
  async function toDtos(rows: StudentRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const userIds = [...new Set(rows.flatMap((r) => [r.ownerId, r.careId]).filter((x): x is string => !!x))];
    const [gs, users, branches] = await Promise.all([
      db.select().from(guardians).where(inArray(guardians.studentId, ids)).orderBy(desc(guardians.isPrimary)),
      core.users.getMany(userIds),
      core.branches.getMany([...new Set(rows.map((r) => r.branchId))]),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      branchId: s.branchId,
      branchName: branchName.get(s.branchId) ?? null,
      ownerId: s.ownerId,
      ownerName: s.ownerId ? (userName.get(s.ownerId) ?? null) : null,
      careId: s.careId,
      careName: s.careId ? (userName.get(s.careId) ?? null) : null,
      fullName: s.fullName,
      birthDate: s.birthDate,
      gender: s.gender,
      school: s.school,
      address: s.address,
      avatarUrl: s.avatarUrl,
      notes: s.notes,
      status: s.status,
      currentClassName: s.currentClassName,
      currentLevelName: s.currentLevelName,
      guardians: gs
        .filter((g) => g.studentId === s.id)
        .map(({ studentId: _s, ...g }) => g),
      createdAt: toApiInstant(s.createdAt),
      version: s.version,
    }));
  }

  /** Đồng bộ danh sách con của tài khoản phụ huynh (Core) theo SĐT phụ huynh. Gọi sau khi ghi xong. */
  async function syncParentLinks(phones: string[]) {
    for (const phone of new Set(phones)) {
      const rows = await db.selectDistinct({ studentId: guardians.studentId }).from(guardians).where(eq(guardians.phone, phone));
      await core.parents.syncLinks(phone, rows.map((r) => r.studentId));
    }
  }

  async function getVisible(actor: Principal, id: string, exec: CrmExecutor = db, lock = false) {
    const q = exec.select().from(students).where(and(eq(students.id, id), studentVisibility(actor)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw Errors.notFound('học viên');
    return row;
  }

  async function assertStaff(userId: string, branchId: string, roles: string[], field: string) {
    const [u] = await core.users.getMany([userId]);
    if (!u || u.status !== 'ACTIVE' || !roles.includes(u.role) || !u.branchIds.includes(branchId)) {
      throw new AppError(422, 'STAFF_INVALID', 'Nhân sự không hợp lệ', `${field}: phải là ${roles.join('/')} đang làm việc tại chi nhánh của học viên`);
    }
  }

  function normalizeGuardians(list: GuardianInput[]) {
    if (!list.length) throw Errors.validation([{ path: 'body.guardians', message: 'Cần ít nhất một phụ huynh' }]);
    const primaryIndex = Math.max(0, list.findIndex((g) => g.isPrimary));
    return list.map((g, i) => {
      const phone = normalizePhone(g.phone);
      if (!phone) throw Errors.validation([{ path: `body.guardians.${i}.phone`, message: 'Số điện thoại không hợp lệ' }]);
      return { ...g, phone, isPrimary: i === primaryIndex };
    });
  }

  async function emitUpdated(tx: CrmExecutor, s: StudentRow, actorId: string) {
    const data: StudentUpdatedV1 = { studentId: s.id, branchId: s.branchId, ...snapshot(s) };
    await appendEvent(tx, eventTables, { type: CRM_EVENTS.studentUpdated, aggregateId: s.id, branchId: s.branchId, actorId, data });
  }

  return {
    syncParentLinks,
    toDtos,
    getVisible,
    snapshot,

    /** Tạo học viên (trong transaction chuyển đổi / đăng ký). */
    async createTx(
      tx: CrmExecutor,
      input: StudentProfileInput & { branchId: string; ownerId: string | null; sourceLeadId?: string | null; guardians: GuardianInput[] },
    ) {
      const gs = normalizeGuardians(input.guardians);
      const id = newId();
      const code = yearCode('HV', await nextSequence(tx, sequences, `student:${vnDate().slice(0, 4)}`));
      await tx.insert(students).values({
        id,
        code,
        branchId: input.branchId,
        ownerId: input.ownerId,
        fullName: input.fullName,
        birthDate: input.birthDate ?? null,
        gender: input.gender ?? null,
        school: input.school ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        sourceLeadId: input.sourceLeadId ?? null,
      });
      await tx.insert(guardians).values(gs.map((g) => ({ id: newId(), studentId: id, ...g, email: g.email ?? null, job: g.job ?? null })));
      return { id, code };
    },

    async list(actor: Principal, q: { page: number; pageSize: number; sort?: string; q?: string; status?: string; branchId?: string; ownerId?: string; careId?: string }) {
      const statuses = csvList(q.status) as StudentStatus[] | undefined;
      const phone = q.q ? normalizePhone(q.q) : null;
      const where = and(
        studentVisibility(actor),
        q.q
          ? or(
              like(students.fullName, likeContains(q.q)),
              like(students.code, likeContains(q.q)),
              phone ? inArray(students.id, sql`(SELECT ${guardians.studentId} FROM ${guardians} WHERE ${guardians.phone} = ${phone})`) : undefined,
            )
          : undefined,
        statuses ? inArray(students.status, statuses) : undefined,
        q.branchId ? eq(students.branchId, q.branchId) : undefined,
        q.ownerId ? eq(students.ownerId, q.ownerId) : undefined,
        q.careId ? eq(students.careId, q.careId) : undefined,
      );
      const orderBy = parseSort(q.sort, { createdAt: students.createdAt, fullName: students.fullName, code: students.code }, [desc(students.createdAt)]);
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db.select().from(students).where(where).orderBy(...orderBy, desc(students.id)).limit(limit).offset(offset),
        db.select({ n: count() }).from(students).where(where),
      ]);
      return { data: await toDtos(rows), meta: pageMeta(q.page, q.pageSize, total?.n ?? 0) };
    },

    async get(actor: Principal, id: string) {
      const row = await getVisible(actor, id);
      const [[dto], docs, logs] = await Promise.all([
        toDtos([row]),
        db.select().from(studentDocuments).where(eq(studentDocuments.studentId, id)).orderBy(desc(studentDocuments.createdAt)),
        db.select().from(studentStatusLogs).where(eq(studentStatusLogs.studentId, id)).orderBy(desc(studentStatusLogs.createdAt)),
      ]);
      const actors = new Map((await core.users.getMany([...new Set(logs.map((l) => l.actorId))])).map((u) => [u.id, u.fullName]));
      const parentAccounts = await core.parents.statusOf(dto!.guardians.map((g) => g.phone));
      return {
        ...dto!,
        parentAccounts,
        documents: docs.map((d) => ({ id: d.id, name: d.name, url: d.url, mimeType: d.mimeType, size: d.size, createdAt: toApiInstant(d.createdAt) })),
        statusLogs: logs.map((l) => ({
          id: l.id,
          fromStatus: l.fromStatus,
          toStatus: l.toStatus,
          reason: l.reason,
          effectiveDate: l.effectiveDate,
          actorName: actors.get(l.actorId) ?? null,
          createdAt: toApiInstant(l.createdAt),
        })),
      };
    },

    async updateProfile(actor: Principal, id: string, patch: Partial<StudentProfileInput>, ifMatch?: number) {
      await db.transaction(async (tx) => {
        const current = await getVisible(actor, id, tx, true);
        if (ifMatch !== undefined && ifMatch !== current.version) throw Errors.conflict('VERSION_CONFLICT', 'Dữ liệu đã bị người khác thay đổi, vui lòng tải lại');
        await tx.update(students).set({ ...patch, version: sql`${students.version} + 1` }).where(eq(students.id, id));
        if (patch.fullName !== undefined || patch.birthDate !== undefined || patch.gender !== undefined) {
          await emitUpdated(tx, (await tx.select().from(students).where(eq(students.id, id)))[0]!, actor.userId);
        }
      });
      return this.get(actor, id);
    },

    async replaceGuardians(actor: Principal, id: string, list: GuardianInput[]) {
      const gs = normalizeGuardians(list);
      const oldPhones = await db.transaction(async (tx) => {
        await getVisible(actor, id, tx, true);
        const before = await tx.select({ phone: guardians.phone }).from(guardians).where(eq(guardians.studentId, id));
        await tx.delete(guardians).where(eq(guardians.studentId, id));
        await tx.insert(guardians).values(gs.map((g) => ({ id: newId(), studentId: id, ...g, email: g.email ?? null, job: g.job ?? null })));
        return before.map((b) => b.phone);
      });
      await syncParentLinks([...oldPhones, ...gs.map((g) => g.phone)]);
      return this.get(actor, id);
    },

    async setStatus(actor: Principal, id: string, input: { status: StudentStatus; reason?: string | null; effectiveDate?: string }) {
      await db.transaction(async (tx) => {
        const current = await getVisible(actor, id, tx, true);
        if (!MANUAL_TRANSITIONS[current.status].includes(input.status)) {
          throw Errors.conflict('INVALID_STATE_TRANSITION', 'Không đổi được trạng thái học viên', `${current.status} → ${input.status}`);
        }
        if (input.status !== 'ACTIVE' && !input.reason) throw Errors.validation([{ path: 'body.reason', message: 'Ghi lý do' }]);
        const effectiveDate = input.effectiveDate ?? vnDate();
        await tx.update(students).set({ status: input.status, version: sql`${students.version} + 1` }).where(eq(students.id, id));
        await tx.insert(studentStatusLogs).values({
          id: newId(),
          studentId: id,
          fromStatus: current.status,
          toStatus: input.status,
          reason: input.reason ?? null,
          effectiveDate,
          actorId: actor.userId,
          createdAt: new Date(),
        });
        const data: StudentStatusChangedV1 = { studentId: id, from: current.status, to: input.status, effectiveDate, reason: input.reason ?? null };
        await appendEvent(tx, eventTables, { type: CRM_EVENTS.studentStatusChanged, aggregateId: id, branchId: current.branchId, actorId: actor.userId, data });
      });
      return this.get(actor, id);
    },

    /** Đổi sale phụ trách / CS chăm sóc. */
    async assign(actor: Principal, id: string, input: { ownerId?: string | null; careId?: string | null }) {
      const current = await getVisible(actor, id);
      if (input.ownerId) await assertStaff(input.ownerId, current.branchId, SALE_ROLES, 'ownerId');
      if (input.careId) await assertStaff(input.careId, current.branchId, CARE_ROLES, 'careId');
      await db
        .update(students)
        .set({ ...input, version: sql`${students.version} + 1` })
        .where(eq(students.id, id));
      return this.get(actor, id);
    },

    async addDocument(actor: Principal, id: string, file: { buffer: Buffer; name: string; mimeType: string }) {
      await getVisible(actor, id);
      const stored = await storage.save(file, `students/${id}`);
      await db.insert(studentDocuments).values({
        id: newId(),
        studentId: id,
        name: stored.name,
        url: stored.url,
        mimeType: stored.mimeType,
        size: stored.size,
        uploadedBy: actor.userId,
        createdAt: new Date(),
      });
      return this.get(actor, id);
    },

    async removeDocument(actor: Principal, id: string, documentId: string) {
      await getVisible(actor, id);
      await db.delete(studentDocuments).where(and(eq(studentDocuments.id, documentId), eq(studentDocuments.studentId, id)));
    },

    async setAvatar(actor: Principal, id: string, file: { buffer: Buffer; name: string; mimeType: string }) {
      await getVisible(actor, id);
      const stored = await storage.save(file, `avatars/${id}`);
      await db.transaction(async (tx) => {
        await tx.update(students).set({ avatarUrl: stored.url, version: sql`${students.version} + 1` }).where(eq(students.id, id));
        await emitUpdated(tx, (await tx.select().from(students).where(eq(students.id, id)))[0]!, actor.userId);
      });
      return this.get(actor, id);
    },

    /** Sale phụ trách học viên (người được ghi doanh số khi tái phí). */
    async ownerOf(id: string) {
      const [s] = await db.select({ ownerId: students.ownerId }).from(students).where(eq(students.id, id));
      return s?.ownerId ?? null;
    },

    /** Lớp / cấp độ hiện tại từ LMS — chỉ để hiển thị trên hồ sơ. */
    subscriptions(): Subscription[] {
      return [
        {
          name: 'crm.students.onLearnerPlaced',
          type: LMS_EVENTS.learnerPlaced,
          async handle(event: EventEnvelope) {
            const d = event.data as LearnerPlacedV1;
            await runOnce(db, eventTables, event, 'crm.students.onLearnerPlaced', async (tx) => {
              await tx.update(students).set({ currentClassName: `${d.classCode} · ${d.className}` }).where(eq(students.id, d.learnerId));
            });
          },
        },
        {
          name: 'crm.students.onLearnerPromoted',
          type: LMS_EVENTS.learnerPromoted,
          async handle(event: EventEnvelope) {
            const d = event.data as LearnerPromotedV1;
            await runOnce(db, eventTables, event, 'crm.students.onLearnerPromoted', async (tx) => {
              await tx.update(students).set({ currentLevelName: d.toLevelName }).where(eq(students.id, d.learnerId));
            });
          },
        },
      ];
    },
  };
}

export type StudentsService = ReturnType<typeof createStudentsService>;
