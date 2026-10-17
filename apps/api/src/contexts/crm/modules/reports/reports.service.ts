import { and, asc, count, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import { can, type Principal } from '../../../../platform/auth/principal.js';
import { scopeWhere } from '../../../../platform/auth/scope-sql.js';
import { daysBetween, monthRange, shiftDate, toApiInstant, vnDate, vnDayStart } from '../../../../platform/time.js';
import type { BranchSummary, CoreContract, UserSummary } from '../../../core/contract/index.js';
import type { CrmDb } from '../../db/types.js';
import { discountApprovals, enrollments, guardians, kpiTargets, leadAppointments, leads, payments, students } from '../../db/schema.js';
import { RENEWAL_REMAINING_THRESHOLD } from '../../settings.js';
import { leadVisibility } from '../leads/leads.service.js';
import { studentVisibility } from '../students/students.service.js';

/** Vai trò có doanh thu / mục tiêu: sale (đăng ký mới), CS (tái phí). CM chỉ hiện khi có số liệu. */
const KPI_ROLES = ['SALE', 'SL', 'CS'];
const KPI_EXTRA_ROLES = ['CM'];
const MAX_RANGE_DAYS = 366;
/** Đăng ký sắp hết hạn trong số ngày này → cần tái phí. */
const ENDING_WITHIN_DAYS = 30;

/** Ngày VN của cột DATETIME (UTC) — dùng để gom theo ngày. */
const vnDayOf = (col: unknown) => sql<string>`DATE(DATE_ADD(${col}, INTERVAL 7 HOUR))`;

export interface Period {
  from: string;
  to: string;
}

/**
 * Kỳ so sánh. Kỳ đang chạy dở chỉ so phần đã qua: xem cả tháng 10 vào ngày 9/10 → so 1–9/10 với 1–9/9.
 * Kỳ bắt đầu từ mùng 1 → so cùng kỳ tháng trước; kỳ khác → khoảng liền trước cùng độ dài.
 */
export function previousPeriod(q: Period, today: string): Period {
  const end = q.to > today && q.from <= today ? today : q.to;
  const days = daysBetween(q.from, end) + 1;
  if (q.from.endsWith('-01')) {
    const prevStart = `${shiftDate(q.from, -1).slice(0, 7)}-01`;
    const prevLast = shiftDate(q.from, -1);
    const prevEnd = shiftDate(prevStart, days - 1);
    return { from: prevStart, to: prevEnd < prevLast ? prevEnd : prevLast };
  }
  return { from: shiftDate(q.from, -days), to: shiftDate(q.from, -1) };
}

export function createReportsService(db: CrmDb, core: CoreContract) {
  /** Doanh thu theo người được tính (đăng ký mới → sale, tái phí → CS). */
  const revenueScope = (actor: Principal) => scopeWhere(actor.scope, { branch: enrollments.branchId, owner: enrollments.creditUserId });

  async function visibleBranches(actor: Principal, branchId?: string): Promise<BranchSummary[]> {
    const list = (actor.scope.kind === 'ALL' ? await core.branches.listActive() : await core.branches.getMany(actor.branchIds)).filter((b) => b.isActive);
    if (!branchId) return list;
    const one = list.filter((b) => b.id === branchId);
    if (!one.length) throw new AppError(403, 'BRANCH_OUT_OF_SCOPE', 'Chi nhánh ngoài phạm vi');
    return one;
  }

  function checkPeriod({ from, to }: Period) {
    const days = daysBetween(from, to);
    if (days < 0) throw Errors.validation([{ path: 'query.to', message: 'Ngày kết thúc phải sau ngày bắt đầu' }]);
    if (days >= MAX_RANGE_DAYS) throw Errors.validation([{ path: 'query.to', message: 'Tối đa 366 ngày' }]);
    return days + 1;
  }

  /** Khoản thu đã xác nhận trong khoảng ngày (giờ VN), gom theo người được tính / loại / chi nhánh / ngày. */
  async function revenueRows(actor: Principal, period: Period, branchFilter: SQL | undefined) {
    return db
      .select({
        creditUserId: enrollments.creditUserId,
        type: enrollments.type,
        branchId: enrollments.branchId,
        day: vnDayOf(payments.paidAt),
        amount: sql<number>`SUM(${payments.amount})`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .where(
        and(
          eq(payments.status, 'CONFIRMED'),
          gte(payments.paidAt, vnDayStart(period.from)),
          lt(payments.paidAt, vnDayStart(shiftDate(period.to, 1))),
          revenueScope(actor),
          branchFilter,
        ),
      )
      .groupBy(enrollments.creditUserId, enrollments.type, enrollments.branchId, vnDayOf(payments.paidAt));
  }

  /** Đăng ký tạo trong khoảng ngày (trừ đã huỷ), gom theo người được tính / loại / chi nhánh. */
  async function enrollmentRows(actor: Principal, period: Period, branchFilter: SQL | undefined) {
    return db
      .select({
        creditUserId: enrollments.creditUserId,
        type: enrollments.type,
        branchId: enrollments.branchId,
        n: count(),
        value: sql<number>`SUM(${enrollments.amountDue})`.mapWith(Number),
      })
      .from(enrollments)
      .where(
        and(
          ne(enrollments.status, 'CANCELLED'),
          gte(enrollments.createdAt, vnDayStart(period.from)),
          lt(enrollments.createdAt, vnDayStart(shiftDate(period.to, 1))),
          revenueScope(actor),
          branchFilter,
        ),
      )
      .groupBy(enrollments.creditUserId, enrollments.type, enrollments.branchId);
  }

  async function names(ids: Array<string | null>) {
    const users = await core.users.getMany([...new Set(ids.filter((x): x is string => !!x))]);
    return new Map(users.map((u) => [u.id, u]));
  }

  /** Học viên cần tái phí: đăng ký gần nhất sắp hết buổi / sắp hết hạn / đã học xong, chưa có đăng ký mới. */
  async function dueRenewals(actor: Principal, q: { branchId?: string; careId?: string }) {
    const branches = await visibleBranches(actor, q.branchId);
    if (!branches.length) return [];
    const thresholds = new Map(await Promise.all(branches.map(async (b) => [b.id, await core.settings.get(RENEWAL_REMAINING_THRESHOLD, b.id)] as const)));
    const studentRows = await db
      .select()
      .from(students)
      .where(
        and(
          eq(students.status, 'ACTIVE'),
          studentVisibility(actor),
          inArray(students.branchId, branches.map((b) => b.id)),
          q.careId === 'none' ? isNull(students.careId) : q.careId ? eq(students.careId, q.careId) : undefined,
        ),
      )
      .limit(5000);
    if (!studentRows.length) return [];
    const ids = studentRows.map((s) => s.id);
    const [enrollRows, guardianRows] = await Promise.all([
      db
        .select()
        .from(enrollments)
        .where(and(inArray(enrollments.studentId, ids), ne(enrollments.status, 'CANCELLED')))
        .orderBy(desc(enrollments.createdAt)),
      db.select().from(guardians).where(and(inArray(guardians.studentId, ids), eq(guardians.isPrimary, true))),
    ]);
    const today = vnDate();
    const soon = shiftDate(today, ENDING_WITHIN_DAYS);
    const result = [];
    for (const s of studentRows) {
      const latest = enrollRows.find((e) => e.studentId === s.id);
      if (!latest || latest.status === 'AWAITING_PAYMENT') continue; // chưa đóng tiền / đang có đăng ký mới chờ thu
      const remaining = Math.max(0, latest.sessionsPurchased - latest.sessionsUsed);
      const threshold = thresholds.get(s.branchId) ?? 4;
      const reason = latest.status === 'COMPLETED' ? 'COMPLETED' : remaining <= threshold ? 'LOW_SESSIONS' : latest.endDate <= soon ? 'ENDING' : null;
      if (!reason) continue;
      const g = guardianRows.find((x) => x.studentId === s.id);
      result.push({
        studentId: s.id,
        code: s.code,
        fullName: s.fullName,
        branchId: s.branchId,
        careId: s.careId,
        ownerId: s.ownerId,
        currentClassName: s.currentClassName,
        currentLevelName: s.currentLevelName,
        guardianName: g?.fullName ?? null,
        guardianPhone: g?.phone ?? null,
        enrollmentId: latest.id,
        enrollmentCode: latest.code,
        packageName: latest.packageName,
        sessionsRemaining: remaining,
        endDate: latest.endDate,
        reason: reason as 'COMPLETED' | 'LOW_SESSIONS' | 'ENDING',
      });
    }
    // Hết buổi trước, rồi sắp hết hạn
    const order = { COMPLETED: 0, LOW_SESSIONS: 1, ENDING: 2 } as const;
    return result.sort((a, b) => order[a.reason] - order[b.reason] || a.sessionsRemaining - b.sessionsRemaining || a.endDate.localeCompare(b.endDate));
  }

  return {
    visibleBranches,

    /** Tổng quan kinh doanh trong khoảng ngày, kèm so sánh với khoảng liền trước cùng độ dài. */
    async overview(actor: Principal, q: Period & { branchId?: string }) {
      const days = checkPeriod(q);
      const branches = await visibleBranches(actor, q.branchId);
      const branchFilter = q.branchId ? eq(enrollments.branchId, q.branchId) : undefined;
      const previous = previousPeriod(q, vnDate());
      const start = vnDayStart(q.from);
      const end = vnDayStart(shiftDate(q.to, 1));

      const leadScope = and(leadVisibility(actor), q.branchId ? eq(leads.branchId, q.branchId) : undefined, gte(leads.createdAt, start), lt(leads.createdAt, end));
      const hasAppointment = (status?: string) =>
        sql`EXISTS (SELECT 1 FROM ${leadAppointments} a WHERE a.lead_id = ${leads.id}${status ? sql` AND a.status = ${status}` : sql``})`;
      const flag = (cond: SQL) => sql<number>`COALESCE(SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0)`.mapWith(Number);

      const [revenue, prevRevenue, enrolled, [outstanding], [pending], [approvals], [funnel], sources, targetRows, due] = await Promise.all([
        revenueRows(actor, q, branchFilter),
        revenueRows(actor, previous, branchFilter),
        enrollmentRows(actor, q, branchFilter),
        db
          .select({
            amount: sql<number>`COALESCE(SUM(GREATEST(${enrollments.amountDue} - ${enrollments.amountPaid}, 0)), 0)`.mapWith(Number),
            n: flag(sql`${enrollments.amountDue} > ${enrollments.amountPaid}`),
          })
          .from(enrollments)
          .where(and(inArray(enrollments.status, ['AWAITING_PAYMENT', 'ACTIVE']), revenueScope(actor), branchFilter)),
        db
          .select({ n: count(), amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)`.mapWith(Number) })
          .from(payments)
          .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
          .where(and(eq(payments.status, 'PENDING'), revenueScope(actor), branchFilter)),
        db
          .select({ n: count() })
          .from(discountApprovals)
          .where(
            and(
              eq(discountApprovals.status, 'PENDING'),
              inArray(discountApprovals.branchId, branches.length ? branches.map((b) => b.id) : ['']),
              // Người không duyệt được chỉ thấy yêu cầu của chính mình
              can(actor, 'crm.approvals.review') ? undefined : eq(discountApprovals.requestedBy, actor.userId),
            ),
          ),
        db
          .select({
            total: count(),
            contacted: flag(sql`${leads.status} <> 'NEW'`),
            appointed: flag(hasAppointment()),
            attended: flag(hasAppointment('ATTENDED')),
            converted: flag(sql`${leads.status} = 'CONVERTED'`),
            lost: flag(sql`${leads.status} = 'LOST'`),
          })
          .from(leads)
          .where(leadScope),
        db
          .select({ source: leads.source, n: count(), converted: flag(sql`${leads.status} = 'CONVERTED'`) })
          .from(leads)
          .where(leadScope)
          .groupBy(leads.source)
          .orderBy(desc(count())),
        // Mục tiêu chỉ có ý nghĩa khi xem trọn một tháng
        q.from.endsWith('-01') && monthRange(q.from.slice(0, 7)).to === q.to
          ? db
              .select({ userId: kpiTargets.userId, target: kpiTargets.targetRevenue })
              .from(kpiTargets)
              .where(
                and(
                  eq(kpiTargets.month, q.from.slice(0, 7)),
                  inArray(kpiTargets.branchId, branches.length ? branches.map((b) => b.id) : ['']),
                  actor.scope.kind === 'TEAM' ? inArray(kpiTargets.userId, actor.scope.userIds) : actor.scope.kind === 'OWN' ? eq(kpiTargets.userId, actor.userId) : undefined,
                ),
              )
          : Promise.resolve(null),
        dueRenewals(actor, { branchId: q.branchId }),
      ]);

      const total = revenue.reduce((n, r) => n + r.amount, 0);
      const byDayMap = new Map<string, number>();
      for (const r of revenue) byDayMap.set(String(r.day).slice(0, 10), (byDayMap.get(String(r.day).slice(0, 10)) ?? 0) + r.amount);
      const byDay = Array.from({ length: days }, (_, i) => {
        const date = shiftDate(q.from, i);
        return { date, amount: byDayMap.get(date) ?? 0 };
      });

      const byUser = new Map<string | null, number>();
      for (const r of revenue) byUser.set(r.creditUserId, (byUser.get(r.creditUserId) ?? 0) + r.amount);
      const people = await names([...byUser.keys()]);
      const ranking = [...byUser.entries()]
        .filter(([id]) => id)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, amount]) => ({ userId: id!, fullName: people.get(id!)?.fullName ?? '—', role: people.get(id!)?.role ?? '', revenue: amount }));

      const sumWhere = (rows: Array<{ type: string; n?: number; value?: number; amount?: number }>, type: string, key: 'n' | 'value' | 'amount') =>
        rows.filter((r) => r.type === type).reduce((n, r) => n + (r[key] ?? 0), 0);

      return {
        period: { from: q.from, to: q.to },
        previous,
        revenue: {
          total,
          newEnrollments: sumWhere(revenue, 'NEW', 'amount'),
          renewals: sumWhere(revenue, 'RENEWAL', 'amount'),
          previousTotal: prevRevenue.reduce((n, r) => n + r.amount, 0),
          target: targetRows ? targetRows.reduce((n, r) => n + r.target, 0) || null : null,
          byDay,
        },
        enrollments: {
          newCount: sumWhere(enrolled, 'NEW', 'n'),
          newValue: sumWhere(enrolled, 'NEW', 'value'),
          renewalCount: sumWhere(enrolled, 'RENEWAL', 'n'),
          renewalValue: sumWhere(enrolled, 'RENEWAL', 'value'),
        },
        outstanding: { amount: outstanding?.amount ?? 0, enrollments: outstanding?.n ?? 0 },
        pendingPayments: { count: pending?.n ?? 0, amount: pending?.amount ?? 0 },
        pendingApprovals: approvals?.n ?? 0,
        funnel: {
          leads: funnel?.total ?? 0,
          contacted: funnel?.contacted ?? 0,
          appointed: funnel?.appointed ?? 0,
          attended: funnel?.attended ?? 0,
          converted: funnel?.converted ?? 0,
          lost: funnel?.lost ?? 0,
        },
        sources: sources.map((s) => ({ source: s.source, leads: s.n, converted: s.converted })),
        ranking,
        renewalsDue: due.length,
        byBranch:
          branches.length > 1
            ? branches.map((b) => ({
                branchId: b.id,
                name: b.name,
                revenue: revenue.filter((r) => r.branchId === b.id).reduce((n, r) => n + r.amount, 0),
                newCount: enrolled.filter((r) => r.branchId === b.id && r.type === 'NEW').reduce((n, r) => n + r.n, 0),
                renewalCount: enrolled.filter((r) => r.branchId === b.id && r.type === 'RENEWAL').reduce((n, r) => n + r.n, 0),
              }))
            : [],
      };
    },

    /** Bảng KPI tháng: mục tiêu và doanh thu thực thu của từng người. */
    async kpi(actor: Principal, q: { month: string; branchId?: string }) {
      const period = monthRange(q.month);
      const branches = await visibleBranches(actor, q.branchId);
      const branchIds = branches.map((b) => b.id);
      const branchFilter = q.branchId ? eq(enrollments.branchId, q.branchId) : undefined;
      const staffLists = await Promise.all(branchIds.map((id) => core.users.listByBranch(id, [...KPI_ROLES, ...KPI_EXTRA_ROLES])));
      let staff = [...new Map(staffLists.flat().map((u) => [u.id, u])).values()];
      if (actor.scope.kind === 'TEAM') {
        const team = actor.scope.userIds;
        staff = staff.filter((u) => team.includes(u.id));
      } else if (actor.scope.kind === 'OWN') staff = staff.filter((u) => u.id === actor.userId);

      const [revenue, enrolled, targets, leadRows] = await Promise.all([
        revenueRows(actor, period, branchFilter),
        enrollmentRows(actor, period, branchFilter),
        db
          .select()
          .from(kpiTargets)
          .where(and(eq(kpiTargets.month, q.month), inArray(kpiTargets.branchId, branchIds.length ? branchIds : ['']))),
        db
          .select({ ownerId: leads.ownerId, n: count(), converted: sql<number>`COALESCE(SUM(CASE WHEN ${leads.status} = 'CONVERTED' THEN 1 ELSE 0 END), 0)`.mapWith(Number) })
          .from(leads)
          .where(
            and(
              leadVisibility(actor),
              q.branchId ? eq(leads.branchId, q.branchId) : undefined,
              gte(leads.createdAt, vnDayStart(period.from)),
              lt(leads.createdAt, vnDayStart(shiftDate(period.to, 1))),
            ),
          )
          .groupBy(leads.ownerId),
      ]);

      const managers = await names(staff.map((u) => u.managerId));
      const editable = (u: UserSummary) => {
        if (!can(actor, 'crm.kpi.manage') || !KPI_ROLES.includes(u.role)) return false;
        if (actor.scope.kind === 'TEAM') return u.id !== actor.userId && actor.scope.userIds.includes(u.id);
        return actor.scope.kind === 'ALL' || actor.scope.kind === 'BRANCHES';
      };
      const rows = staff
        .map((u) => {
          const mine = revenue.filter((r) => r.creditUserId === u.id);
          const newRevenue = mine.filter((r) => r.type === 'NEW').reduce((n, r) => n + r.amount, 0);
          const renewalRevenue = mine.filter((r) => r.type === 'RENEWAL').reduce((n, r) => n + r.amount, 0);
          const target = targets.find((t) => t.userId === u.id)?.targetRevenue ?? null;
          const leadsOwned = leadRows.find((l) => l.ownerId === u.id);
          const manager = u.managerId ? managers.get(u.managerId) : undefined;
          return {
            userId: u.id,
            fullName: u.fullName,
            role: u.role,
            branchId: u.branchIds[0] ?? null,
            managerId: u.managerId,
            managerName: manager?.fullName ?? null,
            managerRole: manager?.role ?? null,
            target,
            revenue: newRevenue + renewalRevenue,
            newRevenue,
            renewalRevenue,
            progress: target ? Math.round(((newRevenue + renewalRevenue) / target) * 100) : null,
            newEnrollments: enrolled.filter((r) => r.creditUserId === u.id && r.type === 'NEW').reduce((n, r) => n + r.n, 0),
            renewals: enrolled.filter((r) => r.creditUserId === u.id && r.type === 'RENEWAL').reduce((n, r) => n + r.n, 0),
            leads: leadsOwned?.n ?? 0,
            converted: leadsOwned?.converted ?? 0,
            canEditTarget: editable(u),
          };
        })
        // CM chỉ hiện khi có số liệu
        .filter((r) => KPI_ROLES.includes(r.role) || r.revenue > 0 || r.target !== null)
        .sort((a, b) => b.revenue - a.revenue || a.fullName.localeCompare(b.fullName, 'vi'));

      const listed = new Set(rows.map((r) => r.userId));
      const otherRevenue = revenue.filter((r) => !r.creditUserId || !listed.has(r.creditUserId)).reduce((n, r) => n + r.amount, 0);
      const total = revenue.reduce((n, r) => n + r.amount, 0);
      const targetTotal = rows.reduce((n, r) => n + (r.target ?? 0), 0);
      return {
        month: q.month,
        rows,
        totals: {
          target: targetTotal || null,
          revenue: total,
          newRevenue: revenue.filter((r) => r.type === 'NEW').reduce((n, r) => n + r.amount, 0),
          renewalRevenue: revenue.filter((r) => r.type === 'RENEWAL').reduce((n, r) => n + r.amount, 0),
          /** Doanh thu chưa gán người / người đã nghỉ / ngoài danh sách. */
          otherRevenue,
          progress: targetTotal ? Math.round((total / targetTotal) * 100) : null,
        },
      };
    },

    /** Đặt / xoá mục tiêu doanh thu tháng (null = xoá). */
    async setTargets(actor: Principal, month: string, items: Array<{ userId: string; targetRevenue: number | null }>) {
      const branches = new Set((await visibleBranches(actor)).map((b) => b.id));
      const users = await core.users.getMany(items.map((i) => i.userId));
      for (const item of items) {
        const u = users.find((x) => x.id === item.userId);
        const branchId = u?.branchIds.find((b) => branches.has(b));
        if (!u || !branchId || !KPI_ROLES.includes(u.role)) throw Errors.validation([{ path: 'body.items', message: `Không đặt được mục tiêu cho ${u?.fullName ?? item.userId}` }]);
        if (actor.scope.kind === 'TEAM' && (u.id === actor.userId || !actor.scope.userIds.includes(u.id))) {
          throw Errors.forbidden(`SL chỉ đặt mục tiêu cho sale trong nhóm mình (${u.fullName})`);
        }
        if (actor.scope.kind === 'OWN') throw Errors.forbidden();
      }
      await db.transaction(async (tx) => {
        for (const item of items) {
          const u = users.find((x) => x.id === item.userId)!;
          if (item.targetRevenue === null) {
            await tx.delete(kpiTargets).where(and(eq(kpiTargets.userId, u.id), eq(kpiTargets.month, month)));
            continue;
          }
          const row = { branchId: u.branchIds.find((b) => branches.has(b))!, targetRevenue: item.targetRevenue, updatedBy: actor.userId, updatedAt: new Date() };
          await tx
            .insert(kpiTargets)
            .values({ userId: u.id, month, ...row })
            .onDuplicateKeyUpdate({ set: row });
        }
      });
    },

    /** Danh sách cần tái phí + kết quả tái phí trong tháng. */
    async renewals(actor: Principal, q: { branchId?: string; careId?: string; month?: string }) {
      const month = q.month ?? vnDate().slice(0, 7);
      const period = monthRange(month);
      const due = await dueRenewals(actor, q);
      const renewed = await db
        .select({
          id: enrollments.id,
          code: enrollments.code,
          studentId: enrollments.studentId,
          studentName: students.fullName,
          studentCode: students.code,
          creditUserId: enrollments.creditUserId,
          amountDue: enrollments.amountDue,
          amountPaid: enrollments.amountPaid,
          packageName: enrollments.packageName,
          createdAt: enrollments.createdAt,
        })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(
          and(
            eq(enrollments.type, 'RENEWAL'),
            ne(enrollments.status, 'CANCELLED'),
            gte(enrollments.createdAt, vnDayStart(period.from)),
            lt(enrollments.createdAt, vnDayStart(shiftDate(period.to, 1))),
            studentVisibility(actor),
            q.branchId ? eq(enrollments.branchId, q.branchId) : undefined,
            q.careId && q.careId !== 'none' ? eq(enrollments.creditUserId, q.careId) : undefined,
          ),
        )
        .orderBy(asc(enrollments.createdAt));
      const people = await names([...due.flatMap((d) => [d.careId, d.ownerId]), ...renewed.map((r) => r.creditUserId)]);
      const name = (id: string | null) => (id ? (people.get(id)?.fullName ?? null) : null);
      return {
        month,
        due: due.map((d) => ({ ...d, careName: name(d.careId), ownerName: name(d.ownerId) })),
        renewed: renewed.map((r) => ({ ...r, creditName: name(r.creditUserId), createdAt: toApiInstant(r.createdAt) })),
        summary: {
          due: due.length,
          renewed: renewed.length,
          renewedValue: renewed.reduce((n, r) => n + r.amountDue, 0),
          /** Đã tái phí trong tháng / (đã tái phí + đang cần tái phí). */
          rate: renewed.length + due.length ? Math.round((renewed.length / (renewed.length + due.length)) * 100) : null,
        },
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
