import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, CheckCheck, Lock, MoreHorizontal, Save, Star, StickyNote } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  BackLink,
  Badge,
  Button,
  Card,
  cn,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  Field,
  Input,
  Select,
  Spinner,
  Tabs,
  Textarea,
  toast,
} from '@zero1/ui';
import { errorMessage, fileUrl, formatDate, formatTime, formatWeekday, fromVnInput, toastError, toVnInput, useApi, usePermission, useStaffOptions, vnDay } from '@zero1/web-core';
import { ATTENDANCE, lmsKeys, RATING_CRITERIA, SESSION_STATUS, TA_ROLES, TEACHER_ROLES, teachingKeys, type AttendanceStatus, type RatingKey } from '../labels';

type Session = Schemas['ClassSessionDetail'];

export default function SessionPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const canReschedule = usePermission('lms.sessions.reschedule');
  const canRecord = usePermission('lms.attendance.record');
  const canFeedback = usePermission('lms.feedback.write');
  const [dialog, setDialog] = useState<'move' | 'cancel' | 'note' | null>(null);
  const [now] = useState(() => Date.now());

  const { data: s, error } = useQuery({
    queryKey: lmsKeys.session(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/sessions/{id}', { params: { path: { id } } }))).data,
  });
  const refresh = () => teachingKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));

  if (error) return <Alert tone="danger">Không tìm thấy buổi học hoặc bạn không có quyền xem.</Alert>;
  if (!s) return <Spinner label="Đang tải…" />;

  const day = vnDay(s.startsAt);
  const cancelled = s.status === 'CANCELLED';
  const menu = [
    ...((canRecord || canReschedule) && !cancelled ? [{ label: 'Chủ đề / ghi chú buổi', icon: StickyNote, onSelect: () => setDialog('note') }] : []),
    ...(canReschedule && s.status === 'SCHEDULED' ? [{ label: 'Dời buổi / dạy thay', icon: CalendarClock, onSelect: () => setDialog('move') }] : []),
    ...(canReschedule && s.status === 'SCHEDULED' ? [{ label: 'Huỷ buổi', icon: Ban, tone: 'danger' as const, separatorBefore: true, onSelect: () => setDialog('cancel') }] : []),
  ];

  return (
    <>
      <BackLink to="/schedule" label="Lịch học" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            <Link to={`/classes/${s.classId}`} className="hover:underline">
              {s.classCode}
            </Link>{' '}
            · Buổi {s.indexNo}/{s.totalSessions}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="capitalize">{formatWeekday(day)}</span>, {formatDate(day)} · {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
            {s.roomName && ` · ${s.roomName}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={SESSION_STATUS[s.status].tone}>{SESSION_STATUS[s.status].label}</Badge>
            <span>GV {s.teacherName ?? '—'}</span>
            {s.substitute && <Badge tone="warning">Dạy thay</Badge>}
            {s.taName && <span className="text-muted-foreground">· TA {s.taName}</span>}
          </div>
          {s.topic && <p className="mt-2 text-sm">Chủ đề: {s.topic}</p>}
        </div>
        {menu.length > 0 && (
          <DropdownMenu
            trigger={
              <Button variant="outline">
                <MoreHorizontal /> Thao tác
              </Button>
            }
            actions={menu}
          />
        )}
      </div>

      {cancelled && (
        <Alert tone="info" className="mb-4" title="Buổi đã huỷ">
          {s.cancelReason}
        </Alert>
      )}
      {s.teacherNote && (
        <Alert tone="info" className="mb-4" title="Ghi chú của giáo viên">
          {s.teacherNote}
        </Alert>
      )}

      {!cancelled && (
        <Tabs
          tabs={[
            { value: 'attendance', label: `Điểm danh (${s.attendanceCount}/${s.learnerCount})`, content: <AttendanceSheet s={s} now={now} canRecord={canRecord} onSaved={refresh} /> },
            { value: 'feedback', label: 'Nhận xét', hidden: !canFeedback && !s.learners.some((l) => l.feedback), content: <FeedbackSheet s={s} canWrite={canFeedback} onSaved={refresh} /> },
            { value: 'trial', label: `Học thử (${s.trialGuests.length})`, hidden: !s.trialGuests.length, content: <TrialGuests s={s} canRecord={canRecord} onSaved={refresh} /> },
          ]}
        />
      )}

      {dialog === 'move' && <MoveDialog s={s} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'note' && <NoteDialog s={s} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'cancel' && <CancelDialog s={s} onClose={() => setDialog(null)} onSaved={refresh} />}
    </>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) return <img src={fileUrl(url)} alt="" className="size-9 shrink-0 rounded-full object-cover" />;
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-100 text-sm font-semibold text-navy-700" aria-hidden>
      {name.trim().split(/\s+/).pop()?.[0]?.toUpperCase()}
    </span>
  );
}

function AttendanceSheet({ s, now, canRecord, onSaved }: { s: Session; now: number; canRecord: boolean; onSaved: () => void }) {
  const api = useApi();
  const canCorrect = usePermission('lms.attendance.correct');
  const done = s.status === 'DONE';
  const editable = canRecord && (!done || canCorrect);
  const tooEarly = new Date(s.startsAt).getTime() - now > 60 * 60_000;
  const [marks, setMarks] = useState<Record<string, { status?: AttendanceStatus; note: string }>>(() =>
    Object.fromEntries(s.learners.map((l) => [l.learnerId, { status: l.attendance?.status, note: l.attendance?.note ?? '' }])),
  );
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const active = s.learners.filter((l) => l.membershipStatus === 'ACTIVE' || l.attendance);
  const marked = active.filter((l) => marks[l.learnerId]?.status).length;

  const save = useMutation({
    mutationFn: async (finalize: boolean) => {
      const records = Object.entries(marks)
        .filter(([, m]) => m.status)
        .map(([learnerId, m]) => ({ learnerId, status: m.status!, note: m.note.trim() || null }));
      return (await unwrap(api.POST('/api/v1/lms/sessions/{id}/attendance', { params: { path: { id: s.id } }, body: { records, finalize } }))).data;
    },
    onSuccess: (res, finalize) => {
      setConfirming(false);
      toast.success(finalize && !done ? 'Đã chốt buổi — số buổi đã trừ bên CRM' : res.finalized ? 'Đã lưu sửa điểm danh' : 'Đã lưu nháp');
      onSaved();
    },
    onError: (err) => toast.error(err instanceof ApiError && err.detail ? `${err.title}: ${err.detail}` : errorMessage(err)),
  });

  const set = (learnerId: string, patch: Partial<{ status: AttendanceStatus; note: string }>) =>
    setMarks((m) => ({ ...m, [learnerId]: { note: '', ...m[learnerId], ...patch } }));

  const canFinalize = canRecord && !done && !tooEarly && s.status === 'SCHEDULED';
  if (!s.learners.length) {
    return (
      <Card className="flex flex-col gap-3 p-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Không có học viên nào trong buổi này.</span>
        {canFinalize && (
          <Button variant="outline" onClick={() => save.mutate(true)} disabled={save.isPending}>
            <Lock /> Chốt buổi không có học viên
          </Button>
        )}
      </Card>
    );
  }

  // Tóm tắt trước khi chốt: chốt xong GV không tự sửa được.
  const tally = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 } as Record<AttendanceStatus, number>;
  for (const l of active) {
    const st = marks[l.learnerId]?.status;
    if (st) tally[st]++;
  }
  const charged = (Object.keys(tally) as AttendanceStatus[]).filter((st) => s.consumingStatuses.includes(st)).reduce((n, st) => n + tally[st], 0);

  return (
    <div className="flex flex-col gap-3">
      {done && (
        <Alert tone={canCorrect ? 'info' : 'success'} title="Buổi đã chốt">
          {canCorrect ? 'Bạn có thể sửa điểm danh — CRM được báo để trả / trừ lại buổi.' : 'Cần TL / CM để sửa điểm danh.'}
        </Alert>
      )}
      {!done && tooEarly && <Alert tone="info">Điểm danh mở từ 1 giờ trước giờ học ({formatTime(s.startsAt)}).</Alert>}

      {editable && !tooEarly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            Đã điểm danh <strong className="text-foreground">{marked}</strong>/{active.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMarks((m) => Object.fromEntries(active.map((l) => [l.learnerId, { note: '', ...m[l.learnerId], status: m[l.learnerId]?.status ?? 'PRESENT' }])))}
          >
            <CheckCheck /> Còn lại có mặt
          </Button>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
        {s.learners.map((l) => {
          const m = marks[l.learnerId];
          const inactive = l.membershipStatus !== 'ACTIVE' && !l.attendance;
          return (
            <li key={l.learnerId} className={cn('flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between', inactive && 'opacity-60')}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={l.fullName} url={l.avatarUrl} />
                <div className="min-w-0">
                  <Link to={`/learners/${l.learnerId}`} className="block truncate font-medium hover:underline">
                    {l.fullName}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={l.sessionsRemaining <= 2 ? 'font-medium text-warning' : ''}>còn {l.sessionsRemaining} buổi</span>
                    {inactive && <Badge>{l.membershipStatus === 'PAUSED' ? 'Bảo lưu' : 'Đã rời lớp'}</Badge>}
                    {l.attendance?.consumesSession && <Badge tone="neutral">Đã trừ buổi</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="grid flex-1 grid-cols-4 gap-1.5 sm:flex-none" role="radiogroup" aria-label={`Điểm danh ${l.fullName}`}>
                  {(Object.keys(ATTENDANCE) as AttendanceStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="radio"
                      aria-checked={m?.status === st}
                      disabled={!editable || tooEarly || inactive}
                      onClick={() => set(l.learnerId, { status: st })}
                      title={ATTENDANCE[st].label}
                      className={cn(
                        'h-10 min-w-14 rounded-md border px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed sm:h-9',
                        m?.status === st ? ATTENDANCE[st].active : 'border-border bg-surface text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {ATTENDANCE[st].short}
                    </button>
                  ))}
                </div>
                {editable && !tooEarly && !inactive && (
                  <Button variant="ghost" size="icon" aria-label="Ghi chú" onClick={() => setNoteOpen(noteOpen === l.learnerId ? null : l.learnerId)} className={m?.note ? 'text-info' : ''}>
                    <StickyNote />
                  </Button>
                )}
              </div>
              {noteOpen === l.learnerId && (
                <Input
                  autoFocus
                  value={m?.note ?? ''}
                  onChange={(e) => set(l.learnerId, { note: e.target.value })}
                  placeholder="Lý do vắng, đi muộn…"
                  className="sm:basis-full"
                  aria-label={`Ghi chú cho ${l.fullName}`}
                />
              )}
              {noteOpen !== l.learnerId && m?.note && <p className="text-xs text-muted-foreground sm:basis-full">{m.note}</p>}
            </li>
          );
        })}
      </ul>

      {editable && !tooEarly && (
        <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
          {done ? (
            <Button onClick={() => save.mutate(false)} disabled={save.isPending}>
              <Save /> Lưu sửa điểm danh
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending || !marked}>
                <Save /> Lưu nháp
              </Button>
              <Button onClick={() => setConfirming(true)} disabled={save.isPending || marked < active.length}>
                <Lock /> Chốt buổi ({marked}/{active.length})
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Chốt điểm danh buổi này?" confirmLabel="Chốt buổi" pending={save.isPending} onConfirm={() => save.mutate(true)}>
        <p>
          {(Object.keys(ATTENDANCE) as AttendanceStatus[])
            .filter((st) => tally[st])
            .map((st) => `${ATTENDANCE[st].label}: ${tally[st]}`)
            .join(' · ')}
        </p>
        <p className="mt-2">
          <strong className="text-foreground">{charged} học viên sẽ bị trừ 1 buổi.</strong> Sau khi chốt, muốn sửa phải nhờ TL / CM.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function Stars({ value, onChange, label, disabled }: { value?: number; onChange: (v: number) => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} sao`}
            disabled={disabled}
            onClick={() => onChange(n)}
            className="p-0.5 disabled:cursor-default"
          >
            <Star className={cn('size-5', value && n <= value ? 'fill-amber-400 text-amber-400' : 'text-navy-200')} />
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedbackSheet({ s, canWrite, onSaved }: { s: Session; canWrite: boolean; onSaved: () => void }) {
  const api = useApi();
  const learners = s.learners.filter((l) => l.attendance?.status !== 'ABSENT' && l.attendance?.status !== 'EXCUSED' && (l.membershipStatus === 'ACTIVE' || l.attendance));
  const [drafts, setDrafts] = useState<Record<string, { ratings: Partial<Record<RatingKey, number>>; comment: string; dirty: boolean }>>(() =>
    Object.fromEntries(s.learners.map((l) => [l.learnerId, { ratings: l.feedback?.ratings ?? {}, comment: l.feedback?.comment ?? '', dirty: false }])),
  );
  const dirty = Object.entries(drafts).filter(([, d]) => d.dirty && d.comment.trim().length >= 3);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        api.POST('/api/v1/lms/sessions/{id}/feedback', {
          params: { path: { id: s.id } },
          body: { items: dirty.map(([learnerId, d]) => ({ learnerId, ratings: d.ratings, comment: d.comment.trim() })) },
        }),
      ),
    onSuccess: () => {
      toast.success(`Đã lưu ${dirty.length} nhận xét`);
      setDrafts((all) => Object.fromEntries(Object.entries(all).map(([k, d]) => [k, { ...d, dirty: false }])));
      onSaved();
    },
    onError: toastError,
  });
  const update = (id: string, patch: Partial<{ ratings: Partial<Record<RatingKey, number>>; comment: string }>) =>
    setDrafts((all) => ({ ...all, [id]: { ...all[id]!, ...patch, dirty: true } }));

  if (!learners.length) return <Card className="p-6 text-sm text-muted-foreground">Chưa có học viên có mặt để nhận xét.</Card>;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {learners.map((l) => {
          const d = drafts[l.learnerId]!;
          return (
            <Card key={l.learnerId} className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <Avatar name={l.fullName} url={l.avatarUrl} />
                <span className="font-medium">{l.fullName}</span>
                {l.feedback && !d.dirty && <Badge tone="success">Đã nhận xét</Badge>}
              </div>
              <div className="grid gap-1 sm:grid-cols-2 sm:gap-x-4">
                {(Object.keys(RATING_CRITERIA) as RatingKey[]).map((k) => (
                  <Stars key={k} label={RATING_CRITERIA[k]} value={d.ratings[k]} disabled={!canWrite} onChange={(v) => update(l.learnerId, { ratings: { ...d.ratings, [k]: v } })} />
                ))}
              </div>
              <Textarea
                rows={2}
                value={d.comment}
                readOnly={!canWrite}
                onChange={(e) => update(l.learnerId, { comment: e.target.value })}
                placeholder="Bé học thế nào hôm nay…"
                aria-label={`Nhận xét ${l.fullName}`}
              />
            </Card>
          );
        })}
      </div>
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={!dirty.length || save.isPending}>
            <Save /> Lưu nhận xét{dirty.length ? ` (${dirty.length})` : ''}
          </Button>
        </div>
      )}
    </div>
  );
}

