import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Button, ConfirmDialog, DataTable, Dialog, Field, Input, PageHeader, Select, Textarea, toast, type Column } from '@zero1/ui';
import { fileUrl, formatBytes, formatDate, toastError, useApi, usePermission } from '@zero1/web-core';
import { lmsKeys } from '../labels';

type Material = Schemas['Material'];

export default function MaterialsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const canManage = usePermission('lms.materials.manage');
  const [levelId, setLevelId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<Material | null>(null);
  const { data: subjects = [] } = useQuery({
    queryKey: [...lmsKeys.subjects, { includeInactive: false }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/subjects', { params: { query: { includeInactive: false } } }))).data,
  });
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.materials, { levelId }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/materials', { params: { query: { levelId: levelId || undefined } } }))).data,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(api.DELETE('/api/v1/lms/materials/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      toast.success('Đã xoá học liệu');
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: lmsKeys.materials });
    },
    onError: toastError,
  });

  const columns: Column<Material>[] = [
    {
      key: 'title',
      header: 'Học liệu',
      cell: (m) => (
        <a href={fileUrl(m.url)} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">{m.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {m.fileName} · {formatBytes(m.size)}
            </div>
          </div>
        </a>
      ),
    },
    { key: 'scope', header: 'Dùng cho', cell: (m) => (m.classId ? 'Riêng một lớp' : (m.levelName ?? 'Chung')) },
    { key: 'by', header: 'Tải lên', className: 'hidden md:table-cell', cell: (m) => <span className="text-muted-foreground">{m.uploadedByName ?? '—'} · {formatDate(m.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Thao tác</span>,
      align: 'right',
      cell: (m) =>
        canManage ? (
          <Button variant="ghost" size="icon" aria-label={`Xoá ${m.title}`} onClick={() => setRemoving(m)}>
            <Trash2 />
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Học liệu"
        description="Giáo trình, slide, video theo cấp độ — tự hiện trong mọi lớp của cấp độ đó."
        actions={
          canManage && (
            <Button onClick={() => setUploading(true)}>
              <Upload /> Tải lên
            </Button>
          )
        }
      />
      <div className="mb-3">
        <Select value={levelId} onChange={(e) => setLevelId(e.target.value)} className="w-64" aria-label="Cấp độ">
          <option value="">Mọi cấp độ</option>
          {subjects.map((s) => (
            <optgroup key={s.id} label={s.name}>
              {s.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <DataTable columns={columns} rows={data} rowKey={(m) => m.id} loading={isFetching} empty="Chưa có học liệu" />
      {uploading && <UploadDialog subjects={subjects} defaultLevel={levelId} onClose={() => setUploading(false)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Xoá học liệu?" confirmLabel="Xoá" tone="danger" pending={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)}>
        {removing?.title}
      </ConfirmDialog>
    </>
  );
}

function UploadDialog({ subjects, defaultLevel, onClose }: { subjects: Schemas['Subject'][]; defaultLevel: string; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [levelId, setLevelId] = useState(defaultLevel);
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('title', title.trim());
      if (description.trim()) fd.append('description', description.trim());
      if (levelId) fd.append('levelId', levelId);
      return unwrap(api.POST('/api/v1/lms/materials', { body: fd as never }));
    },
    onSuccess: () => {
      toast.success('Đã tải lên');
      void qc.invalidateQueries({ queryKey: lmsKeys.materials });
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Tải học liệu lên"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => upload.mutate()} disabled={!file || title.trim().length < 2 || !levelId || upload.isPending}>
            Tải lên
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="File" required hint="PDF, Office, ảnh, video, zip — tối đa 50 MB">
          <Input
            type="file"
            className="py-1.5"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </Field>
        <Field label="Tiêu đề" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Cấp độ" required>
          <Select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">— Chọn cấp độ —</option>
            {subjects.map((s) => (
              <optgroup key={s.id} label={s.name}>
                {s.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Mô tả">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
