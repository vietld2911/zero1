import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { Spinner } from './feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Ví dụ `hidden md:table-cell` để ẩn cột phụ trên điện thoại. */
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  pagination?: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void };
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T>({ columns, rows, rowKey, loading, empty, onRowClick, pagination }: DataTableProps<T>) {
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      {/* relative: phần tử absolute (nhãn sr-only…) trong bảng không thoát khỏi khung cuộn làm trang rộng ra trên điện thoại */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/60 text-xs text-muted-foreground uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-2.5 font-medium tracking-wide', alignClass[c.align ?? 'left'], c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && !rows?.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center">
                  <Spinner label="Đang tải…" />
                </td>
              </tr>
            ) : !rows?.length ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  {empty ?? 'Không có dữ liệu'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-muted/50', loading && 'opacity-60')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 align-middle', alignClass[c.align ?? 'left'], c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted-foreground">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} /{' '}
            {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Trang trước"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="px-2 tabular-nums">
              {pagination.page}/{pages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Trang sau"
              disabled={pagination.page >= pages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
