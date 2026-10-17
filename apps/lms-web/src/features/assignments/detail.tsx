import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Pencil, Save, Trash2 } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Alert, BackLink, Badge, Button, Card, ConfirmDialog, Input, PageHeader, Select, Spinner, toast } from '@zero1/ui';
import { fileUrl, formatBytes, formatDateTime, toastError, useApi, usePermission } from '@zero1/web-core';
import { lmsKeys, SUBMISSION_STATUS } from '../labels';
import { AssignmentFormDialog } from './assignment-form';

type Assignment = Schemas['AssignmentDetail'];
type SubmissionStatus = 'SUBMITTED' | 'GRADED' | 'MISSING';
type Draft = { status: SubmissionStatus | ''; score: string; comment: string; dirty: boolean };

export default function AssignmentDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const { data: a, error } = useQuery({
    queryKey: lmsKeys.assignment(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/assignments/{id}', { params: { path: { id } } }))).data,
  });
  if (error) return <Alert tone="danger">Không tìm thấy bài tập hoặc bạn không có quyền xem.</Alert>;
  if (!a) return <Spinner label="Đang tải…" />;
  return <AssignmentView key={a.id} a={a} />;
}

function AssignmentView({ a }: { a: Assignment }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = usePermission('lms.assignments.manage');
  const canGrade = usePermission('lms.assignments.grade');
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(a.submissions.map((s) => [s.learnerId, { status: s.status ?? '', score: s.score?.toString() ?? '', comment: s.comment ?? '', dirty: false }])),
  );
  const refresh = () => void qc.invalidateQueries({ queryKey: lmsKeys.assignments });

  const dirty = Object.entries(drafts).filter(([, d]) => d.dirty && d.status);
  const badScore = (d: Draft) => d.score === '' || !Number.isInteger(Number(d.score)) || Number(d.score) < 0 || Number(d.score) > a.maxScore;
  const invalid = dirty.some(([, d]) => d.status === 'GRADED' && badScore(d));
  const grade = useMutation({
    mutationFn: async () =>
      unwrap(
        api.POST('/api/v1/lms/assignments/{id}/grades', {
          params: { path: { id: a.id } },
          body: {
            items: dirty.map(([learnerId, d]) => ({
              learnerId,
              status: d.status as SubmissionStatus,
              score: d.status === 'GRADED' ? Number(d.score) : null,
              comment: d.comment.trim() || null,
            })),
          },
        }),
      ),
    onSuccess: () => {
      toast.success('Đã lưu điểm');
      setDrafts((all) => Object.fromEntries(Object.entries(all).map(([k, d]) => [k, { ...d, dirty: false }])));
      refresh();
    },
    onError: toastError,
  });
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return unwrap(api.POST('/api/v1/lms/assignments/{id}/attachments', { params: { path: { id: a.id } }, body: fd as never }));
    },
    onSuccess: () => (toast.success('Đã đính kèm'), refresh()),
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(api.DELETE('/api/v1/lms/assignments/{id}', { params: { path: { id: a.id } } })),
    onSuccess: () => {
      toast.success('Đã xoá bài tập');
      refresh();
      navigate('/assignments');
    },
    onError: toastError,
  });
  const update = (learnerId: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [learnerId]: { ...all[learnerId]!, ...patch, dirty: true } }));

  return (
    <>
      <BackLink to="/assignments" label="Bài tập" />
      <PageHeader
        title={a.title}
        description={`${a.classCode} · ${a.className} · ${a.dueAt ? `hạn ${formatDateTime(a.dueAt)}` : 'không có hạn'} · thang ${a.maxScore}`}
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Sửa
              </Button>
              <Button variant="outline" size="icon" aria-label="Xoá bài tập" onClick={() => setRemoving(true)} disabled={a.gradedCount > 0}>
                <Trash2 />
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">
              Bài nộp · {a.submittedCount + a.gradedCount}/{a.learnerCount}
            </h2>
            <Link to={`/classes/${a.classId}`} className="text-sm text-info hover:underline">
              Xem lớp
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {a.submissions.map((s) => {
              const d = drafts[s.learnerId]!;
              return (
                <li key={s.learnerId} className="grid gap-2 p-3 sm:grid-cols-[1fr_150px_90px] sm:items-center">
                  <div className="min-w-0">
                    <div className="font-medium">{s.fullName}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.status ? <Badge tone={SUBMISSION_STATUS[s.status].tone}>{SUBMISSION_STATUS[s.status].label}</Badge> : 'Chưa ghi nhận'}
                      {s.gradedByName && ` · chấm bởi ${s.gradedByName}`}
                    </div>
                  </div>
                  <Select value={d.status} disabled={!canGrade} onChange={(e) => update(s.learnerId, { status: e.target.value as SubmissionStatus })} aria-label={`Trạng thái bài của ${s.fullName}`}>
                    <option value="">— Chưa ghi —</option>
                    <option value="SUBMITTED">Đã nộp</option>
                    <option value="GRADED">Chấm điểm</option>
                    <option value="MISSING">Không nộp</option>
                  </Select>
                  <Input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={0}
                    max={a.maxScore}
                    placeholder={`/${a.maxScore}`}
                    value={d.score}
                    disabled={!canGrade || d.status !== 'GRADED'}
                    onChange={(e) => update(s.learnerId, { score: e.target.value })}
                    aria-label={`Điểm của ${s.fullName}`}
                    aria-invalid={d.status === 'GRADED' && d.dirty && badScore(d) ? true : undefined}
                  />
                  <Input
                    className="sm:col-span-3"
                    value={d.comment}
                    disabled={!canGrade}
                    onChange={(e) => update(s.learnerId, { comment: e.target.value })}
                    placeholder="Nhận xét bài làm"
                    aria-label={`Nhận xét bài của ${s.fullName}`}
                  />
                </li>
              );
            })}
          </ul>
          {canGrade && (
            <div className="mt-3 flex items-center justify-end gap-3">
              {invalid && <span className="text-sm text-danger">Điểm là số nguyên từ 0 đến {a.maxScore}</span>}
              <Button onClick={() => grade.mutate()} disabled={!dirty.length || invalid || grade.isPending}>
                <Save /> Lưu {dirty.length ? `(${dirty.length})` : ''}
              </Button>
            </div>
          )}
        </section>

        <Card className="h-fit p-4">
          <h2 className="mb-2 font-semibold">Đề bài</h2>
          {a.description ? <p className="text-sm whitespace-pre-line">{a.description}</p> : <p className="text-sm text-muted-foreground">Không có mô tả.</p>}
          <h3 className="mt-4 mb-2 text-sm font-semibold">File đính kèm</h3>
          {!a.attachments.length && <p className="text-sm text-muted-foreground">Không có.</p>}
          <ul className="flex flex-col gap-1.5">
            {a.attachments.map((f) => (
              <li key={f.url}>
                <a href={fileUrl(f.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-info hover:underline">
                  <Paperclip className="size-3.5" /> {f.name} <span className="text-xs text-muted-foreground">({formatBytes(f.size)})</span>
                </a>
              </li>
            ))}
          </ul>
          {canManage && (
            <>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => fileInput.current?.click()} disabled={attach.isPending}>
                <Paperclip /> Đính kèm file
              </Button>
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attach.mutate(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </Card>
      </div>
      {editing && <AssignmentFormDialog assignment={a} onClose={() => setEditing(false)} />}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Xoá bài tập?" confirmLabel="Xoá" tone="danger" pending={remove.isPending} onConfirm={() => remove.mutate()}>
        Bài tập và các ghi nhận nộp bài sẽ bị xoá.
      </ConfirmDialog>
    </>
  );
}
