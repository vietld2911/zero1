import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, KeyRound, Lock, MoreHorizontal, Pencil, Plus, Search, Unlock } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Badge, Button, ConfirmDialog, DataTable, DropdownMenu, Input, PageHeader, Select, Tabs, cn, toast, type Column } from '@zero1/ui';
import { useApi } from '../api';
import { useMe, usePermission } from '../auth/auth-context';
import { toastError } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useDebounced } from '../lib/use-debounced';
import { TEAM_ORDER, TEAMS } from '../lib/teams';
import { coreKeys, useBranches, useRoles, type User } from '../queries';
import { TemporaryPasswordDialog, UserFormDialog } from '../features/staff/user-form-dialog';

type OrgMember = Schemas['OrgMember'];

export default function StaffPage() {
  const canManage = usePermission('core.users.manage');
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null);

  return (
    <>
      <PageHeader
        title="Nhân sự"
        description="Tài khoản, vai trò, chi nhánh và cây quản lý."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Thêm nhân sự
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { value: 'list', label: 'Danh sách', content: <StaffList onTempPassword={setTempPassword} /> },
          { value: 'tree', label: 'Cây quản lý', content: <OrgTree /> },
        ]}
      />
      <UserFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={({ user, temporaryPassword }) => {
          toast.success(`Đã tạo tài khoản ${user.fullName}`);
          if (temporaryPassword) setTempPassword({ name: `${user.fullName} · ${user.email}`, password: temporaryPassword });
        }}
      />
      <TemporaryPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  );
}

type Pending = { kind: 'lock' | 'unlock' | 'reset'; user: User } | null;

