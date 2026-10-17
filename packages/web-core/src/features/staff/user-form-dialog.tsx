import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { ApiError, unwrap } from '@zero1/api-client';
import { Alert, Button, Checkbox, Dialog, Field, Input, PasswordInput, Select, toast } from '@zero1/ui';
import { useApi } from '../../api';
import { useMe } from '../../auth/auth-context';
import { applyFieldErrors, errorMessage } from '../../lib/errors';
import { coreKeys, useBranches, useRoles, type User } from '../../queries';

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
    email: z.email('Email không hợp lệ'),
    phone: z.string().trim().regex(/^([0-9+ ]{8,20})?$/, 'Số điện thoại không hợp lệ'),
    role: z.string().min(1, 'Chọn vai trò'),
    primaryBranchId: z.string(),
    otherBranchIds: z.array(z.string()),
    managerId: z.string(),
    password: z
      .string()
      .refine((v) => !v || (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v)), 'Tối thiểu 8 ký tự, có chữ và số'),
  })
  .refine((v) => v.role === 'ADMIN' || !!v.primaryBranchId, { path: ['primaryBranchId'], message: 'Chọn chi nhánh chính' });

type FormValues = z.infer<typeof schema>;

/** Cùng chi nhánh chính và cùng tập chi nhánh. */
function sameBranches(user: User, branchIds: string[]) {
  const primary = user.branches.find((b) => b.isPrimary)?.id ?? user.branches[0]?.id;
  const before = new Set(user.branches.map((b) => b.id));
  return primary === branchIds[0] && before.size === branchIds.length && branchIds.every((id) => before.has(id));
}
const FIELDS = ['fullName', 'email', 'phone', 'role', 'managerId', 'password'] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Có → sửa; không → tạo mới. */
  user?: User;
  onCreated: (result: { user: User; temporaryPassword: string | null }) => void;
}

