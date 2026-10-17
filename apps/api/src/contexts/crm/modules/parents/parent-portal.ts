import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { Errors } from '../../../../platform/http/errors.js';
import type { ParentPrincipal, Principal } from '../../../../platform/auth/principal.js';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { toApiInstant } from '../../../../platform/time.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { CoreContract } from '../../../core/contract/index.js';
import type { CrmDb } from '../../db/types.js';
import { enrollments, guardians, payments, students } from '../../db/schema.js';
import type { StudentsService } from '../students/students.service.js';

/**
 * Cổng phụ huynh (phần CRM): con của tôi, học phí. Chỉ đọc; phụ huynh chỉ thấy học viên
 * có phụ huynh mang SĐT của tài khoản (Core giữ danh sách con, CRM đồng bộ).
 */
export function createParentPortal(db: CrmDb, core: CoreContract, studentsService: StudentsService) {
  function assertChild(parent: ParentPrincipal, studentId: string) {
    if (!parent.studentIds.includes(studentId)) throw Errors.notFound('học viên');
  }

  return {
    /** Nhân sự cấp / cấp lại mã kích hoạt cho một phụ huynh của học viên. */
    async issueAccess(actor: Principal, studentId: string, guardianId: string) {
      await studentsService.getVisible(actor, studentId);
      const [g] = await db.select().from(guardians).where(and(eq(guardians.id, guardianId), eq(guardians.studentId, studentId)));
      if (!g) throw Errors.notFound('phụ huynh');
      const children = await db.selectDistinct({ studentId: guardians.studentId }).from(guardians).where(eq(guardians.phone, g.phone));
      const res = await core.parents.issueActivation({ phone: g.phone, fullName: g.fullName, studentIds: children.map((c) => c.studentId) });
      return { ...res, phone: g.phone, fullName: g.fullName, children: children.length };
    },

    async children(parent: ParentPrincipal) {
      if (!parent.studentIds.length) return [];
      const [rows, enrollRows] = await Promise.all([
        db.select().from(students).where(inArray(students.id, parent.studentIds)),
        db
          .select()
          .from(enrollments)
          .where(and(inArray(enrollments.studentId, parent.studentIds), inArray(enrollments.status, ['AWAITING_PAYMENT', 'ACTIVE']))),
      ]);
      const branchNames = new Map((await core.branches.getMany([...new Set(rows.map((r) => r.branchId))])).map((b) => [b.id, b.name]));
      return rows.map((s) => {
        const mine = enrollRows.filter((e) => e.studentId === s.id);
        return {
          id: s.id,
          code: s.code,
          fullName: s.fullName,
          birthDate: s.birthDate,
          gender: s.gender,
          avatarUrl: s.avatarUrl,
          status: s.status,
          branchName: branchNames.get(s.branchId) ?? null,
          currentClassName: s.currentClassName,
          currentLevelName: s.currentLevelName,
          sessionsRemaining: mine.filter((e) => e.status === 'ACTIVE').reduce((n, e) => n + Math.max(0, e.sessionsPurchased - e.sessionsUsed), 0),
          amountOutstanding: mine.reduce((n, e) => n + Math.max(0, e.amountDue - e.amountPaid), 0),
        };
      });
    },

    async tuition(parent: ParentPrincipal, studentId: string) {
      assertChild(parent, studentId);
      const rows = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.studentId, studentId), ne(enrollments.status, 'CANCELLED')))
        .orderBy(desc(enrollments.createdAt));
      const paid = rows.length
        ? await db
            .select()
            .from(payments)
            .where(and(inArray(payments.enrollmentId, rows.map((r) => r.id)), eq(payments.status, 'CONFIRMED')))
            .orderBy(desc(payments.paidAt))
        : [];
      return rows.map((e) => ({
        id: e.id,
        code: e.code,
        type: e.type,
        packageName: e.packageName,
        status: e.status,
        startDate: e.startDate,
        endDate: e.endDate,
        amountDue: e.amountDue,
        amountPaid: e.amountPaid,
        balance: Math.max(0, e.amountDue - e.amountPaid),
        sessionsPurchased: e.sessionsPurchased,
        sessionsUsed: e.sessionsUsed,
        sessionsRemaining: Math.max(0, e.sessionsPurchased - e.sessionsUsed),
        payments: paid.filter((p) => p.enrollmentId === e.id).map((p) => ({ amount: p.amount, method: p.method, paidAt: toApiInstant(p.paidAt) })),
      }));
    },
  };
}

