import { z } from 'zod';
import { defineSetting } from '../core/contract/index.js';

const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const;

export const CONSUMING_STATUSES = defineSetting({
  key: 'lms.attendance.consuming_statuses',
  app: 'lms',
  label: 'Trạng thái điểm danh bị trừ buổi',
  description: 'Học viên có trạng thái này trong buổi học sẽ bị trừ một buổi bên CRM.',
  schema: z.array(z.enum(ATTENDANCE_STATUSES)).min(1),
  defaultValue: ['PRESENT', 'LATE', 'ABSENT'],
  branchOverride: false,
  input: {
    kind: 'multiselect',
    options: [
      { value: 'PRESENT', label: 'Có mặt' },
      { value: 'LATE', label: 'Đi muộn' },
      { value: 'ABSENT', label: 'Vắng không phép' },
      { value: 'EXCUSED', label: 'Vắng có phép' },
    ],
  },
});

export const ABSENCE_ALERT_THRESHOLD = defineSetting({
  key: 'lms.attendance.absence_alert_threshold',
  app: 'lms',
  label: 'Cảnh báo khi vắng liên tiếp',
  description: 'Học viên vắng liên tiếp từ số buổi này trở lên sẽ hiện trong cảnh báo.',
  schema: z.number().int().min(1).max(20),
  defaultValue: 2,
  branchOverride: true,
  input: { kind: 'number', unit: 'buổi', min: 1, max: 20 },
});

export const lmsSettings = [CONSUMING_STATUSES, ABSENCE_ALERT_THRESHOLD];
