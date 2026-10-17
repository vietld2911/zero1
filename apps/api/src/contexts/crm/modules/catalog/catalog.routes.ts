import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import { toApiInstant } from '../../../../platform/time.js';
import type { createLevelCatalog } from './level-projection.js';

const CatalogLevelSchema = z
  .object({
    levelId: z.string(),
    subjectId: z.string(),
    subjectCode: z.string(),
    subjectName: z.string(),
    code: z.string(),
    name: z.string(),
    sessionsCount: z.number().int(),
    sessionMinutes: z.number().int(),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
    syncedAt: z.string().openapi({ description: 'Lần cuối đồng bộ từ LMS' }),
  })
  .openapi('CatalogLevel');

export function registerCatalogRoutes(route: RouteRegistrar, catalog: ReturnType<typeof createLevelCatalog>) {
  route({
    method: 'get',
    path: '/crm/catalog/levels',
    tags: ['crm'],
    summary: 'Cấp độ đang mở bán (bản sao từ LMS)',
    description: 'Đồng bộ tự động qua sự kiện `lms.level.changed` (thường trong vài giây). Dùng khi tạo gói học phí.',
    access: { authenticated: true },
    request: { query: z.object({ includeInactive: z.stringbool().default(false).openapi({ type: 'boolean' }) }) },
    responses: { 200: { description: 'Cấp độ', schema: item(z.array(CatalogLevelSchema)) } },
    handler: async ({ query }) => ({
      data: (await catalog.list(query.includeInactive)).map(({ sourceEventId: _e, syncedAt, ...l }) => ({ ...l, syncedAt: toApiInstant(syncedAt) })),
    }),
  });
}
