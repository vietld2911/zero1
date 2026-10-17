import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, Target } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, Button, Card, Input, MoneyInput, PageHeader, Progress, Spinner, Stat, toast } from '@zero1/ui';
import { BranchSelect, formatMoney, formatMoneyShort, toastError, todayVN, useApi, useDownload, usePermission } from '@zero1/web-core';
import { crmKeys } from '../labels';

type Board = Schemas['KpiBoard'];
type Row = Board['rows'][number];

const ROLE_LABEL: Record<string, string> = { SALE: 'Sale', SL: 'Sale Leader', CS: 'CS', CM: 'CM' };

/** Nhóm theo cơ cấu: mỗi SL một nhóm kinh doanh (SL + sale dưới quyền); CS = team vận hành (tái phí). */
function groupRows(rows: Row[]) {
  const leaders = rows.filter((r) => r.role === 'SL');
  const groups: Array<{ key: string; title: string; hint: string; rows: Row[] }> = [];
  for (const sl of leaders) {
    groups.push({ key: sl.userId, title: `Nhóm ${sl.fullName}`, hint: 'Kinh doanh · đăng ký mới', rows: [sl, ...rows.filter((r) => r.role === 'SALE' && r.managerId === sl.userId)] });
  }
  const placed = new Set(groups.flatMap((g) => g.rows.map((r) => r.userId)));
  const otherSales = rows.filter((r) => r.role === 'SALE' && !placed.has(r.userId));
  if (otherSales.length) groups.push({ key: 'sales', title: leaders.length ? 'Sale chưa thuộc nhóm' : 'Kinh doanh', hint: 'Đăng ký mới', rows: otherSales });
  const cs = rows.filter((r) => r.role === 'CS');
  if (cs.length) groups.push({ key: 'cs', title: 'Vận hành', hint: 'CS · tái phí', rows: cs });
  const rest = rows.filter((r) => !['SALE', 'SL', 'CS'].includes(r.role));
  if (rest.length) groups.push({ key: 'other', title: 'Quản lý', hint: 'Đăng ký do quản lý chốt', rows: rest });
  return groups;
}

