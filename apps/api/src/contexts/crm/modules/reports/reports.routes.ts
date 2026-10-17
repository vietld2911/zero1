import ExcelJS from 'exceljs';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { ReportsService } from './reports.service.js';

const ulid = z.string().length(26);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng dạng YYYY-MM');

const ROLE_NAMES: Record<string, string> = { SALE: 'Sale', SL: 'Sale Leader', CS: 'CS', CM: 'CM' };

const KpiRowSchema = z
  .object({
    userId: z.string(),
    fullName: z.string(),
    role: z.string(),
    branchId: z.string().nullable(),
    managerId: z.string().nullable(),
    managerName: z.string().nullable(),
    managerRole: z.string().nullable(),
    target: z.number().int().nullable(),
    revenue: z.number().int().openapi({ description: 'Tiền đã thu (khoản thu đã xác nhận) trong tháng' }),
    newRevenue: z.number().int(),
    renewalRevenue: z.number().int(),
    progress: z.number().int().nullable().openapi({ description: '% doanh thu / mục tiêu' }),
    newEnrollments: z.number().int(),
    renewals: z.number().int(),
    leads: z.number().int().openapi({ description: 'Lead mới nhận trong tháng (đang phụ trách)' }),
    converted: z.number().int(),
    canEditTarget: z.boolean(),
  })
  .openapi('KpiRow');

const KpiBoardSchema = z
  .object({
    month: z.string(),
    rows: z.array(KpiRowSchema),
    totals: z.object({
      target: z.number().int().nullable(),
      revenue: z.number().int(),
      newRevenue: z.number().int(),
      renewalRevenue: z.number().int(),
      otherRevenue: z.number().int().openapi({ description: 'Doanh thu chưa gán người / người ngoài danh sách' }),
      progress: z.number().int().nullable(),
    }),
  })
  .openapi('KpiBoard');

const OverviewSchema = z
  .object({
    period: z.object({ from: z.string(), to: z.string() }),
    previous: z.object({ from: z.string(), to: z.string() }),
    revenue: z.object({
      total: z.number().int(),
      newEnrollments: z.number().int(),
      renewals: z.number().int(),
      previousTotal: z.number().int(),
      target: z.number().int().nullable().openapi({ description: 'Chỉ có khi xem trọn một tháng' }),
      byDay: z.array(z.object({ date: z.string(), amount: z.number().int() })),
    }),
    enrollments: z.object({ newCount: z.number().int(), newValue: z.number().int(), renewalCount: z.number().int(), renewalValue: z.number().int() }),
    outstanding: z.object({ amount: z.number().int(), enrollments: z.number().int() }),
    pendingPayments: z.object({ count: z.number().int(), amount: z.number().int() }),
    pendingApprovals: z.number().int(),
    funnel: z.object({
      leads: z.number().int(),
      contacted: z.number().int(),
      appointed: z.number().int(),
      attended: z.number().int(),
      converted: z.number().int(),
      lost: z.number().int(),
    }),
    sources: z.array(z.object({ source: z.string(), leads: z.number().int(), converted: z.number().int() })),
    ranking: z.array(z.object({ userId: z.string(), fullName: z.string(), role: z.string(), revenue: z.number().int() })),
    renewalsDue: z.number().int(),
    byBranch: z.array(z.object({ branchId: z.string(), name: z.string(), revenue: z.number().int(), newCount: z.number().int(), renewalCount: z.number().int() })),
  })
  .openapi('SalesOverview');

const RenewalsSchema = z
  .object({
    month: z.string(),
    due: z.array(
      z.object({
        studentId: z.string(),
        code: z.string(),
        fullName: z.string(),
        branchId: z.string(),
        careId: z.string().nullable(),
        careName: z.string().nullable(),
        ownerId: z.string().nullable(),
        ownerName: z.string().nullable(),
        currentClassName: z.string().nullable(),
        currentLevelName: z.string().nullable(),
        guardianName: z.string().nullable(),
        guardianPhone: z.string().nullable(),
        enrollmentId: z.string(),
        enrollmentCode: z.string(),
        packageName: z.string(),
        sessionsRemaining: z.number().int(),
        endDate: z.string(),
        reason: z.enum(['COMPLETED', 'LOW_SESSIONS', 'ENDING']).openapi({ description: 'Đã học hết / còn ít buổi / sắp hết hạn (30 ngày)' }),
      }),
    ),
    renewed: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        studentId: z.string(),
        studentName: z.string(),
        studentCode: z.string(),
        creditUserId: z.string().nullable(),
        creditName: z.string().nullable(),
        amountDue: z.number().int(),
        amountPaid: z.number().int(),
        packageName: z.string(),
        createdAt: z.string(),
      }),
    ),
    summary: z.object({
      due: z.number().int(),
      renewed: z.number().int(),
      renewedValue: z.number().int(),
      rate: z.number().int().nullable().openapi({ description: 'Đã tái phí trong tháng / (đã tái phí + đang cần tái phí), %' }),
    }),
  })
  .openapi('Renewals');

