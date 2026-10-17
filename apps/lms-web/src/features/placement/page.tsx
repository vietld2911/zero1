import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { unwrap, type ApiData } from '@zero1/api-client';
import { Badge, Button, Card, DataTable, Dialog, PageHeader, Spinner, Stat, toast, type Column } from '@zero1/ui';
import { BranchSelect, formatDate, toastError, useApi, WEEKDAY_SHORT } from '@zero1/web-core';
import { lmsKeys, teachingKeys } from '../labels';

type Waiting = ApiData<'/api/v1/lms/placement'>[number];

export default function PlacementPage() {
  const api = useApi();
  const [branchId, setBranchId] = useState('');
  const [placing, setPlacing] = useState<Waiting | null>(null);
  const [now] = useState(() => Date.now());
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.placement, branchId],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/placement', { params: { query: { branchId: branchId || undefined } } }))).data,
  });
  const days = (iso: string) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  const long = (data ?? []).filter((w) => days(w.waitingSince) >= 14).length;

  const columns: Column<Waiting>[] = [
    {
      key: 'name',
      header: 'Học viên',
      cell: (w) => (
        <div>
          <Link to={`/learners/${w.learnerId}`} className="font-medium hover:underline">
            {w.fullName}
          </Link>
          <div className="font-mono text-xs text-muted-foreground">
            {w.learnerCode} · {w.enrollmentCode}
          </div>
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Môn / cấp độ',
      cell: (w) => (
        <div className="text-sm">
          <div>{w.subjectName}</div>
          <div className="text-xs text-muted-foreground">Bắt đầu {w.startLevelName}</div>
        </div>
      ),
    },
    { key: 'sessions', header: 'Buổi', align: 'right', cell: (w) => <span className="tabular-nums">{w.sessionsRemaining}</span> },
    {
      key: 'waiting',
      header: 'Chờ',
      cell: (w) => {
        const d = days(w.waitingSince);
        return (
          <Badge tone={d >= 14 ? 'danger' : d >= 7 ? 'warning' : 'neutral'} title={formatDate(w.waitingSince)}>
            {d} ngày
          </Badge>
        );
      },
    },
    {
      key: 'action',
      header: <span className="sr-only">Xếp lớp</span>,
      align: 'right',
      cell: (w) => (
        <Button size="sm" onClick={() => setPlacing(w)}>
          <UserPlus /> Xếp lớp
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Chờ xếp lớp" description="Học viên đã đóng tiền bên CRM nhưng chưa có lớp của môn đăng ký." actions={<BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label="Đang chờ" value={data?.length ?? '—'} />
        <Stat label="Chờ ≥ 14 ngày" value={long} tone={long ? 'danger' : 'default'} />
      </div>
      <DataTable columns={columns} rows={data} rowKey={(w) => w.enrollmentId} loading={isFetching} empty="Không có học viên chờ xếp lớp" />
      {placing && <ChooseClassDialog w={placing} onClose={() => setPlacing(null)} />}
    </>
  );
}

/** Chọn lớp cùng môn, cùng chi nhánh còn chỗ. Lớp đúng cấp độ bắt đầu lên đầu. */
export function ChooseClassDialog({ w, onClose }: { w: { learnerId: string; enrollmentId: string; fullName: string; branchId: string; subjectId: string; startLevelId: string }; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [classId, setClassId] = useState('');
  const { data, isPending } = useQuery({
    queryKey: [...lmsKeys.classes, 'list', { status: 'PLANNED,ONGOING', branchId: w.branchId }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/classes', { params: { query: { status: 'PLANNED,ONGOING', branchId: w.branchId } } }))).data,
  });
  const options = (data ?? [])
    .filter((c) => c.subjectId === w.subjectId)
    .sort((a, b) => Number(b.levelId === w.startLevelId) - Number(a.levelId === w.startLevelId) || a.startDate.localeCompare(b.startDate));
  const place = useMutation({
    mutationFn: async () => (await unwrap(api.POST('/api/v1/lms/classes/{id}/learners', { params: { path: { id: classId } }, body: { learnerId: w.learnerId, enrollmentId: w.enrollmentId } }))).data,
    onSuccess: (res) => {
      toast.success(res.fromClassId ? 'Đã chuyển lớp' : 'Đã xếp lớp');
      teachingKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      onClose();
    },
    onError: toastError,
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Xếp lớp — ${w.fullName}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => place.mutate()} disabled={!classId || place.isPending}>
            Xếp vào lớp
          </Button>
        </>
      }
    >
      {isPending ? (
        <Spinner label="Đang tải…" />
      ) : !options.length ? (
        <Card className="p-4 text-sm text-muted-foreground">Chưa có lớp đang mở của môn này tại chi nhánh. Tạo lớp ở trang “Lớp học”.</Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((c) => {
            const full = c.learnerCount >= c.capacity;
            return (
              <button
                key={c.id}
                type="button"
                disabled={full}
                onClick={() => setClassId(c.id)}
                className={`rounded-md border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  classId === c.id ? 'border-cyan-brand bg-cyan-brand-soft' : 'border-border hover:border-navy-300'
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{c.code}</span>
                  <Badge tone={c.levelId === w.startLevelId ? 'success' : 'neutral'}>{c.levelName}</Badge>
                </div>
                <div className="text-muted-foreground">
                  {c.schedule
                    .slice()
                    .sort((a, b) => a.weekday - b.weekday)
                    .map((s) => `${WEEKDAY_SHORT[s.weekday]} ${s.startTime}`)
                    .join(', ')}
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>GV {c.teacherName ?? '—'}</span>
                  <span className={full ? 'text-danger' : ''}>
                    {c.learnerCount}/{c.capacity} · buổi {c.sessionsDone}/{c.totalSessions}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
