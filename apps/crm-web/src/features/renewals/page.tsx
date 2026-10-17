import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, buttonVariants, DataTable, Input, PageHeader, Select, Spinner, Stat, Tabs, type Column } from '@zero1/ui';
import { BranchSelect, formatDate, formatDateTime, formatMoney, formatMoneyShort, todayVN, useApi, useMe, usePermission, useStaffOptions } from '@zero1/web-core';
import { crmKeys } from '../labels';

type Renewals = Schemas['Renewals'];
type Due = Renewals['due'][number];
type Renewed = Renewals['renewed'][number];

const REASON = {
  COMPLETED: { label: 'Đã học hết', tone: 'danger' },
  LOW_SESSIONS: { label: 'Sắp hết buổi', tone: 'warning' },
  ENDING: { label: 'Sắp hết hạn', tone: 'info' },
} as const;

export default function RenewalsPage() {
  const api = useApi();
  const me = useMe();
  const canEnroll = usePermission('crm.enrollments.create');
  const canSeeStaff = usePermission('core.users.read');
  const [branchId, setBranchId] = useState('');
  const [careId, setCareId] = useState(me.role === 'CS' ? me.id : '');
  const [month, setMonth] = useState(() => todayVN().slice(0, 7));
  const { data: csList = [] } = useStaffOptions(['CS', 'CM'], branchId || undefined, canSeeStaff);

  const query = { branchId: branchId || undefined, careId: careId || undefined, month };
  const { data, isPending, isFetching } = useQuery({
    queryKey: [...crmKeys.renewals, query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/renewals', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });

  const dueColumns: Column<Due>[] = [
    {
      key: 'student',
      header: 'Học viên',
      cell: (d) => (
        <div>
          <Link to={`/students/${d.studentId}`} className="font-medium hover:underline">
            {d.fullName}
          </Link>
          <div className="text-xs text-muted-foreground">
            {d.code}
            {d.currentClassName && ` · ${d.currentClassName}`}
          </div>
        </div>
      ),
    },
    {
      key: 'guardian',
      header: 'Phụ huynh',
      className: 'hidden md:table-cell',
      cell: (d) =>
        d.guardianPhone ? (
          <div>
            <div>{d.guardianName}</div>
            <a href={`tel:${d.guardianPhone}`} className="text-xs text-info tabular-nums hover:underline">
              {d.guardianPhone}
            </a>
          </div>
        ) : (
          '—'
        ),
    },
    {
      key: 'reason',
      header: 'Lý do',
      cell: (d) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={REASON[d.reason].tone}>{REASON[d.reason].label}</Badge>
          <span className="text-xs text-muted-foreground">
            còn {d.sessionsRemaining} buổi · hết hạn {formatDate(d.endDate)}
          </span>
        </div>
      ),
    },
    { key: 'package', header: 'Gói hiện tại', className: 'hidden lg:table-cell', cell: (d) => <span className="text-sm">{d.packageName}</span> },
    { key: 'care', header: 'CS chăm sóc', className: 'hidden md:table-cell', cell: (d) => d.careName ?? <Badge tone="warning">Chưa có CS</Badge> },
    {
      key: 'action',
      header: <span className="sr-only">Tái phí</span>,
      align: 'right',
      cell: (d) =>
        canEnroll ? (
          <Link to={`/students/${d.studentId}?renew=1`} className={buttonVariants({ size: 'sm' })}>
            <RefreshCcw /> Tái phí
          </Link>
        ) : null,
    },
  ];

  const renewedColumns: Column<Renewed>[] = [
    {
      key: 'student',
      header: 'Học viên',
      cell: (r) => (
        <div>
          <Link to={`/enrollments/${r.id}`} className="font-medium hover:underline">
            {r.studentName}
          </Link>
          <div className="text-xs text-muted-foreground">
            {r.code} · {r.packageName}
          </div>
        </div>
      ),
    },
    { key: 'credit', header: 'Tính cho', cell: (r) => r.creditName ?? '—' },
    { key: 'value', header: 'Giá trị', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.amountDue)}</span> },
    { key: 'paid', header: 'Đã thu', align: 'right', cell: (r) => <span className="tabular-nums">{formatMoney(r.amountPaid)}</span> },
    { key: 'at', header: 'Ngày tạo', className: 'hidden md:table-cell', cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span> },
  ];

  const s = data?.summary;
  return (
    <>
      <PageHeader title="Tái phí" description="Học viên đang học có đăng ký sắp hết buổi, sắp hết hạn hoặc đã học xong mà chưa đăng ký tiếp. Doanh thu tái phí tính cho CS chăm sóc." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />
        <Select value={careId} onChange={(e) => setCareId(e.target.value)} className="w-52" aria-label="CS chăm sóc">
          <option value="">Mọi CS</option>
          <option value={me.id}>Học viên tôi chăm sóc</option>
          <option value="none">Chưa có CS</option>
          {csList
            .filter((u) => u.id !== me.id)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
        </Select>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Tháng (đã tái phí)" />
        {isFetching && <Spinner />}
      </div>

      {isPending || !data || !s ? (
        <Spinner label="Đang tải…" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Cần tái phí" value={s.due} tone={s.due ? 'warning' : 'default'} hint="Hiện tại" />
            <Stat label="Đã tái phí" value={s.renewed} hint={`Trong tháng ${month.slice(5)}/${month.slice(0, 4)}`} />
            <Stat label="Tỉ lệ tái phí" value={s.rate === null ? '—' : `${s.rate}%`} hint="Đã tái phí / (đã tái phí + đang cần)" tone={s.rate !== null && s.rate >= 70 ? 'success' : 'default'} />
            <Stat label="Giá trị tái phí" value={formatMoneyShort(s.renewedValue)} hint="Tổng phải thu của đăng ký tái phí" />
          </div>
          <Tabs
            tabs={[
              {
                value: 'due',
                label: `Cần tái phí (${s.due})`,
                content: <DataTable columns={dueColumns} rows={data.due} rowKey={(d) => d.studentId} empty="Không có học viên cần tái phí" />,
              },
              {
                value: 'renewed',
                label: `Đã tái phí trong tháng (${s.renewed})`,
                content: <DataTable columns={renewedColumns} rows={data.renewed} rowKey={(r) => r.id} empty="Chưa có tái phí trong tháng" />,
              },
            ]}
          />
        </>
      )}
    </>
  );
}
