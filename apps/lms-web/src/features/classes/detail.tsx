import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, FileText, MoreHorizontal, NotebookPen, Pencil, UserMinus, UserPlus, XCircle } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  BackLink,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  DropdownMenu,
  Field,
  Progress,
  Spinner,
  Stat,
  Tabs,
  Textarea,
  toast,
  type Column,
} from '@zero1/ui';
import { fileUrl, formatBytes, formatDate, formatDateTime, formatTime, formatWorkDate, toastError, useApi, usePermission, vnDay, WEEKDAY_SHORT } from '@zero1/web-core';
import { AssignmentFormDialog } from '../assignments/assignment-form';
import { CLASS_STATUS, lmsKeys, MEMBERSHIP_STATUS, SESSION_STATUS, teachingKeys } from '../labels';
import { ClassFormDialog } from './class-form';
import { PlaceDialog } from './place-dialog';

type ClassDetail = Schemas['ClassDetail'];
type Member = ClassDetail['learners'][number];
type SessionRow = ClassDetail['sessions'][number];

export default function ClassDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = usePermission('lms.classes.manage');
  const canPlace = usePermission('lms.classes.place');
  const canAssign = usePermission('lms.assignments.manage');
  const [dialog, setDialog] = useState<'edit' | 'place' | 'assign' | 'complete' | 'cancel' | null>(null);
  const [leaving, setLeaving] = useState<Member | null>(null);
  const [warnings, setWarnings] = useState<Array<{ kind: 'TEACHER' | 'ROOM'; classCode: string; startsAt: string }>>([]);

  const { data: c, error } = useQuery({
    queryKey: lmsKeys.class(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/classes/{id}', { params: { path: { id } } }))).data,
  });
  const refresh = () => teachingKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));

  const generate = useMutation({
    mutationFn: async () => (await unwrap(api.POST('/api/v1/lms/classes/{id}/generate-sessions', { params: { path: { id } }, body: {} }))).data,
    onSuccess: (res) => {
      toast.success(res.created ? `Đã sinh ${res.created} buổi học` : 'Lớp đã đủ buổi');
      setWarnings(res.warnings);
      refresh();
    },
    onError: toastError,
  });
  const setStatus = useMutation({
    mutationFn: async (status: 'ONGOING' | 'COMPLETED' | 'CANCELLED') => unwrap(api.PATCH('/api/v1/lms/classes/{id}', { params: { path: { id } }, body: { status } })),
    onSuccess: (_, status) => {
      toast.success(status === 'COMPLETED' ? 'Đã kết thúc lớp — học viên hoàn thành cấp độ' : 'Đã cập nhật trạng thái lớp');
      setDialog(null);
      refresh();
    },
    onError: toastError,
  });

  if (error) return <Alert tone="danger">Không tìm thấy lớp hoặc bạn không có quyền xem.</Alert>;
  if (!c) return <Spinner label="Đang tải…" />;

  const open = c.status === 'PLANNED' || c.status === 'ONGOING';
  const activeLearners = c.learners.filter((l) => l.status === 'ACTIVE' || l.status === 'PAUSED');
  const rates = c.learners.filter((l) => l.attendanceRate != null && l.status !== 'LEFT').map((l) => l.attendanceRate!);
  const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
  const validSessions = c.sessions.filter((s) => s.status !== 'CANCELLED');

  const learnerColumns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Học viên',
      cell: (l) => (
        <div>
          <Link to={`/learners/${l.learnerId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {l.fullName}
          </Link>
          <div className="font-mono text-xs text-muted-foreground">
            {l.code} · {l.enrollmentCode}
          </div>
        </div>
      ),
    },
    {
      key: 'rate',
      header: 'Đi học',
      cell: (l) =>
        l.attendanceRate == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex w-28 flex-col gap-1">
            <span className="text-xs tabular-nums">
              {l.attendanceRate}% · {l.attended}/{l.recorded}
            </span>
            <Progress value={l.attendanceRate} tone={l.attendanceRate < 70 ? 'danger' : l.attendanceRate < 85 ? 'warning' : 'success'} label="Tỉ lệ đi học" />
          </div>
        ),
    },
    {
      key: 'remaining',
      header: 'Còn buổi',
      align: 'right',
      cell: (l) => <span className={`tabular-nums ${l.sessionsRemaining <= 2 ? 'font-medium text-warning' : ''}`}>{l.sessionsRemaining}</span>,
    },
    { key: 'status', header: 'Trạng thái', cell: (l) => <Badge tone={MEMBERSHIP_STATUS[l.status].tone}>{MEMBERSHIP_STATUS[l.status].label}</Badge> },
    { key: 'joined', header: 'Vào lớp', className: 'hidden md:table-cell', cell: (l) => <span className="text-muted-foreground">{formatDate(l.joinedAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Thao tác</span>,
      align: 'right',
      cell: (l) =>
        canPlace && (l.status === 'ACTIVE' || l.status === 'PAUSED') ? (
          <Button variant="ghost" size="icon" aria-label={`Cho ${l.fullName} rời lớp`} onClick={() => setLeaving(l)}>
            <UserMinus />
          </Button>
        ) : null,
    },
  ];

  const sessionColumns: Column<SessionRow>[] = [
    { key: 'index', header: '#', className: 'w-12', cell: (s) => <span className="tabular-nums">{s.indexNo || '—'}</span> },
    {
      key: 'time',
      header: 'Thời gian',
      cell: (s) => (
        <div className={s.status === 'CANCELLED' ? 'line-through opacity-60' : ''}>
          <div className="capitalize">{formatWorkDate(vnDay(s.startsAt))}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
          </div>
        </div>
      ),
    },
    { key: 'topic', header: 'Chủ đề', className: 'hidden md:table-cell', cell: (s) => s.topic ?? <span className="text-muted-foreground">—</span> },
    {
      key: 'teacher',
      header: 'GV',
      className: 'hidden lg:table-cell',
      cell: (s) => (
        <span>
          {s.teacherName ?? '—'} {s.substitute && <Badge tone="warning">Dạy thay</Badge>}
        </span>
      ),
    },
    {
      key: 'att',
      header: 'Điểm danh',
      align: 'right',
      cell: (s) => (s.status === 'CANCELLED' ? null : <span className="tabular-nums">{s.attendanceCount}</span>),
    },
    { key: 'status', header: 'Trạng thái', cell: (s) => <Badge tone={SESSION_STATUS[s.status].tone}>{SESSION_STATUS[s.status].label}</Badge> },
  ];

  const menu = [
    ...(canManage && open ? [{ label: 'Sửa lớp', icon: Pencil, onSelect: () => setDialog('edit') }] : []),
    ...(canAssign && open ? [{ label: 'Giao bài tập', icon: NotebookPen, onSelect: () => setDialog('assign') }] : []),
    ...(canManage && c.status === 'ONGOING' ? [{ label: 'Kết thúc lớp', icon: CheckCircle2, separatorBefore: true, onSelect: () => setDialog('complete') }] : []),
    ...(canManage && c.status === 'PLANNED' ? [{ label: 'Huỷ lớp', icon: XCircle, tone: 'danger' as const, onSelect: () => setDialog('cancel') }] : []),
  ];

  return (
    <>
      <BackLink to="/classes" label="Lớp học" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.code}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.name} · {c.subjectName} / {c.levelName}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <Badge tone={CLASS_STATUS[c.status].tone}>{CLASS_STATUS[c.status].label}</Badge>
            <span>GV {c.teacherName ?? '—'}</span>
            {c.taName && <span className="text-muted-foreground">TA {c.taName}</span>}
            <span className="text-muted-foreground">{c.roomName ?? 'Chưa xếp phòng'}</span>
            <span className="text-muted-foreground">
              {c.schedule
                .slice()
                .sort((a, b) => a.weekday - b.weekday)
                .map((s) => `${WEEKDAY_SHORT[s.weekday]} ${s.startTime} (${s.minutes}′)`)
                .join(' · ')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
          {canManage && open && validSessions.length < c.totalSessions && (
            <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
              <CalendarPlus /> Sinh buổi học
            </Button>
          )}
          {canPlace && open && (
            <Button onClick={() => setDialog('place')}>
              <UserPlus /> Xếp học viên
            </Button>
          )}
          {menu.length > 0 && (
            <DropdownMenu
              trigger={
                <Button variant="outline" size="icon" aria-label="Thao tác khác">
                  <MoreHorizontal />
                </Button>
              }
              actions={menu}
            />
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <Alert tone="warning" className="mb-4" title={`${warnings.length} buổi trùng lịch`} action={<Button size="sm" variant="ghost" onClick={() => setWarnings([])}>Đóng</Button>}>
          <ul>
            {warnings.slice(0, 6).map((w, i) => (
              <li key={i}>
                {formatDateTime(w.startsAt)} — trùng {w.kind === 'ROOM' ? 'phòng' : 'giáo viên'} với lớp {w.classCode}
              </li>
            ))}
          </ul>
          <p className="mt-1">Mở từng buổi ở lịch học để dời hoặc đổi phòng / giáo viên.</p>
        </Alert>
      )}
      {open && validSessions.length < c.totalSessions && (
        <Alert tone="info" className="mb-4">
          Lớp mới có lịch {validSessions.length}/{c.totalSessions} buổi{canManage ? ' — bấm “Sinh buổi học” để tạo đủ.' : '.'}
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Tiến độ"
          value={`${c.sessionsDone}/${c.totalSessions}`}
          hint={<Progress value={c.totalSessions ? (c.sessionsDone / c.totalSessions) * 100 : 0} className="mt-1" label="Tiến độ lớp" />}
        />
        <Stat label="Sĩ số" value={`${activeLearners.length}/${c.capacity}`} tone={activeLearners.length >= c.capacity ? 'warning' : 'default'} hint={`Khai giảng ${formatDate(c.startDate)}`} />
        <Stat label="Tỉ lệ đi học" value={avgRate == null ? '—' : `${avgRate}%`} tone={avgRate == null ? 'default' : avgRate < 70 ? 'danger' : avgRate < 85 ? 'warning' : 'success'} hint="Có mặt + đi muộn / buổi đã chốt" />
        <Stat label="Buổi tới" value={<span className="text-base">{c.nextSessionAt ? formatDateTime(c.nextSessionAt) : '—'}</span>} />
      </div>

      <Tabs
        tabs={[
          {
            value: 'learners',
            label: `Học viên (${activeLearners.length})`,
            content: <DataTable columns={learnerColumns} rows={c.learners} rowKey={(l) => l.membershipId} empty="Chưa có học viên — bấm “Xếp học viên”" />,
          },
          {
            value: 'sessions',
            label: `Buổi học (${validSessions.length})`,
            content: <DataTable columns={sessionColumns} rows={c.sessions} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/sessions/${s.id}`)} empty="Chưa có buổi học" />,
          },
          { value: 'assignments', label: 'Bài tập', content: <ClassAssignments classId={c.id} /> },
          { value: 'materials', label: 'Học liệu', content: <ClassMaterials classId={c.id} /> },
        ]}
      />

      {dialog === 'edit' && <ClassFormDialog cls={c} onClose={() => setDialog(null)} />}
      {dialog === 'place' && <PlaceDialog cls={c} onClose={() => setDialog(null)} />}
      {dialog === 'assign' && <AssignmentFormDialog classId={c.id} sessions={validSessions} onClose={() => setDialog(null)} onSaved={(aid) => navigate(`/assignments/${aid}`)} />}
      <ConfirmDialog
        open={dialog === 'complete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Kết thúc lớp?"
        confirmLabel="Kết thúc lớp"
        pending={setStatus.isPending}
        onConfirm={() => setStatus.mutate('COMPLETED')}
      >
        {c.sessionsDone < c.totalSessions && <p className="mb-2 font-medium text-warning">Lớp mới học {c.sessionsDone}/{c.totalSessions} buổi.</p>}
        Học viên đang học được đánh dấu hoàn thành. Các buổi chưa học sẽ bị huỷ. Lên cấp độ mới ở hồ sơ từng học viên.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Huỷ lớp?"
        confirmLabel="Huỷ lớp"
        tone="danger"
        pending={setStatus.isPending}
        onConfirm={() => setStatus.mutate('CANCELLED')}
      >
        Lớp chưa khai giảng sẽ bị huỷ cùng toàn bộ buổi học. Học viên quay lại danh sách chờ xếp lớp.
      </ConfirmDialog>
      {leaving && <LeaveDialog member={leaving} onClose={() => setLeaving(null)} onDone={refresh} />}
    </>
  );
}

function LeaveDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: async () => unwrap(api.POST('/api/v1/lms/class-learners/{id}/leave', { params: { path: { id: member.membershipId } }, body: { reason: reason.trim() } })),
    onSuccess: () => {
      toast.success(`${member.fullName} đã rời lớp — quay lại danh sách chờ xếp lớp`);
      onDone();
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cho ${member.fullName} rời lớp`}
      description="Số buổi còn lại giữ nguyên. Chuyển lớp: xếp sang lớp mới ở hồ sơ học viên (tự rời lớp cũ)."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="danger" onClick={() => run.mutate()} disabled={reason.trim().length < 3 || run.isPending}>
            Rời lớp
          </Button>
        </>
      }
    >
      <Field label="Lý do" required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function ClassAssignments({ classId }: { classId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: [...lmsKeys.assignments, { classId }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/assignments', { params: { query: { classId } } }))).data,
  });
  if (!data) return <Spinner />;
  if (!data.length) return <Card className="p-6 text-sm text-muted-foreground">Chưa giao bài tập.</Card>;
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {data.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => navigate(`/assignments/${a.id}`)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50">
            <div className="min-w-0">
              <div className="font-medium">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.dueAt ? `Hạn ${formatDateTime(a.dueAt)}` : 'Không có hạn'}</div>
            </div>
            <div className="text-right text-xs tabular-nums">
              <div>
                Nộp {a.submittedCount + a.gradedCount}/{a.learnerCount}
              </div>
              <div className="text-muted-foreground">Đã chấm {a.gradedCount}</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ClassMaterials({ classId }: { classId: string }) {
  const api = useApi();
  const { data } = useQuery({
    queryKey: [...lmsKeys.materials, { classId }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/materials', { params: { query: { classId } } }))).data,
  });
  if (!data) return <Spinner />;
  if (!data.length) return <Card className="p-6 text-sm text-muted-foreground">Chưa có học liệu cho lớp / cấp độ này. Tải lên ở trang Học liệu.</Card>;
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {data.map((m) => (
        <li key={m.id}>
          <a href={fileUrl(m.url)} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 hover:bg-muted/50">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.title}</div>
              <div className="text-xs text-muted-foreground">
                {m.classId ? 'Riêng lớp' : `Cấp độ ${m.levelName ?? ''}`} · {formatBytes(m.size)}
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
