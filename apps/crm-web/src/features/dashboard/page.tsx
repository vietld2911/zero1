import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, BadgePercent, RefreshCcw, Wallet } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { BarList, Card, CardContent, CardHeader, CardTitle, ColumnChart, Input, PageHeader, Progress, Segmented, Spinner, Stat } from '@zero1/ui';
import { addDays, BranchSelect, formatDate, formatMoney, formatMoneyShort, monthStartVN, percentChange, todayVN, useApi, useMe, usePermission } from '@zero1/web-core';
import { crmKeys, LEAD_SOURCES, type LeadSource } from '../labels';

type Overview = Schemas['SalesOverview'];
type Range = 'month' | 'lastMonth' | '7d' | '30d' | 'custom';

function lastDayOf(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function rangeOf(range: Range, today: string, custom: { from: string; to: string }) {
  switch (range) {
    case 'month':
      return { from: monthStartVN(), to: lastDayOf(today.slice(0, 7)) };
    case 'lastMonth': {
      const prev = addDays(monthStartVN(), -1);
      return { from: `${prev.slice(0, 7)}-01`, to: prev };
    }
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    default:
      return custom;
  }
}

export default function DashboardPage() {
  const api = useApi();
  const me = useMe();
  const [today] = useState(() => todayVN());
  const [range, setRange] = useState<Range>('month');
  const [custom, setCustom] = useState({ from: monthStartVN(), to: today });
  const [branchId, setBranchId] = useState('');
  const period = rangeOf(range, today, custom);
  const valid = period.from <= period.to;

  const { data, isPending, isFetching } = useQuery({
    queryKey: [...crmKeys.reports, 'overview', period, branchId],
    enabled: valid,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/reports/overview', { params: { query: { ...period, branchId: branchId || undefined } } }))).data,
    placeholderData: keepPreviousData,
  });

  const scopeHint = me.role === 'SALE' ? 'Số liệu của bạn' : me.role === 'SL' ? 'Số liệu nhóm của bạn' : undefined;

  return (
    <>
      <PageHeader
        title="Tổng quan kinh doanh"
        description={`${formatDate(period.from)} – ${formatDate(period.to)}${scopeHint ? ` · ${scopeHint}` : ''}. Doanh thu là tiền đã thu (khoản thu đã xác nhận).`}
        actions={<BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="Khoảng thời gian"
          value={range}
          onChange={setRange}
          options={[
            { value: 'month', label: 'Tháng này' },
            { value: 'lastMonth', label: 'Tháng trước' },
            { value: '7d', label: '7 ngày' },
            { value: '30d', label: '30 ngày' },
            { value: 'custom', label: 'Tuỳ chọn' },
          ]}
        />
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Từ ngày" className="w-40" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Đến ngày" className="w-40" />
          </div>
        )}
        {isFetching && <Spinner />}
      </div>

      {!valid ? (
        <p className="text-sm text-danger">Ngày kết thúc phải sau ngày bắt đầu.</p>
      ) : isPending || !data ? (
        <Spinner label="Đang tải…" />
      ) : (
        <Body data={data} today={today} />
      )}
    </>
  );
}

