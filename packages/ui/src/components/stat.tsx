import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

interface StatProps {
  label: string;
  value: ReactNode;
  /** Dòng phụ dưới số: so sánh, đơn vị, ghi chú. */
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
  onClick?: () => void;
}

const toneClass = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

/** Ô số liệu: nhãn nhỏ, số lớn thẳng cột. */
export function Stat({ label, value, hint, icon: Icon, tone = 'default', className, onClick }: StatProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 text-left shadow-card',
        onClick && 'transition-colors hover:border-navy-300',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
        {Icon && <Icon className="size-3.5" aria-hidden />}
        {label}
      </span>
      <span className={cn('text-2xl font-semibold tracking-tight tabular-nums', toneClass[tone])}>{value}</span>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Tag>
  );
}

/** Thanh tiến độ 0–100. */
export function Progress({ value, tone = 'brand', className, label }: { value: number; tone?: 'brand' | 'success' | 'warning' | 'danger'; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = { brand: 'bg-cyan-brand', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width]', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
