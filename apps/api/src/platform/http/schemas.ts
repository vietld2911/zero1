import { z } from '../openapi/zod.js';

export const ProblemSchema = z
  .object({
    type: z.string().openapi({ example: 'urn:zero1:error:VALIDATION_ERROR' }),
    title: z.string().openapi({ example: 'Dữ liệu không hợp lệ' }),
    status: z.number().int().openapi({ example: 400 }),
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    detail: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string(),
  })
  .openapi('Problem', { description: 'Lỗi theo RFC 7807' });

export const PageMetaSchema = z
  .object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi('PageMeta');

/** `{ data: T }` */
export const item = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

/** `{ data: T[], meta }` */
export const list = <T extends z.ZodType>(schema: T) => z.object({ data: z.array(schema), meta: PageMetaSchema });

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .optional()
    .openapi({ description: 'Danh sách field, `-` là giảm dần. Ví dụ: `-createdAt,fullName`' }),
});

/**
 * `T | null` cho schema đã đặt tên (component). KHÔNG dùng `.nullable()` trên component:
 * zod-to-openapi sẽ đánh dấu nullable vào chính component, làm sai mọi chỗ khác dùng nó.
 */
export const nullableRef = <T extends z.ZodType>(schema: T) => z.union([schema, z.null()]);

export const IdParams = z.object({ id: z.string().length(26).openapi({ description: 'ULID' }) });
