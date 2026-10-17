import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, History, Pencil, Plus } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  MoneyInput,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  toast,
  type Column,
} from '@zero1/ui';
import { applyFieldErrors, errorMessage, formatDate, formatDateTime, formatMoney, toastError, todayVN, useApi, useBranches, usePermission } from '@zero1/web-core';

type Program = Schemas['PromotionProgram'];
type Item = Schemas['PromotionItem'];

const keys = { programs: ['crm', 'promotions'] as const, items: ['crm', 'promotion-items'] as const };

export default function PromotionsPage() {
  return (
    <>
      <PageHeader title="Khuyến mại & quà tặng" description="Chương trình giảm giá áp dụng khi đăng ký, quà tặng và tồn kho theo chi nhánh." />
      <Tabs
        tabs={[
          { value: 'programs', label: 'Chương trình khuyến mại', content: <Programs /> },
          { value: 'items', label: 'Quà tặng & kho', content: <Items /> },
        ]}
      />
    </>
  );
}

// ─────────────────────────────── Chương trình

function programStatus(p: Program, today: string): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (!p.isActive) return { label: 'Đã ngừng', tone: 'neutral' };
  if (p.startDate && today < p.startDate) return { label: 'Sắp diễn ra', tone: 'warning' };
  if (p.endDate && today > p.endDate) return { label: 'Hết hạn', tone: 'neutral' };
  return { label: 'Đang áp dụng', tone: 'success' };
}

