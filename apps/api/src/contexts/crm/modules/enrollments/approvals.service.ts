import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError, Errors } from '../../../../platform/http/errors.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { CrmDb } from '../../db/types.js';
import { discountApprovals, enrollments, students } from '../../db/schema.js';
import type { EnrollmentsService } from './enrollments.service.js';

/** Ai duyệt được mức nào: CM duyệt mức CM; AM / ADMIN duyệt cả hai. */
function canReviewLevel(role: string, level: 'CM' | 'AM') {
  if (role === 'ADMIN' || role === 'AM') return true;
  return role === 'CM' && level === 'CM';
}

export function createApprovalsService(db: CrmDb, core: CoreContract, enrollmentsService: EnrollmentsService) {
  function branchFilter(actor: Principal) {
    if (actor.scope.kind === 'ALL') return undefined;
    return actor.branchIds.length ? inArray(discountApprovals.branchId, actor.branchIds) : sql`1 = 0`;
  }

  return {
    async list(actor: Principal, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
      const rows = await db
        .select({ a: discountApprovals, e: enrollments, studentName: students.fullName, studentCode: students.code })
        .from(discountApprovals)
        .innerJoin(enrollments, eq(enrollments.id, discountApprovals.enrollmentId))
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(and(branchFilter(actor), status ? eq(discountApprovals.status, status) : undefined))
        .orderBy(desc(discountApprovals.createdAt))
        .limit(200);
      const users = new Map(
        (await core.users.getMany([...new Set(rows.flatMap((r) => [r.a.requestedBy, r.a.reviewedBy]).filter((x): x is string => !!x))])).map((u) => [u.id, u.fullName]),
      );
      return rows.map(({ a, e, studentName, studentCode }) => ({
        id: a.id,
        enrollmentId: e.id,
        enrollmentCode: e.code,
        studentName,
        studentCode,
        branchId: a.branchId,
        packageName: e.packageName,
        listPrice: e.listPrice,
        promotionDiscount: e.promotionDiscount,
        extraDiscount: a.extraDiscount,
        extraScholarshipMonths: a.extraScholarshipMonths,
        value: a.value,
        approverRole: a.approverRole,
        reason: a.reason,
        status: a.status,
        requestedByName: users.get(a.requestedBy) ?? null,
        reviewedByName: a.reviewedBy ? (users.get(a.reviewedBy) ?? null) : null,
        reviewNote: a.reviewNote,
        createdAt: toApiInstant(a.createdAt),
        reviewedAt: a.reviewedAt ? toApiInstant(a.reviewedAt) : null,
        /** Người gọi có duyệt được yêu cầu này không (cấp + không phải người xin). */
        canReview: a.status === 'PENDING' && canReviewLevel(actor.role, a.approverRole) && a.requestedBy !== actor.userId,
      }));
    },

    async review(actor: Principal, id: string, decision: 'APPROVE' | 'REJECT', note?: string | null) {
      const reviewed = await db.transaction(async (tx) => {
        const [a] = await tx
          .select()
          .from(discountApprovals)
          .where(and(eq(discountApprovals.id, id), branchFilter(actor)))
          .for('update');
        if (!a) throw Errors.notFound('yêu cầu duyệt');
        if (a.status !== 'PENDING') throw Errors.conflict('APPROVAL_ALREADY_REVIEWED', 'Yêu cầu đã được xử lý');
        if (a.requestedBy === actor.userId) throw new AppError(403, 'CANNOT_APPROVE_SELF', 'Không tự duyệt yêu cầu của mình');
        if (!canReviewLevel(actor.role, a.approverRole)) {
          throw new AppError(403, 'APPROVER_LEVEL_TOO_LOW', `Yêu cầu này cần ${a.approverRole} duyệt`, `Giá trị ${a.value.toLocaleString('vi-VN')}đ vượt hạn mức CM`);
        }
        await tx
          .update(discountApprovals)
          .set({ status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedBy: actor.userId, reviewedAt: new Date(), reviewNote: note ?? null })
          .where(eq(discountApprovals.id, id));
        await enrollmentsService.applyApproval(tx, a.enrollmentId, decision === 'APPROVE', actor.userId);
        return a;
      });
      const value = `${reviewed.value.toLocaleString('vi-VN')}đ`;
      await core.notifications.send([
        {
          userId: reviewed.requestedBy,
          type: 'crm.approval.reviewed',
          app: 'crm',
          title: decision === 'APPROVE' ? 'Ưu đãi đã được duyệt' : 'Ưu đãi bị từ chối',
          body: note ? `${value} · ${note}` : value,
          link: `/enrollments/${reviewed.enrollmentId}`,
        },
      ]);
    },
  };
}

export type ApprovalsService = ReturnType<typeof createApprovalsService>;