export function registerReportRoutes(route: RouteRegistrar, reports: ReportsService) {
  const read = { permission: 'crm.reports.read' } as const;

  route({
    method: 'get',
    path: '/crm/reports/overview',
    tags: ['crm'],
    summary: 'Tổng quan kinh doanh',
    description:
      'Doanh thu = khoản thu đã xác nhận theo ngày thu (giờ VN), tính cho người được tính của đăng ký (mới → sale, tái phí → CS). ' +
      'So sánh với khoảng liền trước cùng độ dài. SALE thấy số của mình, SL của nhóm, CM / CS / AM theo chi nhánh.',
    access: read,
    request: { query: z.object({ from: date, to: date, branchId: ulid.optional() }) },
    responses: { 200: { description: 'Tổng quan', schema: item(OverviewSchema) } },
    errorCodes: ['BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, query }) => ({ data: await reports.overview(principal, query) }),
  });

  route({
    method: 'get',
    path: '/crm/reports/kpi',
    tags: ['crm'],
    summary: 'Doanh số & KPI theo tháng',
    description: 'Mỗi sale / SL / CS một dòng: mục tiêu, doanh thu (mới + tái phí), số đăng ký, lead nhận trong tháng.',
    access: read,
    request: { query: z.object({ month, branchId: ulid.optional() }) },
    responses: { 200: { description: 'Bảng KPI', schema: item(KpiBoardSchema) } },
    errorCodes: ['BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, query }) => ({ data: await reports.kpi(principal, query) }),
  });

  route({
    method: 'put',
    path: '/crm/reports/kpi/targets',
    tags: ['crm'],
    summary: 'Đặt mục tiêu doanh thu tháng',
    description: '`targetRevenue: null` → xoá mục tiêu. SL đặt cho sale trong nhóm mình; CM / AM / ADMIN cho sale, SL, CS trong chi nhánh.',
    access: { permission: 'crm.kpi.manage' },
    request: {
      body: z.object({
        month,
        items: z
          .array(z.object({ userId: ulid, targetRevenue: z.number().int().min(0).max(100_000_000_000).nullable() }))
          .min(1)
          .max(200),
      }),
    },
    responses: { 204: { description: 'Đã lưu' } },
    async handler({ principal, body }) {
      await reports.setTargets(principal, body.month, body.items);
    },
  });

  route({
    method: 'get',
    path: '/crm/reports/kpi/export',
    tags: ['crm'],
    summary: 'Xuất Excel bảng KPI tháng',
    access: read,
    request: { query: z.object({ month, branchId: ulid.optional() }) },
    responses: { 200: { description: 'File Excel', fileType: XLSX } },
    async handler({ principal, query, res }) {
      const board = await reports.kpi(principal, query);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(`KPI ${query.month}`);
      ws.columns = [
        { header: 'Nhân sự', key: 'fullName', width: 26 },
        { header: 'Vai trò', key: 'role', width: 12 },
        { header: 'Quản lý', key: 'managerName', width: 22 },
        { header: 'Mục tiêu', key: 'target', width: 16 },
        { header: 'Doanh thu', key: 'revenue', width: 16 },
        { header: 'Đăng ký mới (đ)', key: 'newRevenue', width: 16 },
        { header: 'Tái phí (đ)', key: 'renewalRevenue', width: 16 },
        { header: '% mục tiêu', key: 'progress', width: 11 },
        { header: 'Số đăng ký mới', key: 'newEnrollments', width: 14 },
        { header: 'Số tái phí', key: 'renewals', width: 11 },
        { header: 'Lead nhận', key: 'leads', width: 11 },
        { header: 'Lead đã chốt', key: 'converted', width: 12 },
      ];
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13233F' } };
      for (const r of board.rows) ws.addRow({ ...r, role: ROLE_NAMES[r.role] ?? r.role, progress: r.progress === null ? '' : r.progress / 100 });
      const total = ws.addRow({
        fullName: 'Tổng',
        target: board.totals.target ?? '',
        revenue: board.totals.revenue,
        newRevenue: board.totals.newRevenue,
        renewalRevenue: board.totals.renewalRevenue,
        progress: board.totals.progress === null ? '' : board.totals.progress / 100,
      });
      total.font = { bold: true };
      for (const key of ['target', 'revenue', 'newRevenue', 'renewalRevenue']) ws.getColumn(key).numFmt = '#,##0';
      ws.getColumn('progress').numFmt = '0%';
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      res.setHeader('Content-Type', XLSX);
      res.setHeader('Content-Disposition', `attachment; filename="kpi-${query.month}.xlsx"`);
      res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    },
  });

  route({
    method: 'get',
    path: '/crm/renewals',
    tags: ['crm'],
    summary: 'Tái phí: học viên cần gia hạn + đã tái phí trong tháng',
    description:
      'Cần tái phí: học viên đang học có đăng ký gần nhất đã học hết, còn ≤ ngưỡng buổi (cài đặt `crm.renewal.remaining_threshold`) ' +
      'hoặc hết hạn trong 30 ngày, và chưa có đăng ký mới. `careId=none` → học viên chưa có CS.',
    access: { permission: 'crm.students.read' },
    request: { query: z.object({ branchId: ulid.optional(), careId: z.string().optional(), month: month.optional() }) },
    responses: { 200: { description: 'Tái phí', schema: item(RenewalsSchema) } },
    errorCodes: ['BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, query }) => ({ data: await reports.renewals(principal, query) }),
  });
}
