import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { vnDate } from '../../../../platform/time.js';
import type { PromotionsService } from './promotions.service.js';

const ulid = z.string().length(26);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{2,30}$/, 'Mã 2–30 ký tự: chữ, số, - hoặc _');

const ProgramSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    discountType: z.enum(['PERCENT', 'AMOUNT']),
    discountValue: z.number().int().openapi({ description: 'PERCENT: 1–100; AMOUNT: VNĐ' }),
    maxDiscount: z.number().int().nullable().openapi({ description: 'Trần số tiền giảm (chỉ PERCENT)' }),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    branchIds: z.array(z.string()).nullable().openapi({ description: 'null = mọi chi nhánh' }),
    packageIds: z.array(z.string()).nullable().openapi({ description: 'null = mọi gói' }),
    isActive: z.boolean(),
  })
  .openapi('PromotionProgram');

const programFields = {
  code,
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  discountType: z.enum(['PERCENT', 'AMOUNT']),
  discountValue: z.number().int().min(1),
  maxDiscount: z.number().int().min(1).nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  branchIds: z.array(ulid).max(200).nullable().optional(),
  packageIds: z.array(ulid).max(500).nullable().optional(),
};

const ItemSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    unit: z.string(),
    minStock: z.number().int(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    stock: z.array(z.object({ branchId: z.string(), quantity: z.number().int() })).openapi({ description: 'Tồn theo chi nhánh trong phạm vi người gọi' }),
    totalStock: z.number().int(),
    lowStockBranches: z.array(z.string()).openapi({ description: 'Chi nhánh có tồn ≤ mức tối thiểu' }),
  })
  .openapi('PromotionItem');

const StockMoveSchema = z
  .object({
    id: z.string(),
    itemId: z.string(),
    branchId: z.string(),
    quantity: z.number().int().openapi({ description: 'Dương = nhập / trả, âm = xuất / tặng' }),
    kind: z.enum(['IN', 'OUT', 'ADJUST', 'GIFT', 'RETURN']),
    refId: z.string().nullable(),
    note: z.string().nullable(),
    createdBy: z.string(),
    createdAt: z.string(),
  })
  .openapi('PromotionStockMove');

const itemFields = {
  code,
  name: z.string().trim().min(2).max(200),
  unit: z.string().trim().min(1).max(20),
  minStock: z.number().int().min(0).max(100_000),
  description: z.string().trim().max(1000).nullable().optional(),
};

export function registerPromotionRoutes(route: RouteRegistrar, service: PromotionsService) {
  const manage = { permission: 'crm.promotions.manage' } as const;

  route({
    method: 'get',
    path: '/crm/promotions',
    tags: ['crm'],
    summary: 'Chương trình khuyến mại',
    description: 'Gửi đủ `branchId` + `packageId` → chỉ trả chương trình áp dụng được hôm nay (hoặc `date`).',
    access: { authenticated: true },
    request: {
      query: z.object({
        includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }),
        branchId: ulid.optional(),
        packageId: ulid.optional(),
        date: z.iso.date().optional(),
      }),
    },
    responses: { 200: { description: 'Chương trình', schema: item(z.array(ProgramSchema)) } },
    handler: async ({ query }) => ({
      data: await service.listPrograms({
        includeInactive: query.includeInactive,
        eligibleFor:
          query.branchId && query.packageId
            ? { branchId: query.branchId, packageId: query.packageId, date: query.date ?? vnDate() }
            : undefined,
      }),
    }),
  });

  route({
    method: 'post',
    path: '/crm/promotions',
    tags: ['crm'],
    summary: 'Tạo chương trình khuyến mại',
    access: manage,
    request: { body: z.object(programFields) },
    responses: { 201: { description: 'Đã tạo', schema: item(ProgramSchema) } },
    errorCodes: ['PROMOTION_CODE_TAKEN'],
    handler: async ({ body }) => ({ data: await service.createProgram(body) }),
  });

  route({
    method: 'patch',
    path: '/crm/promotions/:id',
    tags: ['crm'],
    summary: 'Sửa / ngừng chương trình khuyến mại',
    description: 'Đăng ký đã chốt giữ nguyên số tiền giảm cũ.',
    access: manage,
    request: { params: IdParams, body: z.object(programFields).partial().extend({ isActive: z.boolean().optional() }).strict() },
    responses: { 200: { description: 'Sau khi sửa', schema: item(ProgramSchema) } },
    errorCodes: ['PROMOTION_CODE_TAKEN'],
    handler: async ({ params, body }) => ({ data: await service.updateProgram(params.id, body) }),
  });

  route({
    method: 'get',
    path: '/crm/promotion-items',
    tags: ['crm'],
    summary: 'Quà tặng và tồn kho theo chi nhánh',
    access: { authenticated: true },
    request: { query: z.object({ includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }) }) },
    responses: { 200: { description: 'Quà tặng', schema: item(z.array(ItemSchema)) } },
    handler: async ({ principal, query }) => ({ data: await service.listItems(principal, query.includeInactive) }),
  });

  route({
    method: 'post',
    path: '/crm/promotion-items',
    tags: ['crm'],
    summary: 'Thêm quà tặng',
    access: manage,
    request: { body: z.object({ ...itemFields, unit: itemFields.unit.default('cái'), minStock: itemFields.minStock.default(5) }) },
    responses: { 201: { description: 'Đã tạo', schema: item(z.object({ id: z.string() })) } },
    errorCodes: ['ITEM_CODE_TAKEN'],
    handler: async ({ body }) => ({ data: { id: await service.createItem(body) } }),
  });

  route({
    method: 'patch',
    path: '/crm/promotion-items/:id',
    tags: ['crm'],
    summary: 'Sửa / ngừng quà tặng',
    access: manage,
    request: { params: IdParams, body: z.object(itemFields).partial().extend({ isActive: z.boolean().optional() }).strict() },
    responses: { 204: { description: 'Đã lưu' } },
    errorCodes: ['ITEM_CODE_TAKEN'],
    async handler({ params, body }) {
      await service.updateItem(params.id, body);
    },
  });

  route({
    method: 'post',
    path: '/crm/promotion-items/:id/stock-moves',
    tags: ['crm'],
    summary: 'Nhập / xuất / điều chỉnh kho',
    description: 'IN, OUT: `quantity` > 0. ADJUST: số có dấu (âm = giảm). Không cho tồn âm.',
    access: { permission: 'crm.promotions.stock' },
    request: {
      params: IdParams,
      body: z.object({
        branchId: ulid,
        kind: z.enum(['IN', 'OUT', 'ADJUST']),
        quantity: z.number().int().min(-100_000).max(100_000),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    },
    responses: { 201: { description: 'Tồn sau thao tác', schema: item(z.object({ branchId: z.string(), quantity: z.number().int() })) } },
    errorCodes: ['INSUFFICIENT_STOCK', 'BRANCH_OUT_OF_SCOPE'],
    handler: async ({ principal, params, body }) => ({ data: await service.moveStock(principal, params.id, body) }),
  });

  route({
    method: 'get',
    path: '/crm/promotion-items/:id/stock-moves',
    tags: ['crm'],
    summary: 'Lịch sử kho của quà tặng',
    access: { permission: 'crm.promotions.stock' },
    request: { params: IdParams, query: z.object({ branchId: ulid.optional() }) },
    responses: { 200: { description: '200 dòng gần nhất', schema: item(z.array(StockMoveSchema)) } },
    handler: async ({ principal, params, query }) => ({ data: await service.listMoves(principal, params.id, query.branchId) }),
  });
}