function Delta({ current, previous, period }: { current: number; previous: number; period: { from: string; to: string } }) {
  const d = percentChange(current, previous);
  const label = `${formatDate(period.from).slice(0, 5)}–${formatDate(period.to).slice(0, 5)}`;
  if (d === null) return <span>Cùng kỳ ({label}): {formatMoney(previous)}</span>;
  const up = d >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? 'text-success' : 'text-danger'}`}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {up ? '+' : ''}
      {d}% so với {label} ({formatMoneyShort(previous)})
    </span>
  );
}

function Body({ data, today }: { data: Overview; today: string }) {
  const canReview = usePermission('crm.approvals.review');
  const r = data.revenue;
  const progress = r.target ? Math.round((r.total / r.target) * 100) : null;
  const f = data.funnel;
  const rate = (n: number) => (f.leads ? `${Math.round((n / f.leads) * 100)}%` : '—');

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col gap-1 px-4 py-3 sm:col-span-2 xl:col-span-1">
          <span className="text-xs font-medium text-muted-foreground uppercase">Doanh thu</span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(r.total)}</span>
          <span className="text-xs">
            <Delta current={r.total} previous={r.previousTotal} period={data.previous} />
          </span>
          {progress !== null && (
            <div className="mt-1">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Mục tiêu {formatMoneyShort(r.target!)}</span>
                <span className="font-medium text-foreground tabular-nums">{progress}%</span>
              </div>
              <Progress value={progress} tone={progress >= 100 ? 'success' : 'brand'} label="Tiến độ mục tiêu" />
            </div>
          )}
        </Card>
        <Stat label="Đăng ký mới" value={data.enrollments.newCount} hint={`Giá trị ${formatMoney(data.enrollments.newValue)} · đã thu ${formatMoneyShort(r.newEnrollments)}`} />
        <Stat
          label="Tái phí"
          icon={RefreshCcw}
          value={data.enrollments.renewalCount}
          hint={`Giá trị ${formatMoney(data.enrollments.renewalValue)} · đã thu ${formatMoneyShort(r.renewals)}`}
        />
        <Stat
          label="Còn phải thu"
          icon={Wallet}
          value={formatMoneyShort(data.outstanding.amount)}
          tone={data.outstanding.amount ? 'warning' : 'default'}
          hint={`${data.outstanding.enrollments} đăng ký chưa thu đủ (hiện tại)`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Doanh thu theo ngày</CardTitle>
          </CardHeader>
          <CardContent>
            <ColumnChart
              aria-label="Doanh thu theo ngày"
              format={formatMoneyShort}
              highlightKey={today}
              data={r.byDay.map((d) => ({
                key: d.date,
                label: d.date.slice(8, 10),
                value: d.amount,
                tooltip: (
                  <>
                    <span className="text-muted-foreground">{formatDate(d.date)}</span> · <strong className="tabular-nums">{formatMoney(d.amount)}</strong>
                  </>
                ),
              }))}
            />
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Việc cần xử lý</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <TodoRow to="/enrollments" icon={Wallet} label="Khoản thu chờ xác nhận" value={data.pendingPayments.count} detail={data.pendingPayments.count ? formatMoney(data.pendingPayments.amount) : undefined} />
            <TodoRow
              to={canReview ? '/approvals' : '/enrollments'}
              icon={BadgePercent}
              label={canReview ? 'Ưu đãi chờ duyệt' : 'Ưu đãi bạn xin đang chờ duyệt'}
              value={data.pendingApprovals}
            />
            <TodoRow to="/renewals" icon={RefreshCcw} label="Học viên cần tái phí" value={data.renewalsDue} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Phễu tuyển sinh</CardTitle>
            <p className="text-sm text-muted-foreground">Lead nhận trong kỳ, tính theo lần đầu đạt mỗi bước S1–S5 (đến nay).</p>
          </CardHeader>
          <CardContent>
            <BarList
              format={(v) => v.toLocaleString('vi-VN')}
              max={f.leads}
              items={[
                { key: 'leads', label: 'S1 · Lead mới', value: f.leads },
                { key: 'contacted', label: 'S2 · Đã khai thác', value: f.contacted, detail: rate(f.contacted) },
                { key: 'appointed', label: 'S3 · Đã hẹn trial', value: f.appointed, detail: rate(f.appointed) },
                { key: 'attended', label: 'S4 · Đã trial + tư vấn', value: f.attended, detail: rate(f.attended) },
                { key: 'converted', label: 'S5 · Đã đăng ký', value: f.converted, detail: rate(f.converted) },
              ]}
            />
            {f.lost > 0 && <p className="mt-3 text-xs text-muted-foreground">{f.lost} lead đã dừng (S1C / S2C / S4C) trong số lead nhận trong kỳ.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Nguồn khách</CardTitle>
            <p className="text-sm text-muted-foreground">Số lead và số đã đăng ký theo nguồn.</p>
          </CardHeader>
          <CardContent>
            {!data.sources.length ? (
              <p className="text-sm text-muted-foreground">Chưa có lead trong kỳ.</p>
            ) : (
              <BarList
                format={(v) => v.toLocaleString('vi-VN')}
                items={data.sources.map((s) => ({
                  key: s.source,
                  label: LEAD_SOURCES[s.source as LeadSource] ?? s.source,
                  value: s.leads,
                  detail: `${s.converted} đăng ký${s.leads ? ` · ${Math.round((s.converted / s.leads) * 100)}%` : ''}`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between">
            <CardTitle>Xếp hạng doanh thu</CardTitle>
            <Link to="/reports" className="text-sm text-info hover:underline">
              Doanh số & KPI →
            </Link>
          </CardHeader>
          <CardContent>
            {!data.ranking.length ? (
              <p className="text-sm text-muted-foreground">Chưa có khoản thu trong kỳ.</p>
            ) : (
              <BarList format={formatMoneyShort} items={data.ranking.map((p, i) => ({ key: p.userId, label: `${i + 1}. ${p.fullName}`, value: p.revenue }))} />
            )}
          </CardContent>
        </Card>
        {data.byBranch.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Theo chi nhánh</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                format={formatMoneyShort}
                items={data.byBranch.map((b) => ({ key: b.branchId, label: b.name, value: b.revenue, detail: `${b.newCount} mới · ${b.renewalCount} tái phí` }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function TodoRow({ to, icon: Icon, label, value, detail }: { to: string; icon: typeof Wallet; label: string; value: number; detail?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 hover:border-navy-300">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <span className="flex-1">
        {label}
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span className={`text-lg font-semibold tabular-nums ${value ? 'text-warning' : 'text-muted-foreground'}`}>{value}</span>
    </Link>
  );
}