function TrialGuests({ s, canRecord, onSaved }: { s: Session; canRecord: boolean; onSaved: () => void }) {
  const api = useApi();
  const check = useMutation({
    mutationFn: async ({ id, result }: { id: string; result: 'ATTENDED' | 'NO_SHOW' }) =>
      unwrap(api.POST('/api/v1/lms/trial-guests/{id}/check', { params: { path: { id } }, body: { result } })),
    onSuccess: () => (toast.success('Đã ghi — CRM được cập nhật'), onSaved()),
    onError: toastError,
  });
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {s.trialGuests.map((g) => (
        <li key={g.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">
              {g.childName} {g.birthYear && <span className="text-sm font-normal text-muted-foreground">({g.birthYear})</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {g.parentName} ·{' '}
              <a href={`tel:${g.parentPhone}`} className="text-info">
                {g.parentPhone}
              </a>
            </div>
          </div>
          {g.result === 'PENDING' && canRecord ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => check.mutate({ id: g.id, result: 'NO_SHOW' })} disabled={check.isPending}>
                Không đến
              </Button>
              <Button onClick={() => check.mutate({ id: g.id, result: 'ATTENDED' })} disabled={check.isPending}>
                Đã đến
              </Button>
            </div>
          ) : (
            <Badge tone={g.result === 'ATTENDED' ? 'success' : g.result === 'NO_SHOW' ? 'danger' : 'info'}>
              {g.result === 'ATTENDED' ? 'Đã đến' : g.result === 'NO_SHOW' ? 'Không đến' : 'Chờ'}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function MoveDialog({ s, onClose, onSaved }: { s: Session; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const { data: teachers = [] } = useStaffOptions(TEACHER_ROLES, s.branchId);
  const { data: tas = [] } = useStaffOptions(TA_ROLES, s.branchId);
  const { data: rooms = [] } = useQuery({
    queryKey: [...lmsKeys.rooms, s.branchId],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/rooms', { params: { query: { branchId: s.branchId } } }))).data,
  });
  const [startsAt, setStartsAt] = useState(toVnInput(s.startsAt));
  const [endsAt, setEndsAt] = useState(toVnInput(s.endsAt));
  const [teacherId, setTeacherId] = useState(s.teacherId);
  const [taId, setTaId] = useState(s.taId ?? '');
  const [roomId, setRoomId] = useState(s.roomId ?? '');
  const [conflict, setConflict] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (force: boolean) =>
      unwrap(
        api.PATCH('/api/v1/lms/sessions/{id}', {
          params: { path: { id: s.id } },
          body: { startsAt: fromVnInput(startsAt), endsAt: fromVnInput(endsAt), teacherId, taId: taId || null, roomId: roomId || null, force },
        }),
      ),
    onSuccess: () => {
      toast.success('Đã cập nhật buổi học');
      onSaved();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SCHEDULE_CONFLICT') setConflict(err.detail ?? err.title);
      else toastError(err);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Dời buổi / dạy thay"
      description="Chỉ áp dụng cho buổi này. Đổi lịch cả lớp ở trang lớp học."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          {conflict ? (
            <Button variant="danger" onClick={() => save.mutate(true)} disabled={save.isPending}>
              Vẫn lưu
            </Button>
          ) : (
            <Button onClick={() => save.mutate(false)} disabled={!startsAt || !endsAt || save.isPending}>
              Lưu
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {conflict && (
          <Alert tone="warning" className="sm:col-span-2" title="Trùng lịch">
            {conflict}
          </Alert>
        )}
        <Field label="Bắt đầu">
          <Input type="datetime-local" value={startsAt} onChange={(e) => (setStartsAt(e.target.value), setConflict(null))} />
        </Field>
        <Field label="Kết thúc">
          <Input type="datetime-local" value={endsAt} onChange={(e) => (setEndsAt(e.target.value), setConflict(null))} />
        </Field>
        <Field label="Giáo viên">
          <Select value={teacherId} onChange={(e) => (setTeacherId(e.target.value), setConflict(null))}>
            {!teachers.some((t) => t.id === teacherId) && <option value={teacherId}>{s.teacherName}</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trợ giảng">
          <Select value={taId} onChange={(e) => setTaId(e.target.value)}>
            <option value="">— Không —</option>
            {tas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phòng" className="sm:col-span-2">
          <Select value={roomId} onChange={(e) => (setRoomId(e.target.value), setConflict(null))}>
            <option value="">— Không —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.capacity} chỗ)
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function NoteDialog({ s, onClose, onSaved }: { s: Session; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const [topic, setTopic] = useState(s.topic ?? '');
  const [note, setNote] = useState(s.teacherNote ?? '');
  const save = useMutation({
    mutationFn: async () =>
      unwrap(api.PATCH('/api/v1/lms/sessions/{id}', { params: { path: { id: s.id } }, body: { topic: topic.trim() || null, teacherNote: note.trim() || null } })),
    onSuccess: () => (toast.success('Đã lưu'), onSaved(), onClose()),
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Chủ đề & ghi chú buổi"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Chủ đề">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Bài 5: Cảm biến ánh sáng" />
        </Field>
        <Field label="Ghi chú">
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nội dung đã dạy, việc cần chuẩn bị buổi sau…" />
        </Field>
      </div>
    </Dialog>
  );
}

function CancelDialog({ s, onClose, onSaved }: { s: Session; onClose: () => void; onSaved: () => void }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: async () => unwrap(api.POST('/api/v1/lms/sessions/{id}/cancel', { params: { path: { id: s.id } }, body: { reason: reason.trim() } })),
    onSuccess: () => (toast.success('Đã huỷ buổi — vào trang lớp để sinh buổi bù'), onSaved(), onClose()),
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Huỷ buổi học"
      description={s.trialGuests.length ? `${s.trialGuests.length} khách học thử sẽ được báo về CRM để đặt lại.` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button variant="danger" onClick={() => run.mutate()} disabled={reason.trim().length < 3 || run.isPending}>
            Huỷ buổi
          </Button>
        </>
      }
    >
      <Field label="Lý do" required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nghỉ lễ, giáo viên ốm…" />
      </Field>
    </Dialog>
  );
}
