import { z } from 'zod';
import { defineSetting } from '../core/contract/index.js';

export const CM_APPROVAL_LIMIT = defineSetting({
  key: 'crm.approval.cm_limit',
  app: 'crm',
  label: 'Hạn mức CM được duyệt giảm giá',
  description: 'Học bổng / giảm thêm vượt mức này phải chuyển AM duyệt.',
  schema: z.number().int().min(0),
  defaultValue: 2_000_000,
  branchOverride: true,
  input: { kind: 'number', unit: 'đ', min: 0, step: 100_000 },
});

export const RENEWAL_REMAINING_THRESHOLD = defineSetting({
  key: 'crm.renewal.remaining_threshold',
  app: 'crm',
  label: 'Nhắc tái phí khi còn',
  description: 'Học viên còn số buổi ≤ mức này sẽ vào danh sách cần tái phí.',
  schema: z.number().int().min(0).max(50),
  defaultValue: 4,
  branchOverride: true,
  input: { kind: 'number', unit: 'buổi', min: 0, max: 50 },
});

export const SCHOLARSHIP_SESSIONS_PER_MONTH = defineSetting({
  key: 'crm.scholarship.sessions_per_month',
  app: 'crm',
  label: 'Số buổi cho mỗi tháng học bổng',
  description: 'Học bổng được tặng theo tháng; số buổi học bổng = số tháng × giá trị này.',
  schema: z.number().int().min(1).max(31),
  defaultValue: 4,
  branchOverride: false,
  input: { kind: 'number', unit: 'buổi', min: 1, max: 31 },
});

export const crmSettings = [CM_APPROVAL_LIMIT, RENEWAL_REMAINING_THRESHOLD, SCHOLARSHIP_SESSIONS_PER_MONTH];
