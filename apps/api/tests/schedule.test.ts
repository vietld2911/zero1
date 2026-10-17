import { describe, expect, it } from 'vitest';
import { isoWeekday, planSessions, vnDateTime, vnDayOf } from '../src/contexts/lms/schedule.js';

describe('lịch học', () => {
  it('giờ Việt Nam → UTC', () => {
    expect(vnDateTime('2026-10-12', '18:00').toISOString()).toBe('2026-10-12T11:00:00.000Z');
    expect(vnDateTime('2026-10-12', '06:30').toISOString()).toBe('2026-10-11T23:30:00.000Z');
    expect(vnDayOf(new Date('2026-10-11T23:30:00.000Z'))).toBe('2026-10-12');
  });

  it('thứ trong tuần: 1 = Thứ 2, 7 = Chủ nhật', () => {
    expect(isoWeekday('2026-10-12')).toBe(1);
    expect(isoWeekday('2026-10-18')).toBe(7);
  });

  it('sinh buổi theo lịch Thứ 3 + Thứ 5, bắt đầu giữa tuần', () => {
    const plan = planSessions(
      [
        { weekday: 4, startTime: '18:00', minutes: 90 },
        { weekday: 2, startTime: '18:00', minutes: 90 },
      ],
      '2026-10-14', // Thứ 4
      4,
    );
    expect(plan.map((p) => vnDayOf(p.startsAt))).toEqual(['2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27']);
    expect(plan[0]!.endsAt.getTime() - plan[0]!.startsAt.getTime()).toBe(90 * 60_000);
  });

  it('lịch rỗng không sinh buổi', () => {
    expect(planSessions([], '2026-10-12', 5)).toEqual([]);
  });
});
