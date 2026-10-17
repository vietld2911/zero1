import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, Checkbox, DataTable, PageHeader, Progress, Select, type Column } from '@zero1/ui';
import { formatDateTime, useApi } from '@zero1/web-core';
import { lmsKeys } from '../labels';

type Assignment = Schemas['Assignment'];

export default function AssignmentsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [classId, setClassId] = useState('');
  const [pending, setPending] = useState(false);
  const [now] = useState(() => Date.now());
  const { data: classes = [] } = useQuery({
    queryKey: [...lmsKeys.classes, 'list', { status: 'PLANNED,ONGOING' }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/classes', { params: { query: { status: 'PLANNED,ONGOING' } } }))).data,
  });
  const query = { classId: classId || undefined, pendingGrading: pending || undefined };
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.assignments, query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/assignments', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });

  const columns: Column<Assignment>[] = [
    {
      key: 'title',
      header: 'Bài tập',
      cell: (a) => (
        <div className="min-w-0">
          <div className="font-medium">{a.title}</div>
          <div className="text-xs text-muted-foreground">
            {a.classCode} · {a.className}
          </div>
        </div>
      ),
    },
    {
      key: 'due',
      header: 'Hạn nộp',
      className: 'hidden md:table-cell',
      cell: (a) =>
        a.dueAt ? (
          <span className={new Date(a.dueAt).getTime() < now && a.submittedCount + a.gradedCount < a.learnerCount ? 'text-danger' : ''}>{formatDateTime(a.dueAt)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'submitted',
      header: 'Đã nộp',
      className: 'w-36',
      cell: (a) => {
        const done = a.submittedCount + a.gradedCount;
        return (
          <div className="flex flex-col gap-1">
            <span className="text-xs tabular-nums">
              {done}/{a.learnerCount}
              {a.missingCount > 0 && <span className="text-danger"> · {a.missingCount} không nộp</span>}
            </span>
            <Progress value={a.learnerCount ? (done / a.learnerCount) * 100 : 0} label="Tỉ lệ nộp bài" />
          </div>
        );
      },
    },
    {
      key: 'grading',
      header: 'Chấm',
      cell: (a) => (a.submittedCount > 0 ? <Badge tone="warning">{a.submittedCount} chờ chấm</Badge> : <Badge tone="success">Xong</Badge>),
    },
  ];

  return (
    <>
      <PageHeader title="Bài tập" description="Giao bài ở trang lớp học. Học viên chưa tự đăng nhập — giáo viên ghi nhận nộp bài và chấm điểm." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-64" aria-label="Lớp">
          <option value="">Mọi lớp đang mở</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </Select>
        <Checkbox label="Chỉ bài chờ chấm" checked={pending} onCheckedChange={setPending} />
      </div>
      <DataTable columns={columns} rows={data} rowKey={(a) => a.id} loading={isFetching} onRowClick={(a) => navigate(`/assignments/${a.id}`)} empty="Chưa có bài tập" />
    </>
  );
}
