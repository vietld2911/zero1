import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, MessageCircle, Pause, Play, Plus, RotateCcw, Send, Trash2, Webhook } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Dialog, Field, Input, Segmented, Select, Spinner, toast, type Column } from '@zero1/ui';
import { useApi } from '../../api';
import { errorMessage, toastError } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useBranches } from '../../queries';

type Overview = Schemas['IntegrationTarget'];
type Delivery = Schemas['IntegrationDelivery'];
type ApiKey = Schemas['ApiKey'];

const keys = { integrations: ['core', 'integrations'] as const, apiKeys: ['core', 'api-keys'] as const };

/** Sao chép, có dự phòng khi trình duyệt chặn clipboard. */
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Đã sao chép');
  } catch {
    toast.error('Không sao chép được — hãy bôi đen và sao chép tay');
  }
}

function SecretOnce({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={label} size="md" footer={<Button onClick={onClose}>Đã lưu lại</Button>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <code className="flex-1 font-mono text-sm break-all select-all">{value}</code>
          <Button variant="ghost" size="icon" aria-label="Sao chép" onClick={() => void copy(value)}>
            <Copy />
          </Button>
        </div>
        <Alert tone="warning">Chỉ hiện một lần. Lưu vào nơi an toàn (trình quản lý mật khẩu, biến môi trường của hệ thống nhận).</Alert>
      </div>
    </Dialog>
  );
}

function BranchPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: branches = [] } = useBranches();
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Chi nhánh</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Checkbox label="Mọi chi nhánh" checked={!value.length} onCheckedChange={(c) => c && onChange([])} />
        {branches.map((b) => (
          <Checkbox key={b.id} label={b.name} checked={value.includes(b.id)} onCheckedChange={(c) => onChange(c ? [...value, b.id] : value.filter((x) => x !== b.id))} />
        ))}
      </div>
    </fieldset>
  );
}

/** Cài đặt → Tích hợp: API key, webhook, nhóm Telegram nội bộ, nhật ký gửi. */
export function IntegrationsTab() {
  return (
    <div className="flex flex-col gap-8">
      <Targets />
      <ApiKeys />
      <Deliveries />
    </div>
  );
}

// ───────────────────────────── Webhook & Telegram

