import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, FileSpreadsheet, Plus, Search, UserPlus } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  toast,
  type Column,
} from '@zero1/ui';
import {
  BranchSelect,
  formatDateTime,
  formatRelative,
  toastError,
  useApi,
  useDebounced,
  useDownload,
  useMe,
  usePermission,
  useStaffOptions,
} from '@zero1/web-core';
import { crmKeys, isStopped, LEAD_SOURCES, LEAD_STAGES, LEAD_STATUS, leadStatusText, OWNER_ROLES, stageOf, STOPPED_STATUSES, type LeadStatus } from '../labels';
import { LeadFormDialog } from './lead-form';
import { LeadStatusBadge } from './status';

type Lead = Schemas['Lead'];
/** Tab S1 … S5 (không gồm trạng thái dừng) và tab "Đã dừng". */
type Tab = 'ALL' | '1' | '2' | '3' | '4' | '5' | 'STOPPED';
const PAGE_SIZE = 20;
const ALL_STATUSES = Object.keys(LEAD_STATUS) as LeadStatus[];
const statusesOf = (tab: Tab) =>
  tab === 'ALL' ? [] : tab === 'STOPPED' ? STOPPED_STATUSES : ALL_STATUSES.filter((s) => String(stageOf(s)) === tab && !isStopped(s));