export type ParentPortal = ReturnType<typeof createParentPortal>;

const ChildSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    fullName: z.string(),
    birthDate: z.string().nullable(),
    gender: z.enum(['MALE', 'FEMALE']).nullable(),
    avatarUrl: z.string().nullable(),
    status: z.enum(['PENDING', 'ACTIVE', 'PAUSED', 'STOPPED']),
    branchName: z.string().nullable(),
    currentClassName: z.string().nullable(),
    currentLevelName: z.string().nullable(),
    sessionsRemaining: z.number().int(),
    amountOutstanding: z.number().int().openapi({ description: 'Học phí còn phải đóng' }),
  })
  .openapi('ParentChild');

const TuitionSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    type: z.enum(['NEW', 'RENEWAL']),
    packageName: z.string(),
    status: z.enum(['AWAITING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
    startDate: z.string(),
    endDate: z.string(),
    amountDue: z.number().int(),
    amountPaid: z.number().int(),
    balance: z.number().int(),
    sessionsPurchased: z.number().int(),
    sessionsUsed: z.number().int(),
    sessionsRemaining: z.number().int(),
    payments: z.array(z.object({ amount: z.number().int(), method: z.enum(['CASH', 'TRANSFER', 'CARD']), paidAt: z.string() })),
  })
  .openapi('ParentTuition');

export function registerParentPortalRoutes(route: RouteRegistrar, portal: ParentPortal) {
  route({
    method: 'post',
    path: '/crm/students/:id/parent-access',
    tags: ['crm'],
    summary: 'Cấp mã kích hoạt tài khoản phụ huynh',
    description:
      'Sinh mã 6 số (hiệu lực 7 ngày) cho SĐT của phụ huynh — gửi cho phụ huynh qua Zalo. Phụ huynh dùng SĐT + mã để kích hoạt, ' +
      'tự đặt mật khẩu; tài khoản đã kích hoạt thì mã dùng để đặt lại mật khẩu. Mọi học viên có phụ huynh mang SĐT này đều là con của tài khoản.',
    access: { permission: 'crm.students.write' },
    request: { params: IdParams, body: z.object({ guardianId: z.string().length(26) }) },
    responses: {
      200: {
        description: 'Mã kích hoạt (chỉ hiện một lần)',
        schema: item(
          z.object({
            code: z.string(),
            expiresAt: z.string(),
            status: z.enum(['PENDING', 'ACTIVE', 'LOCKED']),
            phone: z.string(),
            fullName: z.string(),
            children: z.number().int(),
          }),
        ),
      },
    },
    errorCodes: ['PARENT_LOCKED'],
    handler: async ({ principal, params, body }) => ({ data: await portal.issueAccess(principal, params.id, body.guardianId) }),
  });

  route({
    method: 'get',
    path: '/parent/children',
    tags: ['parent'],
    summary: 'Con của tôi',
    access: { parent: true },
    responses: { 200: { description: 'Học viên', schema: item(z.array(ChildSchema)) } },
    handler: async ({ parent }) => ({ data: await portal.children(parent) }),
  });

  route({
    method: 'get',
    path: '/parent/children/:id/tuition',
    tags: ['parent'],
    summary: 'Học phí của con: các đăng ký và khoản đã đóng',
    access: { parent: true },
    request: { params: IdParams },
    responses: { 200: { description: 'Đăng ký', schema: item(z.array(TuitionSchema)) } },
    handler: async ({ parent, params }) => ({ data: await portal.tuition(parent, params.id) }),
  });
}
