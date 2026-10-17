import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, GraduationCap, Star } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Alert, BackLink, Badge, Button, Card, CardContent, Dialog, Field, Progress, Select, Spinner, Stat, Tabs, Textarea, toast } from '@zero1/ui';
import { formatDate, formatDateTime, toastError, useApi, usePermission, vnDay } from '@zero1/web-core';
import { ChooseClassDialog } from '../placement/page';
import { ATTENDANCE, LEARNER_STATUS, lmsKeys, MEMBERSHIP_STATUS, RATING_CRITERIA, SUBMISSION_STATUS, teachingKeys, type AttendanceStatus, type RatingKey } from '../labels';
import { LearnerAvatar } from './page';

type Learner = Schemas['LearnerDetail'];

export default function LearnerDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const canPromote = usePermission('lms.learners.promote');
  const canPlace = usePermission('lms.classes.place');
  const [dialog, setDialog] = useState<'promote' | 'move' | null>(null);
  const { data: l, error } = useQuery({
    queryKey: lmsKeys.learner(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/learners/{id}', { params: { path: { id } } }))).data,
  });

  if (error) return <Alert tone="danger">Không tìm thấy học viên hoặc bạn không có quyền xem.</Alert>;
  if (!l) return <Spinner label="Đang tải…" />;

  const sum = l.attendanceSummary;
  const rate = sum.total ? Math.round(((sum.PRESENT + sum.LATE) / sum.total) * 100) : null;
  const graded = l.grades.filter((g) => g.score != null);
  const avgScore = graded.length ? graded.reduce((n, g) => n + (g.score! / g.maxScore) * 10, 0) / graded.length : null;
  const activeEnt = l.entitlements.find((e) => e.status === 'ACTIVE');

  return (
    <>
      <BackLink to="/learners" label="Học viên" />
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <LearnerAvatar name={l.fullName} url={l.avatarUrl} size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{l.fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{l.code}</span>
              <Badge tone={LEARNER_STATUS[l.status].tone}>{LEARNER_STATUS[l.status].label}</Badge>
              {l.currentLevelName && <Badge tone="brand">{l.currentLevelName}</Badge>}
              {l.birthDate && <span>· sinh {formatDate(l.birthDate)}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPlace && activeEnt && l.status === 'ACTIVE' && (
            <Button variant="outline" onClick={() => setDialog('move')}>
              <ArrowRightLeft /> {l.classes.some((c) => c.status === 'ACTIVE') ? 'Chuyển lớp' : 'Xếp lớp'}
            </Button>
          )}
          {canPromote && (
            <Button onClick={() => setDialog('promote')}>
              <GraduationCap /> Lên cấp độ
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Còn buổi" value={l.sessionsRemaining} tone={l.sessionsRemaining <= 2 ? 'warning' : 'default'} />
        <Stat
          label="Tỉ lệ đi học"
          value={rate == null ? '—' : `${rate}%`}
          tone={rate == null ? 'default' : rate < 70 ? 'danger' : rate < 85 ? 'warning' : 'success'}
          hint={`${sum.PRESENT} có mặt · ${sum.LATE} muộn · ${sum.ABSENT} vắng · ${sum.EXCUSED} phép`}
        />
        <Stat label="Điểm TB (thang 10)" value={avgScore == null ? '—' : avgScore.toFixed(1)} hint={`${graded.length} bài đã chấm`} />
        <Stat label="Nhận xét" value={l.feedback.length} />
      </div>

      <Tabs
        tabs={[
          {
            value: 'attendance',
            label: 'Điểm danh',
            content: !l.attendance.length ? (
              <Card className="p-6 text-sm text-muted-foreground">Chưa có buổi điểm danh.</Card>
            ) : (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {l.attendance.map((a) => {
                  const st = ATTENDANCE[a.status as AttendanceStatus];
                  return (
                    <li key={a.sessionId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <Link to={`/sessions/${a.sessionId}`} className="hover:underline">
                        {a.classCode} · buổi {a.indexNo} <span className="text-muted-foreground">· {formatDate(vnDay(a.startsAt))}</span>
                      </Link>
                      <div className="flex items-center gap-2">
                        {a.note && <span className="hidden text-xs text-muted-foreground sm:inline">{a.note}</span>}
                        <Badge tone={st?.tone}>{st?.label ?? a.status}</Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ),
          },
          {
            value: 'grades',
            label: 'Bài tập',
            content: !l.grades.length ? (
              <Card className="p-6 text-sm text-muted-foreground">Chưa có bài tập.</Card>
            ) : (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {l.grades.map((g) => (
                  <li key={g.assignmentId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <Link to={`/assignments/${g.assignmentId}`} className="min-w-0 hover:underline">
                      <div className="truncate font-medium">{g.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {g.classCode}
                        {g.comment && ` · ${g.comment}`}
                      </div>
                    </Link>
                    {g.score != null ? (
                      <span className="font-semibold tabular-nums">
                        {g.score}/{g.maxScore}
                      </span>
                    ) : (
                      <Badge tone={SUBMISSION_STATUS[g.status as keyof typeof SUBMISSION_STATUS]?.tone}>{SUBMISSION_STATUS[g.status as keyof typeof SUBMISSION_STATUS]?.label ?? g.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ),
          },
          {
            value: 'feedback',
            label: 'Nhận xét',
            content: !l.feedback.length ? (
              <Card className="p-6 text-sm text-muted-foreground">Chưa có nhận xét.</Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {l.feedback.map((f) => (
                  <Card key={f.sessionId} className="p-3">
                    <div className="mb-1 text-xs text-muted-foreground">
                      {f.classCode} · {formatDateTime(f.startsAt)}
                    </div>
                    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
                      {(Object.keys(RATING_CRITERIA) as RatingKey[])
                        .filter((k) => f.ratings[k])
                        .map((k) => (
                          <span key={k} className="inline-flex items-center gap-1 text-xs">
                            {RATING_CRITERIA[k]} <Star className="size-3 fill-amber-400 text-amber-400" />
                            {f.ratings[k]}
                          </span>
                        ))}
                    </div>
                    <p className="text-sm whitespace-pre-line">{f.comment}</p>
                  </Card>
                ))}
              </div>
            ),
          },
          {
            value: 'study',
            label: 'Lớp & đăng ký',
            content: (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardContent className="pt-5">
                    <h3 className="mb-3 font-semibold">Đăng ký (từ CRM)</h3>
                    <ul className="flex flex-col gap-3">
                      {l.entitlements.map((e) => (
                        <li key={e.enrollmentId} className="text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-mono">{e.enrollmentCode}</span>
                            <Badge tone={e.status === 'ACTIVE' ? 'success' : e.status === 'LOCKED' ? 'danger' : 'neutral'}>
                              {e.status === 'ACTIVE' ? 'Còn hiệu lực' : e.status === 'LOCKED' ? 'Đã khoá' : 'Hết buổi'}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="tabular-nums">
                              {e.sessionsUsed}/{e.sessionsPurchased} buổi
                            </span>
                            <Progress value={e.sessionsPurchased ? (e.sessionsUsed / e.sessionsPurchased) * 100 : 0} className="flex-1" label="Đã học" />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Bắt đầu {e.startLevelName ?? '—'} · kích hoạt {formatDate(e.activatedAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <h3 className="mb-3 font-semibold">Lớp đã học</h3>
                    <ul className="flex flex-col gap-2 text-sm">
                      {l.memberships.map((m) => (
                        <li key={m.id} className="flex items-start justify-between gap-2">
                          <div>
                            <Link to={`/classes/${m.classId}`} className="font-medium hover:underline">
                              {m.classCode}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(m.joinedAt)} – {m.leftAt ? formatDate(m.leftAt) : 'nay'}
                              {m.leftReason && ` · ${m.leftReason}`}
                            </div>
                          </div>
                          <Badge tone={MEMBERSHIP_STATUS[m.status as keyof typeof MEMBERSHIP_STATUS]?.tone}>
                            {MEMBERSHIP_STATUS[m.status as keyof typeof MEMBERSHIP_STATUS]?.label ?? m.status}
                          </Badge>
                        </li>
                      ))}
                      {!l.memberships.length && <li className="text-muted-foreground">Chưa xếp lớp.</li>}
                    </ul>
                    <h3 className="mt-5 mb-2 font-semibold">Lịch sử cấp độ</h3>
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {l.levelHistory.map((h, i) => (
                        <li key={i}>
                          {h.fromLevelName ?? '—'} → <strong>{h.toLevelName}</strong>
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            · {formatDate(h.createdAt)}
                            {h.note && ` · ${h.note}`}
                          </span>
                        </li>
                      ))}
                      {!l.levelHistory.length && <li className="text-muted-foreground">Chưa lên cấp độ.</li>}
                    </ul>
                  </CardContent>
                </Card>
              </div>
            ),
          },
        ]}
      />

      {dialog === 'promote' && <PromoteDialog l={l} onClose={() => setDialog(null)} />}
      {dialog === 'move' && activeEnt && (
        <ChooseClassDialog
          w={{ learnerId: l.id, enrollmentId: activeEnt.enrollmentId, fullName: l.fullName, branchId: l.branchId, subjectId: activeEnt.subjectId, startLevelId: l.currentLevelId ?? activeEnt.startLevelId }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function PromoteDialog({ l, onClose }: { l: Learner; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [toLevelId, setToLevelId] = useState('');
  const [note, setNote] = useState('');
  const { data: subjects = [] } = useQuery({
    queryKey: [...lmsKeys.subjects, { includeInactive: false }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/subjects', { params: { query: { includeInactive: false } } }))).data,
  });
  const subject = subjects.find((s) => s.levels.some((lv) => lv.id === l.currentLevelId));
  const levels = (subject?.levels ?? subjects.flatMap((s) => s.levels)).filter((lv) => lv.isActive && lv.id !== l.currentLevelId);
  const currentIndex = subject?.levels.findIndex((lv) => lv.id === l.currentLevelId) ?? -1;
  const next = currentIndex >= 0 ? subject?.levels[currentIndex + 1] : undefined;
  const chosen = toLevelId || next?.id || '';
  const promote = useMutation({
    mutationFn: async () => unwrap(api.POST('/api/v1/lms/learners/{id}/promote', { params: { path: { id: l.id } }, body: { toLevelId: chosen, note: note.trim() || null } })),
    onSuccess: () => {
      toast.success('Đã lên cấp độ — CRM được cập nhật');
      teachingKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Lên cấp độ — ${l.fullName}`}
      description={`Hiện tại: ${l.currentLevelName ?? 'chưa có'}. Sau khi lên cấp, xếp học viên vào lớp của cấp độ mới.`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => promote.mutate()} disabled={!chosen || promote.isPending}>
            Lên cấp
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Cấp độ mới" required hint={next ? `Cấp tiếp theo: ${next.name}` : undefined}>
          <Select value={chosen} onChange={(e) => setToLevelId(e.target.value)}>
            <option value="">— Chọn cấp độ —</option>
            {levels.map((lv) => (
              <option key={lv.id} value={lv.id}>
                {lv.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kết quả cuối khoá…" />
        </Field>
      </div>
    </Dialog>
  );
}
