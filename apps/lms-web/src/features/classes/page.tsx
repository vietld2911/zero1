import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, Button, DataTable, Input, PageHeader, Progress, Segmented, type Column } from '@zero1/ui';
import { BranchSelect, formatDate, formatDateTime, useApi, useDebounced, usePermission, WEEKDAY_SHORT } from '@zero1/web-core';
import { CLASS_STATUS, lmsKeys } from '../labels';
import { ClassFormDialog } from './class-form';

type Class = Schemas['Class'];
type Filter = 'OPEN' | 'PLANNED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';

export default function ClassesPage() {
  const api = useApi();
  const navigate = useNavigate();
  const canManage = usePermission('lms.classes.manage');
  const [status, setStatus] = useState<Filter>('OPEN');
  const [branchId, setBranchId] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const search = useDebounced(q.trim(), 300);

  const query = { status: status === 'OPEN' ? 'PLANNED,ONGOING' : status, branchId: branchId || undefined, q: search || undefined };
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.classes, 'list', query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/classes', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });

  const columns: Column<Class>[] = [
    {
      key: 'class',
      header: 'Lớp',
      cell: (c) => (
        <div className="min-w-0">
          <div className="font-medium">{c.code}</div>
          <div className="truncate text-xs text-muted-foreground">
            {c.name} · {c.levelName}
          </div>
        </div>
      ),
    },
    {
      key: 'schedule',
      header: 'Lịch',
      className: 'hidden md:table-cell',
      cell: (c) => (
        <div className="text-sm">
          <div>
            {c.schedule
              .slice()
              .sort((a, b) => a.weekday - b.weekday)
              .map((s) => `${WEEKDAY_SHORT[s.weekday]} ${s.startTime}`)
              .join(', ')}
          </div>
          <div className="text-xs text-muted-foreground">
            {c.roomName ?? 'Chưa xếp phòng'} · KG {formatDate(c.startDate)}
          </div>
        </div>
      ),
    },
    {
      key: 'teacher',
      header: 'Giáo viên',
      className: 'hidden lg:table-cell',
      cell: (c) => (
        <div className="text-sm">
          <div>{c.teacherName ?? '—'}</div>
          {c.taName && <div className="text-xs text-muted-foreground">TA {c.taName}</div>}
        </div>
      ),
    },
    {
      key: 'learners',
      header: 'Sĩ số',
      align: 'right',
      cell: (c) => (
        <span className={`tabular-nums ${c.learnerCount >= c.capacity ? 'font-medium text-warning' : ''}`}>
          {c.learnerCount}/{c.capacity}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Tiến độ',
      className: 'w-40',
      cell: (c) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs tabular-nums">
            {c.sessionsDone}/{c.totalSessions} buổi
            {c.sessionsPlanned < c.totalSessions && <span className="text-warning"> · thiếu lịch</span>}
          </span>
          <Progress value={c.totalSessions ? (c.sessionsDone / c.totalSessions) * 100 : 0} label="Tiến độ lớp" />
        </div>
      ),
    },
    {
      key: 'next',
      header: 'Buổi tới',
      className: 'hidden xl:table-cell',
      cell: (c) => <span className="text-sm text-muted-foreground">{c.nextSessionAt ? formatDateTime(c.nextSessionAt) : '—'}</span>,
    },
    { key: 'status', header: 'Trạng thái', cell: (c) => <Badge tone={CLASS_STATUS[c.status].tone}>{CLASS_STATUS[c.status].label}</Badge> },
  ];

  return (
    <>
      <PageHeader
        title="Lớp học"
        description="Tiến độ, sĩ số và lịch của từng lớp."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Tạo lớp
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="Trạng thái"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'OPEN', label: 'Đang mở' },
            { value: 'PLANNED', label: 'Sắp khai giảng' },
            { value: 'ONGOING', label: 'Đang học' },
            { value: 'COMPLETED', label: 'Đã kết thúc' },
            { value: 'CANCELLED', label: 'Đã huỷ' },
          ]}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã, tên lớp…" className="pl-9" aria-label="Tìm lớp" />
        </div>
        <BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />
      </div>
      <DataTable columns={columns} rows={data} rowKey={(c) => c.id} loading={isFetching} onRowClick={(c) => navigate(`/classes/${c.id}`)} empty="Không có lớp" />
      {creating && <ClassFormDialog cls={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/classes/${id}`)} />}
    </>
  );
}
