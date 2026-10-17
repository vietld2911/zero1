import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Spinner, Textarea, toast } from '@zero1/ui';
import { applyFieldErrors, errorMessage, formatMinutes, toastError, useApi, usePermission } from '@zero1/web-core';

type Subject = Schemas['Subject'];
type Level = Schemas['Level'];

const keys = { all: ['lms', 'subjects'] as const, list: (includeInactive: boolean) => ['lms', 'subjects', { includeInactive }] as const };

export default function CurriculumPage() {
  const api = useApi();
  const canManage = usePermission('lms.curriculum.manage');
  const [showInactive, setShowInactive] = useState(false);
  const [subjectDialog, setSubjectDialog] = useState<Subject | 'new' | null>(null);
  const [levelDialog, setLevelDialog] = useState<{ subject: Subject; level?: Level } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: keys.list(showInactive),
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/subjects', { params: { query: { includeInactive: showInactive } } }))).data,
  });

  return (
    <>
      <PageHeader
        title="Môn học & cấp độ"
        description="Khung chương trình đào tạo. Số buổi của cấp độ là số buổi mặc định khi CRM tạo gói học phí."
        actions={
          canManage && (
            <Button onClick={() => setSubjectDialog('new')}>
              <Plus /> Thêm môn học
            </Button>
          )
        }
      />
      <div className="mb-4">
        <Checkbox label="Hiện cả mục đã ngừng" checked={showInactive} onCheckedChange={setShowInactive} />
      </div>

      {isLoading ? (
        <Spinner label="Đang tải…" />
      ) : error ? (
        <Alert tone="danger">{errorMessage(error)}</Alert>
      ) : !data?.length ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <BookOpen className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Chưa có môn học</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {canManage ? 'Thêm môn học đầu tiên (ví dụ Robotics), sau đó thêm các cấp độ theo thứ tự lên lớp.' : 'Quản trị viên chưa tạo chương trình học.'}
          </p>
          {canManage && (
            <Button onClick={() => setSubjectDialog('new')}>
              <Plus /> Thêm môn học
            </Button>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {data.map((s) => (
            <SubjectCard
              key={s.id}
              subject={s}
              canManage={canManage}
              onEdit={() => setSubjectDialog(s)}
              onAddLevel={() => setLevelDialog({ subject: s })}
              onEditLevel={(level) => setLevelDialog({ subject: s, level })}
            />
          ))}
        </div>
      )}

      <SubjectDialog subject={subjectDialog} onClose={() => setSubjectDialog(null)} />
      <LevelDialog target={levelDialog} onClose={() => setLevelDialog(null)} />
    </>
  );
}

