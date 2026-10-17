import { describe, expect, it } from 'vitest';
import { formatTelegram } from '../src/contexts/core/modules/integrations/telegram.js';
import type { EventEnvelope } from '../src/platform/events/types.js';

const envelope = (type: string, data: unknown): EventEnvelope => ({
  id: '01TEST',
  type,
  version: 1,
  occurredAt: '2026-10-17T10:00:00.000+07:00',
  source: 'lms',
  aggregateId: 'X',
  branchId: 'B',
  actorId: null,
  data,
});
const ctx = { branchName: 'Zero1 <Cầu Giấy>', userName: (id: string | null | undefined) => (id === 'T1' ? 'Cô Lan' : null) };

describe('tin nhắn Telegram', () => {
  it('chốt điểm danh: tỉ lệ có mặt, người vắng, giờ VN, escape HTML', () => {
    const text = formatTelegram(
      envelope('lms.session.finalized', {
        sessionId: 'S',
        classId: 'C',
        classCode: 'ROB1-A',
        className: 'Robotics',
        indexNo: 3,
        sessionStartsAt: '2026-10-17T11:00:00.000Z',
        teacherId: 'T1',
        counts: { PRESENT: 8, LATE: 1, ABSENT: 1, EXCUSED: 1 },
        absent: [
          { learnerId: 'L1', fullName: 'Nguyễn An', status: 'ABSENT' },
          { learnerId: 'L2', fullName: 'Lê Bình', status: 'EXCUSED' },
        ],
      }),
      ctx,
    )!;
    expect(text).toContain('Zero1 &lt;Cầu Giấy&gt;');
    expect(text).toContain('ROB1-A · buổi 3</b> (18:00 17/10)');
    expect(text).toContain('Có mặt 9/11 (1 muộn) · GV Cô Lan');
    expect(text).toContain('Vắng: Nguyễn An, Lê Bình (phép)');
  });

  it('thu tiền: số tiền định dạng VN, hình thức', () => {
    const text = formatTelegram(
      envelope('crm.payment.confirmed', { paymentId: 'P', enrollmentId: 'E', enrollmentCode: 'DK26-00001', studentId: 'S', studentName: 'Trần An', studentCode: 'HV26-00001', amount: 3_000_000, method: 'TRANSFER' }),
      ctx,
    )!;
    expect(text).toContain('Đã thu 3.000.000đ</b> · chuyển khoản');
    expect(text).toContain('Trần An (HV26-00001) · DK26-00001');
  });

  it('lead import hàng loạt và sự kiện không có mẫu → không gửi', () => {
    expect(formatTelegram(envelope('crm.lead.created', { via: 'IMPORT' }), ctx)).toBeNull();
    expect(formatTelegram(envelope('crm.student.updated', {}), ctx)).toBeNull();
  });
});