export default function ReportsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const download = useDownload();
  const canManage = usePermission('crm.kpi.manage');
  const [month, setMonth] = useState(() => todayVN().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number | null>>({});

  const query = { month, branchId: branchId || undefined };
  const { data, isPending, isFetching } = useQuery({
    queryKey: [...crmKeys.reports, 'kpi', query],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/reports/kpi', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: async () => {
      const items = Object.entries(draft)
        .filter(([id, v]) => (data?.rows.find((r) => r.userId === id)?.target ?? null) !== v)
        .map(([userId, targetRevenue]) => ({ userId, targetRevenue }));
      if (items.length) await unwrap(api.PUT('/api/v1/crm/reports/kpi/targets', { body: { month, items } }));
      return items.length;
    },
    onSuccess: (n) => {
      toast.success(n ? `Đã lưu mục tiêu cho ${n} người` : 'Không có thay đổi');
      setEditing(false);
      void qc.invalidateQueries({ queryKey: crmKeys.reports });
    },
    onError: toastError,
  });

  const startEdit = () => {
    setDraft(Object.fromEntries((data?.rows ?? []).filter((r) => r.canEditTarget).map((r) => [r.userId, r.target])));
    setEditing(true);
  };
  const editable = (data?.rows ?? []).some((r) => r.canEditTarget);
  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Doanh số & KPI"
        description="Mục tiêu doanh thu tháng và tiền đã thu của từng người. Đăng ký mới tính cho sale, tái phí tính cho CS chăm sóc."
        actions={
          <>
            <Button variant="outline" onClick={() => download(`/api/v1/crm/reports/kpi/export?month=${month}${branchId ? `&branchId=${branchId}` : ''}`, `kpi-${month}.xlsx`).catch(toastError)}>
              <FileDown /> Xuất Excel
            </Button>
            {canManage && editable && !editing && (
              <Button onClick={startEdit}>
                <Target /> Đặt mục tiêu
              </Button>
            )}
            {editing && (
              <>
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Huỷ
                </Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  Lưu mục tiêu
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Tháng" disabled={editing} />
        <BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />
        {isFetching && <Spinner />}
      </div>

      {isPending || !data || !t ? (
        <Spinner label="Đang tải…" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Doanh thu tháng"
              value={formatMoneyShort(t.revenue)}
              hint={
                t.progress !== null ? (
                  <>
                    <span>
                      {t.progress}% mục tiêu {formatMoneyShort(t.target!)}
                    </span>
                    <Progress value={t.progress} tone={t.progress >= 100 ? 'success' : 'brand'} className="mt-1" label="Tiến độ mục tiêu" />
                  </>
                ) : (
                  'Chưa đặt mục tiêu'
                )
              }
            />
            <Stat label="Đăng ký mới" value={formatMoneyShort(t.newRevenue)} hint="Tiền đã thu" />
            <Stat label="Tái phí" value={formatMoneyShort(t.renewalRevenue)} hint="Tiền đã thu" />
            <Stat label="Chưa gán người" value={formatMoneyShort(t.otherRevenue)} hint="Đăng ký không có sale / CS hoặc người đã nghỉ" tone={t.otherRevenue ? 'warning' : 'default'} />
          </div>

          {!data.rows.length ? (
            <Card className="p-6 text-sm text-muted-foreground">Không có nhân sự kinh doanh / CS trong phạm vi xem.</Card>
          ) : (
            <div className="relative overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-border bg-muted/60 text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Nhân sự</th>
                    <th className="px-4 py-2.5 text-right font-medium">Mục tiêu</th>
                    <th className="px-4 py-2.5 text-right font-medium">Doanh thu</th>
                    <th className="w-44 px-4 py-2.5 text-left font-medium">Tiến độ</th>
                    <th className="px-4 py-2.5 text-right font-medium">Đăng ký</th>
                    <th className="px-4 py-2.5 text-right font-medium">Lead nhận / chốt</th>
                  </tr>
                </thead>
                {groupRows(data.rows).map((g) => (
                  <tbody key={g.key} className="divide-y divide-border border-b border-border last:border-0">
                    <tr className="bg-muted/30">
                      <td colSpan={6} className="px-4 py-2 text-xs font-semibold tracking-wide uppercase">
                        {g.title} <span className="font-normal text-muted-foreground normal-case">· {g.hint}</span>
                        <span className="float-right font-medium text-foreground normal-case tabular-nums">{formatMoney(g.rows.reduce((n, r) => n + r.revenue, 0))}</span>
                      </td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.userId}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{r.fullName}</div>
                          <div className="text-xs text-muted-foreground">{ROLE_LABEL[r.role] ?? r.role}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {editing && r.canEditTarget ? (
                            <div className="ml-auto w-40">
                              <MoneyInput value={draft[r.userId] ?? null} onChange={(v) => setDraft((d) => ({ ...d, [r.userId]: v }))} aria-label={`Mục tiêu của ${r.fullName}`} placeholder="Chưa đặt" />
                            </div>
                          ) : r.target !== null ? (
                            formatMoney(r.target)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <div className="font-medium">{formatMoney(r.revenue)}</div>
                          {r.newRevenue > 0 && r.renewalRevenue > 0 && (
                            <div className="text-xs text-muted-foreground">
                              mới {formatMoneyShort(r.newRevenue)} · tái phí {formatMoneyShort(r.renewalRevenue)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.progress !== null ? (
                            <div className="flex items-center gap-2">
                              <Progress value={r.progress} tone={r.progress >= 100 ? 'success' : r.progress < 50 ? 'warning' : 'brand'} label={`Tiến độ ${r.fullName}`} />
                              <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums">{r.progress}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Chưa có mục tiêu</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {r.newEnrollments + r.renewals}
                          {r.renewals > 0 && <Badge className="ml-1.5">{r.renewals} tái phí</Badge>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {r.role === 'CS' ? '—' : `${r.leads} / ${r.converted}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {editing && <p className="mt-2 text-xs text-muted-foreground">Xoá trắng ô để bỏ mục tiêu. SL đặt cho sale trong nhóm; CM / AM đặt cho sale, SL và CS.</p>}
        </>
      )}
    </>
  );
}
