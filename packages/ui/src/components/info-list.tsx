import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Danh sách nhãn — giá trị trong thẻ thông tin. */
export function InfoList({ items, className }: { items: Array<{ label: string; value: ReactNode; hidden?: boolean }>; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{i.label}</dt>
            <dd className="mt-0.5 break-words">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}
