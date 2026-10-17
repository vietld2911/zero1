import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { IdParams, item, list, PaginationQuery } from '../../../../platform/http/schemas.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { IntegrationsService } from './integrations.service.js';

const manage = { permission: 'core.integrations.manage' } as const;

const TargetSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['WEBHOOK', 'TELEGRAM']),
    name: z.string(),
    url: z.string().nullable(),
    chatId: z.string().nullable(),
    secretPreview: z.string().nullable(),
    events: z.array(z.string()).openapi({ description: '`*` = mọi sự kiện (Telegram: mọi sự kiện có mẫu tin)' }),
    branchIds: z.array(z.string()).openapi({ description: 'Rỗng = mọi chi nhánh' }),
    isActive: z.boolean(),
    createdAt: z.string(),
    delivered: z.number().int(),
    pending: z.number().int(),
    failed: z.number().int(),
  })
  .openapi('IntegrationTarget');

const DeliverySchema = z
  .object({
    id: z.string(),
    targetId: z.string(),
    eventId: z.string(),
    eventType: z.string(),
    eventLabel: z.string(),
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
    attempts: z.number().int(),
    lastStatusCode: z.number().int().nullable(),
    lastError: z.string().nullable(),
    nextAttemptAt: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('IntegrationDelivery');

const TestResultSchema = item(z.object({ ok: z.boolean(), statusCode: z.number().int().nullable(), error: z.string().nullable() }));

const fields = {
  name: z.string().trim().min(2).max(100),
  events: z.array(z.string().max(100)).min(1).max(50),
  branchIds: z.array(z.string().length(26)).max(200),
};

export function registerIntegrationRoutes(route: RouteRegistrar, service: IntegrationsService) {
  route({
    method: 'get',
    path: '/core/integrations',
    tags: ['core'],
    summary: 'Webhook & Telegram: nơi nhận, danh mục sự kiện',
    access: manage,
    responses: {
      200: {
        description: 'Tổng quan tích hợp',
        schema: item(
          z.object({
            telegramConfigured: z.boolean().openapi({ description: 'Máy chủ đã có TELEGRAM_BOT_TOKEN' }),
            eventTypes: z.array(z.object({ type: z.string(), label: z.string(), app: z.enum(['crm', 'lms']), telegram: z.boolean() })),
            targets: z.array(TargetSchema),
          }),
        ),
      },
    },
    handler: async () => ({ data: await service.overview() }),
  });

  route({
    method: 'post',
    path: '/core/integrations/targets',
    tags: ['core'],
    summary: 'Thêm webhook / nhóm Telegram',
    description:
      'Webhook: hệ thống gửi `POST` JSON `{ id, type, version, occurredAt, branchId, data }` kèm header `X-Zero1-Event`, `X-Zero1-Delivery`, ' +
      '`X-Zero1-Timestamp`, `X-Zero1-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`. Trả 2xx trong 10 giây; lỗi 5xx / 408 / 429 / mạng → ' +
      'gửi lại sau 1, 5, 15, 60, 180, 360 phút. `secret` chỉ hiện một lần.\n\nTelegram: thêm bot vào nhóm, lấy `chat_id` của nhóm (số âm).',
    access: manage,
    request: {
      body: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('WEBHOOK'), url: z.url().max(500), ...fields }),
        z.object({ kind: z.literal('TELEGRAM'), chatId: z.string().trim().regex(/^-?\d{5,20}$|^@[A-Za-z0-9_]{5,}$/, 'chat_id là số (nhóm: số âm) hoặc @tenkenh'), ...fields }),
      ]),
    },
    responses: { 201: { description: 'Đã thêm', schema: item(z.object({ id: z.string(), secret: z.string().nullable() })) } },
    errorCodes: ['WEBHOOK_PRIVATE_ADDRESS', 'WEBHOOK_HOST_UNRESOLVED'],
    handler: async ({ principal, body }) => ({ data: await service.create(principal, body) }),
  });

  route({
    method: 'patch',
    path: '/core/integrations/targets/:id',
    tags: ['core'],
    summary: 'Sửa / tạm dừng nơi nhận',
    access: manage,
    request: {
      params: IdParams,
      body: z
        .object({
          name: fields.name.optional(),
          url: z.url().max(500).optional(),
          chatId: z.string().trim().max(30).optional(),
          events: fields.events.optional(),
          branchIds: fields.branchIds.optional(),
          isActive: z.boolean().optional(),
        })
        .strict(),
    },
    responses: { 204: { description: 'Đã lưu' } },
    errorCodes: ['WEBHOOK_PRIVATE_ADDRESS'],
    async handler({ params, body }) {
      await service.update(params.id, body);
    },
  });

  route({
    method: 'delete',
    path: '/core/integrations/targets/:id',
    tags: ['core'],
    summary: 'Xoá nơi nhận (kèm nhật ký gửi)',
    access: manage,
    request: { params: IdParams },
    responses: { 204: { description: 'Đã xoá' } },
    async handler({ params }) {
      await service.remove(params.id);
    },
  });

  route({
    method: 'post',
    path: '/core/integrations/targets/:id/test',
    tags: ['core'],
    summary: 'Gửi thử',
    description: 'Webhook nhận sự kiện `core.integration.test`; Telegram nhận tin “đã kết nối”.',
    access: manage,
    request: { params: IdParams },
    responses: { 200: { description: 'Kết quả', schema: TestResultSchema } },
    handler: async ({ params }) => ({ data: await service.test(params.id) }),
  });

  route({
    method: 'get',
    path: '/core/integrations/deliveries',
    tags: ['core'],
    summary: 'Nhật ký gửi',
    access: manage,
    request: {
      query: PaginationQuery.omit({ sort: true }).extend({
        targetId: z.string().length(26).optional(),
        status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']).optional(),
      }),
    },
    responses: { 200: { description: 'Lần gửi, mới nhất trước', schema: list(DeliverySchema) } },
    handler: ({ query }) => service.deliveries(query),
  });

  route({
    method: 'post',
    path: '/core/integrations/deliveries/:id/retry',
    tags: ['core'],
    summary: 'Gửi lại ngay',
    access: manage,
    request: { params: IdParams },
    responses: { 200: { description: 'Kết quả', schema: TestResultSchema } },
    handler: async ({ params }) => ({ data: await service.retry(params.id) }),
  });
}
