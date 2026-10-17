import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Field, Input, MoneyInput, Select, Spinner } from '@zero1/ui';
import { errorMessage, formatMoney, useApi, useBranches, useDebounced } from '@zero1/web-core';

type Package = Schemas['Package'];
type Quote = Schemas['Quote'];

/**
 * Xem trước học phí bằng chính API tính giá (`POST /crm/pricing/quote`).
 * Giao diện không tự cộng trừ — chỉ hiển thị kết quả server.
 */
export function QuoteCalculator({ packages, defaultBranchId }: { packages: Package[]; defaultBranchId: string }) {
  const api = useApi();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [promotionId, setPromotionId] = useState('');
  const [scholarship, setScholarship] = useState<number | ''>('');
  const [extra, setExtra] = useState<number | null>(null);

  const branch = branchId || defaultBranchId;
  const pkg = packages.find((p) => p.id === packageId) ?? packages[0];

  const { data: promotions = [] } = useQuery({
    queryKey: ['crm', 'promotions', 'eligible', branch, pkg?.id],
    enabled: !!branch && !!pkg,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/promotions', { params: { query: { branchId: branch, packageId: pkg!.id, includeInactive: false } } }))).data,
  });

  // Debounce chuỗi (giá trị ổn định) — debounce object mới mỗi lần render sẽ gây vòng render vô tận.
  const inputKey = useDebounced(
    JSON.stringify({
      packageId: pkg?.id ?? '',
      branchId: branch,
      promotionId: promotions.some((p) => p.id === promotionId) ? promotionId : null,
      scholarshipMonths: scholarship === '' ? undefined : scholarship,
      extraDiscount: extra ?? 0,
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

  if (!packages.length) return <p className="text-sm text-muted-foreground">Chưa có gói đang bán.</p>;

  return (
    <div className="flex flex-col gap-3">
      {branches.length > 1 && (
        <Field label="Chi nhánh">
          <Select value={branch} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Gói">
        <Select value={pkg?.id ?? ''} onChange={(e) => (setPackageId(e.target.value), setScholarship(''))}>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Khuyến mại" hint={promotions.length ? undefined : 'Không có chương trình áp dụng cho gói / chi nhánh này'}>
        <Select value={promotionId} onChange={(e) => setPromotionId(e.target.value)} disabled={!promotions.length}>
          <option value="">— Không áp dụng —</option>
          {promotions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.discountType === 'PERCENT' ? `${p.discountValue}%` : formatMoney(p.discountValue)})
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Học bổng (tháng)" hint={pkg ? `Mặc định ${pkg.defaultScholarshipMonths}` : undefined}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            value={scholarship === '' ? (pkg?.defaultScholarshipMonths ?? 0) : scholarship}
            onChange={(e) => setScholarship(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
          />
        </Field>
        <Field label="Giảm thêm">
          <MoneyInput value={extra} onChange={setExtra} placeholder="0" />
        </Field>
      </div>

      <div className="mt-1 border-t border-border pt-3">
        {quote.isPending ? (
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

function Row({ label, value, tone }: { label: string; value: string; tone?: 'minus' | 'strong' }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${tone === 'strong' ? 'border-t border-border pt-2 text-base font-semibold' : ''}`}>
      <span className={tone === 'strong' ? '' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${tone === 'minus' ? 'text-success' : ''}`}>{value}</span>
    </div>
  );
}

export function QuoteBreakdown({ q }: { q: Quote }) {
  return (
    <div>
      <Row label={`Giá niêm yết ${q.priceSource === 'BRANCH' ? '(giá chi nhánh)' : '(giá gốc)'}`} value={formatMoney(q.listPrice)} />
      {q.promotion && <Row label={`KM ${q.promotion.code}`} value={`−${formatMoney(q.promotion.discount)}`} tone="minus" />}
      {q.extraDiscount.applied > 0 && <Row label="Giảm thêm" value={`−${formatMoney(q.extraDiscount.applied)}`} tone="minus" />}
      <Row label="Phải thu" value={formatMoney(q.amountDue)} tone="strong" />
      <p className="mt-2 text-sm text-muted-foreground">
        {q.sessions.package} buổi
        {q.sessions.scholarship > 0 && ` + ${q.sessions.scholarship} buổi học bổng (${q.scholarship.grantedMonths} tháng)`} = <strong className="text-foreground">{q.sessions.total} buổi</strong> ·{' '}
        {q.months.total} tháng
      </p>
      {q.approval && (
        <Alert tone="warning" className="mt-3" title={`Cần ${q.approval.approverRole} duyệt — ${formatMoney(q.approval.value)}`}>
          <div className="flex flex-wrap gap-1.5">
            {q.approval.reasons.includes('EXTRA_DISCOUNT') && <Badge tone="warning">Giảm thêm {formatMoney(q.extraDiscount.requested)}</Badge>}
            {q.approval.reasons.includes('EXTRA_SCHOLARSHIP') && <Badge tone="warning">Học bổng vượt {q.scholarship.pendingMonths} tháng</Badge>}
          </div>
          <p className="mt-1.5">Sau khi duyệt, phải thu còn {formatMoney(q.amountDueIfApproved)}. Được thu cọc trước.</p>
        </Alert>
      )}
    </div>
  );
}
