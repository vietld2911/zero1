import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock, LogIn, LogOut, Plus, X } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  toast,
  type Column,
} from '@zero1/ui';
import { useApi } from '../api';
import { useMe, usePermission } from '../auth/auth-context';
import { applyFieldErrors, errorMessage, toastError } from '../lib/errors';
import { formatDateTime, formatMinutes, formatTime, formatWorkDate, monthStartVN, todayVN } from '../lib/format';
import { timekeepingKeys, usePunch, useTimekeepingStatus } from '../shell/topbar';
import { useBranches } from '../queries';

type Entry = Schemas['TimekeepingEntry'];
type Adjustment = Schemas['TimekeepingAdjustment'];
type SummaryRow = Schemas['TimekeepingSummaryRow'];

const sourceLabel: Record<Entry['checkInSource'], string> = { WEB: 'Web', MOBILE: 'Điện thoại', DEVICE: 'Máy chấm công', MANUAL: 'Sửa công' };

export default function TimekeepingPage() {
  const canRead = usePermission('core.timekeeping.read');
  const canAdjust = usePermission('core.timekeeping.adjust');
  const [requestFor, setRequestFor] = useState<{ entry?: Entry; userId?: string; userName?: string } | null>(null);

  return (
    <>
      <PageHeader title="Chấm công" description="Check-in / check-out, lịch sử và yêu cầu sửa công." />
      <TodayCard onFix={(entry) => setRequestFor({ entry })} />
      <Tabs
        className="mt-6"
        tabs={[
          { value: 'mine', label: 'Lịch sử của tôi', content: <MyEntries onFix={(entry) => setRequestFor({ entry })} /> },
          { value: 'requests', label: 'Yêu cầu sửa công', content: <MyAdjustments onNew={() => setRequestFor({})} /> },
          { value: 'summary', label: 'Bảng công', hidden: !canRead, content: <TeamSummary onAdjust={(userId, userName) => setRequestFor({ userId, userName })} /> },
          { value: 'review', label: 'Duyệt sửa công', hidden: !canAdjust, content: <ReviewQueue /> },
        ]}
      />
      <AdjustmentDialog target={requestFor} onClose={() => setRequestFor(null)} />
    </>
  );
}

