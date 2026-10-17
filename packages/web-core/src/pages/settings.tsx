import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Tabs, toast } from '@zero1/ui';
import { useApi } from '../api';
import { usePermission } from '../auth/auth-context';
import { errorMessage, toastError } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { coreKeys, useBranches, useRoles } from '../queries';
import { IntegrationsTab } from '../features/integrations/integrations-tab';

type Setting = Schemas['Setting'];
type Input =
  | { kind: 'number'; unit?: string; min?: number; max?: number; step?: number }
  | { kind: 'boolean' }
  | { kind: 'text' }
  | { kind: 'multiselect'; options: Array<{ value: string; label: string }> };

const appLabel = { core: 'Hệ thống', crm: 'CRM — Kinh doanh', lms: 'LMS — Đào tạo' } as const;

export default function SettingsPage() {
  const canRoles = usePermission('core.roles.manage');
  const canIntegrations = usePermission('core.integrations.manage');
  return (
    <>
      <PageHeader title="Cài đặt" description="Cấu hình hệ thống, phân quyền theo vai trò, email và tích hợp (Telegram, webhook, API key)." />
      <Tabs
        tabs={[
          { value: 'settings', label: 'Cấu hình', content: <SettingsList /> },
          { value: 'roles', label: 'Phân quyền', hidden: !canRoles, content: <RolesMatrix /> },
          { value: 'email', label: 'Email', content: <EmailSettings /> },
          { value: 'integrations', label: 'Tích hợp', hidden: !canIntegrations, content: <IntegrationsTab /> },
        ]}
      />
    </>
  );
}

// ───────────────────────────── Cấu hình

function useSettingMutations() {
  const api = useApi();
  const qc = useQueryClient();
  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: coreKeys.settings });
  };
  const set = useMutation({
    mutationFn: ({ key, value, branchId }: { key: string; value: unknown; branchId?: string }) =>
      unwrap(api.PATCH('/api/v1/core/settings/{key}', { params: { path: { key } }, body: { value, branchId: branchId ?? null } })),
    onSuccess: () => done('Đã lưu cấu hình'),
    onError: toastError,
  });
  const clear = useMutation({
    mutationFn: ({ key, branchId }: { key: string; branchId?: string }) =>
      unwrap(api.DELETE('/api/v1/core/settings/{key}', { params: { path: { key }, query: { branchId } } })),
    onSuccess: () => done('Đã khôi phục'),
    onError: toastError,
  });
  return { set, clear };
}

