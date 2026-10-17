import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@zero1/api-client';
import { DataTable, Input, PageHeader, Progress, Spinner, Stat, Tabs, type Column } from '@zero1/ui';
import { BranchSelect, todayVN, useApi } from '@zero1/web-core';
import { CLASS_STATUS } from '../labels';

type Report = Schemas['TeachingReport'];
type TeacherRow = Report['teachers'][number];
type ClassRow = Report['classes'][number];

const ROLE_LABEL: Record<string, string> = { TEACHER: 'Giáo viên', TA: 'Trợ giảng', TL: 'Teaching Leader', CM: 'CM', ADMIN: 'Quản trị' };

/** Ô tỉ lệ: số % + thanh; dưới ngưỡng thì cảnh báo. */
function Rate({ value, warnBelow = 80 }: { value: number | null; warnBelow?: number }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-28 items-center gap-2">
      <Progress value={value} tone={value >= warnBelow ? 'success' : value >= warnBelow - 20 ? 'warning' : 'danger'} label={`${value}%`} />
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums">{value}%</span>
    </div>
  );
}

export default function TeachingReportPage() {
  const api = useApi();
  const [month, setMonth] = useState(() => todayVN().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const query = { month, branchId: branchId || undefined };
  const { data, isPending, isFetching } = useQuery({
    queryKey: ['lms', 'reports', 'teaching', query],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/reports/teaching', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });

  const teacherColumns: Column<TeacherRow>[] = [
    {
      key: 'name',
      header: 'Giáo viên / trợ giảng',
      cell: (t) => (
        <div>
          <div className="font-medium">{t.fullName}</div>
          <div className="text-xs text-muted-foreground">{ROLE_LABEL[t.role] ?? t.role}</div>
        </div>
      ),
    },
    { key: 'sessions', header: 'Buổi dạy', align: 'right', cell: (t) => <span className="tabular-nums">{t.sessions}</span> },
    { key: 'hours', header: 'Giờ dạy', align: 'right', cell: (t) => <span className="tabular-nums">{t.hours.toLocaleString('vi-VN')}</span> },
    { key: 'sub', header: 'Dạy thay', align: 'right', className: 'hidden md:table-cell', cell: (t) => <span className="tabular-nums">{t.substituteSessions || '—'}</span> },
    { key: 'ta', header: 'Trợ giảng', align: 'right', className: 'hidden md:table-cell', cell: (t) => <span className="tabular-nums">{t.assistedSessions || '—'}</span> },
    {
      key: 'overdue',
      header: 'Chưa chốt',
      align: 'right',
      cell: (t) => <span className={`tabular-nums ${t.overdueSessions ? 'font-medium text-warning' : 'text-muted-foreground'}`}>{t.overdueSessions || '—'}</span>,
    },
    { key: 'feedback', header: 'Nhận xét', cell: (t) => <Rate value={t.feedbackRate} /> },
  ];

  const classColumns: Column<ClassRow>[] = [
    {
      key: 'class',
      header: 'Lớp',
      cell: (c) => (
        <div>
          <Link to={`/classes/${c.classId}`} className="font-medium hover:underline">
            {c.code}
          </Link>
          <div className="text-xs text-muted-foreground">
            {c.learners} học viên · {CLASS_STATUS[c.status as keyof typeof CLASS_STATUS]?.label ?? c.status}
          </div>
        </div>
      ),
    },
    {
      key: 'sessions',
      header: 'Buổi',
      align: 'right',
      cell: (c) => (
        <div className="tabular-nums">
          {c.sessionsDone}
          {(c.sessionsCancelled > 0 || c.sessionsOverdue > 0) && (
            <div className="text-xs text-muted-foreground">
              {c.sessionsCancelled > 0 && `${c.sessionsCancelled} huỷ`}
              {c.sessionsCancelled > 0 && c.sessionsOverdue > 0 && ' · '}
              {c.sessionsOverdue > 0 && <span className="text-warning">{c.sessionsOverdue} chưa chốt</span>}
            </div>
          )}
        </div>
      ),
    },
    { key: 'att', header: 'Đi học', cell: (c) => <Rate value={c.attendanceRate} warnBelow={85} /> },
    { key: 'fb', header: 'Nhận xét', cell: (c) => <Rate value={c.feedbackRate} /> },
    {
      key: 'hw',
      header: 'Nộp bài',
      className: 'hidden lg:table-cell',
      cell: (c) =>
        c.assignments ? (
          <div>
            <Rate value={c.submissionRate} warnBelow={70} />
            <div className="text-xs text-muted-foreground">
              {c.assignments} bài · đã chấm {c.gradedRate ?? 0}%
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">Chưa giao bài</span>
        ),
    },
  ];

  const s = data?.summary;
  return (
    <>
      <PageHeader title="Báo cáo học tập" description="Khối lượng giảng dạy và chất lượng từng lớp trong tháng. Giáo viên, trợ giảng chỉ thấy lớp mình dạy." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Tháng" />
        <BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />
        {isFetching && <Spinner />}
      </div>
      {isPending || !data || !s ? (
        <Spinner label="Đang tải…" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Buổi đã dạy" value={s.sessionsDone} hint={`${s.teachingHours.toLocaleString('vi-VN')} giờ · ${s.sessionsCancelled} buổi huỷ`} />
            <Stat label="Tỉ lệ đi học" value={s.attendanceRate === null ? '—' : `${s.attendanceRate}%`} tone={s.attendanceRate !== null && s.attendanceRate < 85 ? 'warning' : 'default'} hint="Có mặt + đi muộn" />
            <Stat label="Tỉ lệ nhận xét" value={s.feedbackRate === null ? '—' : `${s.feedbackRate}%`} tone={s.feedbackRate !== null && s.feedbackRate < 80 ? 'warning' : 'default'} hint="Lượt có mặt được nhận xét" />
            <Stat label="Chưa chốt điểm danh" value={s.sessionsOverdue} tone={s.sessionsOverdue ? 'danger' : 'success'} hint="Buổi đã qua giờ học" />
          </div>
          <Tabs
            tabs={[
              { value: 'classes', label: `Lớp (${data.classes.length})`, content: <DataTable columns={classColumns} rows={data.classes} rowKey={(c) => c.classId} empty="Không có buổi học trong tháng" /> },
              { value: 'teachers', label: `Giáo viên (${data.teachers.length})`, content: <DataTable columns={teacherColumns} rows={data.teachers} rowKey={(t) => t.userId} empty="Không có buổi học trong tháng" /> },
            ]}
          />
        </>
      )}
    </>
  );
}
