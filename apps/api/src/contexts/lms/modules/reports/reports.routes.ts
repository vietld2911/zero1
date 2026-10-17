import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { LmsReportsService } from './reports.service.js';

const rate = z.number().int().nullable();

const TeachingReportSchema = z
  .object({
    month: z.string(),
    summary: z.object({
      sessionsDone: z.number().int(),
      sessionsCancelled: z.number().int(),
      sessionsOverdue: z.number().int().openapi({ description: 'Đã qua giờ học, chưa chốt điểm danh' }),
      teachingHours: z.number(),
      attendanceRate: rate.openapi({ description: '% có mặt + đi muộn trên số lượt điểm danh' }),
      feedbackRate: rate.openapi({ description: '% lượt học viên có mặt được nhận xét' }),
    }),
    teachers: z.array(
      z.object({
        userId: z.string(),
        fullName: z.string(),
        role: z.string(),
        sessions: z.number().int().openapi({ description: 'Buổi đã dạy (đã chốt)' }),
        substituteSessions: z.number().int(),
        hours: z.number(),
        assistedSessions: z.number().int().openapi({ description: 'Buổi trợ giảng' }),
        overdueSessions: z.number().int(),
        feedbackRate: rate,
      }),
    ),
    classes: z.array(
      z.object({
        classId: z.string(),
        code: z.string(),
        name: z.string(),
        status: z.string(),
        learners: z.number().int(),
        sessionsDone: z.number().int(),
        sessionsCancelled: z.number().int(),
        sessionsOverdue: z.number().int(),
        attendanceRate: rate,
        absences: z.number().int(),
        feedbackRate: rate,
        assignments: z.number().int(),
        submissionRate: rate,
        gradedRate: rate,
      }),
    ),
  })
  .openapi('TeachingReport');

export function registerLmsReportRoutes(route: RouteRegistrar, reports: LmsReportsService) {
  route({
    method: 'get',
    path: '/lms/reports/teaching',
    tags: ['lms'],
    summary: 'Báo cáo học tập theo tháng',
    description: 'Khối lượng giảng dạy từng GV / TA và chất lượng từng lớp. GV / TA chỉ thấy lớp mình dạy.',
    access: { permission: 'lms.reports.read' },
    request: {
      query: z.object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Tháng dạng YYYY-MM'),
        branchId: z.string().length(26).optional(),
      }),
    },
    responses: { 200: { description: 'Báo cáo', schema: item(TeachingReportSchema) } },
    errorCodes: ['BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, query }) => ({ data: await reports.teaching(principal, query) }),
  });
}