export default function LeadsPage() {
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const canWrite = usePermission('crm.leads.write');
  const canImport = usePermission('crm.leads.import');
  const canAssign = usePermission('crm.leads.assign');
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('ALL');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  /** S1B quá hạn khai thác — SL trở lên (link từ thông báo: /leads?stale=true). */
  const [stale, setStale] = useState(() => searchParams.get('stale') === 'true');
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [branchId, setBranchId] = useState('');
  const [followUpDue, setFollowUpDue] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const search = useDebounced(q.trim(), 300);

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1), setSelected(new Set()));

  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: search || undefined,
    status: status || undefined,
    stage: !status && tab !== 'ALL' && tab !== 'STOPPED' ? tab : undefined,
    stopped: status || tab === 'ALL' ? undefined : tab === 'STOPPED',
    stale: stale || undefined,
    source: source || undefined,
    ownerId: owner || undefined,
    branchId: branchId || undefined,
    followUpDue: followUpDue || undefined,
  };
  const { data, isFetching } = useQuery({
    queryKey: [...crmKeys.leads, 'list', query],
    queryFn: async () => unwrap(api.GET('/api/v1/crm/leads', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const { data: counts } = useQuery({
    queryKey: [...crmKeys.leads, 'counts', branchId],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/leads/status-counts', { params: { query: { branchId: branchId || undefined } } }))).data,
  });
  const { data: followUps = [] } = useQuery({
    queryKey: [...crmKeys.leads, 'follow-ups'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/leads/follow-ups'))).data,
  });
  const { data: staff = [] } = useStaffOptions(OWNER_ROLES, branchId || undefined, canAssign);

  const countOf = (list: LeadStatus[]) => (counts ? list.reduce((n, s) => n + (counts[s] ?? 0), 0) : undefined);
  const total = countOf(ALL_STATUSES);
  const subStatuses = statusesOf(tab);
  const rows = data?.data;
  const allSelected = !!rows?.length && rows.every((r) => selected.has(r.id));

  const columns: Column<Lead>[] = [
    ...(canAssign
      ? [
          {
            key: 'select',
            header: (
              <Checkbox
                aria-label="Chọn tất cả"
                checked={allSelected}
                onCheckedChange={(v) => setSelected(v ? new Set(rows?.map((r) => r.id)) : new Set())}
              />
            ),
            className: 'w-10',
            cell: (l: Lead) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={`Chọn ${l.childName}`}
                  checked={selected.has(l.id)}
                  onCheckedChange={(v) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (v) next.add(l.id);
                      else next.delete(l.id);
                      return next;
                    })
                  }
                />
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'child',
      header: 'Học sinh',
      cell: (l) => (
        <div className="min-w-0">
          <div className="font-medium">{l.childName}</div>
          <div className="text-xs text-muted-foreground">
            {l.childBirthYear ?? '—'} · {LEAD_SOURCES[l.source]}
          </div>
        </div>
      ),
    },
    {
      key: 'parent',
      header: 'Phụ huynh',
      cell: (l) => (
        <div>
          <div>{l.parentName}</div>
          <a href={`tel:${l.parentPhone}`} onClick={(e) => e.stopPropagation()} className="text-xs text-info tabular-nums hover:underline">
            {l.parentPhone}
          </a>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (l) => (
        <div className="flex flex-wrap gap-1">
          <LeadStatusBadge status={l.status} compact />
          {l.stale && <Badge tone="danger">Quá hạn khai thác</Badge>}
          {l.enrollmentCancelled && <Badge tone="danger">Đăng ký đã huỷ</Badge>}
        </div>
      ),
    },
    {
      key: 'followUp',
      header: 'Gọi lại',
      className: 'hidden md:table-cell',
      cell: (l) =>
        l.nextFollowUpAt ? (
          <span className={new Date(l.nextFollowUpAt).getTime() <= Date.now() ? 'font-medium text-danger' : ''} title={formatDateTime(l.nextFollowUpAt)}>
            {formatRelative(l.nextFollowUpAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'owner', header: 'Phụ trách', className: 'hidden lg:table-cell', cell: (l) => l.ownerName ?? <Badge tone="warning">Chưa phân công</Badge> },
    { key: 'created', header: 'Ngày tạo', className: 'hidden xl:table-cell', cell: (l) => <span className="text-muted-foreground">{formatDateTime(l.createdAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Khách hàng tiềm năng"
        description="Từ lúc nhận số đến khi đăng ký học."
        actions={
          <>
            {canImport && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileSpreadsheet /> Nhập Excel
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> Thêm khách hàng
              </Button>
            )}
          </>
        }
      />

      {followUps.length > 0 && (
        <Alert
          tone="warning"
          className="mb-4"
          title={`${followUps.length} khách hàng đến hạn gọi lại`}
          action={
            <Button size="sm" variant="outline" onClick={() => (setFollowUpDue(true), setTab('ALL'), setStatus(''), setPage(1))}>
              <BellRing /> Xem
            </Button>
          }
        >
          {followUps
            .slice(0, 3)
            .map((l) => l.childName)
            .join(', ')}
          {followUps.length > 3 && '…'}
        </Alert>
      )}

      <Segmented
        aria-label="Lọc theo bước"
        className="mb-2"
        value={tab}
        onChange={(t) => (setTab(t), setStatus(''), setPage(1), setSelected(new Set()))}
        options={[
          { value: 'ALL', label: 'Tất cả', count: total },
          ...([1, 2, 3, 4, 5] as const).map((n) => ({
            value: String(n) as Tab,
            label: <span title={LEAD_STAGES[n]}>S{n}</span>,
            count: countOf(statusesOf(String(n) as Tab)),
          })),
          { value: 'STOPPED', label: 'Đã dừng', count: countOf(STOPPED_STATUSES) },
        ]}
      />
      {subStatuses.length > 1 && (
        <Segmented
          aria-label="Lọc theo trạng thái"
          className="mb-3"
          value={status || 'ALL'}
          onChange={(v) => resetPage(setStatus)(v === 'ALL' ? '' : v)}
          options={[
            { value: 'ALL' as const, label: tab === 'STOPPED' ? 'Mọi lead đã dừng' : `${LEAD_STAGES[Number(tab) as 1]}` },
            ...subStatuses.map((s) => ({ value: s, label: leadStatusText(s), count: counts?.[s] })),
          ]}
        />
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Tên, số điện thoại…" className="pl-9" aria-label="Tìm kiếm" />
        </div>
        <Select value={source} onChange={(e) => resetPage(setSource)(e.target.value)} className="w-40" aria-label="Nguồn">
          <option value="">Mọi nguồn</option>
          {Object.entries(LEAD_SOURCES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={owner} onChange={(e) => resetPage(setOwner)(e.target.value)} className="w-48" aria-label="Người phụ trách">
          <option value="">Mọi người phụ trách</option>
          <option value={me.id}>Của tôi</option>
          <option value="none">Chưa phân công</option>
          {staff
            .filter((s) => s.id !== me.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
        </Select>
        <BranchSelect value={branchId} onChange={resetPage(setBranchId)} allLabel="Mọi chi nhánh" />
        <Checkbox label="Đến hạn gọi lại" checked={followUpDue} onCheckedChange={resetPage(setFollowUpDue)} />
        {canAssign && <Checkbox label="S1B quá hạn khai thác" checked={stale} onCheckedChange={resetPage(setStale)} />}
      </div>

      {canAssign && selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-cyan-brand/40 bg-cyan-brand-soft px-4 py-2 text-sm">
          <span>
            Đã chọn <strong>{selected.size}</strong> khách hàng
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Bỏ chọn
            </Button>
            <Button size="sm" onClick={() => setAssigning(true)}>
              <UserPlus /> Phân công
            </Button>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        loading={isFetching}
        onRowClick={(l) => navigate(`/leads/${l.id}`)}
        empty={search || source || owner || status || tab !== 'ALL' || followUpDue || stale ? 'Không có khách hàng khớp bộ lọc' : 'Chưa có khách hàng tiềm năng'}
        pagination={data ? { page, pageSize: PAGE_SIZE, total: data.meta.total, onPageChange: setPage } : undefined}
      />

      {creating && <LeadFormDialog lead={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/leads/${id}`)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {assigning && <AssignDialog leadIds={[...selected]} branchId={branchId} onClose={() => setAssigning(false)} onDone={() => setSelected(new Set())} />}
    </>
  );
}

function AssignDialog({ leadIds, branchId, onClose, onDone }: { leadIds: string[]; branchId: string; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { data: staff = [] } = useStaffOptions(OWNER_ROLES, branchId || undefined);
  const [ownerId, setOwnerId] = useState('');
  const assign = useMutation({
    mutationFn: async () => unwrap(api.POST('/api/v1/crm/leads/assign', { body: { leadIds, ownerId: ownerId === 'none' ? null : ownerId } })),
    onSuccess: (res) => {
      toast.success(`Đã phân công ${res.data.updated} khách hàng`);
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      onDone();
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Phân công ${leadIds.length} khách hàng`}
      description="Người nhận phải làm việc tại chi nhánh của khách hàng."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => assign.mutate()} disabled={!ownerId || assign.isPending}>
            Phân công
          </Button>
        </>
      }
    >
      <Field label="Giao cho">
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">— Chọn người phụ trách —</option>
          <option value="none">Bỏ phân công</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName} · {s.roleName}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const download = useDownload();
  const { data: staff = [] } = useStaffOptions(OWNER_ROLES);
  const [file, setFile] = useState<File | null>(null);
  const [ownerId, setOwnerId] = useState('');
  const run = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      if (ownerId) fd.append('ownerId', ownerId);
      return (await unwrap(api.POST('/api/v1/crm/leads/import', { body: fd as never }))).data;
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      toast.success(`Đã nhập ${res.created} khách hàng`);
      if (!res.skipped.length) onClose();
    },
    onError: toastError,
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Nhập khách hàng từ Excel"
      description="Dòng lỗi hoặc trùng số điện thoại sẽ được bỏ qua, các dòng còn lại vẫn được nhập."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button onClick={() => run.mutate()} disabled={!file || run.isPending}>
            Nhập
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="self-start" onClick={() => download('/api/v1/crm/leads/import-template', 'mau-nhap-lead.xlsx').catch(toastError)}>
          <FileSpreadsheet /> Tải file mẫu
        </Button>
        <Field label="File Excel (.xlsx)" required>
          <Input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
        </Field>
        <Field label="Giao cho" hint="Để trống: người nhập tự phụ trách (SL) hoặc chờ phân công (CM)">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">— Không chỉ định —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName} · {s.roleName}
              </option>
            ))}
          </Select>
        </Field>
        {run.data && (
          <Alert tone={run.data.skipped.length ? 'warning' : 'success'} title={`Đã nhập ${run.data.created} dòng, bỏ qua ${run.data.skipped.length} dòng`}>
            {run.data.skipped.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {run.data.skipped.map((s) => (
                  <li key={s.row}>
                    Dòng {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