function Targets() {
  const api = useApi();
  const qc = useQueryClient();
  const [creating, setCreating] = useState<'WEBHOOK' | 'TELEGRAM' | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Overview | null>(null);
  const { data, isPending } = useQuery({ queryKey: keys.integrations, queryFn: async () => (await unwrap(api.GET('/api/v1/core/integrations'))).data });
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.integrations });

  const test = useMutation({
    mutationFn: async (id: string) => (await unwrap(api.POST('/api/v1/core/integrations/targets/{id}/test', { params: { path: { id } } }))).data,
    onSuccess: (r) => (r.ok ? toast.success('Gửi thử thành công') : toast.error(`Gửi thử thất bại${r.statusCode ? ` (HTTP ${r.statusCode})` : ''}: ${r.error ?? ''}`)),
    onError: toastError,
  });
  const toggle = useMutation({
    mutationFn: async (t: Overview) => unwrap(api.PATCH('/api/v1/core/integrations/targets/{id}', { params: { path: { id: t.id } }, body: { isActive: !t.isActive } })),
    onSuccess: refresh,
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(api.DELETE('/api/v1/core/integrations/targets/{id}', { params: { path: { id } } })),
    onSuccess: () => (toast.success('Đã xoá'), setRemoving(null), refresh()),
    onError: toastError,
  });
  const label = (type: string) => data?.eventTypes.find((e) => e.type === type)?.label ?? type;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold">Gửi sự kiện ra ngoài</h2>
          <p className="text-sm text-muted-foreground">Nhóm Telegram nội bộ theo chi nhánh, hoặc webhook cho hệ thống khác (n8n, Zalo OA, app riêng).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCreating('TELEGRAM')}>
            <MessageCircle /> Nhóm Telegram
          </Button>
          <Button variant="outline" onClick={() => setCreating('WEBHOOK')}>
            <Webhook /> Webhook
          </Button>
        </div>
      </div>
      {data && !data.telegramConfigured && (
        <Alert tone="info" title="Máy chủ chưa có bot Telegram">
          Tạo bot qua @BotFather rồi đặt <code>TELEGRAM_BOT_TOKEN</code> trong file cấu hình của API. Chưa có token thì tin Telegram sẽ báo lỗi trong nhật ký.
        </Alert>
      )}
      {isPending || !data ? (
        <Spinner label="Đang tải…" />
      ) : !data.targets.length ? (
        <Card className="p-6 text-sm text-muted-foreground">Chưa có nơi nhận. Thêm nhóm Telegram của chi nhánh để nhận tin lead mới, thu tiền, điểm danh…</Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.targets.map((t) => (
            <Card key={t.id} className={`flex flex-col gap-2 p-4 ${t.isActive ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {t.kind === 'TELEGRAM' ? <MessageCircle className="size-4 text-info" /> : <Webhook className="size-4 text-muted-foreground" />}
                    {t.name}
                    {!t.isActive && <Badge>Tạm dừng</Badge>}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{t.kind === 'TELEGRAM' ? `chat_id ${t.chatId}` : t.url}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label="Gửi thử" title="Gửi thử" onClick={() => test.mutate(t.id)} disabled={test.isPending}>
                    <Send />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t.isActive ? 'Tạm dừng' : 'Bật lại'} title={t.isActive ? 'Tạm dừng' : 'Bật lại'} onClick={() => toggle.mutate(t)}>
                    {t.isActive ? <Pause /> : <Play />}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Xoá" title="Xoá" onClick={() => setRemoving(t)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {t.events.includes('*') ? <Badge tone="brand">{t.kind === 'TELEGRAM' ? 'Mọi tin có mẫu' : 'Mọi sự kiện'}</Badge> : t.events.map((e) => <Badge key={e}>{label(e)}</Badge>)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                Đã gửi {t.delivered} · chờ {t.pending} · <span className={t.failed ? 'text-danger' : ''}>lỗi {t.failed}</span>
                {t.secretPreview && <span> · khoá ký {t.secretPreview}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {creating && data && (
        <TargetDialog
          kind={creating}
          eventTypes={data.eventTypes}
          onClose={() => setCreating(null)}
          onCreated={(s) => {
            refresh();
            if (s) setSecret(s);
          }}
        />
      )}
      {secret && <SecretOnce label="Khoá ký webhook" value={secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Xoá nơi nhận?" confirmLabel="Xoá" tone="danger" pending={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)}>
        {removing?.name} và nhật ký gửi của nó sẽ bị xoá.
      </ConfirmDialog>
    </section>
  );
}

function TargetDialog({
  kind,
  eventTypes,
  onClose,
  onCreated,
}: {
  kind: 'WEBHOOK' | 'TELEGRAM';
  eventTypes: Array<{ type: string; label: string; app: 'crm' | 'lms'; telegram: boolean }>;
  onClose: () => void;
  onCreated: (secret: string | null) => void;
}) {
  const api = useApi();
  const options = eventTypes.filter((e) => kind === 'WEBHOOK' || e.telegram);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [all, setAll] = useState(kind === 'TELEGRAM');
  const [events, setEvents] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const common = { name: name.trim(), events: all ? ['*'] : events, branchIds };
      const body = kind === 'WEBHOOK' ? { kind, url: target.trim(), ...common } : { kind, chatId: target.trim(), ...common };
      return (await unwrap(api.POST('/api/v1/core/integrations/targets', { body }))).data;
    },
    onSuccess: (r) => {
      toast.success('Đã thêm — bấm “Gửi thử” để kiểm tra');
      onCreated(r.secret);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? errorMessage(err)) : errorMessage(err)),
  });
  const valid = name.trim().length >= 2 && target.trim() && (all || events.length);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === 'TELEGRAM' ? 'Thêm nhóm Telegram' : 'Thêm webhook'}
      description={
        kind === 'TELEGRAM'
          ? 'Thêm bot của trung tâm vào nhóm, rồi lấy chat_id của nhóm (số âm, ví dụ -1001234567890).'
          : 'Hệ thống gửi POST JSON có chữ ký HMAC (header X-Zero1-Signature). Xem chi tiết ở tài liệu API (/docs).'
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => (setError(null), create.mutate())} disabled={!valid || create.isPending}>
            Thêm
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'TELEGRAM' ? 'Nhóm vận hành Cầu Giấy' : 'n8n — gửi Zalo phụ huynh'} />
          </Field>
          <Field label={kind === 'TELEGRAM' ? 'chat_id' : 'URL nhận'} required>
            <Input className="font-mono" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === 'TELEGRAM' ? '-1001234567890' : 'https://…'} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Sự kiện</legend>
          <Checkbox label={kind === 'TELEGRAM' ? 'Mọi loại tin có mẫu (gồm loại mới sau này)' : 'Mọi sự kiện'} checked={all} onCheckedChange={setAll} />
          {!all && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {options.map((e) => (
                <Checkbox
                  key={e.type}
                  label={
                    <span>
                      {e.label} <span className="font-mono text-xs text-muted-foreground">{e.type}</span>
                    </span>
                  }
                  checked={events.includes(e.type)}
                  onCheckedChange={(c) => setEvents((v) => (c ? [...v, e.type] : v.filter((x) => x !== e.type)))}
                />
              ))}
            </div>
          )}
        </fieldset>
        <BranchPicker value={branchIds} onChange={setBranchIds} />
      </div>
    </Dialog>
  );
}

// ───────────────────────────── API key

function ApiKeys() {
  const api = useApi();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const { data } = useQuery({ queryKey: keys.apiKeys, queryFn: async () => (await unwrap(api.GET('/api/v1/core/api-keys'))).data });
  const { data: branches = [] } = useBranches();
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(api.POST('/api/v1/core/api-keys/{id}/revoke', { params: { path: { id } } })),
    onSuccess: () => (toast.success('Đã thu hồi key'), setRevoking(null), void qc.invalidateQueries({ queryKey: keys.apiKeys })),
    onError: toastError,
  });
  const columns: Column<ApiKey>[] = [
    {
      key: 'name',
      header: 'Key',
      cell: (k) => (
        <div>
          <div className="font-medium">
            {k.name} {k.revokedAt && <Badge tone="danger">Đã thu hồi</Badge>}
          </div>
          <div className="font-mono text-xs text-muted-foreground">{k.prefix}_…</div>
        </div>
      ),
    },
    { key: 'perms', header: 'Quyền', cell: (k) => <span className="text-xs">{k.permissions.join(', ')}</span> },
    {
      key: 'branches',
      header: 'Chi nhánh',
      className: 'hidden md:table-cell',
      cell: (k) => (k.branchIds.length ? k.branchIds.map((id) => branches.find((b) => b.id === id)?.name ?? id).join(', ') : 'Tất cả'),
    },
    { key: 'used', header: 'Dùng gần nhất', className: 'hidden lg:table-cell', cell: (k) => <span className="text-muted-foreground">{formatDateTime(k.lastUsedAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Thu hồi</span>,
      align: 'right',
      cell: (k) =>
        k.revokedAt ? null : (
          <Button variant="ghost" size="sm" onClick={() => setRevoking(k)}>
            Thu hồi
          </Button>
        ),
    },
  ];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold">API key</h2>
          <p className="text-sm text-muted-foreground">Cho hệ thống khác gọi API: form website tạo lead, công cụ tự động đọc học viên… Gửi qua header X-Api-Key.</p>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)}>
          <KeyRound /> Tạo key
        </Button>
      </div>
      <DataTable columns={columns} rows={data?.keys} rowKey={(k) => k.id} loading={!data} empty="Chưa có API key" />
      {creating && data && <ApiKeyDialog grantable={data.grantable} onClose={() => setCreating(false)} onCreated={setKey} />}
      {key && <SecretOnce label="API key mới" value={key} onClose={() => setKey(null)} />}
      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title="Thu hồi API key?" confirmLabel="Thu hồi" tone="danger" pending={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking.id)}>
        Hệ thống đang dùng key “{revoking?.name}” sẽ không gọi được API nữa.
      </ConfirmDialog>
    </section>
  );
}

function ApiKeyDialog({ grantable, onClose, onCreated }: { grantable: Array<{ code: string; app: string; description: string }>; onClose: () => void; onCreated: (key: string) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<string[]>(['crm.leads.write']);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: async () => (await unwrap(api.POST('/api/v1/core/api-keys', { body: { name: name.trim(), permissions, branchIds } }))).data,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.apiKeys });
      onCreated(r.key);
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Tạo API key"
      description="Chỉ cấp đúng quyền hệ thống kia cần. Key không bao giờ có quyền quản trị (nhân sự, cài đặt…)."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => create.mutate()} disabled={name.trim().length < 2 || !permissions.length || create.isPending}>
            <Plus /> Tạo key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tên" required hint="Ví dụ: Form đăng ký trên website">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Quyền</legend>
          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
            {grantable.map((p) => (
              <Checkbox
                key={p.code}
                label={
                  <span>
                    {p.description} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                  </span>
                }
                checked={permissions.includes(p.code)}
                onCheckedChange={(c) => setPermissions((v) => (c ? [...v, p.code] : v.filter((x) => x !== p.code)))}
              />
            ))}
          </div>
        </fieldset>
        <BranchPicker value={branchIds} onChange={setBranchIds} />
      </div>
    </Dialog>
  );
}

// ───────────────────────────── Nhật ký gửi

const STATUS = { PENDING: { label: 'Chờ gửi lại', tone: 'warning' }, SUCCEEDED: { label: 'Đã gửi', tone: 'success' }, FAILED: { label: 'Lỗi', tone: 'danger' } } as const;

function Deliveries() {
  const api = useApi();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | 'PENDING' | 'SUCCEEDED' | 'FAILED'>('');
  const [targetId, setTargetId] = useState('');
  const [page, setPage] = useState(1);
  const { data: overview } = useQuery({ queryKey: keys.integrations, queryFn: async () => (await unwrap(api.GET('/api/v1/core/integrations'))).data });
  const query = { page, pageSize: 20, status: status || undefined, targetId: targetId || undefined };
  const { data, isFetching } = useQuery({
    queryKey: [...keys.integrations, 'deliveries', query],
    queryFn: async () => unwrap(api.GET('/api/v1/core/integrations/deliveries', { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const retry = useMutation({
    mutationFn: async (id: string) => (await unwrap(api.POST('/api/v1/core/integrations/deliveries/{id}/retry', { params: { path: { id } } }))).data,
    onSuccess: (r) => {
      if (r.ok) toast.success('Đã gửi lại thành công');
      else toast.error(`Vẫn lỗi: ${r.error ?? ''}`);
      void qc.invalidateQueries({ queryKey: keys.integrations });
    },
    onError: toastError,
  });
  const nameOf = (id: string) => overview?.targets.find((t) => t.id === id)?.name ?? '—';
  const columns: Column<Delivery>[] = [
    {
      key: 'event',
      header: 'Sự kiện',
      cell: (d) => (
        <div>
          <div>{d.eventLabel}</div>
          <div className="text-xs text-muted-foreground">
            → {nameOf(d.targetId)} · {formatDateTime(d.createdAt)}
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', cell: (d) => <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge> },
    {
      key: 'detail',
      header: 'Chi tiết',
      className: 'hidden md:table-cell',
      cell: (d) => (
        <div className="max-w-sm text-xs text-muted-foreground">
          {d.attempts} lần{d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ''}
          {d.nextAttemptAt && ` · thử lại ${formatDateTime(d.nextAttemptAt)}`}
          {d.lastError && <div className="truncate text-danger">{d.lastError}</div>}
        </div>
      ),
    },
    {
      key: 'retry',
      header: <span className="sr-only">Gửi lại</span>,
      align: 'right',
      cell: (d) =>
        d.status !== 'SUCCEEDED' ? (
          <Button variant="ghost" size="sm" onClick={() => retry.mutate(d.id)} disabled={retry.isPending}>
            <RotateCcw /> Gửi lại
          </Button>
        ) : null,
    },
  ];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Nhật ký gửi</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="Trạng thái"
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: '', label: 'Tất cả' },
            { value: 'FAILED', label: 'Lỗi' },
            { value: 'PENDING', label: 'Chờ gửi lại' },
            { value: 'SUCCEEDED', label: 'Đã gửi' },
          ]}
        />
        <Select value={targetId} onChange={(e) => (setTargetId(e.target.value), setPage(1))} className="w-56" aria-label="Nơi nhận">
          <option value="">Mọi nơi nhận</option>
          {overview?.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(d) => d.id}
        loading={isFetching}
        empty="Chưa có lần gửi nào"
        pagination={data ? { page, pageSize: 20, total: data.meta.total, onPageChange: setPage } : undefined}
      />
    </section>
  );
}
