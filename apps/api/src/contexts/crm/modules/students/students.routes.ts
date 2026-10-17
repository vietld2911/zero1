import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item, list, PaginationQuery } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { PhoneSchema } from '../../../../platform/text.js';
import { ifMatchVersion } from '../../../../platform/http/headers.js';
import { requireFile, uploadSingle } from '../../../../platform/http/upload.js';
import { STUDENT_STATUSES } from '../../db/schema.js';
import type { StudentsService } from './students.service.js';

const ulid = z.string().length(26);

const GuardianSchema = z
  .object({
    id: z.string(),
    fullName: z.string(),
    relation: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
    job: z.string().nullable(),
    isPrimary: z.boolean(),
  })
  .openapi('Guardian');

export const StudentSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    branchId: z.string(),
    branchName: z.string().nullable(),
    ownerId: z.string().nullable(),
    ownerName: z.string().nullable(),
    careId: z.string().nullable(),
    careName: z.string().nullable(),
    fullName: z.string(),
    birthDate: z.string().nullable(),
    gender: z.enum(['MALE', 'FEMALE']).nullable(),
    school: z.string().nullable(),
    address: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    notes: z.string().nullable(),
    status: z.enum(STUDENT_STATUSES),
    currentClassName: z.string().nullable().openapi({ description: 'Từ LMS' }),
    currentLevelName: z.string().nullable(),
    guardians: z.array(GuardianSchema),
    createdAt: z.string(),
    version: z.number().int(),
  })
  .openapi('Student');

