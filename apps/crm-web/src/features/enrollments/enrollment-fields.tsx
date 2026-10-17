import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, unwrap } from '@zero1/api-client';
import { Alert, Button, Field, Input, MoneyInput, Select, Spinner, Textarea } from '@zero1/ui';
import { errorMessage, formatMoney, todayVN, useApi, useDebounced } from '@zero1/web-core';
import { QuoteBreakdown } from '../packages/quote-calculator';

export interface GiftDraft {
  itemId: string;
  quantity: number;
  deliveryCondition: 'IMMEDIATE' | 'ON_PAID';
}

export interface EnrollmentDraft {
  packageId: string;
  startLevelId: string;
  promotionId: string;
  /** null = học bổng mặc định của gói. */
  scholarshipMonths: number | null;
  extraDiscount: number | null;
  extraDiscountReason: string;
  startDate: string;
  note: string;
  gifts: GiftDraft[];
}

export const emptyEnrollment = (): EnrollmentDraft => ({
  packageId: '',
  startLevelId: '',
  promotionId: '',
  scholarshipMonths: null,
  extraDiscount: null,
  extraDiscountReason: '',
  startDate: todayVN(),
  note: '',
  gifts: [],
});

/** Lỗi nhập liệu chặn gửi; null = hợp lệ. */
export function enrollmentProblem(d: EnrollmentDraft): string | null {
  if (!d.packageId) return 'Chọn gói học phí';
  if (!d.startLevelId) return 'Chọn cấp độ bắt đầu';
  if ((d.extraDiscount ?? 0) > 0 && d.extraDiscountReason.trim().length < 3) return 'Nhập lý do giảm thêm';
  if (d.gifts.some((g) => !g.itemId)) return 'Chọn quà tặng hoặc xoá dòng trống';
  return null;
}

export function enrollmentBody(d: EnrollmentDraft) {
  return {
    packageId: d.packageId,
    startLevelId: d.startLevelId,
    promotionId: d.promotionId || null,
    scholarshipMonths: d.scholarshipMonths ?? undefined,
    extraDiscount: d.extraDiscount ?? 0,
    extraDiscountReason: d.extraDiscountReason.trim() || null,
    startDate: d.startDate || undefined,
    note: d.note.trim() || null,
    gifts: d.gifts,
  };
}

/**
 * Chọn gói, cấp độ, khuyến mại, học bổng, giảm thêm, quà tặng — kèm bảng tính học phí từ server.
 * Dùng cho chuyển đổi lead và tái phí.
 */
