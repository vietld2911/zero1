import type { Logger } from '../logger.js';
import { dbUnavailableCode } from '../db/connection.js';
import type { EventEnvelope, OutboxSource, Subscription } from './types.js';

export interface DispatcherOptions {
  sources: OutboxSource[];
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
}

/**
 * Đọc outbox của từng database và chuyển sự kiện tới các handler đã đăng ký.
 * Giao ít nhất một lần: handler phải idempotent (dùng `runOnce`).
 * Chạy trong 1 process (docs/architecture.md §2), nên không cần khóa phân tán.
 */
export function createDispatcher({ sources, logger, intervalMs = 1000, batchSize = 50 }: DispatcherOptions) {
  const subscriptions: Subscription[] = [];
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;
  let stopped = true;

  function subscribe(sub: Subscription) {
    if (subscriptions.some((s) => s.name === sub.name)) {
      throw new Error(`Handler sự kiện bị đăng ký trùng tên: ${sub.name}`);
    }
    subscriptions.push(sub);
  }

  async function deliver(event: EventEnvelope) {
    const targets = subscriptions.filter((s) => s.type === event.type || s.type === '*');
    for (const sub of targets) {
      await sub.handle(event);
    }
  }

  /** Xử lý một lượt; trả về số sự kiện đã xử lý (thành công hoặc lỗi). */
  async function tick(): Promise<number> {
    let handled = 0;
    for (const source of sources) {
      const events = await source.fetchPending(batchSize);
      for (const event of events) {
        handled++;
        try {
          await deliver(event);
          await source.markPublished(event.id);
        } catch (err) {
          const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
          logger.error({ err, eventId: event.id, type: event.type, source: source.name }, 'Event delivery failed');
          await source.markFailed(event.id, message);
        }
      }
    }
    return handled;
  }

  let lastUnavailableLog = 0;
  function runTick() {
    running = tick().catch((err) => {
      // Mất kết nối DB: báo ngắn gọn, tối đa mỗi phút một lần, thay vì in stack trace mỗi giây.
      const code = dbUnavailableCode(err);
      if (code) {
        if (Date.now() - lastUnavailableLog > 60_000) {
          lastUnavailableLog = Date.now();
          logger.warn(`Bộ gửi sự kiện tạm dừng: mất kết nối database (${code}). Sẽ tự chạy lại khi database sẵn sàng.`);
        }
      } else {
        logger.error({ err }, 'Dispatcher tick failed');
      }
      return 0;
    });
    return running;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      await runTick();
      schedule();
    }, intervalMs);
  }

  return {
    subscribe,
    tick: runTick,
    /** Chạy đến khi không còn sự kiện đến hạn xử lý, tối đa `maxRounds` lượt (dùng trong test). */
    async drain(maxRounds = 20) {
      for (let i = 0; i < maxRounds; i++) {
        if ((await runTick()) === 0) return;
      }
    },
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
