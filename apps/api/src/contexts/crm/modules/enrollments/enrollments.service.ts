import { and, count, desc, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { csvList, likeContains, pageMeta, pageOffset } from '../../../../platform/http/list.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { runOnce } from '../../../../platform/events/run-once.js';
import { nextSequence, yearCode } from '../../../../platform/db/sequences.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import { toApiInstant, vnDate } from '../../../../platform/time.js';
import {
  CRM_EVENTS,
  type EnrollmentActivatedV1,
  type EnrollmentAdjustedV1,
  type EnrollmentCancelledV1,
  type LeadConvertedV1,
  type PaymentConfirmedV1,
} from '../../../../contracts/events/crm.js';
import { LMS_EVENTS, type AttendanceCorrectedV1, type AttendanceRecordedV1 } from '../../../../contracts/events/lms.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { CrmDb, CrmExecutor } from '../../db/types.js';
import {
  catalogLevels,
  discountApprovals,
  enrollmentGifts,
  enrollments,
  guardians,
  leads,
  outboxEvents,
  payments,
  processedEvents,
  sequences,
  sessionUsages,
  students,
} from '../../db/schema.js';
import { computeQuote, type QuoteInput } from '../pricing/pricing.core.js';
import type { PricingService } from '../pricing/pricing.service.js';
import type { PromotionsService } from '../promotions/promotions.service.js';
import type { LeadsService } from '../leads/leads.service.js';
import { studentVisibility, type GuardianInput, type StudentProfileInput, type StudentsService } from '../students/students.service.js';

const eventTables = { outboxEvents, processedEvents };
type EnrollmentRow = typeof enrollments.$inferSelect;
type StudentRow = typeof students.$inferSelect;

export interface EnrollmentRequest {
  packageId: string;
  startLevelId: string;
  promotionId?: string | null;
  scholarshipMonths?: number;
  extraDiscount?: number;
  extraDiscountReason?: string | null;
  startDate?: string;
  note?: string | null;
  gifts?: Array<{ itemId: string; quantity: number; deliveryCondition: 'IMMEDIATE' | 'ON_PAID' }>;
}

export interface ConvertRequest {
  student: StudentProfileInput;
  guardians?: GuardianInput[];
  enrollment: EnrollmentRequest;
}

/** YYYY-MM-DD + n tháng (ngày 31 → cuối tháng sau nếu thiếu ngày). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export type PaymentState = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID';
export function paymentState(e: { amountDue: number; amountPaid: number }): PaymentState {
  if (e.amountPaid > e.amountDue) return 'OVERPAID';
  if (e.amountPaid >= e.amountDue) return 'PAID';
  return e.amountPaid > 0 ? 'PARTIAL' : 'UNPAID';
}

interface Deps {
  db: CrmDb;
  core: CoreContract;
  pricing: PricingService;
  promotions: PromotionsService;
  leads: LeadsService;
  students: StudentsService;
}

export function createEnrollmentsService({ db, core, pricing, promotions, leads: leadsService, students: studentsService }: Deps) {
  async function toDtos(rows: EnrollmentRow[]) {
    if (!rows.length) return [];
    const [studentRows, users] = await Promise.all([
      db
        .select({ id: students.id, code: students.code, fullName: students.fullName })
        .from(students)
        .where(inArray(students.id, [...new Set(rows.map((r) => r.studentId))])),
      core.users.getMany([...new Set(rows.flatMap((r) => [r.saleId, r.creditUserId]).filter((x): x is string => !!x))]),
    ]);
    const st = new Map(studentRows.map((s) => [s.id, s]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((e) => ({
      id: e.id,
      code: e.code,
      studentId: e.studentId,
      studentCode: st.get(e.studentId)?.code ?? '',
      studentName: st.get(e.studentId)?.fullName ?? '',
      branchId: e.branchId,
      type: e.type,
      saleId: e.saleId,
      saleName: e.saleId ? (userName.get(e.saleId) ?? null) : null,
      creditUserId: e.creditUserId,
      creditName: e.creditUserId ? (userName.get(e.creditUserId) ?? null) : null,
      packageId: e.packageId,
      packageCode: e.packageCode,
      packageName: e.packageName,
      startLevelId: e.startLevelId,
      startLevelName: e.startLevelName,
      promotionCode: e.promotionCode,
      listPrice: e.listPrice,
      promotionDiscount: e.promotionDiscount,
      extraDiscountRequested: e.extraDiscountRequested,
      extraDiscountApplied: e.extraDiscountApplied,
      extraDiscountReason: e.extraDiscountReason,
      scholarshipMonthsRequested: e.scholarshipMonthsRequested,
      scholarshipMonthsGranted: e.scholarshipMonthsGranted,
      amountDue: e.amountDue,
      amountPaid: e.amountPaid,
      balance: e.amountDue - e.amountPaid,
      paymentState: paymentState(e),
      sessionsPurchased: e.sessionsPurchased,
      sessionsUsed: e.sessionsUsed,
      sessionsRemaining: Math.max(0, e.sessionsPurchased - e.sessionsUsed),
      approvalStatus: e.approvalStatus,
      status: e.status,
      startDate: e.startDate,
      endDate: e.endDate,
      activatedAt: e.activatedAt ? toApiInstant(e.activatedAt) : null,
      cancelReason: e.cancelReason,
      note: e.note,
      createdAt: toApiInstant(e.createdAt),
    }));
  }

  /** Đăng ký trong phạm vi người gọi (theo học viên). */
  async function getVisible(actor: Principal, id: string, exec: CrmExecutor = db, lock = false) {
    const q = exec
      .select({ e: enrollments })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.id, id), studentVisibility(actor)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw Errors.notFound('đăng ký');
    return row.e;
  }

  /** Kiểm tra cấp độ bắt đầu thuộc môn của gói và đang mở; quà tặng đang dùng. */
  async function validateRequest(req: EnrollmentRequest, subjectId: string) {
    const [level] = await db.select().from(catalogLevels).where(eq(catalogLevels.levelId, req.startLevelId));
    if (!level || level.subjectId !== subjectId || !level.isActive) {
      throw Errors.validation([{ path: 'body.enrollment.startLevelId', message: 'Cấp độ không thuộc môn của gói hoặc đã ngừng' }]);
    }
    if ((req.extraDiscount ?? 0) > 0 && !req.extraDiscountReason?.trim()) {
      throw Errors.validation([{ path: 'body.enrollment.extraDiscountReason', message: 'Ghi lý do giảm thêm' }]);
    }
    const itemIds = [...new Set((req.gifts ?? []).map((g) => g.itemId))];
    const items = await promotions.getItems(itemIds);
    if (items.length !== itemIds.length || items.some((i) => !i.isActive)) {
      throw Errors.validation([{ path: 'body.enrollment.gifts', message: 'Quà tặng không tồn tại hoặc đã ngừng' }]);
    }
    return level;
  }

  /** Tính giá + kiểm tra, ngoài transaction (chỉ đọc). */
  async function prepare(actor: Principal, branchId: string, req: EnrollmentRequest) {
    const quote = await pricing.quote(actor, {
      packageId: req.packageId,
      branchId,
      promotionId: req.promotionId,
      scholarshipMonths: req.scholarshipMonths,
      extraDiscount: req.extraDiscount,
    });
    const level = await validateRequest(req, quote.package.subjectId);
    return { quote, level };
  }

  async function insertTx(
    tx: CrmExecutor,
    actor: Principal,
    ctx: { studentId: string; branchId: string; saleId: string | null; creditUserId: string | null; type: 'NEW' | 'RENEWAL'; idempotencyKey?: string },
    req: EnrollmentRequest,
    prepared: Awaited<ReturnType<typeof prepare>>,
  ) {
    const { quote, level } = prepared;
    const id = newId();
    const code = yearCode('DK', await nextSequence(tx, sequences, `enrollment:${vnDate().slice(0, 4)}`));
    const startDate = req.startDate ?? vnDate();
    await tx.insert(enrollments).values({
      id,
      code,
      studentId: ctx.studentId,
      branchId: ctx.branchId,
      type: ctx.type,
      saleId: ctx.saleId,
      creditUserId: ctx.creditUserId,
      packageId: quote.package.id,
      packageCode: quote.package.code,
      packageName: quote.package.name,
      subjectId: quote.package.subjectId,
      startLevelId: level.levelId,
      startLevelName: level.name,
      promotionId: quote.promotion?.id ?? null,
      promotionCode: quote.promotion?.code ?? null,
      listPrice: quote.listPrice,
      promotionDiscount: quote.promotion?.discount ?? 0,
      extraDiscountRequested: quote.extraDiscount.requested,
      extraDiscountApplied: quote.extraDiscount.applied,
      extraDiscountReason: req.extraDiscountReason ?? null,
      scholarshipMonthsRequested: quote.scholarship.requestedMonths,
      scholarshipMonthsGranted: quote.scholarship.grantedMonths,
      amountDue: quote.amountDue,
      sessionsPurchased: quote.sessions.total,
      approvalStatus: quote.approval ? 'PENDING' : 'NONE',
      startDate,
      endDate: addMonths(startDate, quote.months.total),
      pricingInput: quote.input,
      note: req.note ?? null,
      idempotencyKey: ctx.idempotencyKey ?? null,
      createdBy: actor.userId,
    });
    if (quote.approval) {
      await tx.insert(discountApprovals).values({
        id: newId(),
        enrollmentId: id,
        branchId: ctx.branchId,
        value: quote.approval.value,
        approverRole: quote.approval.approverRole,
        extraDiscount: quote.extraDiscount.requested,
        extraScholarshipMonths: quote.scholarship.pendingMonths,
        reason: req.extraDiscountReason ?? null,
        requestedBy: actor.userId,
      });
    }
    if (req.gifts?.length) {
      await tx.insert(enrollmentGifts).values(
        req.gifts.map((g) => ({ id: newId(), enrollmentId: id, itemId: g.itemId, branchId: ctx.branchId, quantity: g.quantity, deliveryCondition: g.deliveryCondition })),
      );
    }
    if (quote.amountDue === 0 && !quote.approval) await afterPaymentChange(tx, id, actor.userId);
    return { id, code, approval: quote.approval ? { approverRole: quote.approval.approverRole, value: quote.approval.value } : null };
  }

  /** Báo người duyệt (CM / AM của chi nhánh) có yêu cầu ưu đãi mới. Gọi sau khi transaction xong. */
  async function notifyApproval(actor: Principal, branchId: string, studentName: string, approval: { approverRole: string; value: number } | null) {
    if (!approval) return;
    await core.notifications.sendToRoles(
      { branchId, roles: [approval.approverRole], exceptUserId: actor.userId },
      { type: 'crm.approval.requested', app: 'crm', title: 'Yêu cầu duyệt ưu đãi', body: `${studentName} · ${approval.value.toLocaleString('vi-VN')}đ`, link: '/approvals' },
    );
  }

  /** Gửi lại cùng Idempotency-Key → trả về đăng ký đã tạo (không tạo trùng). */
  async function findByKey(key: string | undefined) {
    if (!key) return undefined;
    const [row] = await db.select().from(enrollments).where(eq(enrollments.idempotencyKey, key));
    return row;
  }

  async function snapshotStudent(tx: CrmExecutor, studentId: string): Promise<StudentRow> {
    return (await tx.select().from(students).where(eq(students.id, studentId)))[0]!;
  }

  /** Cộng lại tiền đã thu; khoản thu đầu tiên → kích hoạt đăng ký + học viên, báo LMS. */
  async function afterPaymentChange(tx: CrmExecutor, enrollmentId: string, actorId: string) {
    const [e] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).for('update');
    if (!e) return;
    const [sum] = await tx
      .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)`.mapWith(Number) })
      .from(payments)
      .where(and(eq(payments.enrollmentId, enrollmentId), eq(payments.status, 'CONFIRMED')));
    const amountPaid = sum?.total ?? 0;
    // Khoản thu đầu tiên — hoặc được giảm 100% (không có gì để thu) — thì kích hoạt.
    const activate = e.status === 'AWAITING_PAYMENT' && (amountPaid > 0 || (e.amountDue === 0 && e.approvalStatus !== 'PENDING'));
    await tx
      .update(enrollments)
      .set({ amountPaid, ...(activate ? { status: 'ACTIVE' as const, activatedAt: new Date() } : {}), version: sql`${enrollments.version} + 1` })
      .where(eq(enrollments.id, enrollmentId));
    if (!activate) return;

    const student = await snapshotStudent(tx, e.studentId);
    if (student.status === 'PENDING') await tx.update(students).set({ status: 'ACTIVE', version: sql`${students.version} + 1` }).where(eq(students.id, student.id));
    const data: EnrollmentActivatedV1 = {
      enrollmentId: e.id,
      enrollmentCode: e.code,
      studentId: e.studentId,
      studentCode: student.code,
      branchId: e.branchId,
      type: e.type,
      subjectId: e.subjectId,
      startLevelId: e.startLevelId,
      sessionsPurchased: e.sessionsPurchased,
      student: studentsService.snapshot(student),
    };
    await appendEvent(tx, eventTables, { type: CRM_EVENTS.enrollmentActivated, aggregateId: e.id, branchId: e.branchId, actorId, data });
  }

  /** Áp kết quả duyệt: tính lại từ đầu vào đã chốt (không đọc giá hiện tại). */
  async function applyApproval(tx: CrmExecutor, enrollmentId: string, approved: boolean, actorId: string) {
    const [e] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).for('update');
    if (!e) throw Errors.notFound('đăng ký');
    const input = e.pricingInput as QuoteInput;
    // Từ chối → coi như không xin phần vượt mức (giữ phần đã cấp).
    const q = computeQuote(
      approved
        ? { ...input, approved: true }
        : { ...input, extraDiscount: 0, scholarshipMonths: Math.min(input.scholarshipMonths, input.defaultScholarshipMonths), approved: false },
    );
    await tx
      .update(enrollments)
      .set({
        approvalStatus: approved ? 'APPROVED' : 'REJECTED',
        extraDiscountApplied: q.extraDiscount.applied,
        scholarshipMonthsGranted: q.scholarship.grantedMonths,
        amountDue: q.amountDue,
        sessionsPurchased: q.sessions.total,
        endDate: addMonths(e.startDate, q.months.total),
        version: sql`${enrollments.version} + 1`,
      })
      .where(eq(enrollments.id, enrollmentId));
    if (e.status === 'AWAITING_PAYMENT') {
      await afterPaymentChange(tx, enrollmentId, actorId);
    } else if (e.status === 'ACTIVE' && q.sessions.total !== e.sessionsPurchased) {
      const data: EnrollmentAdjustedV1 = { enrollmentId: e.id, studentId: e.studentId, sessionsPurchased: q.sessions.total };
      await appendEvent(tx, eventTables, { type: CRM_EVENTS.enrollmentAdjusted, aggregateId: e.id, branchId: e.branchId, actorId, data });
    }
  }

  /** Đếm lại số buổi đã dùng của đăng ký từ bảng session_usages. */
  async function recountSessions(tx: CrmExecutor, enrollmentId: string) {
    const [e] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).for('update');
    if (!e) return;
    const [used] = await tx
      .select({ n: count() })
      .from(sessionUsages)
      .where(and(eq(sessionUsages.enrollmentId, enrollmentId), eq(sessionUsages.consumed, true)));
    const sessionsUsed = used?.n ?? 0;
    const status = e.status === 'ACTIVE' && sessionsUsed >= e.sessionsPurchased ? 'COMPLETED' : e.status === 'COMPLETED' && sessionsUsed < e.sessionsPurchased ? 'ACTIVE' : e.status;
    await tx.update(enrollments).set({ sessionsUsed, status }).where(eq(enrollments.id, enrollmentId));
  }

  return {
    toDtos,
    getVisible,
    afterPaymentChange,
    applyApproval,

    async list(actor: Principal, q: { page: number; pageSize: number; q?: string; status?: string; branchId?: string; approvalStatus?: string; paymentState?: PaymentState; studentId?: string }) {
      const statuses = csvList(q.status) as Array<EnrollmentRow['status']> | undefined;
      const approval = csvList(q.approvalStatus) as Array<EnrollmentRow['approvalStatus']> | undefined;
      const where = and(
        studentVisibility(actor),
        q.q ? or(like(enrollments.code, likeContains(q.q)), like(students.fullName, likeContains(q.q)), like(students.code, likeContains(q.q))) : undefined,
        statuses ? inArray(enrollments.status, statuses) : undefined,
        approval ? inArray(enrollments.approvalStatus, approval) : undefined,
        q.branchId ? eq(enrollments.branchId, q.branchId) : undefined,
        q.studentId ? eq(enrollments.studentId, q.studentId) : undefined,
        q.paymentState === 'UNPAID'
          ? and(eq(enrollments.amountPaid, 0), sql`${enrollments.amountDue} > 0`)
          : q.paymentState === 'PARTIAL'
            ? and(sql`${enrollments.amountPaid} > 0`, sql`${enrollments.amountPaid} < ${enrollments.amountDue}`)
            : q.paymentState === 'PAID'
              ? sql`${enrollments.amountPaid} = ${enrollments.amountDue}`
              : q.paymentState === 'OVERPAID'
                ? sql`${enrollments.amountPaid} > ${enrollments.amountDue}`
                : undefined,
      );
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db.select({ e: enrollments }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(where).orderBy(desc(enrollments.createdAt)).limit(limit).offset(offset),
        db.select({ n: count() }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(where),
      ]);
      return { data: await toDtos(rows.map((r) => r.e)), meta: pageMeta(q.page, q.pageSize, total?.n ?? 0) };
    },

    async get(actor: Principal, id: string) {
      const e = await getVisible(actor, id);
      const [[dto], paymentRows, giftRows, approvalRows] = await Promise.all([
        toDtos([e]),
        db.select().from(payments).where(eq(payments.enrollmentId, id)).orderBy(desc(payments.paidAt)),
        db.select().from(enrollmentGifts).where(eq(enrollmentGifts.enrollmentId, id)),
        db.select().from(discountApprovals).where(eq(discountApprovals.enrollmentId, id)).orderBy(desc(discountApprovals.createdAt)),
      ]);
      const userIds = [...new Set([...paymentRows.flatMap((p) => [p.recordedBy, p.confirmedBy]), ...approvalRows.flatMap((a) => [a.requestedBy, a.reviewedBy])].filter((x): x is string => !!x))];
      const [users, items] = await Promise.all([core.users.getMany(userIds), promotions.getItems([...new Set(giftRows.map((g) => g.itemId))])]);
      const userName = new Map(users.map((u) => [u.id, u.fullName]));
      const itemOf = new Map(items.map((i) => [i.id, i]));
      return {
        ...dto!,
        payments: paymentRows.map((p) => ({
          id: p.id,
          amount: p.amount,
          method: p.method,
          status: p.status,
          reference: p.reference,
          note: p.note,
          paidAt: toApiInstant(p.paidAt),
          recordedByName: userName.get(p.recordedBy) ?? null,
          confirmedByName: p.confirmedBy ? (userName.get(p.confirmedBy) ?? null) : null,
          confirmedAt: p.confirmedAt ? toApiInstant(p.confirmedAt) : null,
        })),
        gifts: giftRows.map((g) => ({
          id: g.id,
          itemId: g.itemId,
          itemName: itemOf.get(g.itemId)?.name ?? '',
          unit: itemOf.get(g.itemId)?.unit ?? '',
          quantity: g.quantity,
          deliveryCondition: g.deliveryCondition,
          status: g.status,
          deliveredAt: g.deliveredAt ? toApiInstant(g.deliveredAt) : null,
        })),
        approval: approvalRows[0]
          ? {
              id: approvalRows[0].id,
              status: approvalRows[0].status,
              approverRole: approvalRows[0].approverRole,
              value: approvalRows[0].value,
              requestedByName: userName.get(approvalRows[0].requestedBy) ?? null,
              reviewedByName: approvalRows[0].reviewedBy ? (userName.get(approvalRows[0].reviewedBy) ?? null) : null,
              reviewNote: approvalRows[0].reviewNote,
            }
          : null,
      };
    },

    /** Chuyển lead → học viên + đăng ký đầu tiên (một transaction). */
    async convertLead(actor: Principal, leadId: string, req: ConvertRequest, idempotencyKey: string) {
      const replay = async () => {
        const existing = await findByKey(idempotencyKey);
        if (!existing) return undefined;
        const [lead] = await db.select({ convertedStudentId: leads.convertedStudentId }).from(leads).where(eq(leads.id, leadId));
        if (lead?.convertedStudentId !== existing.studentId) throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã dùng cho thao tác khác');
        return { studentId: existing.studentId, enrollmentId: existing.id };
      };
      const prior = await replay();
      if (prior) return prior;
      const lead = await leadsService.getVisible(actor, leadId);
      const prepared = await prepare(actor, lead.branchId, req.enrollment);

      const result = await db.transaction(async (tx) => {
        const locked = await leadsService.lockForConvert(actor, leadId, tx);
        const ownerId = locked.ownerId ?? (['SALE', 'SL'].includes(actor.role) ? actor.userId : null);
        const student = await studentsService.createTx(tx, {
          ...req.student,
          branchId: locked.branchId,
          ownerId,
          sourceLeadId: leadId,
          guardians: req.guardians?.length
            ? req.guardians
            : [{ fullName: locked.parentName, relation: 'Phụ huynh', phone: locked.parentPhone, email: locked.parentEmail, isPrimary: true }],
        });
        const enrollment = await insertTx(
          tx,
          actor,
          { studentId: student.id, branchId: locked.branchId, saleId: ownerId, creditUserId: ownerId, type: 'NEW', idempotencyKey },
          req.enrollment,
          prepared,
        );
        await tx
          .update(leads)
          .set({ status: 'CONVERTED', convertedStudentId: student.id, nextFollowUpAt: null, version: sql`${leads.version} + 1` })
          .where(eq(leads.id, leadId));
        const data: LeadConvertedV1 = { leadId, studentId: student.id, enrollmentId: enrollment.id, ownerId };
        await appendEvent(tx, eventTables, { type: CRM_EVENTS.leadConverted, aggregateId: leadId, branchId: locked.branchId, actorId: actor.userId, data });
        return { studentId: student.id, enrollmentId: enrollment.id, approval: enrollment.approval };
      }).catch(async (err: unknown) => {
        // Request cùng key chạy song song đã chuyển đổi xong (trùng key / LEAD_CONVERTED) → trả kết quả đó.
        const done = await replay();
        if (done) return done;
        throw err;
      });
      if (!('approval' in result)) return result;
      await notifyApproval(actor, lead.branchId, req.student.fullName, result.approval);
      // Phụ huynh đã có tài khoản thấy thêm con mới.
      const phones = await db.select({ phone: guardians.phone }).from(guardians).where(eq(guardians.studentId, result.studentId));
      await studentsService.syncParentLinks(phones.map((p) => p.phone));
      return { studentId: result.studentId, enrollmentId: result.enrollmentId };
    },

    /** Đăng ký thêm cho học viên đã có: tái phí (đã từng có đăng ký) hoặc khoá mới. */
    async createForStudent(actor: Principal, studentId: string, req: EnrollmentRequest, idempotencyKey: string) {
      const replay = async () => {
        const existing = await findByKey(idempotencyKey);
        if (existing && existing.studentId !== studentId) throw Errors.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã dùng cho thao tác khác');
        return existing ? { studentId, enrollmentId: existing.id } : undefined;
      };
      const prior = await replay();
      if (prior) return prior;
      const student = await studentsService.getVisible(actor, studentId);
      if (student.status === 'STOPPED') throw Errors.conflict('STUDENT_STOPPED', 'Học viên đã nghỉ — mở lại trước khi đăng ký');
      const prepared = await prepare(actor, student.branchId, req);
      const result = await db.transaction(async (tx) => {
        const [prev] = await tx
          .select({ n: count() })
          .from(enrollments)
          .where(and(eq(enrollments.studentId, studentId), ne(enrollments.status, 'CANCELLED')));
        const type = (prev?.n ?? 0) > 0 ? 'RENEWAL' : 'NEW';
        // Doanh thu: đăng ký mới → sale; tái phí → CS chăm sóc (chưa có CS mà người tạo là CS → người tạo).
        const creditUserId = type === 'NEW' ? student.ownerId : (student.careId ?? (actor.role === 'CS' ? actor.userId : student.ownerId));
        const enrollment = await insertTx(tx, actor, { studentId, branchId: student.branchId, saleId: student.ownerId, creditUserId, type, idempotencyKey }, req, prepared);
        return { enrollmentId: enrollment.id, approval: enrollment.approval };
      }).catch(async (err: unknown) => {
        const done = await replay();
        if (done) return done;
        throw err;
      });
      if (!('approval' in result)) return result;
      await notifyApproval(actor, student.branchId, student.fullName, result.approval);
      return { studentId, enrollmentId: result.enrollmentId };
    },

    /** Huỷ đăng ký chưa thu tiền (đã có khoản thu → phải huỷ khoản thu trước). */
    async cancel(actor: Principal, id: string, reason: string) {
      await db.transaction(async (tx) => {
        const e = await getVisible(actor, id, tx, true);
        if (e.status === 'CANCELLED') return;
        const [paid] = await tx
          .select({ n: count() })
          .from(payments)
          .where(and(eq(payments.enrollmentId, id), inArray(payments.status, ['PENDING', 'CONFIRMED'])));
        if ((paid?.n ?? 0) > 0) throw Errors.conflict('ENROLLMENT_HAS_PAYMENTS', 'Đăng ký đã có khoản thu', 'Huỷ các khoản thu trước khi huỷ đăng ký');
        await tx.update(enrollments).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }).where(eq(enrollments.id, id));
        await tx
          .update(discountApprovals)
          .set({ status: 'REJECTED', reviewNote: 'Đăng ký đã huỷ', reviewedAt: new Date(), reviewedBy: actor.userId })
          .where(and(eq(discountApprovals.enrollmentId, id), eq(discountApprovals.status, 'PENDING')));
        if (e.activatedAt) {
          const data: EnrollmentCancelledV1 = { enrollmentId: id, studentId: e.studentId, reason };
          await appendEvent(tx, eventTables, { type: CRM_EVENTS.enrollmentCancelled, aggregateId: id, branchId: e.branchId, actorId: actor.userId, data });
        }
      });
    },

    /** Giao / nhận lại quà tặng — trừ / cộng kho của chi nhánh. */
    async setGiftStatus(actor: Principal, giftId: string, status: 'DELIVERED' | 'RETURNED') {
      await db.transaction(async (tx) => {
        const [gift] = await tx.select().from(enrollmentGifts).where(eq(enrollmentGifts.id, giftId)).for('update');
        if (!gift) throw Errors.notFound('quà tặng');
        const e = await getVisible(actor, gift.enrollmentId, tx);
        if (status === 'DELIVERED') {
          if (gift.status !== 'PENDING') throw Errors.conflict('INVALID_STATE_TRANSITION', 'Quà đã giao');
          if (e.status === 'CANCELLED') throw Errors.conflict('ENROLLMENT_CANCELLED', 'Đăng ký đã huỷ');
          if (gift.deliveryCondition === 'ON_PAID' && !e.activatedAt) throw new AppError(422, 'GIFT_NOT_YET', 'Quà chỉ giao sau khi có khoản thu đầu tiên');
          await promotions.giftMove(tx, { itemId: gift.itemId, branchId: gift.branchId, delta: -gift.quantity, kind: 'GIFT', refId: gift.id, actorId: actor.userId });
          await tx.update(enrollmentGifts).set({ status: 'DELIVERED', deliveredBy: actor.userId, deliveredAt: new Date() }).where(eq(enrollmentGifts.id, giftId));
        } else {
          if (gift.status !== 'DELIVERED') throw Errors.conflict('INVALID_STATE_TRANSITION', 'Quà chưa giao');
          await promotions.giftMove(tx, { itemId: gift.itemId, branchId: gift.branchId, delta: gift.quantity, kind: 'RETURN', refId: gift.id, actorId: actor.userId });
          await tx.update(enrollmentGifts).set({ status: 'RETURNED' }).where(eq(enrollmentGifts.id, giftId));
        }
      });
    },

    /** Báo cho LMS khi khoản thu đầu tiên được xác nhận (gọi từ payments). */
    async emitPaymentConfirmed(tx: CrmExecutor, p: { id: string; enrollmentId: string; amount: number; method: 'CASH' | 'TRANSFER' | 'CARD'; branchId: string }, actorId: string) {
      const [e] = await tx
        .select({ studentId: enrollments.studentId, code: enrollments.code, studentName: students.fullName, studentCode: students.code })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(eq(enrollments.id, p.enrollmentId));
      const data: PaymentConfirmedV1 = {
        paymentId: p.id,
        enrollmentId: p.enrollmentId,
        enrollmentCode: e!.code,
        studentId: e!.studentId,
        studentName: e!.studentName,
        studentCode: e!.studentCode,
        amount: p.amount,
        method: p.method,
      };
      await appendEvent(tx, eventTables, { type: CRM_EVENTS.paymentConfirmed, aggregateId: p.id, branchId: p.branchId, actorId, data });
    },

    /** Trừ buổi theo điểm danh LMS (idempotent: một dòng / (đăng ký, buổi học)). */
    subscriptions(): Subscription[] {
      const handler = (name: string, type: string): Subscription => ({
        name,
        type,
        async handle(event: EventEnvelope) {
          const d = event.data as AttendanceRecordedV1 | AttendanceCorrectedV1;
          await runOnce(db, eventTables, event, name, async (tx) => {
            const [e] = await tx.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.id, d.enrollmentId));
            if (!e) return; // đăng ký không tồn tại (dữ liệu test cũ) → bỏ qua
            const row = {
              learnerId: d.learnerId,
              attendanceStatus: d.status,
              consumed: d.consumesSession,
              sessionStartsAt: new Date(d.sessionStartsAt),
              updatedAt: new Date(),
            };
            await tx
              .insert(sessionUsages)
              .values({ enrollmentId: d.enrollmentId, lmsSessionId: d.sessionId, ...row })
              .onDuplicateKeyUpdate({ set: row });
            await recountSessions(tx, d.enrollmentId);
          });
        },
      });
      return [handler('crm.enrollments.onAttendanceRecorded', LMS_EVENTS.attendanceRecorded), handler('crm.enrollments.onAttendanceCorrected', LMS_EVENTS.attendanceCorrected)];
    },
  };
}

export type EnrollmentsService = ReturnType<typeof createEnrollmentsService>;
