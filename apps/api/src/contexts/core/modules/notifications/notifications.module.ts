import { and, count, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Logger } from '../../../../platform/logger.js';
import { newId } from '../../../../platform/ids.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { RouteRegistrar } from '../../../../platform/http/route.js';
import { item, list, PaginationQuery } from '../../../../platform/http/schemas.js';
import { pageMeta, pageOffset } from '../../../../platform/http/list.js';
import { z } from '../../../../platform/openapi/zod.js';
import type { CoreDb } from '../../db/types.js';
import { notifications, userBranches, users } from '../../db/schema.js';
import type { NotificationInput, NotificationSender } from '../../contract/index.js';

/** Giữ thông báo 90 ngày. */
const RETENTION_DAYS = 90;

export function createNotificationsService(db: CoreDb, logger: Logger) {
  async function insert(items: NotificationInput[]) {
    const rows = items
      .filter((i) => i.userId)
      .map((i) => ({
        id: newId(),
        userId: i.userId,
        type: i.type,
        app: i.app,
        title: i.title.slice(0, 200),
        body: i.body ? i.body.slice(0, 500) : null,
        link: i.link ?? null,
        dedupeKey: i.dedupeKey ?? null,
      }));
    if (!rows.length) return;
    // Trùng (userId, dedupeKey) → bỏ qua dòng đó.
    await db.insert(notifications).values(rows).onDuplicateKeyUpdate({ set: { id: sql`id` } });
  }

  const sender: NotificationSender = {
    async send(items) {
      try {
        await insert(items);
      } catch (err) {
        logger.error({ err }, 'Không ghi được thông báo');
      }
    },
    async sendToRoles(target, notification) {
      try {
        const rows = await db
          .select({ id: users.id })
          .from(users)
          .innerJoin(userBranches, eq(userBranches.userId, users.id))
          .where(
            and(
              eq(userBranches.branchId, target.branchId),
              eq(users.status, 'ACTIVE'),
              inArray(users.role, target.roles),
              target.exceptUserId ? ne(users.id, target.exceptUserId) : undefined,
            ),
          );
        await insert([...new Set(rows.map((r) => r.id))].map((userId) => ({ ...notification, userId })));
      } catch (err) {
        logger.error({ err }, 'Không ghi được thông báo');
      }
    },
  };

  return {
    sender,

    async list(actor: Principal, q: { page: number; pageSize: number; unreadOnly?: boolean; app?: 'core' | 'crm' | 'lms' }) {
      const where = and(eq(notifications.userId, actor.userId), q.unreadOnly ? isNull(notifications.readAt) : undefined, q.app ? eq(notifications.app, q.app) : undefined);
      const { limit, offset } = pageOffset(q.page, q.pageSize);
      const [rows, [total]] = await Promise.all([
        db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit).offset(offset),
        db.select({ n: count() }).from(notifications).where(where),
      ]);
      return {
        data: rows.map((r) => ({
          id: r.id,
          type: r.type,
          app: r.app,
          title: r.title,
          body: r.body,
          link: r.link,
          read: !!r.readAt,
          createdAt: r.createdAt.toISOString(),
        })),
        meta: pageMeta(q.page, q.pageSize, total?.n ?? 0),
      };
    },

    async unreadCount(actor: Principal) {
      const [row] = await db
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
      return row?.n ?? 0;
    },

    async markRead(actor: Principal, ids: string[] | 'all') {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt), ids === 'all' ? undefined : inArray(notifications.id, ids.length ? ids : [''])));
    },

    /** Xoá thông báo quá hạn lưu (chạy định kỳ). */
    async purge(now = new Date()) {
      await db.delete(notifications).where(lt(notifications.createdAt, new Date(now.getTime() - RETENTION_DAYS * 86_400_000)));
    },
  };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;

const NotificationSchema = z
  .object({
    id: z.string(),
    type: z.string().openapi({ example: 'crm.lead.assigned' }),
    app: z.enum(['core', 'crm', 'lms']),
    title: z.string(),
    body: z.string().nullable(),
    link: z.string().nullable().openapi({ description: 'Đường dẫn trong app `app`' }),
    read: z.boolean(),
    createdAt: z.string(),
  })
  .openapi('Notification');

export function registerNotificationRoutes(route: RouteRegistrar, service: NotificationsService) {
  route({
    method: 'get',
    path: '/core/notifications',
    tags: ['core'],
    summary: 'Thông báo của tôi',
    access: { authenticated: true },
    request: {
      query: PaginationQuery.omit({ sort: true }).extend({
        unreadOnly: z.stringbool().optional().openapi({ type: 'boolean' }),
        app: z.enum(['core', 'crm', 'lms']).optional(),
      }),
    },
    responses: { 200: { description: 'Thông báo, mới nhất trước', schema: list(NotificationSchema) } },
    handler: ({ principal, query }) => service.list(principal, query),
  });

  route({
    method: 'get',
    path: '/core/notifications/unread-count',
    tags: ['core'],
    summary: 'Số thông báo chưa đọc',
    access: { authenticated: true },
    responses: { 200: { description: 'Số chưa đọc', schema: item(z.object({ count: z.number().int() })) } },
    handler: async ({ principal }) => ({ data: { count: await service.unreadCount(principal) } }),
  });

  route({
    method: 'post',
    path: '/core/notifications/read',
    tags: ['core'],
    summary: 'Đánh dấu đã đọc',
    description: 'Gửi `ids` để đánh dấu một số thông báo, hoặc `all: true` để đánh dấu tất cả.',
    access: { authenticated: true },
    request: { body: z.object({ ids: z.array(z.string().length(26)).max(200).optional(), all: z.boolean().optional() }) },
    responses: { 204: { description: 'Đã đánh dấu' } },
    async handler({ principal, body }) {
      await service.markRead(principal, body.all ? 'all' : (body.ids ?? []));
    },
  });
}