function Programs() {
  const api = useApi();
  const canManage = usePermission('crm.promotions.manage');
  const { data: branches = [] } = useBranches();
  const [editing, setEditing] = useState<Program | 'new' | null>(null);
  const { data, isFetching } = useQuery({
    queryKey: [...keys.programs, 'all'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/promotions', { params: { query: { includeInactive: true } } }))).data,
  });
  const [today] = useState(() => todayVN());
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '…';

  const columns: Column<Program>[] = [
    {
      key: 'name',
      header: 'Chương trình',
      cell: (p) => (
        <div>
          <div className="font-medium">{p.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Mức giảm',
      cell: (p) =>
        p.discountType === 'PERCENT' ? (
          <span className="whitespace-nowrap">
            {p.discountValue}%{p.maxDiscount != null && <span className="text-xs text-muted-foreground"> · tối đa {formatMoney(p.maxDiscount)}</span>}
          </span>
        ) : (
          formatMoney(p.discountValue)
        ),
    },
    {
      key: 'period',
      header: 'Thời gian',
      className: 'hidden md:table-cell text-sm',
      cell: (p) => (p.startDate || p.endDate ? `${p.startDate ? formatDate(p.startDate) : '…'} → ${p.endDate ? formatDate(p.endDate) : '…'}` : 'Không giới hạn'),
    },
    {
      key: 'scope',
      header: 'Áp dụng',
      className: 'hidden lg:table-cell text-sm',
      cell: (p) => (
        <div>
          <div>{p.branchIds ? p.branchIds.map(branchName).join(', ') : 'Mọi chi nhánh'}</div>
          <div className="text-xs text-muted-foreground">{p.packageIds ? `${p.packageIds.length} gói` : 'Mọi gói'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (p) => {
        const s = programStatus(p, today);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    ...(canManage
      ? [
          {
            key: 'edit',
            header: <span className="sr-only">Sửa</span>,
            align: 'right' as const,
            cell: (p: Program) => (
              <Button variant="ghost" size="icon" aria-label={`Sửa ${p.name}`} onClick={() => setEditing(p)}>
                <Pencil />
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div>
          <Button onClick={() => setEditing('new')}>
            <Plus /> Thêm chương trình
          </Button>
        </div>
      )}
      <DataTable columns={columns} rows={data} rowKey={(p) => p.id} loading={isFetching} empty="Chưa có chương trình khuyến mại" />
      {editing && <ProgramDialog key={editing === 'new' ? 'new' : editing.id} program={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const programSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,30}$/, '2–30 ký tự: chữ, số, - hoặc _'),
    name: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(200),
    description: z.string().trim().max(1000),
    discountType: z.enum(['PERCENT', 'AMOUNT']),
    discountValue: z.number().int().min(1, 'Lớn hơn 0').nullable().refine((v) => v !== null, 'Nhập mức giảm'),
    maxDiscount: z.number().int().min(1).nullable(),
    startDate: z.string(),
    endDate: z.string(),
    allBranches: z.boolean(),
    branchIds: z.array(z.string()),
    allPackages: z.boolean(),
    packageIds: z.array(z.string()),
    isActive: z.boolean(),
  })
  .refine((v) => v.discountType !== 'PERCENT' || (v.discountValue ?? 0) <= 100, { path: ['discountValue'], message: 'Tối đa 100%' })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, { path: ['endDate'], message: 'Phải sau ngày bắt đầu' })
  .refine((v) => v.allBranches || v.branchIds.length > 0, { path: ['branchIds'], message: 'Chọn ít nhất một chi nhánh' })
  .refine((v) => v.allPackages || v.packageIds.length > 0, { path: ['packageIds'], message: 'Chọn ít nhất một gói' });
type ProgramForm = z.output<typeof programSchema>;

function ProgramDialog({ program, onClose }: { program: Program | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { data: branches = [] } = useBranches();
  const { data: packages = [] } = useQuery({
    queryKey: ['crm', 'packages', { showInactive: false }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/packages', { params: { query: { includeInactive: false } } }))).data,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof programSchema>, unknown, ProgramForm>({
    resolver: zodResolver(programSchema),
    defaultValues: {
      code: program?.code ?? '',
      name: program?.name ?? '',
      description: program?.description ?? '',
      discountType: program?.discountType ?? 'PERCENT',
      discountValue: program?.discountValue ?? 10,
      maxDiscount: program?.maxDiscount ?? null,
      startDate: program?.startDate ?? '',
      endDate: program?.endDate ?? '',
      allBranches: !program?.branchIds,
      branchIds: program?.branchIds ?? [],
      allPackages: !program?.packageIds,
      packageIds: program?.packageIds ?? [],
      isActive: program?.isActive ?? true,
    },
  });
  const [discountType, allBranches, allPackages] = useWatch({ control: form.control, name: ['discountType', 'allBranches', 'allPackages'] });

  const save = useMutation({
    mutationFn: async (v: ProgramForm) => {
      const body = {
        code: v.code,
        name: v.name,
        description: v.description || null,
        discountType: v.discountType,
        discountValue: v.discountValue,
        maxDiscount: v.discountType === 'PERCENT' ? v.maxDiscount : null,
        startDate: v.startDate || null,
        endDate: v.endDate || null,
        branchIds: v.allBranches ? null : v.branchIds,
        packageIds: v.allPackages ? null : v.packageIds,
      };
      if (program) await unwrap(api.PATCH('/api/v1/crm/promotions/{id}', { params: { path: { id: program.id } }, body: { ...body, isActive: v.isActive } }));
      else await unwrap(api.POST('/api/v1/crm/promotions', { body }));
    },
    onSuccess: () => {
      toast.success(program ? 'Đã lưu chương trình' : 'Đã thêm chương trình');
      void qc.invalidateQueries({ queryKey: keys.programs });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'PROMOTION_CODE_TAKEN') form.setError('code', { message: err.title });
      else if (!applyFieldErrors(err, form.setError, ['code', 'name', 'discountValue', 'maxDiscount', 'startDate', 'endDate', 'branchIds', 'packageIds'])) {
        setFormError(errorMessage(err));
      }
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const e = form.formState.errors;

  const toggleIn = (name: 'branchIds' | 'packageIds', id: string, on: boolean) => {
    const cur = form.getValues(name);
    form.setValue(name, on ? [...cur, id] : cur.filter((x) => x !== id), { shouldValidate: form.formState.isSubmitted });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={program ? `Sửa — ${program.name}` : 'Thêm chương trình khuyến mại'}
      description={program ? 'Đăng ký đã chốt giữ nguyên số tiền giảm cũ.' : 'Mỗi lần đăng ký áp dụng tối đa một chương trình.'}
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
        <Field label="Mã" required error={e.code?.message}>
          <Input className="font-mono uppercase" placeholder="HE2026" {...form.register('code')} />
        </Field>
        <Field label="Tên chương trình" required error={e.name?.message}>
          <Input placeholder="Ưu đãi hè 2026" {...form.register('name')} />
        </Field>
        <Field label="Loại giảm" required>
          <Select {...form.register('discountType')}>
            <option value="PERCENT">Theo %</option>
            <option value="AMOUNT">Số tiền cố định</option>
          </Select>
        </Field>
        {discountType === 'PERCENT' ? (
          <Field label="Phần trăm giảm" required error={e.discountValue?.message}>
            <Input type="number" inputMode="numeric" min={1} max={100} {...form.register('discountValue', { valueAsNumber: true })} />
          </Field>
        ) : (
          <Field label="Số tiền giảm" required error={e.discountValue?.message}>
            <Controller control={form.control} name="discountValue" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} />} />
          </Field>
        )}
        {discountType === 'PERCENT' && (
          <Field label="Giảm tối đa" className="sm:col-span-2" error={e.maxDiscount?.message} hint="Để trống = không giới hạn">
            <Controller control={form.control} name="maxDiscount" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} />} />
          </Field>
        )}
        <Field label="Từ ngày" error={e.startDate?.message} hint="Để trống = không giới hạn">
          <Input type="date" {...form.register('startDate')} />
        </Field>
        <Field label="Đến ngày" error={e.endDate?.message}>
          <Input type="date" {...form.register('endDate')} />
        </Field>

        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Chi nhánh áp dụng</legend>
          <Controller control={form.control} name="allBranches" render={({ field }) => <Checkbox label="Mọi chi nhánh" checked={field.value} onCheckedChange={field.onChange} />} />
          {!allBranches && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {branches.map((b) => (
                <Controller
                  key={b.id}
                  control={form.control}
                  name="branchIds"
                  render={({ field }) => <Checkbox label={b.name} checked={field.value.includes(b.id)} onCheckedChange={(c) => toggleIn('branchIds', b.id, c)} />}
                />
              ))}
            </div>
          )}
          {e.branchIds?.message && <p className="mt-1 text-xs text-danger">{e.branchIds.message}</p>}
        </fieldset>

        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Gói áp dụng</legend>
          <Controller control={form.control} name="allPackages" render={({ field }) => <Checkbox label="Mọi gói" checked={field.value} onCheckedChange={field.onChange} />} />
          {!allPackages && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {packages.map((p) => (
                <Controller
                  key={p.id}
                  control={form.control}
                  name="packageIds"
                  render={({ field }) => <Checkbox label={p.name} checked={field.value.includes(p.id)} onCheckedChange={(c) => toggleIn('packageIds', p.id, c)} />}
                />
              ))}
            </div>
          )}
          {e.packageIds?.message && <p className="mt-1 text-xs text-danger">{e.packageIds.message}</p>}
        </fieldset>

        <Field label="Mô tả / điều kiện" className="sm:col-span-2">
          <Textarea rows={2} {...form.register('description')} />
        </Field>
        {program && (
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => <Checkbox label="Đang bật" checked={field.value} onCheckedChange={field.onChange} className="sm:col-span-2" />}
          />
        )}
      </form>
    </Dialog>
  );
}

// ─────────────────────────────── Quà tặng & kho

function Items() {
  const api = useApi();
  const canManage = usePermission('crm.promotions.manage');
  const canStock = usePermission('crm.promotions.stock');
  const { data: branches = [] } = useBranches();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<{ item: Item; kind: 'IN' | 'OUT' } | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const { data, isFetching } = useQuery({
    queryKey: keys.items,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/promotion-items', { params: { query: { includeInactive: true } } }))).data,
  });
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '…';

  const columns: Column<Item>[] = [
    {
      key: 'name',
      header: 'Quà tặng',
      cell: (i) => (
        <div>
          <div className="flex items-center gap-2 font-medium">
            {i.name}
            {!i.isActive && <Badge>Ngừng</Badge>}
          </div>
          <div className="font-mono text-xs text-muted-foreground">{i.code}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Tồn kho',
      cell: (i) =>
        i.stock.length ? (
          <ul className="space-y-0.5 text-sm">
            {i.stock.map((s) => (
              <li key={s.branchId} className="flex items-center gap-2">
                <span className="text-muted-foreground">{branchName(s.branchId)}:</span>
                <span className="font-medium tabular-nums">
                  {s.quantity} {i.unit}
                </span>
                {i.lowStockBranches.includes(s.branchId) && <Badge tone="warning">Sắp hết</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-muted-foreground">Chưa nhập kho</span>
        ),
    },
    { key: 'min', header: 'Tối thiểu', className: 'hidden md:table-cell', align: 'right', cell: (i) => `${i.minStock} ${i.unit}` },
    {
      key: 'actions',
      header: <span className="sr-only">Thao tác</span>,
      align: 'right',
      cell: (i) => (
        <div className="flex justify-end gap-1">
          {canStock && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMoving({ item: i, kind: 'IN' })}>
                <ArrowDownToLine /> <span className="hidden lg:inline">Nhập</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMoving({ item: i, kind: 'OUT' })}>
                <ArrowUpFromLine /> <span className="hidden lg:inline">Xuất</span>
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Lịch sử kho ${i.name}`} onClick={() => setHistory(i)}>
                <History />
              </Button>
            </>
          )}
          {canManage && (
            <Button variant="ghost" size="icon" aria-label={`Sửa ${i.name}`} onClick={() => setEditing(i)}>
              <Pencil />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div>
          <Button onClick={() => setEditing('new')}>
            <Plus /> Thêm quà tặng
          </Button>
        </div>
      )}
      <DataTable columns={columns} rows={data} rowKey={(i) => i.id} loading={isFetching} empty="Chưa có quà tặng" />
      {editing && <ItemDialog key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {moving && <StockDialog key={`${moving.item.id}-${moving.kind}`} item={moving.item} kind={moving.kind} onClose={() => setMoving(null)} />}
      {history && <HistoryDialog item={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

const itemSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,30}$/, '2–30 ký tự: chữ, số, - hoặc _'),
  name: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(200),
  unit: z.string().trim().min(1, 'Nhập đơn vị').max(20),
  minStock: z.number({ error: 'Nhập số' }).int().min(0),
  description: z.string().trim().max(1000),
  isActive: z.boolean(),
});

function ItemDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      code: item?.code ?? '',
      name: item?.name ?? '',
      unit: item?.unit ?? 'cái',
      minStock: item?.minStock ?? 5,
      description: item?.description ?? '',
      isActive: item?.isActive ?? true,
    },
  });
  const save = useMutation({
    mutationFn: async ({ isActive, description, ...v }: z.infer<typeof itemSchema>) => {
      const body = { ...v, description: description || null };
      if (item) await unwrap(api.PATCH('/api/v1/crm/promotion-items/{id}', { params: { path: { id: item.id } }, body: { ...body, isActive } }));
      else await unwrap(api.POST('/api/v1/crm/promotion-items', { body }));
    },
    onSuccess: () => {
      toast.success(item ? 'Đã lưu quà tặng' : 'Đã thêm quà tặng');
      void qc.invalidateQueries({ queryKey: keys.items });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'ITEM_CODE_TAKEN') form.setError('code', { message: err.title });
      else if (!applyFieldErrors(err, form.setError, ['code', 'name', 'unit', 'minStock', 'description'])) setFormError(errorMessage(err));
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const e = form.formState.errors;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? `Sửa — ${item.name}` : 'Thêm quà tặng'}
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
        <Field label="Mã" required error={e.code?.message}>
          <Input className="font-mono uppercase" placeholder="BALO" {...form.register('code')} />
        </Field>
        <Field label="Tên quà tặng" required error={e.name?.message}>
          <Input placeholder="Balo Zero1" {...form.register('name')} />
        </Field>
        <Field label="Đơn vị" required error={e.unit?.message}>
          <Input {...form.register('unit')} />
        </Field>
        <Field label="Cảnh báo khi tồn ≤" required error={e.minStock?.message}>
          <Input type="number" inputMode="numeric" min={0} {...form.register('minStock', { valueAsNumber: true })} />
        </Field>
        <Field label="Mô tả" className="sm:col-span-2">
          <Textarea rows={2} {...form.register('description')} />
        </Field>
        {item && (
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => <Checkbox label="Đang dùng" checked={field.value} onCheckedChange={field.onChange} className="sm:col-span-2" />}
          />
        )}
      </form>
    </Dialog>
  );
}

function StockDialog({ item, kind, onClose }: { item: Item; kind: 'IN' | 'OUT'; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const branch = branchId || branches[0]?.id || '';
  const current = item.stock.find((s) => s.branchId === branch)?.quantity ?? 0;

  const save = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/crm/promotion-items/{id}/stock-moves', { params: { path: { id: item.id } }, body: { branchId: branch, kind, quantity, note: note || null } })),
    onSuccess: (res) => {
      toast.success(`${kind === 'IN' ? 'Đã nhập' : 'Đã xuất'} — tồn còn ${res.data.quantity} ${item.unit}`);
      void qc.invalidateQueries({ queryKey: keys.items });
      onClose();
    },
    onError: toastError,
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${kind === 'IN' ? 'Nhập kho' : 'Xuất kho'} — ${item.name}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !branch || quantity < 1}>
            {kind === 'IN' ? 'Nhập' : 'Xuất'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Chi nhánh" hint={`Đang tồn ${current} ${item.unit}`}>
          <Select value={branch} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Số lượng (${item.unit})`}>
          <Input type="number" inputMode="numeric" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))} />
        </Field>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'IN' ? 'Nhập từ nhà cung cấp…' : 'Lý do xuất…'} />
        </Field>
      </div>
    </Dialog>
  );
}

const moveLabel = { IN: 'Nhập', OUT: 'Xuất', ADJUST: 'Điều chỉnh', GIFT: 'Tặng học viên', RETURN: 'Trả lại' } as const;

function HistoryDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const api = useApi();
  const { data: branches = [] } = useBranches();
  const { data, isLoading } = useQuery({
    queryKey: [...keys.items, item.id, 'moves'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/promotion-items/{id}/stock-moves', { params: { path: { id: item.id }, query: {} } }))).data,
  });
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? '…';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Lịch sử kho — ${item.name}`} size="lg">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Đang tải…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">Chưa có lịch sử.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {data.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <span className="font-medium">{moveLabel[m.kind]}</span> · {branchName(m.branchId)}
                {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
              </div>
              <div className="text-right">
                <div className={`font-medium tabular-nums ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>
                  {m.quantity > 0 ? '+' : ''}
                  {m.quantity}
                </div>
                <div className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
