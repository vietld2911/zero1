import { z } from '../openapi/zod.js';
import { item } from './schemas.js';
import type { createRouteRegistrar } from './route.js';

export type HealthChecks = Record<string, () => Promise<void>>;

const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z.record(z.string(), z.enum(['up', 'down'])),
    version: z.string(),
  })
  .openapi('Health');

const TIMEOUT_MS = 2000;

export function registerHealthRoute(route: ReturnType<typeof createRouteRegistrar>, checks: HealthChecks, version: string) {
  route({
    method: 'get',
    path: '/health',
    tags: ['system'],
    summary: 'Tình trạng hệ thống',
    description: 'Kiểm tra kết nối tới từng database. Trả 503 nếu có thành phần không hoạt động.',
    access: { public: true },
    responses: {
      200: { description: 'Mọi thành phần hoạt động', schema: item(HealthSchema) },
      503: { description: 'Có thành phần không hoạt động', schema: item(HealthSchema) },
    },
    async handler({ res }) {
      const entries = await Promise.all(
        Object.entries(checks).map(async ([name, check]) => [name, (await withTimeout(check())) ? 'up' : 'down'] as const),
      );
      const result = Object.fromEntries(entries);
      const healthy = entries.every(([, s]) => s === 'up');
      res.status(healthy ? 200 : 503).json({ data: { status: healthy ? 'ok' : 'degraded', checks: result, version } });
    },
  });
}

async function withTimeout(p: Promise<void>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([p, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)))]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
