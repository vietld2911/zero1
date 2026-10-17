const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
const money = new Intl.NumberFormat('vi-VN');

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
export const formatTime = (iso: string | null | undefined) => (iso ? time.format(new Date(iso)) : '—');

/** YYYY-MM-DD → "T2, 07/10" */
export const formatWorkDate = (date: string) => weekday.format(new Date(`${date}T00:00:00Z`));

/** YYYY-MM-DD → 07/10/2026 */
export function formatDate(date: string | null | undefined) {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** 545 → "9 giờ 05 phút" */
export function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null) return '—';
  minutes = Math.max(0, minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} phút`;
  return `${h} giờ${m ? ` ${String(m).padStart(2, '0')} phút` : ''}`;
}

export const formatMoney = (vnd: number) => `${money.format(vnd)} đ`;

/** Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
export function todayVN(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Ngày đầu tháng hiện tại theo giờ Việt Nam. */
export function monthStartVN() {
  return `${todayVN().slice(0, 7)}-01`;
}

/** ISO → giá trị cho <input type="datetime-local"> theo giờ Việt Nam. */
export function toVnInput(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 16);
}

/** Giá trị <input type="datetime-local"> (giờ Việt Nam) → ISO có múi giờ. */
export function fromVnInput(local: string) {
  return local ? `${local.length === 16 ? `${local}:00` : local}+07:00` : '';
}

/** ISO → YYYY-MM-DD theo giờ Việt Nam. */
export const vnDay = (iso: string) => toVnInput(iso).slice(0, 10);

/** Cộng ngày cho YYYY-MM-DD. */
export function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Thứ Hai của tuần chứa `date` (YYYY-MM-DD). */
export function weekStart(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = CN
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

const weekdayLong = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', weekday: 'long' });
/** YYYY-MM-DD → "Thứ Hai" */
export const formatWeekday = (date: string) => weekdayLong.format(new Date(`${date}T00:00:00Z`));

/** "1 = Thứ 2 … 7 = Chủ nhật" của lịch tuần. */
export const WEEKDAY_SHORT = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;

/** Thời điểm tương đối ngắn gọn: "3 ngày trước", "2 giờ nữa". */
export function formatRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const unit = abs < 3_600_000 ? [Math.round(abs / 60_000), 'phút'] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), 'giờ'] : [Math.round(abs / 86_400_000), 'ngày'];
  if (unit[0] === 0) return 'vừa xong';
  return diff < 0 ? `${unit[0]} ${unit[1]} trước` : `${unit[0]} ${unit[1]} nữa`;
}

/** Kích thước file dễ đọc. */
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/** Tiền gọn cho trục / ô số: 950 n · 12,5 tr · 1,2 tỷ. */
export function formatMoneyShort(vnd: number) {
  const abs = Math.abs(vnd);
  const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: Math.abs(n) < 100 ? 1 : 0 });
  if (abs >= 1e9) return `${fmt(vnd / 1e9)} tỷ`;
  if (abs >= 1e6) return `${fmt(vnd / 1e6)} tr`;
  if (abs >= 1e3) return `${fmt(vnd / 1e3)} n`;
  return String(vnd);
}

/** % thay đổi so với kỳ trước (null khi kỳ trước = 0). */
export function percentChange(current: number, previous: number) {
  return previous ? Math.round(((current - previous) / previous) * 100) : null;
}