function SubjectCard({
  subject,
  canManage,
  onEdit,
  onAddLevel,
  onEditLevel,
}: {
  subject: Subject;
  canManage: boolean;
  onEdit: () => void;
  onAddLevel: () => void;
  onEditLevel: (level: Level) => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const reorder = useMutation({
    mutationFn: (levelIds: string[]) =>
      unwrap(api.PATCH('/api/v1/lms/subjects/{id}/level-order', { params: { path: { id: subject.id } }, body: { levelIds } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.all }),
    onError: toastError,
  });

  const move = (index: number, delta: -1 | 1) => {
    const ids = subject.levels.map((l) => l.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  const totalSessions = subject.levels.filter((l) => l.isActive).reduce((s, l) => s + l.sessionsCount, 0);

  return (
    <Card className={subject.isActive ? undefined : 'opacity-70'}>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-navy-900 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">{subject.code}</span>
            <h2 className="text-lg font-semibold">{subject.name}</h2>
            {!subject.isActive && <Badge>Đã ngừng</Badge>}
          </div>
          {subject.description && <p className="mt-1 text-sm text-muted-foreground">{subject.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {subject.levels.length} cấp độ · tổng {totalSessions} buổi
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil /> Sửa môn
            </Button>
            <Button size="sm" onClick={onAddLevel}>
              <Plus /> Thêm cấp độ
            </Button>
          </div>
        )}
      </div>

      {subject.levels.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">Chưa có cấp độ.</p>
      ) : (
        <ol className="divide-y divide-border">
          {subject.levels.map((l, i) => (
            <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-brand-soft text-xs font-semibold text-navy-900 tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                  {!l.isActive && <Badge>Đã ngừng</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {l.sessionsCount} buổi × {l.sessionMinutes} phút · {formatMinutes(l.sessionsCount * l.sessionMinutes)}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="icon" aria-label={`Đưa ${l.name} lên`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Đưa ${l.name} xuống`}
                    disabled={i === subject.levels.length - 1 || reorder.isPending}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Sửa ${l.name}`} onClick={() => onEditLevel(l)}>
                    <Pencil />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,20}$/, '1–20 ký tự: chữ, số, - hoặc _');

const subjectSchema = z.object({
  code,
  name: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
  description: z.string().trim().max(1000),
  isActive: z.boolean(),
});

/** Mỗi lần mở là một form mới (key theo bản ghi) — giá trị khởi tạo đúng mà không cần effect. */
function SubjectDialog({ subject, onClose }: { subject: Subject | 'new' | null; onClose: () => void }) {
  if (!subject) return null;
  return <SubjectForm key={subject === 'new' ? 'new' : subject.id} editing={subject === 'new' ? null : subject} onClose={onClose} />;
}

function SubjectForm({ editing, onClose }: { editing: Subject | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(subjectSchema),
    defaultValues: { code: editing?.code ?? '', name: editing?.name ?? '', description: editing?.description ?? '', isActive: editing?.isActive ?? true },
  });

  const save = useMutation({
    mutationFn: async (v: z.infer<typeof subjectSchema>) => {
      const body = { code: v.code, name: v.name, description: v.description || null };
      if (editing) await unwrap(api.PATCH('/api/v1/lms/subjects/{id}', { params: { path: { id: editing.id } }, body: { ...body, isActive: v.isActive } }));
      else await unwrap(api.POST('/api/v1/lms/subjects', { body }));
    },
    onSuccess: () => {
      toast.success(editing ? 'Đã lưu môn học' : 'Đã thêm môn học');
      void qc.invalidateQueries({ queryKey: keys.all });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SUBJECT_CODE_TAKEN') form.setError('code', { message: err.title });
      else if (!applyFieldErrors(err, form.setError, ['code', 'name', 'description'])) setFormError(errorMessage(err));
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const errors = form.formState.errors;
  const isActive = useWatch({ control: form.control, name: 'isActive' });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Sửa môn học' : 'Thêm môn học'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[140px_1fr]" noValidate>
        {formError && <Alert tone="danger" className="sm:col-span-2">{formError}</Alert>}
        <Field label="Mã" required error={errors.code?.message}>
          <Input className="font-mono uppercase" placeholder="ROB" {...form.register('code')} />
        </Field>
        <Field label="Tên môn học" required error={errors.name?.message}>
          <Input placeholder="Robotics" {...form.register('name')} />
        </Field>
        <Field label="Mô tả" className="sm:col-span-2" error={errors.description?.message}>
          <Textarea rows={3} {...form.register('description')} />
        </Field>
        {editing && (
          <div className="sm:col-span-2">
            <Checkbox label="Đang hoạt động" checked={isActive} onCheckedChange={(c) => form.setValue('isActive', c, { shouldDirty: true })} />
            {!isActive && editing.isActive && (
              <Alert tone="warning" className="mt-3">
                Ngừng môn học → mọi cấp độ trong môn được coi là ngừng: CRM sẽ không bán gói của môn này nữa.
              </Alert>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

const levelSchema = z.object({
  code,
  name: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
  sessionsCount: z.number({ error: 'Nhập số buổi' }).int().min(1, 'Tối thiểu 1 buổi').max(200),
  sessionMinutes: z.number({ error: 'Nhập số phút' }).int().min(15, 'Tối thiểu 15 phút').max(480),
  description: z.string().trim().max(1000),
  isActive: z.boolean(),
});

function LevelDialog({ target, onClose }: { target: { subject: Subject; level?: Level } | null; onClose: () => void }) {
  if (!target) return null;
  return <LevelForm key={target.level?.id ?? `new-${target.subject.id}`} subject={target.subject} level={target.level} onClose={onClose} />;
}

function LevelForm({ subject, level, onClose }: { subject: Subject; level?: Level; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(levelSchema),
    defaultValues: {
      code: level?.code ?? '',
      name: level?.name ?? '',
      sessionsCount: level?.sessionsCount ?? 14,
      sessionMinutes: level?.sessionMinutes ?? 90,
      description: level?.description ?? '',
      isActive: level?.isActive ?? true,
    },
  });

  const save = useMutation({
    mutationFn: async (v: z.infer<typeof levelSchema>) => {
      const body = { code: v.code, name: v.name, sessionsCount: v.sessionsCount, sessionMinutes: v.sessionMinutes, description: v.description || null };
      if (level) await unwrap(api.PATCH('/api/v1/lms/levels/{id}', { params: { path: { id: level.id } }, body: { ...body, isActive: v.isActive } }));
      else await unwrap(api.POST('/api/v1/lms/subjects/{id}/levels', { params: { path: { id: subject.id } }, body }));
    },
    onSuccess: () => {
      toast.success(level ? 'Đã lưu cấp độ' : 'Đã thêm cấp độ');
      void qc.invalidateQueries({ queryKey: keys.all });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'LEVEL_CODE_TAKEN') form.setError('code', { message: err.title });
      else if (!applyFieldErrors(err, form.setError, ['code', 'name', 'sessionsCount', 'sessionMinutes', 'description'])) setFormError(errorMessage(err));
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const errors = form.formState.errors;
  const levelActive = useWatch({ control: form.control, name: 'isActive' });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={level ? `Sửa cấp độ — ${level.name}` : `Thêm cấp độ — ${subject.name}`}
      description={level ? undefined : 'Cấp độ mới được xếp cuối cùng; đổi thứ tự bằng nút mũi tên.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {formError && <Alert tone="danger" className="sm:col-span-2">{formError}</Alert>}
        <Field label="Mã" required error={errors.code?.message}>
          <Input className="font-mono uppercase" placeholder="ROB1" {...form.register('code')} />
        </Field>
        <Field label="Tên cấp độ" required error={errors.name?.message}>
          <Input placeholder="Robotics 1" {...form.register('name')} />
        </Field>
        <Field label="Số buổi" required error={errors.sessionsCount?.message}>
          <Input type="number" inputMode="numeric" min={1} {...form.register('sessionsCount', { valueAsNumber: true })} />
        </Field>
        <Field label="Thời lượng mỗi buổi (phút)" required error={errors.sessionMinutes?.message}>
          <Input type="number" inputMode="numeric" min={15} step={15} {...form.register('sessionMinutes', { valueAsNumber: true })} />
        </Field>
        <Field label="Mô tả / mục tiêu" className="sm:col-span-2" error={errors.description?.message}>
          <Textarea rows={3} {...form.register('description')} />
        </Field>
        {level && (
          <div className="sm:col-span-2">
            <Checkbox
              label="Đang hoạt động"
              checked={levelActive}
              onCheckedChange={(c) => form.setValue('isActive', c, { shouldDirty: true })}
            />
          </div>
        )}
      </form>
    </Dialog>
  );
}
