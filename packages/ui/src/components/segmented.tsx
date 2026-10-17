import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Số đếm hiển thị cạnh nhãn. */
  count?: number;
}

/** Nhóm nút lọc một lựa chọn (trạng thái, khoảng thời gian…), cuộn ngang trên điện thoại. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('flex gap-1 overflow-x-auto rounded-lg bg-muted p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'bg-surface text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-navy-900 text-white' : 'bg-navy-100 text-navy-700')}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
