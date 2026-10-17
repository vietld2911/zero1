import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, DataTable, Input, PageHeader, Segmented, type Column } from '@zero1/ui';
import { BranchSelect, fileUrl, useApi, useDebounced } from '@zero1/web-core';
import { LEARNER_STATUS, lmsKeys } from '../labels';

type Learner = Schemas['Learner'];
type Filter = '' | keyof typeof LEARNER_STATUS;
const PAGE_SIZE = 20;

export function LearnerAvatar({ name, url, size = 'md' }: { name: string; url: string | null; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-16 text-xl' : 'size-9 text-sm';
  if (url) return <img src={fileUrl(url)} alt="" className={`${box} shrink-0 rounded-full object-cover`} />;
  return (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-full bg-navy-100 font-semibold text-navy-700`} aria-hidden>
      {name.trim().split(/\s+/).pop()?.[0]?.toUpperCase()}
    </span>
  );
}

export default function LearnersPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Filter>('ACTIVE');
  const [branchId, setBranchId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim(), 300);
  const query = { page, pageSize: PAGE_SIZE, q: search || undefined, status: status || undefined, branchId: branchId || undefined };
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.learners, 'list', query],
    queryFn: async () => unwrap(api.GET('/api/v1/lms/learners', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Learner>[] = [
    {
      key: 'name',
      header: 'Học viên',
      cell: (l) => (
        <div className="flex items-center gap-3">
          <LearnerAvatar name={l.fullName} url={l.avatarUrl} />
          <div>
            <div className="font-medium">{l.fullName}</div>
            <div className="font-mono text-xs text-muted-foreground">{l.code}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'classes',
      header: 'Lớp',
      cell: (l) => {
        const current = l.classes.filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED');
        return current.length ? current.map((c) => c.code).join(', ') : <Badge tone="warning">Chưa có lớp</Badge>;
      },
    },
    { key: 'level', header: 'Cấp độ', className: 'hidden md:table-cell', cell: (l) => l.currentLevelName ?? '—' },
    {
      key: 'remaining',
      header: 'Còn buổi',
      align: 'right',
      cell: (l) => <span className={`tabular-nums ${l.sessionsRemaining <= 2 ? 'font-medium text-warning' : ''}`}>{l.sessionsRemaining}</span>,
    },
    { key: 'status', header: 'Trạng thái', cell: (l) => <Badge tone={LEARNER_STATUS[l.status].tone}>{LEARNER_STATUS[l.status].label}</Badge> },
  ];

  return (
    <>
      <PageHeader title="Học viên" description="Hồ sơ học tập: lớp, điểm danh, điểm bài tập, nhận xét. Thông tin cá nhân và học phí ở CRM." />
      <Segmented
        aria-label="Trạng thái"
        className="mb-3"
        value={status}
        onChange={(v) => (setStatus(v), setPage(1))}
        options={[{ value: '' as Filter, label: 'Tất cả' }, ...Object.entries(LEARNER_STATUS).map(([k, v]) => ({ value: k as Filter, label: v.label }))]}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Tên, mã học viên…" className="pl-9" aria-label="Tìm học viên" />
        </div>
        <BranchSelect value={branchId} onChange={(v) => (setBranchId(v), setPage(1))} allLabel="Mọi chi nhánh" />
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(l) => l.id}
        loading={isFetching}
        onRowClick={(l) => navigate(`/learners/${l.id}`)}
        empty="Không có học viên"
        pagination={data ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage } : undefined}
      />
    </>
  );
}
