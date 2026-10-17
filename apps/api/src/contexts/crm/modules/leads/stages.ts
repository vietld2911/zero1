import type { LEAD_STATUS_SOURCES, LEAD_STATUSES } from '../../db/schema.js';
import { LEAD_STATUSES as ALL } from '../../db/schema.js';

/** Phễu tuyển sinh S1–S5 (docs/roadmap.md GĐ7, thiết kế: docs/gd7-lead-stages.md). */
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadStatusSource = (typeof LEAD_STATUS_SOURCES)[number];
export type LeadStage = 1 | 2 | 3 | 4 | 5;

/** Bước của trạng thái: số sau chữ S. */
export function stageOf(status: LeadStatus): LeadStage {
  return Number(status[1]) as LeadStage;
}

/** Lead đã dừng (mở lại được). S3C không phải dừng — khách không đến, cần hẹn lại. */
export const STOPPED_STATUSES: LeadStatus[] = ['S1C', 'S2C', 'S4C'];
export const isStopped = (s: LeadStatus) => STOPPED_STATUSES.includes(s);

/** Lead còn "mở" — đang được chăm sóc: chưa dừng, chưa đăng ký. */
export const OPEN_STATUSES: LeadStatus[] = ALL.filter((s) => !isStopped(s) && stageOf(s) < 5);
export const isOpen = (s: LeadStatus) => OPEN_STATUSES.includes(s);

/**
 * Trạng thái người dùng được chọn (ghi cuộc gọi / đổi trạng thái / mở lại).
 * Lên S3 / S4A / S5 chỉ qua nghiệp vụ thật (đặt lịch, điểm danh, tạo đăng ký).
 */
export const MANUAL_STATUSES: LeadStatus[] = ['S1B', 'S1C', 'S2A', 'S2B', 'S2C', 'S4B', 'S4C'];
/** Chỉ chọn được khi lead đã từng đạt S4. */
export const NEEDS_S4: LeadStatus[] = ['S4B', 'S4C'];

/** Cột "lần đầu đạt bước" của bảng leads. */
export const REACHED_COLUMNS = { 2: 'reachedS2At', 3: 'reachedS3At', 4: 'reachedS4At', 5: 'reachedS5At' } as const;
