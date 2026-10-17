import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Button, cn, Popover, Spinner } from '@zero1/ui';
import { useApi } from '../api';
import { APP_URLS, type AppKey } from '../app-meta';
import { formatRelative } from '../lib/format';

type Notification = Schemas['Notification'];

export const notificationKeys = {
  all: ['core', 'notifications'] as const,
  unread: ['core', 'notifications', 'unread'] as const,
  list: ['core', 'notifications', 'list'] as const,
};

/** Chuông thông báo trên thanh trên cùng: số chưa đọc (cập nhật mỗi phút), danh sách 20 thông báo gần nhất. */
export function NotificationBell({ app }: { app: AppKey }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const { data: unread = 0 } = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/notifications/unread-count'))).data.count,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const list = useQuery({
    queryKey: notificationKeys.list,
    enabled: open,
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/notifications', { params: { query: { page: 1, pageSize: 20 } } }))).data,
  });
  const markRead = useMutation({
    mutationFn: async (body: { ids?: string[]; all?: boolean }) => unwrap(api.POST('/api/v1/core/notifications/read', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });

  const openItem = (n: Notification) => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    if (!n.link) return;
    // Thông báo của app kia (ví dụ CS ở CRM nhận "học viên chờ xếp lớp" của LMS) → mở app đó.
    if (n.app === app || n.app === 'core') navigate(n.link);
    else window.location.href = `${APP_URLS[n.app as AppKey]}${n.link}`;
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setNow(Date.now());
          void qc.invalidateQueries({ queryKey: notificationKeys.all });
        }
      }}
      trigger={
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-semibold">Thông báo</span>
        <Button variant="ghost" size="sm" disabled={!unread || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
          <CheckCheck /> Đọc tất cả
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {list.isPending ? (
          <div className="p-4">
            <Spinner label="Đang tải…" />
          </div>
        ) : !list.data?.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Chưa có thông báo.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/60', !n.read && 'bg-cyan-brand-soft/40')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-cyan-brand')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', !n.read && 'font-semibold')}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatRelative(n.createdAt, now)}
                      {n.app !== app && n.app !== 'core' && ` · ${n.app.toUpperCase()}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}