export function EnrollmentFields({ branchId, value, onChange }: { branchId: string; value: EnrollmentDraft; onChange: (v: EnrollmentDraft) => void }) {
  const api = useApi();
  const set = (patch: Partial<EnrollmentDraft>) => onChange({ ...value, ...patch });

  const { data: packages = [] } = useQuery({
    queryKey: ['crm', 'packages', { showInactive: false, viewBranch: branchId }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/packages', { params: { query: { includeInactive: false, branchId } } }))).data,
  });
  const { data: levels = [] } = useQuery({
    queryKey: ['crm', 'catalog', 'levels'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/catalog/levels'))).data,
    staleTime: 5 * 60_000,
  });
  const pkg = packages.find((p) => p.id === value.packageId);
  const { data: promotions = [] } = useQuery({
    queryKey: ['crm', 'promotions', 'eligible', branchId, pkg?.id],
    enabled: !!pkg,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/promotions', { params: { query: { branchId, packageId: pkg!.id, includeInactive: false } } }))).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['crm', 'promotion-items', 'active'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/promotion-items', { params: { query: { includeInactive: false } } }))).data,
  });
  const subjectLevels = levels.filter((l) => l.subjectId === pkg?.subjectId);

  const inputKey = useDebounced(
    JSON.stringify({
      packageId: value.packageId,
      branchId,
      promotionId: promotions.some((p) => p.id === value.promotionId) ? value.promotionId : null,
      scholarshipMonths: value.scholarshipMonths ?? undefined,
      extraDiscount: value.extraDiscount ?? 0,
    }),
    250,
  );
  const input = useMemo(
    () => JSON.parse(inputKey) as { packageId: string; branchId: string; promotionId: string | null; scholarshipMonths?: number; extraDiscount: number },
    [inputKey],
  );
  const quote = useQuery({
    queryKey: ['crm', 'pricing', 'quote', input],
    enabled: !!input.packageId && !!input.branchId,
    queryFn: async () => (await unwrap(api.POST('/api/v1/crm/pricing/quote', { body: input }))).data,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const stockOf = (itemId: string) => items.find((i) => i.id === itemId)?.stock.find((s) => s.branchId === branchId)?.quantity ?? 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="grid content-start gap-4 sm:grid-cols-2">
        <Field label="Gói học phí" required className="sm:col-span-2">
          <Select
            value={value.packageId}
            onChange={(e) => {
              const next = packages.find((p) => p.id === e.target.value);
              const first = levels.find((l) => l.subjectId === next?.subjectId);
              set({ packageId: e.target.value, startLevelId: first?.levelId ?? '', promotionId: '', scholarshipMonths: null });
            }}
          >
            <option value="">— Chọn gói —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.sessionsCount} buổi · {formatMoney(p.effectivePrice ?? p.basePrice)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cấp độ bắt đầu" required hint={pkg ? `Môn ${pkg.subjectName ?? ''}` : undefined}>
          <Select value={value.startLevelId} onChange={(e) => set({ startLevelId: e.target.value })} disabled={!pkg}>
            <option value="">— Chọn cấp độ —</option>
            {subjectLevels.map((l) => (
              <option key={l.levelId} value={l.levelId}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ngày bắt đầu">
          <Input type="date" value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="Khuyến mại" className="sm:col-span-2" hint={pkg && !promotions.length ? 'Không có chương trình áp dụng cho gói / chi nhánh này' : undefined}>
          <Select value={value.promotionId} onChange={(e) => set({ promotionId: e.target.value })} disabled={!promotions.length}>
            <option value="">— Không áp dụng —</option>
            {promotions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.discountType === 'PERCENT' ? `${p.discountValue}%` : formatMoney(p.discountValue)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Học bổng (tháng)" hint={pkg ? `Mặc định ${pkg.defaultScholarshipMonths} tháng, vượt mức cần duyệt` : undefined}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            value={value.scholarshipMonths ?? pkg?.defaultScholarshipMonths ?? 0}
            onChange={(e) => set({ scholarshipMonths: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </Field>
        <Field label="Giảm thêm" hint="Cần duyệt">
          <MoneyInput value={value.extraDiscount} onChange={(v) => set({ extraDiscount: v })} placeholder="0" />
        </Field>
        {(value.extraDiscount ?? 0) > 0 && (
          <Field label="Lý do giảm thêm" required className="sm:col-span-2">
            <Input value={value.extraDiscountReason} onChange={(e) => set({ extraDiscountReason: e.target.value })} />
          </Field>
        )}

        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium">Quà tặng</span>
            <Button size="sm" variant="ghost" onClick={() => set({ gifts: [...value.gifts, { itemId: '', quantity: 1, deliveryCondition: 'ON_PAID' }] })} disabled={!items.length}>
              <Plus /> Thêm quà
            </Button>
          </div>
          {value.gifts.length === 0 && <p className="text-sm text-muted-foreground">Không tặng quà.</p>}
          <ul className="flex flex-col gap-2">
            {value.gifts.map((g, i) => {
              const update = (patch: Partial<GiftDraft>) => set({ gifts: value.gifts.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <li key={i} className="grid grid-cols-[72px_1fr_auto] items-center gap-2 rounded-md border border-border p-2">
                  <div className="col-span-3">
                    <Select value={g.itemId} onChange={(e) => update({ itemId: e.target.value })} aria-label="Quà tặng">
                      <option value="">— Chọn quà —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} (còn {stockOf(it.id)} {it.unit})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input type="number" min={1} max={100} value={g.quantity} onChange={(e) => update({ quantity: Math.max(1, Number(e.target.value) || 1) })} aria-label="Số lượng" />
                  <Select
                    value={g.deliveryCondition}
                    onChange={(e) => update({ deliveryCondition: e.target.value as GiftDraft['deliveryCondition'] })}
                    aria-label="Điều kiện giao"
                  >
                    <option value="ON_PAID">Khi đóng tiền</option>
                    <option value="IMMEDIATE">Giao ngay</option>
                  </Select>
                  <Button variant="ghost" size="icon" aria-label="Xoá quà" onClick={() => set({ gifts: value.gifts.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        <Field label="Ghi chú đăng ký" className="sm:col-span-2">
          <Textarea rows={2} value={value.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </div>

      <div className="h-fit rounded-lg border border-border bg-muted/40 p-4">
        <h3 className="mb-2 text-sm font-semibold">Học phí</h3>
        {!value.packageId ? (
          <p className="text-sm text-muted-foreground">Chọn gói để xem học phí.</p>
        ) : quote.isPending ? (
          <Spinner label="Đang tính…" />
        ) : quote.error ? (
          <Alert tone="warning">{quote.error instanceof ApiError ? errorMessage(quote.error) : 'Không tính được'}</Alert>
        ) : quote.data ? (
          <QuoteBreakdown q={quote.data} />
        ) : null}
      </div>
    </div>
  );
}
