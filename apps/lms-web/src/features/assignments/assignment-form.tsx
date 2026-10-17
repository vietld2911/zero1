import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Button, Dialog, Field, Input, Select, Textarea, toast } from '@zero1/ui';
import { formatDate, fromVnInput, toastError, toVnInput, useApi, vnDay } from '@zero1/web-core';
import { lmsKeys } from '../labels';

type Assignment = Schemas['AssignmentDetail'];

/** Giao bài (classId) hoặc sửa bài (assignment). */
export function AssignmentFormDialog({
  classId,
  sessions = [],
  assignment,
  onClose,
  onSaved,
}: {
  classId?: string;
  sessions?: Array<{ id: string; indexNo: number; startsAt: string }>;
  assignment?: Assignment;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [description, setDescription] = useState(assignment?.description ?? '');
  const [dueAt, setDueAt] = useState(toVnInput(assignment?.dueAt));
  const [maxScore, setMaxScore] = useState(assignment?.maxScore ?? 10);
  const [sessionId, setSessionId] = useState(assignment?.sessionId ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const body = { title: title.trim(), description: description.trim() || null, dueAt: dueAt ? fromVnInput(dueAt) : null, maxScore };
      if (assignment) return (await unwrap(api.PATCH('/api/v1/lms/assignments/{id}', { params: { path: { id: assignment.id } }, body }))).data.id;
      return (await unwrap(api.POST('/api/v1/lms/classes/{id}/assignments', { params: { path: { id: classId! } }, body: { ...body, sessionId: sessionId || null } }))).data.id;
    },
    onSuccess: (id) => {
      toast.success(assignment ? 'Đã lưu bài tập' : 'Đã giao bài tập');
      void qc.invalidateQueries({ queryKey: lmsKeys.assignments });
      onSaved?.(id);
      onClose();
    },
    onError: toastError,
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={assignment ? 'Sửa bài tập' : 'Giao bài tập'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={title.trim().length < 2 || save.isPending}>
            {assignment ? 'Lưu' : 'Giao bài'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tiêu đề" required className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Yêu cầu" className="sm:col-span-2">
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Hạn nộp">
          <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Thang điểm">
          <Input type="number" min={1} max={100} value={maxScore} onChange={(e) => setMaxScore(Math.max(1, Number(e.target.value) || 10))} />
        </Field>
        {!assignment && sessions.length > 0 && (
          <Field label="Gắn với buổi" className="sm:col-span-2">
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">— Không —</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Buổi {s.indexNo} · {formatDate(vnDay(s.startsAt))}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
