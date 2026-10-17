import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, unwrap } from '@zero1/api-client';
import { Alert, Badge, Button, Checkbox, DataTable, Dialog, Field, Input, PageHeader, toast, type Column } from '@zero1/ui';
import { useApi } from '../api';
import { applyFieldErrors, errorMessage } from '../lib/errors';
import { coreKeys, useBranches, type Branch } from '../queries';

export default function BranchesPage() {
  const [showInactive, setShowInactive] = useState(false);
  const { data, isFetching } = useBranches(showInactive);
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);

  const columns: Column<Branch>[] = [
    { key: 'code', header: 'Mã', cell: (b) => <span className="font-mono text-xs">{b.code}</span> },
    { key: 'name', header: 'Tên chi nhánh', cell: (b) => <span className="font-medium">{b.name}</span> },
    { key: 'address', header: 'Địa chỉ', className: 'hidden md:table-cell text-muted-foreground', cell: (b) => b.address ?? '—' },
    { key: 'phone', header: 'Điện thoại', className: 'hidden lg:table-cell', cell: (b) => b.phone ?? '—' },
    { key: 'staff', header: 'Nhân sự', align: 'right', cell: (b) => <span className="tabular-nums">{b.staffCount}</span> },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (b) => (b.isActive ? <Badge tone="success">Hoạt động</Badge> : <Badge>Ngừng</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Chi nhánh"
        description="Danh sách trung tâm. Nhân sự được gán vào chi nhánh ở trang Nhân sự."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Thêm chi nhánh
          </Button>
        }
      />
      <div className="mb-3">
        <Checkbox label="Hiện cả chi nhánh đã ngừng" checked={showInactive} onCheckedChange={setShowInactive} />
      </div>
      <DataTable
        columns={columns}
        rows={data}
        rowKey={(b) => b.id}
        loading={isFetching}
        empty="Chưa có chi nhánh — bấm “Thêm chi nhánh” để bắt đầu"
        onRowClick={(b) => setEditing(b)}
      />
      <BranchDialog branch={editing} onClose={() => setEditing(null)} />
    </>
  );
}

const schema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, '2–20 ký tự: chữ, số, - hoặc _'),
  name: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
  address: z.string().trim().max(255),
  phone: z.string().trim().regex(/^([0-9+ ]{8,20})?$/, 'Số điện thoại không hợp lệ'),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function BranchDialog({ branch, onClose }: { branch: Branch | 'new' | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const editing = branch && branch !== 'new' ? branch : null;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!branch) return;
    setFormError(null);
    form.reset({
      code: editing?.code ?? '',
      name: editing?.name ?? '',
      address: editing?.address ?? '',
      phone: editing?.phone ?? '',
      isActive: editing?.isActive ?? true,
    });
  }, [branch, editing, form]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const body = { code: v.code, name: v.name, address: v.address || null, phone: v.phone || null };
      if (editing) {
        await unwrap(api.PATCH('/api/v1/core/branches/{id}', { params: { path: { id: editing.id } }, body: { ...body, isActive: v.isActive } }));
      } else {
        await unwrap(api.POST('/api/v1/core/branches', { body }));
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: coreKeys.branchesAll });
      toast.success(editing ? 'Đã lưu chi nhánh' : 'Đã tạo chi nhánh');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'BRANCH_CODE_TAKEN') form.setError('code', { message: err.title });
      else if (!applyFieldErrors(err, form.setError, ['code', 'name', 'address', 'phone'])) setFormError(errorMessage(err));
    },
  });

  const submit = form.handleSubmit((v) => save.mutate(v));
  const errors = form.formState.errors;
  const isActive = useWatch({ control: form.control, name: 'isActive' });

  return (
    <Dialog
      open={!!branch}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Sửa chi nhánh' : 'Thêm chi nhánh'}
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
          <Input className="font-mono uppercase" {...form.register('code')} />
        </Field>
        <Field label="Tên chi nhánh" required error={errors.name?.message}>
          <Input {...form.register('name')} />
        </Field>
        <Field label="Địa chỉ" className="sm:col-span-2" error={errors.address?.message}>
          <Input {...form.register('address')} />
        </Field>
        <Field label="Điện thoại" className="sm:col-span-2" error={errors.phone?.message}>
          <Input type="tel" {...form.register('phone')} />
        </Field>
        {editing && (
          <div className="sm:col-span-2">
            <Checkbox label="Đang hoạt động" checked={isActive} onCheckedChange={(c) => form.setValue('isActive', c, { shouldDirty: true })} />
            {!isActive && editing.isActive && editing.staffCount > 0 && (
              <Alert tone="warning" className="mt-3">
                Chi nhánh còn {editing.staffCount} nhân sự đang hoạt động — cần chuyển hoặc khoá họ trước khi ngừng.
              </Alert>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}
