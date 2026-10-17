import type { ScheduleSlot } from './db/schema.js';

const VN_OFFSET_H = 7;

/** Ngày YYYY-MM-DD + giờ HH:MM (giờ Việt Nam) → thời điểm UTC. */
export function vnDateTime(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh - VN_OFFSET_H, mm));
}

/** 1 = Thứ 2 … 7 = Chủ nhật, cho ngày YYYY-MM-DD. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Ngày (giờ VN) của một thời điểm. */
export function vnDayOf(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_H * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Sinh `count` buổi theo lịch tuần, bắt đầu từ ngày `from` (gồm cả ngày đó).
 * Lịch rỗng → không sinh (tránh vòng lặp vô tận).
 */
export function planSessions(schedule: ScheduleSlot[], from: string, count: number): Array<{ startsAt: Date; endsAt: Date }> {
  const out: Array<{ startsAt: Date; endsAt: Date }> = [];
  if (!schedule.length || count <= 0) return out;
  const slots = [...schedule].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  for (let day = from, guard = 0; out.length < count && guard < 1000; day = addDays(day, 1), guard++) {
    for (const slot of slots.filter((s) => s.weekday === isoWeekday(day))) {
      if (out.length >= count) break;
      const startsAt = vnDateTime(day, slot.startTime);
      out.push({ startsAt, endsAt: new Date(startsAt.getTime() + slot.minutes * 60_000) });
    }
  }
  return out;
}
