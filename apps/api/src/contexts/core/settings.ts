import { z } from 'zod';
import { defineSetting } from './contract/index.js';

export const MAX_SHIFT_HOURS = defineSetting({
  key: 'core.timekeeping.max_shift_hours',
  app: 'core',
  label: 'Số giờ tối đa một lần chấm công',
  description: 'Yêu cầu sửa công dài hơn mức này bị từ chối (tránh nhập nhầm ngày).',
  schema: z.number().int().min(1).max(24),
  defaultValue: 16,
  branchOverride: false,
  input: { kind: 'number', unit: 'giờ', min: 1, max: 24 },
});

export const coreSettings = [MAX_SHIFT_HOURS];
