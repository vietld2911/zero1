import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Mốc trục "đẹp" (1 / 2 / 5 × 10^n) ≥ giá trị lớn nhất. */
function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

export interface ColumnDatum {
  key: string;
  /** Nhãn trục X (ngắn). */
  label: string;
  value: number;
  /** Nội dung tooltip khi rê chuột / focus. */
  tooltip?: ReactNode;
}

/**
 * Biểu đồ cột một chuỗi số liệu (không cần chú giải — tiêu đề nói tên chuỗi).
 * Cột tối đa 24px, bo 4px ở đầu dữ liệu, lưới mảnh; rê chuột / Tab để xem giá trị.
 */
export function ColumnChart({
  data,
  format,
  height = 180,
  highlightKey,
  labelEvery,
  'aria-label': ariaLabel,
}: {
  data: ColumnDatum[];
  format: (v: number) => string;
  height?: number;
  /** Cột nhấn mạnh (ví dụ hôm nay). */
  highlightKey?: string;
  /** Hiện nhãn trục X mỗi n cột (mặc định tự tính). */
  labelEvery?: number;
  'aria-label': string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [top, top / 2, 0];
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 10));
  const current = data.find((d) => d.key === active);

  return (
    <figure className="m-0" aria-label={ariaLabel}>
      <div className="flex gap-2">
        {/* Trục Y */}
        <div className="flex shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* Lưới */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" style={{ height }} aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="h-px bg-border" />
            ))}
          </div>
          <div className="relative flex items-end gap-0.5" style={{ height }} role="list">
            {data.map((d) => {
              const h = (d.value / top) * 100;
              return (
                <button
                  key={d.key}
                  type="button"
                  role="listitem"
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onMouseEnter={() => setActive(d.key)}
                  onMouseLeave={() => setActive((a) => (a === d.key ? null : a))}
                  onFocus={() => setActive(d.key)}
                  onBlur={() => setActive((a) => (a === d.key ? null : a))}
                  className="group flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none"
                >
                  <span
                    className={cn(
                      'block w-full max-w-6 rounded-t-[4px] transition-colors',
                      d.key === highlightKey ? 'bg-cyan-brand' : 'bg-navy-700',
                      active === d.key && 'bg-navy-900',
                      d.value > 0 && 'min-h-[2px]',
                    )}
                    style={{ height: `${h}%` }}
                  />
                </button>
              );
            })}
          </div>
          {current && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
              style={{ left: `${((data.indexOf(current) + 0.5) / data.length) * 100}%` }}
              role="status"
            >
              {current.tooltip ?? (
                <>
                  <span className="text-muted-foreground">{current.label}</span> · <strong className="tabular-nums">{format(current.value)}</strong>
                </>
              )}
            </div>
          )}
          {/* Trục X */}
          <div className="mt-1 flex gap-0.5 text-[11px] text-muted-foreground" aria-hidden>
            {data.map((d, i) => (
              <span key={d.key} className="min-w-0 flex-1 text-center">
                {i % every === 0 ? d.label : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Chữ phụ bên phải (ví dụ "12 chốt · 30%"). */
  detail?: ReactNode;
}

/** Danh sách thanh ngang một chuỗi: nhãn trái, thanh, giá trị ở đầu thanh. Dùng cho phễu, nguồn khách, xếp hạng. */
export function BarList({ items, format, max, className }: { items: BarListItem[]; format: (v: number) => string; max?: number; className?: string }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn('flex flex-col gap-2.5', className)}>
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <span className="truncate text-muted-foreground">{i.label}</span>
          {/* Giá trị nằm ngay đầu thanh; chừa 7rem cho nhãn giá trị */}
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="block h-3 shrink-0 rounded-r-[4px] bg-navy-700"
              style={{ width: `calc((100% - 7rem) * ${i.value > 0 ? Math.max(0.01, i.value / top) : 0})` }}
            />
            <span className="min-w-0 truncate tabular-nums" title={typeof i.detail === 'string' ? i.detail : undefined}>
              <span className="font-medium">{format(i.value)}</span>
              {i.detail && <span className="ml-1.5 text-xs text-muted-foreground">{i.detail}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
