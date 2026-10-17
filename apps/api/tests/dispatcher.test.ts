import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { createDispatcher } from '../src/platform/events/dispatcher.js';
import type { EventEnvelope, OutboxSource } from '../src/platform/events/types.js';

function makeEvent(id: string, type: string): EventEnvelope {
  return {
    id,
    type,
    version: 1,
    occurredAt: '2026-10-07T18:30:00.000+07:00',
    source: 'crm',
    aggregateId: id,
    branchId: null,
    actorId: null,
    data: {},
  };
}

/** Outbox giả trong bộ nhớ, mô phỏng đúng hành vi của bản Drizzle. */
function memorySource(events: EventEnvelope[]): OutboxSource & { published: string[]; failures: Map<string, number> } {
  const published: string[] = [];
  const failures = new Map<string, number>();
  return {
    name: 'crm',
    published,
    failures,
    async fetchPending(limit) {
      return events.filter((e) => !published.includes(e.id) && (failures.get(e.id) ?? 0) < 10).slice(0, limit);
    },
    async markPublished(id) {
      published.push(id);
    },
    async markFailed(id) {
      failures.set(id, (failures.get(id) ?? 0) + 1);
    },
  };
}

const logger = pino({ level: 'silent' });

describe('dispatcher', () => {
  it('chuyển sự kiện đúng loại tới handler và đánh dấu đã phát', async () => {
    const source = memorySource([makeEvent('e1', 'crm.enrollment.activated'), makeEvent('e2', 'crm.lead.converted')]);
    const dispatcher = createDispatcher({ sources: [source], logger });
    const seen: string[] = [];
    dispatcher.subscribe({ name: 'lms.onActivated', type: 'crm.enrollment.activated', handle: async (e) => void seen.push(e.id) });

    await dispatcher.drain();

    expect(seen).toEqual(['e1']);
    expect(source.published).toEqual(['e1', 'e2']); // sự kiện không ai nghe vẫn được đánh dấu
  });

  it('handler "*" nhận mọi sự kiện (dùng cho webhooks)', async () => {
    const source = memorySource([makeEvent('e1', 'a'), makeEvent('e2', 'b')]);
    const dispatcher = createDispatcher({ sources: [source], logger });
    const seen: string[] = [];
    dispatcher.subscribe({ name: 'webhooks', type: '*', handle: async (e) => void seen.push(e.type) });

    await dispatcher.drain();

    expect(seen).toEqual(['a', 'b']);
  });

  it('handler lỗi → giữ lại để thử lại, không chặn sự kiện khác', async () => {
    const source = memorySource([makeEvent('bad', 'x'), makeEvent('good', 'y')]);
    const dispatcher = createDispatcher({ sources: [source], logger });
    let attempts = 0;
    dispatcher.subscribe({
      name: 'flaky',
      type: 'x',
      handle: async () => {
        attempts++;
        if (attempts < 3) throw new Error('tạm lỗi');
      },
    });

    await dispatcher.tick();
    expect(source.published).toEqual(['good']);
    expect(source.failures.get('bad')).toBe(1);

    await dispatcher.drain();
    expect(source.published).toContain('bad');
    expect(attempts).toBe(3);
  });

  it('không cho đăng ký trùng tên handler', () => {
    const dispatcher = createDispatcher({ sources: [], logger });
    dispatcher.subscribe({ name: 'h', type: 'a', handle: async () => {} });
    expect(() => dispatcher.subscribe({ name: 'h', type: 'b', handle: async () => {} })).toThrow(/trùng/);
  });
});
