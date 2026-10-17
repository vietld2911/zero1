import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, KeyRound, LogIn, LogOut, UserRound } from 'lucide-react';
import { unwrap } from '@zero1/api-client';
import { Badge, Button, Dialog, DropdownMenu, Field, Input, Tabs, cn, toast } from '@zero1/ui';
import { useApi } from '../api';
import { useMe, usePermission, useSession } from '../auth/auth-context';
import { ChangePasswordForm } from '../auth/auth-pages';
import { applyFieldErrors, toastError } from '../lib/errors';
import { formatMinutes, formatTime } from '../lib/format';

export const timekeepingKeys = {
  me: ['core', 'timekeeping', 'me'] as const,
  all: ['core', 'timekeeping'] as const,
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts.at(-2)?.[0] ?? '') + (parts.at(-1)?.[0] ?? '')).toUpperCase();
}

export function UserMenu() {
  const me = useMe();
  const session = useSession();
  const [profileOpen, setProfileOpen] = useState(false);
  const primary = me.branches.find((b) => b.isPrimary) ?? me.branches[0];

  return (
    <>
      <DropdownMenu
        trigger={
          <button type="button" className="flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 hover:bg-muted" aria-label="Tài khoản">
            <span className="flex size-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">{initials(me.fullName)}</span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block max-w-40 truncate text-sm font-medium">{me.fullName}</span>
              <span className="block text-xs text-muted-foreground">
                {me.roleName}
                {primary ? ` · ${primary.name}` : ''}
              </span>
            </span>
            <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
          </button>
        }
        header={
          <div>
            <p className="font-medium">{me.fullName}</p>
            <p className="text-xs text-muted-foreground">{me.email}</p>
          </div>
        }
        actions={[
          { label: 'Hồ sơ & mật khẩu', icon: UserRound, onSelect: () => setProfileOpen(true) },
          { label: 'Đăng xuất', icon: LogOut, onSelect: () => void session.logout(), tone: 'danger', separatorBefore: true },
        ]}
      />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
  phone: z
    .string()
    .trim()
    .regex(/^([0-9+ ]{8,20})?$/, 'Số điện thoại không hợp lệ'),
});

function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe();
  const api = useApi();
  const session = useSession();
  const form = useForm({ resolver: zodResolver(profileSchema), values: { fullName: me.fullName, phone: me.phone ?? '' } });

  const save = form.handleSubmit(async (v) => {
    try {
      const res = await unwrap(api.PATCH('/api/v1/core/auth/me', { body: { fullName: v.fullName, phone: v.phone || null } }));
      session.setUser(res.data);
      toast.success('Đã lưu hồ sơ');
    } catch (err) {
      if (!applyFieldErrors(err, form.setError, ['fullName', 'phone'])) toastError(err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Hồ sơ cá nhân" description={me.email}>
      <Tabs
        tabs={[
          {
            value: 'profile',
            label: 'Thông tin',
            content: (
              <form onSubmit={save} className="flex flex-col gap-4" noValidate>
                <Field label="Họ tên" error={form.formState.errors.fullName?.message}>
                  <Input {...form.register('fullName')} />
                </Field>
                <Field label="Số điện thoại" error={form.formState.errors.phone?.message}>
                  <Input type="tel" {...form.register('phone')} />
                </Field>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <Badge tone="brand">{me.roleName}</Badge>
                  {me.branches.map((b) => (
                    <Badge key={b.id}>{b.name}</Badge>
                  ))}
                </div>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  Lưu
                </Button>
              </form>
            ),
          },
          {
            value: 'password',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> Đổi mật khẩu
              </span>
            ),
            content: (
              <ChangePasswordForm
                onDone={() => {
                  toast.success('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
                  onOpenChange(false);
                }}
              />
            ),
          },
        ]}
      />
    </Dialog>
  );
}

/** Thời gian đã làm của lượt đang mở, tự cập nhật mỗi phút. */
function useElapsed(since: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000)) : 0;
}

export function useTimekeepingStatus(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: timekeepingKeys.me,
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/timekeeping/me'))).data,
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

export function usePunch() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: 'in' | 'out') => {
      const res =
        kind === 'in'
          ? await unwrap(api.POST('/api/v1/core/timekeeping/check-in', { body: { source: 'WEB' } }))
          : await unwrap(api.POST('/api/v1/core/timekeeping/check-out', { body: { source: 'WEB' } }));
      return res.data;
    },
    onSuccess: (entry, kind) => {
      toast.success(kind === 'in' ? `Đã check-in lúc ${formatTime(entry.checkInAt)}` : `Đã check-out lúc ${formatTime(entry.checkOutAt)}`);
      void qc.invalidateQueries({ queryKey: timekeepingKeys.all });
    },
    onError: toastError,
  });
}

/** Nút chấm công nhanh trên thanh trên cùng. */
export function PunchButton() {
  const allowed = usePermission('core.timekeeping.self');
  const { data } = useTimekeepingStatus(allowed);
  const punch = usePunch();
  const elapsed = useElapsed(data?.current?.checkInAt);
  if (!allowed || !data) return null;

  const working = !!data.current;
  return (
    <Button
      variant={working ? 'outline' : 'primary'}
      size="sm"
      disabled={punch.isPending}
      onClick={() => punch.mutate(working ? 'out' : 'in')}
      className={cn(working && 'border-success/40')}
      title={working ? `Đã làm ${formatMinutes(elapsed)} — bấm để check-out` : 'Bấm để check-in'}
      aria-label={working ? `Check-out (đã làm ${formatMinutes(elapsed)})` : 'Check-in'}
    >
      {working ? (
        <>
          <span className="size-2 rounded-full bg-success" aria-hidden />
          <span className="hidden tabular-nums min-[420px]:inline">{formatMinutes(elapsed)}</span>
          <span className="hidden sm:inline">· Check-out</span>
        </>
      ) : (
        <>
          <LogIn aria-hidden /> <span className="sr-only sm:not-sr-only">Check-in</span>
        </>
      )}
    </Button>
  );
}