function StaffList({ onTempPassword }: { onTempPassword: (v: { name: string; password: string }) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const canManage = usePermission('core.users.manage');
  const { data: roles = [] } = useRoles();
  const { data: branches = [] } = useBranches();

  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'LOCKED'>('ACTIVE');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const search = useDebounced(q.trim());

  const query = { page, pageSize: 20, q: search || undefined, role: role || undefined, branchId: branchId || undefined, status: status || undefined };
  const { data, isFetching } = useQuery({
    queryKey: [...coreKeys.users, query],
    queryFn: () => unwrap(api.GET('/api/v1/core/users', { params: { query } })),
    placeholderData: keepPreviousData,
  });

  const assignable = useMemo(() => new Set(roles.filter((r) => r.assignable).map((r) => r.code)), [roles]);
  const canManageUser = (u: User) => canManage && u.id !== me.id && assignable.has(u.role);

  const act = useMutation({
    mutationFn: async (p: NonNullable<Pending>) => {
      if (p.kind === 'reset') {
        const res = await unwrap(api.POST('/api/v1/core/users/{id}/reset-password', { params: { path: { id: p.user.id } } }));
        return { password: res.data.temporaryPassword };
      }
      await unwrap(
        api.PATCH('/api/v1/core/users/{id}', {
          params: { path: { id: p.user.id } },
          headers: { 'If-Match': String(p.user.version) },
          body: { status: p.kind === 'lock' ? 'LOCKED' : 'ACTIVE' },
        }),
      );
      return { password: null };
    },
    onSuccess: ({ password }, p) => {
      setPending(null);
      void qc.invalidateQueries({ queryKey: coreKeys.users });
      void qc.invalidateQueries({ queryKey: coreKeys.orgTree });
      if (password) onTempPassword({ name: `${p.user.fullName} · ${p.user.email}`, password });
      else toast.success(p.kind === 'lock' ? `Đã khoá ${p.user.fullName}` : `Đã mở khoá ${p.user.fullName}`);
    },
    onError: toastError,
  });

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'Nhân sự',
      cell: (u) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            {u.fullName}
            {u.id === me.id && <Badge tone="info">Bạn</Badge>}
          </div>
          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Vai trò',
      cell: (u) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone="brand">{u.roleName}</Badge>
          {u.team !== 'MANAGEMENT' && <span className="text-xs text-muted-foreground">Team {TEAMS[u.team].label}</span>}
        </div>
      ),
    },
    {
      key: 'branches',
      header: 'Chi nhánh',
      className: 'hidden md:table-cell',
      cell: (u) => (u.branches.length ? u.branches.map((b) => b.name).join(', ') : <span className="text-muted-foreground">Toàn hệ thống</span>),
    },
    {
      key: 'manager',
      header: 'Quản lý',
      className: 'hidden lg:table-cell',
      cell: (u) => u.manager?.fullName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (u) =>
        u.status === 'LOCKED' ? (
          <Badge tone="danger">Đã khoá</Badge>
        ) : u.mustChangePassword ? (
          <Badge tone="warning">Chờ đổi mật khẩu</Badge>
        ) : (
          <Badge tone="success">Hoạt động</Badge>
        ),
    },
    {
      key: 'lastLogin',
      header: 'Đăng nhập gần nhất',
      className: 'hidden xl:table-cell text-muted-foreground',
      cell: (u) => formatDateTime(u.lastLoginAt),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Thao tác</span>,
      align: 'right',
      cell: (u) =>
        canManageUser(u) ? (
          <DropdownMenu
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Thao tác với ${u.fullName}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            }
            actions={[
              { label: 'Sửa', icon: Pencil, onSelect: () => setEditing(u) },
              { label: 'Cấp mật khẩu tạm', icon: KeyRound, onSelect: () => setPending({ kind: 'reset', user: u }) },
              u.status === 'ACTIVE'
                ? { label: 'Khoá tài khoản', icon: Lock, tone: 'danger', separatorBefore: true, onSelect: () => setPending({ kind: 'lock', user: u }) }
                : { label: 'Mở khoá', icon: Unlock, separatorBefore: true, onSelect: () => setPending({ kind: 'unlock', user: u }) },
            ]}
          />
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_200px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => resetFilters(() => setQ(e.target.value))}
            placeholder="Tìm tên, email, số điện thoại"
            className="pl-9"
            aria-label="Tìm nhân sự"
          />
        </div>
        <Select value={role} onChange={(e) => resetFilters(() => setRole(e.target.value))} aria-label="Lọc theo vai trò">
          <option value="">Tất cả vai trò</option>
          {TEAM_ORDER.map((team) => {
            const inTeam = roles.filter((r) => r.team === team);
            if (!inTeam.length) return null;
            return (
              <optgroup key={team} label={TEAMS[team].label}>
                {inTeam.length > 1 && <option value={inTeam.map((r) => r.code).join(',')}>Cả team {TEAMS[team].label}</option>}
                {inTeam.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </Select>
        <Select value={branchId} onChange={(e) => resetFilters(() => setBranchId(e.target.value))} aria-label="Lọc theo chi nhánh">
          <option value="">Tất cả chi nhánh</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => resetFilters(() => setStatus(e.target.value as typeof status))}
          aria-label="Lọc theo trạng thái"
        >
          <option value="ACTIVE">Đang hoạt động</option>
          <option value="LOCKED">Đã khoá</option>
          <option value="">Tất cả</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(u) => u.id}
        loading={isFetching}
        empty="Không có nhân sự phù hợp"
        onRowClick={(u) => canManageUser(u) && setEditing(u)}
        pagination={data ? { ...data.meta, onPageChange: setPage } : undefined}
      />

      <UserFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} user={editing ?? undefined} onCreated={() => {}} />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'lock' ? 'Khoá tài khoản?' : pending?.kind === 'unlock' ? 'Mở khoá tài khoản?' : 'Cấp mật khẩu tạm?'}
        confirmLabel={pending?.kind === 'lock' ? 'Khoá' : pending?.kind === 'unlock' ? 'Mở khoá' : 'Cấp mật khẩu'}
        tone={pending?.kind === 'lock' ? 'danger' : 'primary'}
        pending={act.isPending}
        onConfirm={() => pending && act.mutate(pending)}
      >
        {pending?.kind === 'lock' && (
          <>
            <strong>{pending.user.fullName}</strong> sẽ bị đăng xuất khỏi mọi thiết bị và không đăng nhập được nữa.
          </>
        )}
        {pending?.kind === 'unlock' && (
          <>
            <strong>{pending.user.fullName}</strong> sẽ đăng nhập lại được bằng mật khẩu hiện có.
          </>
        )}
        {pending?.kind === 'reset' && (
          <>
            Mật khẩu cũ của <strong>{pending.user.fullName}</strong> hết hiệu lực ngay, mọi thiết bị bị đăng xuất. Mật khẩu tạm mới chỉ hiện một lần.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

interface TreeNode extends OrgMember {
  children: TreeNode[];
}

function buildTree(members: OrgMember[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(members.map((m) => [m.id, { ...m, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.managerId ? nodes.get(node.managerId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  // Dưới CM: xếp theo team (Kinh doanh → Vận hành → Học thuật), rồi theo tên.
  const order = (n: TreeNode) => TEAM_ORDER.indexOf(n.team);
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => order(a) - order(b) || a.fullName.localeCompare(b.fullName, 'vi'));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function OrgTree() {
  const api = useApi();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [...coreKeys.orgTree, branchId],
    queryFn: async () =>
      (await unwrap(api.GET('/api/v1/core/org-tree', { params: { query: { branchId: branchId || undefined, includeLocked: false } } }))).data,
  });
  const tree = useMemo(() => buildTree(data ?? []), [data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Cơ cấu</p>
        <p className="mt-1 text-muted-foreground">
          ADMIN, AM quản lý nhiều cơ sở. Mỗi cơ sở do CM phụ trách, gồm 3 team: <strong className="text-foreground">Kinh doanh</strong> (SL → Sale, có thể
          nhiều nhóm), <strong className="text-foreground">Vận hành</strong> (CS, báo cáo thẳng CM) và <strong className="text-foreground">Học thuật</strong>{' '}
          (TL → Giáo viên, Trợ giảng). Nhân sự cơ sở thuộc đúng một chi nhánh.
        </p>
      </div>
      {branches.length > 1 && (
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:max-w-xs" aria-label="Chi nhánh">
          <option value="">Tất cả chi nhánh</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
      <div className="rounded-lg border border-border bg-surface p-3 shadow-card">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Đang tải…</p>
        ) : tree.length ? (
          <ul role="tree" aria-label="Cây quản lý">
            {tree.map((n) => (
              <TreeItem key={n.id} node={n} depth={0} />
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Chưa có nhân sự</p>
        )}
      </div>
    </div>
  );
}

function TreeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={false}>
      <div className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-muted/60" style={{ paddingLeft: depth * 20 + 4 }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn('flex size-5 items-center justify-center rounded text-muted-foreground', !hasChildren && 'invisible')}
          aria-label={open ? 'Thu gọn' : 'Mở rộng'}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="text-sm font-medium">{node.fullName}</span>
        <Badge tone="brand">{node.roleName}</Badge>
        {node.team !== 'MANAGEMENT' && <Badge tone={TEAMS[node.team].tone}>{TEAMS[node.team].label}</Badge>}
        {hasChildren && <span className="text-xs text-muted-foreground">{node.children.length} người</span>}
      </div>
      {hasChildren && open && (
        <ul role="group">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