function TodayCard({ onFix }: { onFix: (entry: Entry) => void }) {
  const { data } = useTimekeepingStatus();
  const punch = usePunch();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const working = !!data?.current;
  const workedToday = (data?.today ?? []).reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  // Đồng hồ máy có thể lệch vài giây so với server — không bao giờ hiện số âm.
  const currentMinutes = data?.current ? Math.max(0, Math.floor((now.getTime() - new Date(data.current.checkInAt).getTime()) / 60_000)) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={`flex size-12 items-center justify-center rounded-full ${working ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>
            <Clock className="size-6" aria-hidden />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{data ? formatWorkDate(data.workDate) : 'Hôm nay'}</p>
            <p className="text-3xl font-semibold tabular-nums">{formatTime(now.toISOString())}</p>
            <p className="text-sm">
              {working ? (
                <span className="text-success">
                  Đang làm từ {formatTime(data!.current!.checkInAt)} · {formatMinutes(currentMinutes)}
                </span>
              ) : (
                <span className="text-muted-foreground">Chưa check-in{workedToday ? ` · đã làm ${formatMinutes(workedToday)} hôm nay` : ''}</span>
              )}
            </p>
          </div>
        </div>
        <Button size="lg" variant={working ? 'outline' : 'primary'} disabled={!data || punch.isPending} onClick={() => punch.mutate(working ? 'out' : 'in')} className="sm:min-w-40">
          {working ? <LogOut /> : <LogIn />}
          {working ? 'Check-out' : 'Check-in'}
        </Button>
      </div>
      {!!data?.missingCheckoutCount && (
        <div className="border-t border-border px-5 py-3">
          <Alert tone="warning" title={`Có ${data.missingCheckoutCount} ngày quên check-out`}>
            Mở “Lịch sử của tôi”, chọn lượt có biểu tượng cảnh báo và gửi yêu cầu sửa công.
          </Alert>
        </div>
      )}
      {!!data?.today.length && (
        <ul className="divide-y divide-border border-t border-border text-sm">
          {data.today.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <span className="tabular-nums">
                {formatTime(e.checkInAt)} → {e.checkOutAt ? formatTime(e.checkOutAt) : '…'}
              </span>
              <span className="text-muted-foreground">{e.durationMinutes != null ? formatMinutes(e.durationMinutes) : 'đang mở'}</span>
              {e.status === 'CLOSED' && (
                <Button variant="ghost" size="sm" onClick={() => onFix(e)}>
                  Sửa
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function useRange(defaultFrom = monthStartVN(), defaultTo = todayVN()) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const picker = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Từ ngày
        <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-40" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Đến ngày
        <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-40" />
      </label>
    </div>
  );
  return { from, to, picker };
}

const entryColumns = (onFix?: (e: Entry) => void, showUser = false): Column<Entry>[] => [
  ...(showUser ? [{ key: 'user', header: 'Nhân sự', cell: (e: Entry) => e.userFullName ?? '—' }] : []),
  { key: 'date', header: 'Ngày', cell: (e) => formatWorkDate(e.workDate) },
  {
    key: 'time',
    header: 'Vào → Ra',
    cell: (e) => (
      <span className="flex items-center gap-1.5 tabular-nums">
        {formatTime(e.checkInAt)} → {e.checkOutAt ? formatTime(e.checkOutAt) : '—'}
        {e.missingCheckout && <AlertTriangle className="size-4 text-warning" aria-label="Quên check-out" />}
      </span>
    ),
  },
  { key: 'duration', header: 'Thời gian', align: 'right', cell: (e) => formatMinutes(e.durationMinutes) },
  { key: 'branch', header: 'Chi nhánh', className: 'hidden md:table-cell', cell: (e) => e.branchName ?? '—' },
  {
    key: 'source',
    header: 'Nguồn',
    className: 'hidden lg:table-cell',
    cell: (e) => (e.status === 'ADJUSTED' ? <Badge tone="info">Đã sửa</Badge> : sourceLabel[e.checkInSource]),
  },
  ...(onFix
    ? [
        {
          key: 'fix',
          header: <span className="sr-only">Sửa</span>,
          align: 'right' as const,
          cell: (e: Entry) =>
            e.status !== 'OPEN' || e.missingCheckout ? (
              <Button variant="ghost" size="sm" onClick={() => onFix(e)}>
                Sửa
              </Button>
            ) : null,
        },
      ]
    : []),
];

function MyEntries({ onFix }: { onFix: (entry: Entry) => void }) {
  const api = useApi();
  const me = useMe();
  const { from, to, picker } = useRange();
  const [page, setPage] = useState(1);
  const query = { from, to, userId: me.id, page, pageSize: 31 };
  const { data, isFetching, error } = useQuery({
    queryKey: [...timekeepingKeys.all, 'entries', query],
    queryFn: () => unwrap(api.GET('/api/v1/core/timekeeping/entries', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const total = (data?.data ?? []).reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {picker}
        <p className="text-sm text-muted-foreground">
          Tổng trang này: <strong className="text-foreground">{formatMinutes(total)}</strong>
        </p>
      </div>
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      <DataTable
        columns={entryColumns(onFix)}
        rows={data?.data}
        rowKey={(e) => e.id}
        loading={isFetching}
        empty="Chưa có lượt chấm công trong khoảng này"
        pagination={data ? { ...data.meta, onPageChange: setPage } : undefined}
      />
    </div>
  );
}

const adjustmentStatus: Record<Adjustment['status'], { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};

const adjustmentColumns = (extra: Column<Adjustment>[] = [], showUser = false): Column<Adjustment>[] => [
  ...(showUser ? [{ key: 'user', header: 'Nhân sự', cell: (a: Adjustment) => <span className="font-medium">{a.userFullName}</span> }] : []),
  { key: 'date', header: 'Ngày', cell: (a) => formatWorkDate(a.workDate) },
  { key: 'time', header: 'Giờ đề nghị', cell: (a) => <span className="tabular-nums">{formatTime(a.checkInAt)} → {formatTime(a.checkOutAt)}</span> },
  { key: 'reason', header: 'Lý do', className: 'hidden md:table-cell max-w-72', cell: (a) => <span className="line-clamp-2">{a.reason}</span> },
  {
    key: 'status',
    header: 'Trạng thái',
    cell: (a) => (
      <div>
        <Badge tone={adjustmentStatus[a.status].tone}>{adjustmentStatus[a.status].label}</Badge>
        {a.reviewNote && <p className="mt-1 text-xs text-muted-foreground">{a.reviewNote}</p>}
      </div>
    ),
  },
  { key: 'created', header: 'Gửi lúc', className: 'hidden lg:table-cell text-muted-foreground', cell: (a) => formatDateTime(a.createdAt) },
  ...extra,
];

function MyAdjustments({ onNew }: { onNew: () => void }) {
  const api = useApi();
  const [page, setPage] = useState(1);
  const query = { view: 'mine' as const, page, pageSize: 20 };
  const { data, isFetching } = useQuery({
    queryKey: [...timekeepingKeys.all, 'adjustments', query],
    queryFn: () => unwrap(api.GET('/api/v1/core/timekeeping/adjustments', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="outline" onClick={onNew}>
          <Plus /> Yêu cầu sửa công
        </Button>
      </div>
      <DataTable
        columns={adjustmentColumns()}
        rows={data?.data}
        rowKey={(a) => a.id}
        loading={isFetching}
        empty="Chưa có yêu cầu nào"
        pagination={data ? { ...data.meta, onPageChange: setPage } : undefined}
      />
    </div>
  );
}

function TeamSummary({ onAdjust }: { onAdjust: (userId: string, userName: string) => void }) {
  const api = useApi();
  const canAdjust = usePermission('core.timekeeping.adjust');
  const me = useMe();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState('');
  const { from, to, picker } = useRange();
  const query = { from, to, branchId: branchId || undefined };
  const { data, isFetching, error } = useQuery({
    queryKey: [...timekeepingKeys.all, 'summary', query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/timekeeping/summary', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });

  const columns: Column<SummaryRow>[] = [
    { key: 'name', header: 'Nhân sự', cell: (r) => <span className="font-medium">{r.fullName}</span> },
    { key: 'role', header: 'Vai trò', className: 'hidden sm:table-cell', cell: (r) => <Badge tone="brand">{r.role}</Badge> },
    { key: 'days', header: 'Ngày công', align: 'right', cell: (r) => <span className="tabular-nums">{r.workDays}</span> },
    { key: 'hours', header: 'Tổng giờ', align: 'right', cell: (r) => formatMinutes(r.totalMinutes) },
    {
      key: 'missing',
      header: 'Quên check-out',
      align: 'right',
      cell: (r) => (r.missingCheckouts ? <Badge tone="warning">{r.missingCheckouts}</Badge> : <span className="text-muted-foreground">0</span>),
    },
    { key: 'adjusted', header: 'Đã sửa', align: 'right', className: 'hidden md:table-cell', cell: (r) => r.adjustedEntries },
    ...(canAdjust
      ? [
          {
            key: 'act',
            header: <span className="sr-only">Sửa công</span>,
            align: 'right' as const,
            cell: (r: SummaryRow) =>
              r.userId !== me.id ? (
                <Button variant="ghost" size="sm" onClick={() => onAdjust(r.userId, r.fullName)}>
                  Thêm công
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {picker}
        {branches.length > 1 && (
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-52" aria-label="Chi nhánh">
            <option value="">Tất cả chi nhánh</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      <DataTable columns={columns} rows={data} rowKey={(r) => r.userId} loading={isFetching} empty="Không có dữ liệu chấm công" />
    </div>
  );
}

function ReviewQueue() {
  const api = useApi();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const [page, setPage] = useState(1);
  const query = { view: 'review' as const, status: status || undefined, page, pageSize: 20 };
  const { data, isFetching } = useQuery({
    queryKey: [...timekeepingKeys.all, 'adjustments', query],
    queryFn: () => unwrap(api.GET('/api/v1/core/timekeeping/adjustments', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  const review = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => {
      const opts = { params: { path: { id } }, body: {} };
      return decision === 'approve'
        ? unwrap(api.POST('/api/v1/core/timekeeping/adjustments/{id}/approve', opts))
        : unwrap(api.POST('/api/v1/core/timekeeping/adjustments/{id}/reject', opts));
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === 'approve' ? 'Đã duyệt' : 'Đã từ chối');
      void qc.invalidateQueries({ queryKey: timekeepingKeys.all });
    },
    onError: toastError,
  });

  const actions: Column<Adjustment> = {
    key: 'actions',
    header: <span className="sr-only">Duyệt</span>,
    align: 'right',
    cell: (a) =>
      a.status === 'PENDING' ? (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, decision: 'reject' })}>
            <X /> Từ chối
          </Button>
          <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, decision: 'approve' })}>
            <Check /> Duyệt
          </Button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{a.reviewedBy?.fullName}</span>
      ),
  };

  return (
    <div className="flex flex-col gap-3">
      <Select value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setPage(1))} className="w-48" aria-label="Trạng thái">
        <option value="PENDING">Chờ duyệt</option>
        <option value="APPROVED">Đã duyệt</option>
        <option value="REJECTED">Từ chối</option>
        <option value="">Tất cả</option>
      </Select>
      <DataTable
        columns={adjustmentColumns([actions], true)}
        rows={data?.data}
        rowKey={(a) => a.id}
        loading={isFetching}
        empty="Không có yêu cầu"
        pagination={data ? { ...data.meta, onPageChange: setPage } : undefined}
      />
    </div>
  );
}

// ───────────────────────────── Form yêu cầu / thêm công

/** Giá trị cho <input type="datetime-local"> theo giờ Việt Nam. */
const toLocalInput = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => `${v}:00+07:00`;

const adjustmentSchema = z
  .object({
    checkInAt: z.string().min(1, 'Chọn giờ vào'),
    checkOutAt: z.string().min(1, 'Chọn giờ ra'),
    reason: z.string().trim().min(5, 'Ghi rõ lý do (tối thiểu 5 ký tự)').max(500),
  })
  .refine((v) => v.checkOutAt > v.checkInAt, { path: ['checkOutAt'], message: 'Giờ ra phải sau giờ vào' });

function AdjustmentDialog({ target, onClose }: { target: { entry?: Entry; userId?: string; userName?: string } | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(adjustmentSchema), defaultValues: { checkInAt: '', checkOutAt: '', reason: '' } });
  const forOther = !!target?.userId;

  useEffect(() => {
    if (!target) return;
    setFormError(null);
    const e = target.entry;
    const day = todayVN(-1);
    form.reset({
      checkInAt: e ? toLocalInput(e.checkInAt) : `${day}T08:00`,
      checkOutAt: e?.checkOutAt ? toLocalInput(e.checkOutAt) : e ? `${e.workDate}T17:30` : `${day}T17:30`,
      reason: '',
    });
  }, [target, form]);

  const save = useMutation({
    mutationFn: async (v: z.infer<typeof adjustmentSchema>) =>
      unwrap(
        api.POST('/api/v1/core/timekeeping/adjustments', {
          body: {
            ...(target?.userId ? { userId: target.userId } : {}),
            ...(target?.entry ? { entryId: target.entry.id } : {}),
            checkInAt: fromLocalInput(v.checkInAt),
            checkOutAt: fromLocalInput(v.checkOutAt),
            reason: v.reason,
          },
        }),
      ),
    onSuccess: (res) => {
      toast.success(res.data.status === 'APPROVED' ? 'Đã thêm công' : 'Đã gửi yêu cầu, chờ quản lý duyệt');
      void qc.invalidateQueries({ queryKey: timekeepingKeys.all });
      onClose();
    },
    onError: (err) => {
      if (!applyFieldErrors(err, form.setError, ['checkInAt', 'checkOutAt', 'reason'])) setFormError(errorMessage(err));
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const errors = form.formState.errors;

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={forOther ? `Thêm / sửa công — ${target?.userName}` : target?.entry ? 'Yêu cầu sửa lượt chấm công' : 'Yêu cầu sửa công'}
      description={forOther ? 'Có hiệu lực ngay, được ghi nhật ký.' : 'Quản lý trực tiếp sẽ duyệt yêu cầu.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {forOther ? 'Lưu' : 'Gửi yêu cầu'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {formError && <Alert tone="danger" className="sm:col-span-2">{formError}</Alert>}
        <Field label="Giờ vào" required error={errors.checkInAt?.message}>
          <Input type="datetime-local" {...form.register('checkInAt')} />
        </Field>
        <Field label="Giờ ra" required error={errors.checkOutAt?.message}>
          <Input type="datetime-local" {...form.register('checkOutAt')} />
        </Field>
        <Field label="Lý do" required className="sm:col-span-2" error={errors.reason?.message}>
          <Textarea rows={3} placeholder="Ví dụ: Quên check-out do dạy bù đến 20h" {...form.register('reason')} />
        </Field>
      </form>
    </Dialog>
  );
}
