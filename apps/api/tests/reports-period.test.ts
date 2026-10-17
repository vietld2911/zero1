import { describe, expect, it } from 'vitest';
import { previousPeriod } from '../src/contexts/crm/modules/reports/reports.service.js';

describe('kỳ so sánh của báo cáo', () => {
  it('tháng đang chạy dở → cùng số ngày đầu tháng trước', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-09')).toEqual({ from: '2026-09-01', to: '2026-09-09' });
  });
  it('tháng đã qua → cả tháng trước (không vượt cuối tháng)', () => {
    expect(previousPeriod({ from: '2026-09-01', to: '2026-09-30' }, '2026-10-09')).toEqual({ from: '2026-08-01', to: '2026-08-30' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' }, '2026-10-09')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('khoảng tuỳ chọn → khoảng liền trước cùng độ dài', () => {
    expect(previousPeriod({ from: '2026-10-03', to: '2026-10-09' }, '2026-10-09')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
  });
});
