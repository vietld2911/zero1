/** Lệch múi giờ Việt Nam so với UTC (không có giờ mùa hè). */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * DB lưu UTC; API trả về ISO 8601 theo +07:00 (docs/api-conventions.md §2).
 * Ví dụ: 2026-10-07T11:30:00.000Z → 2026-10-07T18:30:00.000+07:00
 */
export function toApiInstant(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().replace('Z', '+07:00');
}

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam của một thời điểm. */
export function vnDate(date: Date = new Date()): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Số ngày giữa hai ngày YYYY-MM-DD (to − from). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 00:00 giờ Việt Nam của ngày YYYY-MM-DD, dạng thời điểm UTC (để so với cột DATETIME). */
export function vnDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - VN_OFFSET_MS);
}

/** Cộng / trừ ngày cho YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Ngày đầu và ngày cuối của tháng YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