function SettingsList() {
  const api = useApi();
  const { data, isLoading, error } = useQuery({
    queryKey: coreKeys.settings,
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/settings'))).data,
  });

  if (isLoading) return <Spinner label="Đang tải…" />;
  if (error) return <Alert tone="danger">{errorMessage(error)}</Alert>;

  const groups = (['core', 'crm', 'lms'] as const).map((app) => ({ app, items: (data ?? []).filter((s) => s.app === app) })).filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g.app}>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{appLabel[g.app]}</h2>
          <div className="flex flex-col gap-3">
            {g.items.map((s) => (
              <SettingCard key={s.key} setting={s} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function displayValue(input: Input, value: unknown): string {
  if (input.kind === 'number') return input.unit === 'đ' ? formatMoney(Number(value)) : `${String(value)}${input.unit ? ` ${input.unit}` : ''}`;
  if (input.kind === 'boolean') return value ? 'Bật' : 'Tắt';
  if (input.kind === 'multiselect') {
    const values = Array.isArray(value) ? (value as string[]) : [];
    return values.map((v) => input.options.find((o) => o.value === v)?.label ?? v).join(', ');
  }
  return String(value ?? '');
}

function SettingCard({ setting }: { setting: Setting }) {
  const input = setting.input as unknown as Input;
  const { set, clear } = useSettingMutations();
  const { data: branches = [] } = useBranches();
  const effective = setting.value ?? setting.defaultValue;
  const [draft, setDraft] = useState<unknown>(effective);
  const [newBranch, setNewBranch] = useState('');
  const [branchDraft, setBranchDraft] = useState<unknown>(effective);
  useEffect(() => setDraft(setting.value ?? setting.defaultValue), [setting.value, setting.defaultValue]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(effective);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? 'Chi nhánh khác';
  const usedBranches = new Set(setting.branchValues.map((b) => b.branchId));

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{setting.label}</h3>
            {setting.value === null && <Badge>Mặc định</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{setting.description}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground/80">{setting.key}</p>
        </div>
        <div className="flex flex-col gap-2 lg:w-80">
          <ValueEditor input={input} value={draft} onChange={setDraft} label={setting.label} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!dirty || set.isPending} onClick={() => set.mutate({ key: setting.key, value: draft })}>
              <Save /> Lưu
            </Button>
            {setting.value !== null && (
              <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate({ key: setting.key })}>
                <RotateCcw /> Về mặc định ({displayValue(input, setting.defaultValue)})
              </Button>
            )}
          </div>
        </div>
      </div>

      {setting.branchOverride && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">Giá trị riêng theo chi nhánh</p>
          {setting.branchValues.length > 0 && (
            <ul className="mb-3 divide-y divide-border rounded-md border border-border">
              {setting.branchValues.map((bv) => (
                <li key={bv.branchId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>{branchName(bv.branchId)}</span>
                  <span className="flex items-center gap-2">
                    <strong>{displayValue(input, bv.value)}</strong>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Xoá giá trị riêng của ${branchName(bv.branchId)}`}
                      onClick={() => clear.mutate({ key: setting.key, branchId: bv.branchId })}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Select value={newBranch} onChange={(e) => setNewBranch(e.target.value)} className="sm:w-56" aria-label="Chi nhánh">
              <option value="">— Chọn chi nhánh —</option>
              {branches
                .filter((b) => !usedBranches.has(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </Select>
            {newBranch && (
              <>
                <div className="sm:w-56">
                  <ValueEditor input={input} value={branchDraft} onChange={setBranchDraft} label={`${setting.label} — ${branchName(newBranch)}`} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={set.isPending}
                  onClick={() => set.mutate({ key: setting.key, value: branchDraft, branchId: newBranch }, { onSuccess: () => setNewBranch('') })}
                >
                  Thêm
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function ValueEditor({ input, value, onChange, label }: { input: Input; value: unknown; onChange: (v: unknown) => void; label: string }) {
  switch (input.kind) {
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            aria-label={label}
            value={String(value ?? '')}
            min={input.min}
            max={input.max}
            step={input.step ?? 1}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {input.unit && <span className="shrink-0 text-sm text-muted-foreground">{input.unit}</span>}
        </div>
      );
    case 'boolean':
      return <Checkbox label="Bật" checked={!!value} onCheckedChange={onChange} />;
    case 'multiselect': {
      const values = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid grid-cols-2 gap-2">
          {input.options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={values.includes(o.value)}
              onCheckedChange={(c) => onChange(c ? [...values, o.value] : values.filter((v) => v !== o.value))}
            />
          ))}
        </div>
      );
    }
    default:
      return <Input aria-label={label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

// ───────────────────────────── Phân quyền

function RolesMatrix() {
  const api = useApi();
  const qc = useQueryClient();
  const { data: roles, isLoading } = useRoles();
  const { data: permissions } = useQuery({
    queryKey: ['core', 'permissions'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/permissions'))).data,
  });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const original = useMemo(() => Object.fromEntries((roles ?? []).map((r) => [r.code, new Set(r.permissions)])), [roles]);
  useEffect(() => setDraft(Object.fromEntries(Object.entries(original).map(([k, v]) => [k, new Set(v)]))), [original]);

  const dirtyRoles = Object.keys(draft).filter((code) => {
    const a = draft[code]!;
    const b = original[code];
    return !b || a.size !== b.size || [...a].some((p) => !b.has(p));
  });

  const save = useMutation({
    mutationFn: async () => {
      for (const code of dirtyRoles) {
        await unwrap(api.PATCH('/api/v1/core/roles/{code}', { params: { path: { code } }, body: { permissions: [...draft[code]!] } }));
      }
    },
    onSuccess: () => {
      toast.success('Đã cập nhật phân quyền');
      void qc.invalidateQueries({ queryKey: coreKeys.roles });
    },
    onError: toastError,
  });

  if (isLoading || !roles || !permissions) return <Spinner label="Đang tải…" />;

  const toggle = (role: string, perm: string, on: boolean) =>
    setDraft((d) => {
      const next = new Set(d[role]);
      if (on) next.add(perm);
      else next.delete(perm);
      return { ...d, [role]: next };
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Thay đổi có hiệu lực ngay khi lưu. Phạm vi dữ liệu (chi nhánh / đội / của mình) vẫn áp dụng theo vai trò.</p>
        <div className="flex gap-2">
          {dirtyRoles.length > 0 && (
            <Button variant="ghost" onClick={() => setDraft(Object.fromEntries(Object.entries(original).map(([k, v]) => [k, new Set(v)])))}>
              Huỷ thay đổi
            </Button>
          )}
          <Button disabled={!dirtyRoles.length || save.isPending} onClick={() => save.mutate()}>
            <Save /> Lưu {dirtyRoles.length ? `(${dirtyRoles.length} vai trò)` : ''}
          </Button>
        </div>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-64 bg-muted px-3 py-2 text-left font-medium">
                Quyền
              </th>
              {roles.map((r) => (
                <th key={r.code} scope="col" className="px-2 py-2 text-center font-medium" title={r.name}>
                  {r.code}
                </th>
              ))}
            </tr>
          </thead>
          {(['core', 'crm', 'lms'] as const).map((app) => (
            <tbody key={app} className="divide-y divide-border">
              <tr>
                <th colSpan={roles.length + 1} scope="colgroup" className="sticky left-0 bg-navy-50 px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-navy-700 uppercase">
                  {appLabel[app]}
                </th>
              </tr>
              {permissions
                .filter((p) => p.app === app)
                .map((p) => (
                  <tr key={p.code} className="hover:bg-muted/40">
                    <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-normal">
                      <div>{p.description}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{p.code}</div>
                    </th>
                    {roles.map((r) => {
                      const locked = r.code === 'ADMIN' && p.code === 'core.roles.manage';
                      return (
                        <td key={r.code} className="px-2 py-2 text-center">
                          <div className="flex justify-center">
                            <Checkbox
                              aria-label={`${r.code} — ${p.code}`}
                              checked={draft[r.code]?.has(p.code) ?? false}
                              disabled={locked}
                              onCheckedChange={(c) => toggle(r.code, p.code, c)}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

// ───────────────────────────── Email

function EmailSettings() {
  const api = useApi();
  const [to, setTo] = useState('');
  const { data } = useQuery({
    queryKey: [...coreKeys.settings, 'email'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/settings/email'))).data,
  });
  const test = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/core/settings/email/test', { body: { to } })),
    onSuccess: () => toast.success(`Đã gửi email thử tới ${to}`),
    onError: toastError,
  });

  return (
    <Card className="flex max-w-xl flex-col gap-4 p-5">
      {data && (
        <Alert tone={data.configured ? 'success' : 'warning'} title={data.configured ? 'SMTP đã cấu hình' : 'Chưa cấu hình SMTP'}>
          {data.configured ? (
            <>Email gửi từ: {data.from}</>
          ) : (
            <>Đặt các biến SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM trong file .env của server rồi khởi động lại. Khi chưa cấu hình, email (mật khẩu tạm, đặt lại mật khẩu) chỉ được ghi vào log.</>
          )}
        </Alert>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          test.mutate();
        }}
      >
        <Field label="Gửi email thử tới" className="flex-1">
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ban@zero1.vn" />
        </Field>
        <Button type="submit" variant="outline" disabled={!to || !data?.configured || test.isPending}>
          <Send /> Gửi thử
        </Button>
      </form>
    </Card>
  );
}