const StudentDetailSchema = StudentSchema.extend({
  documents: z.array(z.object({ id: z.string(), name: z.string(), url: z.string(), mimeType: z.string(), size: z.number().int(), createdAt: z.string() })),
  statusLogs: z.array(
    z.object({
      id: z.string(),
      fromStatus: z.string(),
      toStatus: z.string(),
      reason: z.string().nullable(),
      effectiveDate: z.string(),
      actorName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  parentAccounts: z
    .array(
      z.object({
        phone: z.string(),
        status: z.enum(['PENDING', 'ACTIVE', 'LOCKED']).openapi({ description: 'Đã cấp mã, chưa kích hoạt / đang dùng / bị khoá' }),
        lastLoginAt: z.string().nullable(),
        activationExpiresAt: z.string().nullable(),
      }),
    )
    .openapi({ description: 'Tài khoản phụ huynh theo SĐT phụ huynh (chưa cấp → không có trong danh sách)' }),
}).openapi('StudentDetail');

export const profileFields = {
  fullName: z.string().trim().min(2).max(150),
  birthDate: z.iso.date().nullable().optional(),
  gender: z.enum(['MALE', 'FEMALE']).nullable().optional(),
  school: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

export const GuardianInputSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  relation: z.string().trim().min(1).max(30),
  phone: PhoneSchema,
  email: z.email().nullable().optional(),
  job: z.string().trim().max(150).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

export function registerStudentRoutes(route: RouteRegistrar, service: StudentsService) {
  const read = { permission: 'crm.students.read' } as const;
  const write = { permission: 'crm.students.write' } as const;

  route({
    method: 'get',
    path: '/crm/students',
    tags: ['crm'],
    summary: 'Danh sách học viên',
    description: 'Tìm theo tên, mã học viên hoặc SĐT phụ huynh.',
    access: read,
    request: {
      query: PaginationQuery.extend({
        q: z.string().trim().optional(),
        status: z.string().optional(),
        branchId: ulid.optional(),
        ownerId: ulid.optional(),
        careId: ulid.optional(),
      }),
    },
    responses: { 200: { description: 'Học viên', schema: list(StudentSchema) } },
    handler: ({ principal, query }) => service.list(principal, query),
  });

  route({
    method: 'get',
    path: '/crm/students/:id',
    tags: ['crm'],
    summary: 'Hồ sơ học viên',
    access: read,
    request: { params: IdParams },
    responses: { 200: { description: 'Học viên', schema: item(StudentDetailSchema) } },
    handler: async ({ principal, params }) => ({ data: await service.get(principal, params.id) }),
  });

  route({
    method: 'patch',
    path: '/crm/students/:id',
    tags: ['crm'],
    summary: 'Sửa hồ sơ học viên',
    description: 'Gửi `If-Match: <version>`. Đổi tên / ngày sinh / giới tính được đồng bộ sang LMS.',
    access: write,
    request: { params: IdParams, body: z.object(profileFields).partial().strict() },
    responses: { 200: { description: 'Sau khi sửa', schema: item(StudentDetailSchema) } },
    errorCodes: ['VERSION_CONFLICT'],
    handler: async ({ principal, params, body, req }) => ({ data: await service.updateProfile(principal, params.id, body, ifMatchVersion(req)) }),
  });

  route({
    method: 'post',
    path: '/crm/students/:id/guardians',
    tags: ['crm'],
    summary: 'Cập nhật danh sách phụ huynh',
    description: 'Thay toàn bộ danh sách. Người đầu tiên có `isPrimary` (hoặc người đầu danh sách) là liên hệ chính.',
    access: write,
    request: { params: IdParams, body: z.object({ guardians: z.array(GuardianInputSchema).min(1).max(5) }) },
    responses: { 200: { description: 'Học viên', schema: item(StudentDetailSchema) } },
    handler: async ({ principal, params, body }) => ({ data: await service.replaceGuardians(principal, params.id, body.guardians) }),
  });

  route({
    method: 'post',
    path: '/crm/students/:id/status',
    tags: ['crm'],
    summary: 'Bảo lưu / nghỉ / học lại',
    description: 'Đang học ↔ bảo lưu ↔ nghỉ. LMS tự rút học viên khỏi lớp khi bảo lưu / nghỉ.',
    access: { permission: 'crm.students.status' },
    request: {
      params: IdParams,
      body: z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'STOPPED']), reason: z.string().trim().max(500).nullable().optional(), effectiveDate: z.iso.date().optional() }),
    },
    responses: { 200: { description: 'Học viên', schema: item(StudentDetailSchema) } },
    errorCodes: ['INVALID_STATE_TRANSITION'],
    handler: async ({ principal, params, body }) => ({ data: await service.setStatus(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/crm/students/:id/assign',
    tags: ['crm'],
    summary: 'Đổi sale phụ trách / CS chăm sóc',
    access: { permission: 'crm.students.status' },
    request: { params: IdParams, body: z.object({ ownerId: ulid.nullable().optional(), careId: ulid.nullable().optional() }) },
    responses: { 200: { description: 'Học viên', schema: item(StudentDetailSchema) } },
    errorCodes: ['STAFF_INVALID'],
    handler: async ({ principal, params, body }) => ({ data: await service.assign(principal, params.id, body) }),
  });

  route({
    method: 'post',
    path: '/crm/students/:id/documents',
    tags: ['crm'],
    summary: 'Tải giấy tờ lên hồ sơ',
    access: write,
    upload: {
      handler: uploadSingle({ field: 'file', maxBytes: 10 * 1_048_576, accept: ['image/', 'application/pdf', 'application/vnd.openxmlformats-officedocument', 'application/msword'] }),
      field: 'file',
      description: 'Ảnh / PDF / Word, tối đa 10 MB',
    },
    request: { params: IdParams },
    responses: { 201: { description: 'Học viên', schema: item(StudentDetailSchema) } },
    errorCodes: ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE'],
    handler: async ({ principal, params, req }) => ({ data: await service.addDocument(principal, params.id, requireFile(req, 'file')) }),
  });

  route({
    method: 'delete',
    path: '/crm/students/:id/documents/:documentId',
    tags: ['crm'],
    summary: 'Xoá giấy tờ',
    access: write,
    request: { params: z.object({ id: ulid, documentId: ulid }) },
    responses: { 204: { description: 'Đã xoá' } },
    async handler({ principal, params }) {
      await service.removeDocument(principal, params.id, params.documentId);
    },
  });

  route({
    method: 'post',
    path: '/crm/students/:id/avatar',
    tags: ['crm'],
    summary: 'Đổi ảnh đại diện',
    access: write,
    upload: { handler: uploadSingle({ field: 'file', maxBytes: 3 * 1_048_576, accept: ['image/'] }), field: 'file', description: 'Ảnh, tối đa 3 MB' },
    request: { params: IdParams },
    responses: { 200: { description: 'Học viên', schema: item(StudentDetailSchema) } },
    errorCodes: ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE'],
    handler: async ({ principal, params, req }) => ({ data: await service.setAvatar(principal, params.id, requireFile(req, 'file')) }),
  });
}
