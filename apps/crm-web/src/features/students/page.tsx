import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, DataTable, Input, PageHeader, Segmented, Select, type Column } from '@zero1/ui';
import { BranchSelect, formatDate, useApi, useDebounced, useMe, usePermission, useStaffOptions } from '@zero1/web-core';
import { crmKeys, OWNER_ROLES, STUDENT_STATUS } from '../labels';
import { StudentAvatar } from './student-avatar';

type Student = Schemas['Student'];
type StatusFilter = '' | keyof typeof STUDENT_STATUS;
const PAGE_SIZE = 20;

export default function StudentsPage() {
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const canSeeStaff = usePermission('core.users.read');
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim(), 300);
  const { data: staff = [] } = useStaffOptions(OWNER_ROLES, branchId || undefined, canSeeStaff);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: search || undefined,
    status: status || undefined,
    ownerId: owner && owner !== 'care' ? owner : undefined,
    careId: owner === 'care' ? me.id : undefined,
    branchId: branchId || undefined,
  };
  const { data, isFetching } = useQuery({
    queryKey: [...crmKeys.students, 'list', query],
    queryFn: async () => unwrap(api.GET('/api/v1/crm/students', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Student>[] = [
    {
      key: 'name',
      header: 'Học viên',
      cell: (s) => (
        <div className="flex items-center gap-3">
          <StudentAvatar name={s.fullName} url={s.avatarUrl} />
          <div className="min-w-0">
            <div className="font-medium">{s.fullName}</div>
            <div className="font-mono text-xs text-muted-foreground">{s.code}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'guardian',
      header: 'Phụ huynh',
      className: 'hidden md:table-cell',
      cell: (s) => {
        const g = s.guardians.find((x) => x.isPrimary) ?? s.guardians[0];
        return g ? (
          <div>
            <div>{g.fullName}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{g.phone}</div>
          </div>
        ) : (
          '—'
        );
      },
    },
    {
      key: 'class',
      header: 'Lớp / cấp độ',
      cell: (s) => (
        <div className="text-sm">
          <div>{s.currentClassName ?? <span className="text-muted-foreground">Chưa xếp lớp</span>}</div>
          {s.currentLevelName && <div className="text-xs text-muted-foreground">{s.currentLevelName}</div>}
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', cell: (s) => <Badge tone={STUDENT_STATUS[s.status].tone}>{STUDENT_STATUS[s.status].label}</Badge> },
    {
      key: 'owner',
      header: 'Sale / CS',
      className: 'hidden lg:table-cell',
      cell: (s) => (
        <div className="text-sm">
          <div>{s.ownerName ?? '—'}</div>
          <div className="text-xs text-muted-foreground">CS: {s.careName ?? '—'}</div>
        </div>
      ),
    },
    { key: 'created', header: 'Ngày tạo', className: 'hidden xl:table-cell', cell: (s) => <span className="text-muted-foreground">{formatDate(s.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader title="Học viên" description="Hồ sơ, phụ huynh, đăng ký và trạng thái học. Học viên mới tạo khi đăng ký học từ khách hàng tiềm năng." />
      <Segmented
        aria-label="Trạng thái"
        className="mb-3"
        value={status}
        onChange={(v) => (setStatus(v), setPage(1))}
        options={[{ value: '' as StatusFilter, label: 'Tất cả' }, ...Object.entries(STUDENT_STATUS).map(([k, v]) => ({ value: k as StatusFilter, label: v.label }))]}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Tên, mã học viên, SĐT phụ huynh…" className="pl-9" aria-label="Tìm kiếm" />
        </div>
        <Select value={owner} onChange={(e) => (setOwner(e.target.value), setPage(1))} className="w-52" aria-label="Người phụ trách">
          <option value="">Mọi người phụ trách</option>
          <option value={me.id}>Tôi là sale</option>
          <option value="care">Tôi chăm sóc (CS)</option>
          {staff
            .filter((s) => s.id !== me.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
        </Select>
        <BranchSelect value={branchId} onChange={(v) => (setBranchId(v), setPage(1))} allLabel="Mọi chi nhánh" />
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(s) => s.id}
        loading={isFetching}
        onRowClick={(s) => navigate(`/students/${s.id}`)}
        empty="Không có học viên"
        pagination={data ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage } : undefined}
      />
    </>
  );
}
