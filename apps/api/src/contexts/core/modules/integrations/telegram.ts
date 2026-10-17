import type { EventEnvelope } from '../../../../platform/events/types.js';
import { toApiInstant } from '../../../../platform/time.js';
import { CRM_EVENTS, type EnrollmentActivatedV1, type LeadCreatedV1, type PaymentConfirmedV1 } from '../../../../contracts/events/crm.js';
import { LMS_EVENTS, type SessionFinalizedV1, type TrialCheckedV1 } from '../../../../contracts/events/lms.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number) => `${n.toLocaleString('vi-VN')}đ`;
/** 0912345678 → 0912 *** 678 (nhóm chat nội bộ vẫn không nên lộ đủ số). */
const maskPhone = (p: string) => (p.length >= 10 ? `${p.slice(0, 4)} *** ${p.slice(-3)}` : p);
const time = (iso: string) => {
  const local = toApiInstant(new Date(iso));
  return `${local.slice(11, 16)} ${local.slice(8, 10)}/${local.slice(5, 7)}`;
};

const SOURCES: Record<string, string> = {
  FACEBOOK: 'Facebook',
  ZALO: 'Zalo',
  WEBSITE: 'Website',
  HOTLINE: 'Hotline',
  REFERRAL: 'Giới thiệu',
  WALK_IN: 'Đến trực tiếp',
  EVENT: 'Sự kiện',
  OTHER: 'Khác',
};
const METHODS: Record<string, string> = { CASH: 'tiền mặt', TRANSFER: 'chuyển khoản', CARD: 'quẹt thẻ' };

export interface TelegramContext {
  branchName: string | null;
  userName: (id: string | null | undefined) => string | null;
}

/**
 * Tin nhắn Telegram (HTML) cho một sự kiện; null = không gửi
 * (ví dụ lead import Excel hàng loạt — tránh làm ngập nhóm).
 */
export function formatTelegram(event: EventEnvelope, ctx: TelegramContext): string | null {
  const head = ctx.branchName ? `<i>${esc(ctx.branchName)}</i>\n` : '';
  switch (event.type) {
    case CRM_EVENTS.leadCreated: {
      const d = event.data as LeadCreatedV1;
      if (d.via === 'IMPORT') return null;
      const owner = ctx.userName(d.ownerId);
      return (
        `${head}🆕 <b>Khách hàng mới</b>${d.via === 'API' ? ' (từ website / tích hợp)' : ''}\n` +
        `${esc(d.childName)} · PH ${esc(d.parentName)} ${maskPhone(d.parentPhone)}\n` +
        `Nguồn: ${SOURCES[d.source] ?? esc(d.source)}${owner ? ` · Phụ trách: ${esc(owner)}` : ' · <b>Chưa phân công</b>'}`
      );
    }
    case CRM_EVENTS.enrollmentActivated: {
      const d = event.data as EnrollmentActivatedV1;
      return `${head}🎓 <b>${d.type === 'RENEWAL' ? 'Tái phí' : 'Học viên mới'}</b>: ${esc(d.student.fullName)} (${d.studentCode}) · ${d.sessionsPurchased} buổi\nĐăng ký ${d.enrollmentCode} — chờ xếp lớp bên LMS`;
    }
    case CRM_EVENTS.paymentConfirmed: {
      const d = event.data as PaymentConfirmedV1;
      const who = d.studentName ? `${esc(d.studentName)}${d.studentCode ? ` (${d.studentCode})` : ''}` : 'Học viên';
      return `${head}💰 <b>Đã thu ${money(d.amount)}</b> · ${METHODS[d.method] ?? d.method}\n${who}${d.enrollmentCode ? ` · ${d.enrollmentCode}` : ''}`;
    }
    case LMS_EVENTS.sessionFinalized: {
      const d = event.data as SessionFinalizedV1;
      const c = d.counts;
      const total = c.PRESENT + c.LATE + c.ABSENT + c.EXCUSED;
      const absent = d.absent.map((a) => `${esc(a.fullName)}${a.status === 'EXCUSED' ? ' (phép)' : ''}`);
      const teacher = ctx.userName(d.teacherId);
      return (
        `${head}📋 <b>Điểm danh ${esc(d.classCode)} · buổi ${d.indexNo}</b> (${time(d.sessionStartsAt)})\n` +
        `Có mặt ${c.PRESENT + c.LATE}/${total}${c.LATE ? ` (${c.LATE} muộn)` : ''}${teacher ? ` · GV ${esc(teacher)}` : ''}` +
        (absent.length ? `\nVắng: ${absent.join(', ')}` : '')
      );
    }
    case LMS_EVENTS.trialChecked: {
      const d = event.data as TrialCheckedV1;
      const result = d.result === 'ATTENDED' ? '✅ đã đến' : '❌ không đến';
      return `${head}👋 <b>Học thử</b>: ${esc(d.childName ?? 'khách')} — ${result}${d.note ? `\n${esc(d.note)}` : ''}`;
    }
    default:
      return null;
  }
}