export function UserFormDialog({ open, onOpenChange, user, onCreated }: Props) {
  const api = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const { data: roles = [] } = useRoles();
  const { data: branches = [] } = useBranches();
  const [formError, setFormError] = useState<string | null>(null);

  const defaults: FormValues = useMemo(
    () => ({
      fullName: user?.fullName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      role: user?.role ?? '',
      primaryBranchId: user?.branches.find((b) => b.isPrimary)?.id ?? user?.branches[0]?.id ?? me.branches[0]?.id ?? '',
      otherBranchIds: user?.branches.filter((b) => !b.isPrimary).map((b) => b.id) ?? [],
      managerId: user?.manager?.id ?? '',
      password: '',
    }),
    [user, me.branches],
  );

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setFormError(null);
    }
  }, [open, defaults, form]);

  const role = useWatch({ control: form.control, name: 'role' });
  const primaryBranchId = useWatch({ control: form.control, name: 'primaryBranchId' });
  const otherBranchIds = useWatch({ control: form.control, name: 'otherBranchIds' });
  const roleDef = roles.find((r) => r.code === role);
  // Nhân sự cơ sở thuộc đúng một chi nhánh; chỉ AM / ADMIN được gán nhiều chi nhánh.
  const multiBranch = roleDef?.multiBranch ?? true;
  const managerRoles = roleDef?.managerRoles ?? [];
  const assignable = roles.filter((r) => r.assignable || r.code === user?.role);

  // Ứng viên quản lý: đang hoạt động, cùng chi nhánh chính, đúng vai trò theo cơ cấu (SALE ← SL, GV ← TL…).
  const { data: candidates = [] } = useQuery({
    queryKey: [...coreKeys.users, 'manager-candidates', primaryBranchId],
    enabled: open && !!primaryBranchId,
    queryFn: async () =>
      (
        await unwrap(
          api.GET('/api/v1/core/users', { params: { query: { branchId: primaryBranchId, status: 'ACTIVE', pageSize: 100, page: 1, sort: 'fullName' } } }),
        )
      ).data,
  });
  const managers = candidates.filter((c) => c.id !== user?.id && managerRoles.includes(c.role));
  const roleName = (code: string) => roles.find((r) => r.code === code)?.name ?? code;

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const others = roles.find((r) => r.code === v.role)?.multiBranch ? v.otherBranchIds.filter((b) => b !== v.primaryBranchId) : [];
      const branchIds = v.role === 'ADMIN' && !v.primaryBranchId ? [] : [v.primaryBranchId, ...others];
      if (!user) {
        const res = await unwrap(
          api.POST('/api/v1/core/users', {
            body: {
              fullName: v.fullName,
              email: v.email,
              phone: v.phone || null,
              role: v.role,
              branchIds,
              managerId: v.managerId || null,
              ...(v.password ? { password: v.password } : {}),
            },
          }),
        );
        return { created: res.data };
      }
      // Chỉ gửi phần đã đổi — tránh đụng tới chi nhánh / quản lý ngoài phạm vi của người sửa.
      const patch: Record<string, unknown> = {};
      if (v.fullName !== user.fullName) patch.fullName = v.fullName;
      if (v.email !== user.email) patch.email = v.email;
      if ((v.phone || null) !== user.phone) patch.phone = v.phone || null;
      if (v.role !== user.role) patch.role = v.role;
      if ((v.managerId || null) !== (user.manager?.id ?? null)) patch.managerId = v.managerId || null;
      if (!sameBranches(user, branchIds)) patch.branchIds = branchIds;
      await unwrap(
        api.PATCH('/api/v1/core/users/{id}', {
          params: { path: { id: user.id } },
          headers: { 'If-Match': String(user.version) },
          body: patch,
        }),
      );
      return { created: null };
    },
    onSuccess: ({ created }) => {
      void qc.invalidateQueries({ queryKey: coreKeys.users });
      void qc.invalidateQueries({ queryKey: coreKeys.orgTree });
      void qc.invalidateQueries({ queryKey: coreKeys.branchesAll });
      onOpenChange(false);
      if (created) onCreated(created);
      else toast.success('Đã lưu thay đổi');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') form.setError('email', { message: err.title });
      else if (err instanceof ApiError && err.code === 'MANAGER_INVALID') form.setError('managerId', { message: err.detail ?? err.title });
      else if (!applyFieldErrors(err, form.setError, FIELDS)) setFormError(errorMessage(err));
    },
  });

  const submit = form.handleSubmit((v) => save.mutate(v));
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? 'Sửa nhân sự' : 'Thêm nhân sự'}
      description={user ? user.email : 'Tài khoản mới sẽ phải đổi mật khẩu ở lần đăng nhập đầu.'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {user ? 'Lưu' : 'Tạo tài khoản'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {formError && <Alert tone="danger" className="sm:col-span-2">{formError}</Alert>}
        <Field label="Họ tên" required error={errors.fullName?.message}>
          <Input {...form.register('fullName')} />
        </Field>
        <Field label="Email đăng nhập" required error={errors.email?.message}>
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </Field>
        <Field label="Số điện thoại" error={errors.phone?.message}>
          <Input type="tel" {...form.register('phone')} />
        </Field>
        <Field label="Vai trò" required error={errors.role?.message}>
          <Select {...form.register('role')}>
            <option value="">— Chọn vai trò —</option>
            {assignable.map((r) => (
              <option key={r.code} value={r.code} disabled={!r.assignable}>
                {r.name} ({r.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={multiBranch ? 'Chi nhánh chính' : 'Chi nhánh'}
          required={role !== 'ADMIN'}
          error={errors.primaryBranchId?.message}
          hint={role && !multiBranch ? 'Nhân sự cơ sở thuộc đúng một chi nhánh' : undefined}
        >
          <Select {...form.register('primaryBranchId')}>
            <option value="">— Chọn chi nhánh —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Quản lý trực tiếp"
          error={errors.managerId?.message}
          hint={!role ? 'Chọn vai trò trước' : managerRoles.length ? `${managerRoles.map(roleName).join(' / ')} cùng chi nhánh` : 'Vai trò này không có quản lý trực tiếp'}
        >
          <Select {...form.register('managerId')} disabled={!role || !managerRoles.length}>
            <option value="">— Không có —</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} · {m.roleName}
              </option>
            ))}
          </Select>
        </Field>
        {branches.length > 1 && multiBranch && role !== '' && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Chi nhánh khác</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {branches
                .filter((b) => b.id !== primaryBranchId)
                .map((b) => (
                  <Checkbox
                    key={b.id}
                    label={b.name}
                    checked={otherBranchIds.includes(b.id)}
                    onCheckedChange={(c) =>
                      form.setValue('otherBranchIds', c ? [...otherBranchIds, b.id] : otherBranchIds.filter((x) => x !== b.id), { shouldDirty: true })
                    }
                  />
                ))}
            </div>
          </fieldset>
        )}
        {!user && (
          <Field
            label="Mật khẩu ban đầu"
            className="sm:col-span-2"
            error={errors.password?.message}
            hint="Bỏ trống để hệ thống tự sinh mật khẩu tạm (hiện một lần sau khi tạo)."
          >
            <PasswordInput autoComplete="new-password" {...form.register('password')} />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/** Hiện mật khẩu tạm đúng một lần, kèm nút sao chép. */
export function TemporaryPasswordDialog({ value, onClose }: { value: { name: string; password: string } | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!value}
      onOpenChange={(o) => !o && onClose()}
      title="Mật khẩu tạm"
      description={value?.name}
      size="sm"
      footer={<Button onClick={onClose}>Đã lưu lại</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
          <code className="flex-1 font-mono text-lg tracking-wider select-all">{value?.password}</code>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sao chép"
            onClick={() => {
              void navigator.clipboard.writeText(value?.password ?? '');
              toast.success('Đã sao chép');
            }}
          >
            <Copy />
          </Button>
        </div>
        <Alert tone="warning">Mật khẩu chỉ hiện một lần. Gửi cho nhân sự qua kênh riêng; họ sẽ phải đổi ở lần đăng nhập đầu.</Alert>
      </div>
    </Dialog>
  );
}
