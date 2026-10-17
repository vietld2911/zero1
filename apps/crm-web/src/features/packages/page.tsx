import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Pencil, Plus, Tag } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  Select,
  Textarea,
  toast,
  type Column,
} from '@zero1/ui';
import { applyFieldErrors, errorMessage, formatMoney, toastError, useApi, useBranches, useMe, usePermission } from '@zero1/web-core';
import { QuoteCalculator } from './quote-calculator';

type Package = Schemas['Package'];
export const packageKeys = { all: ['crm', 'packages'] as const };

export default function PackagesPage() {
  const api = useApi();
  const me = useMe();
  const canManage = usePermission('crm.catalog.manage');
  const canBranchPrice = usePermission('crm.catalog.branch_prices');
  const canQuote = usePermission('crm.enrollments.create');
  const { data: branches = [] } = useBranches();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Package | 'new' | null>(null);
  const [pricing, setPricing] = useState<Package | null>(null);
  const defaultBranch = me.branches.find((b) => b.isPrimary)?.id ?? branches[0]?.id ?? '';
  const [branchId, setBranchId] = useState('');
  const viewBranch = branchId || defaultBranch;

  const { data, isFetching } = useQuery({
    queryKey: [...packageKeys.all, { showInactive, viewBranch }],
    queryFn: async () =>
      (await unwrap(api.GET('/api/v1/crm/packages', { params: { query: { includeInactive: showInactive, branchId: viewBranch || undefined } } }))).data,
  });

  const columns: Column<Package>[] = [
    {
      key: 'name',
      header: 'Gói',
      cell: (p) => (
        <div>
          <div className="flex items-center gap-2 font-medium">
            {p.name}
            {!p.isActive && <Badge>Ngừng bán</Badge>}
          </div>
          <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
        </div>
      ),
    },
    { key: 'subject', header: 'Môn', className: 'hidden md:table-cell', cell: (p) => p.subjectName ?? '—' },
    {
      key: 'duration',
      header: 'Thời lượng',
      cell: (p) => (
        <div className="text-sm">
          {p.months} tháng · {p.sessionsCount} buổi
          {p.defaultScholarshipMonths > 0 && <div className="text-xs text-success">+{p.defaultScholarshipMonths} tháng học bổng</div>}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Giá',
      align: 'right',
      cell: (p) => (
        <div>
          <div className="font-medium whitespace-nowrap tabular-nums">{formatMoney(p.effectivePrice ?? p.basePrice)}</div>
          {p.effectivePrice != null && p.effectivePrice !== p.basePrice && (
            <div className="text-xs whitespace-nowrap text-muted-foreground line-through tabular-nums">{formatMoney(p.basePrice)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Thao tác</span>,
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          {canBranchPrice && (
            <Button variant="ghost" size="sm" onClick={() => setPricing(p)}>
              <Tag /> <span className="hidden lg:inline">Giá chi nhánh</span>
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" size="icon" aria-label={`Sửa ${p.name}`} onClick={() => setEditing(p)}>
              <Pencil />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Gói học phí"
        description="Gói theo môn học: số buổi, số tháng hiệu lực, học bổng mặc định. Giá có thể đặt riêng cho từng chi nhánh."
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Thêm gói
            </Button>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {branches.length > 1 && (
              <Select value={viewBranch} onChange={(e) => setBranchId(e.target.value)} className="w-56" aria-label="Xem giá tại chi nhánh">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Giá tại {b.name}
                  </option>
                ))}
              </Select>
            )}
            <Checkbox label="Hiện gói đã ngừng bán" checked={showInactive} onCheckedChange={setShowInactive} />
          </div>
          <DataTable
            columns={columns}
            rows={data}
            rowKey={(p) => p.id}
            loading={isFetching}
            empty={canManage ? 'Chưa có gói học phí — bấm “Thêm gói”' : 'Chưa có gói học phí'}
          />
        </div>
        {canQuote && (
          <Card className="h-fit p-5">
            <h2 className="mb-1 flex items-center gap-2 font-semibold">
              <Calculator className="size-4" /> Tính thử học phí
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">Cùng công thức với lúc đăng ký thật (docs/pricing-rules.md).</p>
            <QuoteCalculator packages={(data ?? []).filter((p) => p.isActive)} defaultBranchId={viewBranch} />
          </Card>
        )}
      </div>
      <PackageDialog target={editing} onClose={() => setEditing(null)} />
      {pricing && <BranchPriceDialog pkg={pricing} onClose={() => setPricing(null)} />}
    </>
  );
}

const packageSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,20}$/, '2–20 ký tự: chữ, số, - hoặc _'),
    name: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
    subjectId: z.string().min(1, 'Chọn môn học'),
    months: z.number({ error: 'Nhập số tháng' }).int().min(1).max(60),
    sessionsCount: z.number({ error: 'Nhập số buổi' }).int().min(1).max(500),
    sessionsPerWeek: z.number({ error: 'Nhập số buổi / tuần' }).int().min(1).max(14),
    // null = ô đang trống (người dùng xoá để gõ lại) — bắt buộc nhập trước khi lưu.
    basePrice: z.number().int().min(0).nullable().refine((v) => v !== null, 'Nhập giá gốc'),
    defaultScholarshipMonths: z.number({ error: 'Nhập số tháng' }).int().min(0).max(24),
    description: z.string().trim().max(1000),
    isActive: z.boolean(),
  })
  .refine((v) => v.defaultScholarshipMonths <= v.months, { path: ['defaultScholarshipMonths'], message: 'Không vượt quá số tháng của gói' });
type PackageForm = z.output<typeof packageSchema>;
const PACKAGE_FIELDS = ['code', 'name', 'subjectId', 'months', 'sessionsCount', 'sessionsPerWeek', 'basePrice', 'defaultScholarshipMonths', 'description'] as const;

function PackageDialog({ target, onClose }: { target: Package | 'new' | null; onClose: () => void }) {
  if (!target) return null;
  return <PackageFormDialog key={target === 'new' ? 'new' : target.id} pkg={target === 'new' ? null : target} onClose={onClose} />;
}

function PackageFormDialog({ pkg, onClose }: { pkg: Package | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { data: subjects = [] } = useQuery({
    queryKey: ['crm', 'catalog', 'subjects'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/catalog/subjects'))).data,
  });
  const form = useForm<z.input<typeof packageSchema>, unknown, PackageForm>({
    resolver: zodResolver(packageSchema),
    defaultValues: {
      code: pkg?.code ?? '',
      name: pkg?.name ?? '',
      subjectId: pkg?.subjectId ?? '',
      months: pkg?.months ?? 6,
      sessionsCount: pkg?.sessionsCount ?? 48,
      sessionsPerWeek: pkg?.sessionsPerWeek ?? 2,
      basePrice: pkg?.basePrice ?? null,
      defaultScholarshipMonths: pkg?.defaultScholarshipMonths ?? 0,
      description: pkg?.description ?? '',
      isActive: pkg?.isActive ?? true,
    },
  });

  const save = useMutation({
    mutationFn: async ({ isActive, description, basePrice, ...v }: PackageForm) => {
      const body = { ...v, basePrice, description: description || null };
      if (pkg) await unwrap(api.PATCH('/api/v1/crm/packages/{id}', { params: { path: { id: pkg.id } }, body: { ...body, isActive } }));
      else await unwrap(api.POST('/api/v1/crm/packages', { body }));
    },
    onSuccess: () => {
      toast.success(pkg ? 'Đã lưu gói' : 'Đã thêm gói');
      void qc.invalidateQueries({ queryKey: packageKeys.all });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'PACKAGE_CODE_TAKEN') form.setError('code', { message: err.title });
      else if (!applyFieldErrors(err, form.setError, PACKAGE_FIELDS)) setFormError(errorMessage(err));
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const e = form.formState.errors;
  const num = { valueAsNumber: true } as const;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={pkg ? `Sửa gói — ${pkg.name}` : 'Thêm gói học phí'}
      description={pkg ? 'Đăng ký đã tạo giữ nguyên giá đã chốt.' : undefined}
      size="lg"
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
        {!subjects.length && (
          <Alert tone="warning" className="sm:col-span-2">
            Chưa có môn học nào từ LMS. Tạo môn học và cấp độ ở LMS → “Môn học & cấp độ” trước.
          </Alert>
        )}
        <Field label="Mã gói" required error={e.code?.message}>
          <Input className="font-mono uppercase" placeholder="ROB-6T" {...form.register('code')} />
        </Field>
        <Field label="Tên gói" required error={e.name?.message}>
          <Input placeholder="Robotics 6 tháng" {...form.register('name')} />
        </Field>
        <Field label="Môn học" required error={e.subjectId?.message} className="sm:col-span-2">
          <Select {...form.register('subjectId')}>
            <option value="">— Chọn môn —</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Số tháng hiệu lực" required error={e.months?.message}>
          <Input type="number" inputMode="numeric" min={1} {...form.register('months', num)} />
        </Field>
        <Field label="Số buổi" required error={e.sessionsCount?.message}>
          <Input type="number" inputMode="numeric" min={1} {...form.register('sessionsCount', num)} />
        </Field>
        <Field label="Buổi / tuần" required error={e.sessionsPerWeek?.message}>
          <Input type="number" inputMode="numeric" min={1} {...form.register('sessionsPerWeek', num)} />
        </Field>
        <Field label="Học bổng mặc định (tháng)" error={e.defaultScholarshipMonths?.message} hint="Cấp ngay, không cần duyệt">
          <Input type="number" inputMode="numeric" min={0} {...form.register('defaultScholarshipMonths', num)} />
        </Field>
        <Field label="Giá gốc" required error={e.basePrice?.message} className="sm:col-span-2" hint="Chi nhánh không đặt giá riêng sẽ dùng giá này">
          <Controller control={form.control} name="basePrice" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Mô tả" className="sm:col-span-2" error={e.description?.message}>
          <Textarea rows={2} {...form.register('description')} />
        </Field>
        {pkg && (
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => <Checkbox label="Đang bán" checked={field.value} onCheckedChange={field.onChange} className="sm:col-span-2" />}
          />
        )}
      </form>
    </Dialog>
  );
}

function BranchPriceDialog({ pkg, onClose }: { pkg: Package; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { data: branches = [] } = useBranches();
  const initial = useMemo(() => Object.fromEntries(pkg.branchPrices.map((b) => [b.branchId, b.price])), [pkg]);
  const [prices, setPrices] = useState<Record<string, number | null>>(initial);

  const save = useMutation({
    mutationFn: async () => {
      for (const b of branches) {
        const next = prices[b.id] ?? null;
        if (next !== (initial[b.id] ?? null)) {
          await unwrap(api.PATCH('/api/v1/crm/packages/{id}/branch-prices', { params: { path: { id: pkg.id } }, body: { branchId: b.id, price: next } }));
        }
      }
    },
    onSuccess: () => {
      toast.success('Đã lưu giá chi nhánh');
      void qc.invalidateQueries({ queryKey: packageKeys.all });
      onClose();
    },
    onError: toastError,
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Giá theo chi nhánh — ${pkg.name}`}
      description={`Để trống = dùng giá gốc ${formatMoney(pkg.basePrice)}`}
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
      <ul className="flex flex-col gap-3">
        {branches.map((b) => (
          <li key={b.id} className="grid items-center gap-2 sm:grid-cols-[1fr_200px]">
            <span className="text-sm font-medium">{b.name}</span>
            <MoneyInput aria-label={`Giá tại ${b.name}`} placeholder={new Intl.NumberFormat('vi-VN').format(pkg.basePrice)} value={prices[b.id]} onChange={(v) => setPrices((p) => ({ ...p, [b.id]: v }))} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
