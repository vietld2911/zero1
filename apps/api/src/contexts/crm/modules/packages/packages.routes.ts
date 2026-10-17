import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { PackagesService } from './packages.service.js';

const ulid = z.string().length(26);
const vnd = z.number().int().min(0).openapi({ description: 'VNĐ' });

export const PackageSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    subjectId: z.string(),
    subjectName: z.string().nullable(),
    months: z.number().int(),
    sessionsCount: z.number().int(),
    sessionsPerWeek: z.number().int(),
    basePrice: z.number().int(),
    defaultScholarshipMonths: z.number().int(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    branchPrices: z.array(z.object({ branchId: z.string(), price: z.number().int() })),
    effectivePrice: z.number().int().nullable().openapi({ description: 'Giá áp dụng tại `branchId` được hỏi' }),
  })
  .openapi('Package');

const packageFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'Mã 2–20 ký tự: chữ, số, - hoặc _'),
  name: z.string().trim().min(2).max(150),
  subjectId: ulid,
  months: z.number().int().min(1).max(60),
  sessionsCount: z.number().int().min(1).max(500),
  sessionsPerWeek: z.number().int().min(1).max(14),
  basePrice: vnd,
  defaultScholarshipMonths: z.number().int().min(0).max(24),
  description: z.string().trim().max(1000).nullable().optional(),
};

export function registerPackageRoutes(route: RouteRegistrar, service: PackagesService) {
  route({
    method: 'get',
    path: '/crm/catalog/subjects',
    tags: ['crm'],
    summary: 'Môn học (bản sao từ LMS)',
    access: { authenticated: true },
    responses: { 200: { description: 'Môn học', schema: item(z.array(z.object({ id: z.string(), code: z.string(), name: z.string() }))) } },
    handler: async () => ({ data: await service.subjects() }),
  });

  route({
    method: 'get',
    path: '/crm/packages',
    tags: ['crm'],
    summary: 'Danh sách gói học phí',
    description: 'Có `branchId` → kèm giá áp dụng tại chi nhánh đó (`effectivePrice`).',
    access: { authenticated: true },
    request: {
      query: z.object({
        includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }),
        subjectId: ulid.optional(),
        branchId: ulid.optional(),
      }),
    },
    responses: { 200: { description: 'Gói học phí', schema: item(z.array(PackageSchema)) } },
    handler: async ({ principal, query }) => ({ data: await service.list(principal, query) }),
  });

  route({
    method: 'post',
    path: '/crm/packages',
    tags: ['crm'],
    summary: 'Tạo gói học phí',
    access: { permission: 'crm.catalog.manage' },
    request: { body: z.object({ ...packageFields, sessionsPerWeek: packageFields.sessionsPerWeek.default(2), defaultScholarshipMonths: packageFields.defaultScholarshipMonths.default(0) }) },
    responses: { 201: { description: 'Đã tạo', schema: item(PackageSchema) } },
    errorCodes: ['PACKAGE_CODE_TAKEN'],
    handler: async ({ principal, body }) => ({ data: await service.create(principal, body) }),
  });

  route({
    method: 'patch',
    path: '/crm/packages/:id',
    tags: ['crm'],
    summary: 'Sửa / ngừng bán gói',
    description: 'Đăng ký đã tạo giữ nguyên giá đã chốt — sửa gói không ảnh hưởng.',
    access: { permission: 'crm.catalog.manage' },
    request: { params: IdParams, body: z.object(packageFields).partial().extend({ isActive: z.boolean().optional() }).strict() },
    responses: { 200: { description: 'Sau khi sửa', schema: item(PackageSchema) } },
    errorCodes: ['PACKAGE_CODE_TAKEN'],
    handler: async ({ principal, params, body }) => ({ data: await service.update(principal, params.id, body) }),
  });

  route({
    method: 'patch',
    path: '/crm/packages/:id/branch-prices',
    tags: ['crm'],
    summary: 'Đặt giá riêng cho chi nhánh',
    description: '`price: null` → bỏ giá riêng, quay về giá gốc. AM chỉ đặt cho chi nhánh mình quản lý.',
    access: { permission: 'crm.catalog.branch_prices' },
    request: { params: IdParams, body: z.object({ branchId: ulid, price: vnd.nullable() }) },
    responses: { 200: { description: 'Gói sau khi đặt giá', schema: item(PackageSchema) } },
    errorCodes: ['BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, params, body }) => ({ data: await service.setBranchPrice(principal, params.id, body.branchId, body.price) }),
  });
}
