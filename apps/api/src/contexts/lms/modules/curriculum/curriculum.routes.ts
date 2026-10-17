import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { CurriculumService } from './curriculum.service.js';

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,20}$/, 'Mã 1–20 ký tự: chữ, số, - hoặc _');
const description = z.string().trim().max(1000).nullable().optional();

export const LevelSchema = z
  .object({
    id: z.string(),
    subjectId: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    sessionsCount: z.number().int(),
    sessionMinutes: z.number().int(),
    sortOrder: z.number().int().openapi({ description: 'Thứ tự lên lớp trong môn (1 = cấp đầu tiên)' }),
    isActive: z.boolean(),
  })
  .openapi('Level');

export const SubjectSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    levels: z.array(LevelSchema),
  })
  .openapi('Subject');

const SubjectBody = z.object({ code, name: z.string().trim().min(2).max(150), description });
const levelFields = {
  code,
  name: z.string().trim().min(2).max(150),
  description,
  sessionsCount: z.number().int().min(1, 'Tối thiểu 1 buổi').max(200),
  sessionMinutes: z.number().int().min(15).max(480),
};
const LevelBody = z.object({ ...levelFields, sessionMinutes: levelFields.sessionMinutes.default(90) });
// Không dẫn xuất từ LevelBody: .partial() vẫn giữ default → PATCH đổi tên sẽ ghi đè thời lượng về 90.
const LevelPatch = z.object(levelFields).partial().extend({ isActive: z.boolean().optional() }).strict();

export function registerCurriculumRoutes(route: RouteRegistrar, service: CurriculumService) {
  const manage = { permission: 'lms.curriculum.manage' } as const;

  route({
    method: 'get',
    path: '/lms/subjects',
    tags: ['lms'],
    summary: 'Chương trình học: môn và cấp độ',
    description: 'Mọi nhân sự đã đăng nhập đều xem được (CRM cần để tư vấn / tạo gói). Cấp độ xếp theo thứ tự lên lớp.',
    access: { authenticated: true },
    request: { query: z.object({ includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }) }) },
    responses: { 200: { description: 'Môn học kèm cấp độ', schema: item(z.array(SubjectSchema)) } },
    handler: async ({ query }) => ({ data: await service.list(query.includeInactive) }),
  });

  route({
    method: 'post',
    path: '/lms/subjects',
    tags: ['lms'],
    summary: 'Thêm môn học',
    access: manage,
    request: { body: SubjectBody },
    responses: { 201: { description: 'Đã tạo', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['SUBJECT_CODE_TAKEN'],
    handler: async ({ principal, body }) => ({ data: { id: await service.createSubject(principal, body) } }),
  });

  route({
    method: 'patch',
    path: '/lms/subjects/:id',
    tags: ['lms'],
    summary: 'Sửa / ngừng môn học',
    description: 'Ngừng môn → mọi cấp độ trong môn được coi là ngừng (CRM không bán gói của môn này nữa).',
    access: manage,
    request: { params: IdParams, body: SubjectBody.partial().extend({ isActive: z.boolean().optional() }).strict() },
    responses: { 204: { description: 'Đã lưu' } },
    errorCodes: ['SUBJECT_CODE_TAKEN'],
    async handler({ principal, params, body }) {
      await service.updateSubject(principal, params.id, body);
    },
  });

  route({
    method: 'post',
    path: '/lms/subjects/:id/levels',
    tags: ['lms'],
    summary: 'Thêm cấp độ vào môn học',
    description: 'Cấp độ mới được xếp cuối cùng trong môn.',
    access: manage,
    request: { params: IdParams, body: LevelBody },
    responses: { 201: { description: 'Đã tạo', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['LEVEL_CODE_TAKEN'],
    handler: async ({ principal, params, body }) => ({ data: { id: await service.createLevel(principal, params.id, body) } }),
  });

  route({
    method: 'patch',
    path: '/lms/subjects/:id/level-order',
    tags: ['lms'],
    summary: 'Sắp lại thứ tự lên lớp',
    access: manage,
    request: { params: IdParams, body: z.object({ levelIds: z.array(z.string().length(26)).min(1).max(100) }) },
    responses: { 204: { description: 'Đã lưu' } },
    async handler({ principal, params, body }) {
      await service.reorderLevels(principal, params.id, body.levelIds);
    },
  });

  route({
    method: 'get',
    path: '/lms/levels/:id',
    tags: ['lms'],
    summary: 'Chi tiết cấp độ',
    access: { authenticated: true },
    request: { params: IdParams },
    responses: { 200: { description: 'Cấp độ', schema: item(LevelSchema) } },
    handler: async ({ params }) => ({ data: await service.getLevel(params.id) }),
  });

  route({
    method: 'patch',
    path: '/lms/levels/:id',
    tags: ['lms'],
    summary: 'Sửa / ngừng cấp độ',
    access: manage,
    request: { params: IdParams, body: LevelPatch },
    responses: { 204: { description: 'Đã lưu' } },
    errorCodes: ['LEVEL_CODE_TAKEN'],
    async handler({ principal, params, body }) {
      await service.updateLevel(principal, params.id, body);
    },
  });
}
