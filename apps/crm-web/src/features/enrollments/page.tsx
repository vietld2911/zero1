import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, DataTable, Input, PageHeader, Segmented, Select, type Column } from '@zero1/ui';
import { BranchSelect, formatDate, formatMoney, useApi, useDebounced } from '@zero1/web-core';
import { APPROVAL_STATUS, crmKeys, ENROLLMENT_STATUS, PAYMENT_STATE } from '../labels';

type Enrollment = Schemas['Enrollment'];
type StatusFilter = '' | keyof typeof ENROLLMENT_STATUS;
const PAGE_SIZE = 20;

export default function EnrollmentsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('');
  const [paymentState, setPaymentState] = useState('');
  const [approval, setApproval] = useState('');
  const [branchId, setBranchId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim(), 300);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: search || undefined,
    status: status || undefined,
    paymentState: (paymentState || undefined) as keyof typeof PAYMENT_STATE | undefined,
    approvalStatus: approval || undefined,
    branchId: branchId || undefined,
  };
  const { data, isFetching } = useQuery({
    queryKey: [...crmKeys.enrollments, 'list', query],
    queryFn: async () => unwrap(api.GET('/api/v1/crm/enrollments', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Enrollment>[] = [
    {
      key: 'student',
      header: 'Học viên',
      cell: (e) => (
        <div>
          <div className="font-medium">{e.studentName}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {e.code} · {e.studentCode}
          </div>
        </div>
      ),
    },
    {
      key: 'package',
      header: 'Gói',
      className: 'hidden md:table-cell',
      cell: (e) => (
        <div className="text-sm">
          <div>{e.packageName}</div>
          <div className="text-xs text-muted-foreground">
            {e.type === 'RENEWAL' ? 'Tái phí' : 'Đăng ký mới'} · {e.saleName ?? '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (e) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={ENROLLMENT_STATUS[e.status].tone}>{ENROLLMENT_STATUS[e.status].label}</Badge>
          {e.approvalStatus === 'PENDING' && <Badge tone="warning">Chờ duyệt</Badge>}
        </div>
      ),
    },
    {
      key: 'due',
      header: 'Phải thu',
      align: 'right',
      cell: (e) => <span className="font-medium tabular-nums">{formatMoney(e.amountDue)}</span>,
    },
    {
      key: 'paid',
      header: 'Đã thu',
      align: 'right',
      className: 'hidden sm:table-cell',
      cell: (e) => (
        <div className="tabular-nums">
          <div>{formatMoney(e.amountPaid)}</div>
          <Badge tone={PAYMENT_STATE[e.paymentState].tone}>{PAYMENT_STATE[e.paymentState].label}</Badge>
        </div>
      ),
    },
    {
      key: 'sessions',
      header: 'Buổi',
      align: 'right',
      className: 'hidden lg:table-cell',
      cell: (e) => (
        <span className="tabular-nums">
          {e.sessionsUsed}/{e.sessionsPurchased}
        </span>
      ),
    },
    { key: 'created', header: 'Ngày tạo', className: 'hidden xl:table-cell', cell: (e) => <span className="text-muted-foreground">{formatDate(e.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader title="Đăng ký & thu tiền" description="Học phí chốt tại thời điểm đăng ký. Khoản thu đầu tiên được xác nhận → học viên sang LMS chờ xếp lớp." />
      <Segmented
        aria-label="Trạng thái"
        className="mb-3"
        value={status}
        onChange={(v) => (setStatus(v), setPage(1))}
        options={[{ value: '' as StatusFilter, label: 'Tất cả' }, ...Object.entries(ENROLLMENT_STATUS).map(([k, v]) => ({ value: k as StatusFilter, label: v.label }))]}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Mã đăng ký, mã / tên học viên…" className="pl-9" aria-label="Tìm kiếm" />
        </div>
        <Select value={paymentState} onChange={(e) => (setPaymentState(e.target.value), setPage(1))} className="w-44" aria-label="Thanh toán">
          <option value="">Mọi tình trạng thu</option>
          {Object.entries(PAYMENT_STATE).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select value={approval} onChange={(e) => (setApproval(e.target.value), setPage(1))} className="w-44" aria-label="Duyệt">
          <option value="">Mọi tình trạng duyệt</option>
          {Object.entries(APPROVAL_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <BranchSelect value={branchId} onChange={(v) => (setBranchId(v), setPage(1))} allLabel="Mọi chi nhánh" />
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(e) => e.id}
        loading={isFetching}
        onRowClick={(e) => navigate(`/enrollments/${e.id}`)}
        empty="Chưa có đăng ký"
        pagination={data ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage } : undefined}
      />
    </>
  );
}
