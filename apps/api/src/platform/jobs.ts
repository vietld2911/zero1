import type { Logger } from './logger.js';

/**
 * Việc định kỳ chạy trong chính process API (nhắc việc, dọn dữ liệu).
 * Mỗi job phải chạy lại an toàn: chạy trùng hay chạy bù không gây sai dữ liệu.
 */
export interface Job {
  name: string;
  everyMinutes: number;
  run(now: Date): Promise<unknown>;
}

export function createScheduler({ jobs, logger, tickMs = 60_000 }: { jobs: Job[]; logger: Logger; tickMs?: number }) {
  const lastRun = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(now = new Date(), force = false) {
    if (running) return;
    running = true;
    try {
      for (const job of jobs) {
        const last = lastRun.get(job.name);
        if (!force && last !== undefined && now.getTime() - last < job.everyMinutes * 60_000) continue;
        lastRun.set(job.name, now.getTime());
        try {
          await job.run(now);
        } catch (err) {
          logger.warn({ err, job: job.name }, 'Việc định kỳ lỗi — sẽ chạy lại ở lượt sau');
          lastRun.delete(job.name);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      // Lượt đầu sau một phút để server khởi động xong.
      timer = setInterval(() => void tick(), tickMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Chạy mọi job ngay (test, script). */
    runAll: (now = new Date()) => tick(now, true),
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
