import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Field, Input, PasswordInput, Spinner } from '@zero1/ui';
import { ApiError, createApiClient, unwrap } from '@zero1/api-client';
import { APP_URLS, otherApp, type AppMeta } from '../app-meta';
import { apiBaseUrl, useApi } from '../api';
import { applyFieldErrors, errorMessage } from '../lib/errors';
import { AuthLayout } from './auth-layout';
import { useAuthState, useSession } from './auth-context';

/** Chính sách mật khẩu — khớp PasswordSchema phía server. */
export const newPasswordSchema = z
  .string()
  .min(8, 'Tối thiểu 8 ký tự')
  .regex(/[A-Za-z]/, 'Phải có chữ cái')
  .regex(/\d/, 'Phải có chữ số');

const publicApi = () => createApiClient({ baseUrl: apiBaseUrl });

// ───────────────────────────── Đăng nhập

const loginSchema = z.object({
  email: z.email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
});

export function LoginPage({ meta }: { meta: AppMeta }) {
  const session = useSession();
  const state = useAuthState();
  const location = useLocation();
  const next = (location.state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  if (state.status === 'loading') return <FullScreenLoading />;
  if (state.status === 'authenticated') return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await session.login(values.email, values.password);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'TOO_MANY_REQUESTS' ? err.title : errorMessage(err));
    }
  });

  return (
    <AuthLayout meta={meta} title="Đăng nhập" description="Dùng tài khoản Zero1 của bạn — một tài khoản cho cả CRM và LMS.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {(error ?? (state.status === 'anonymous' ? state.reason : undefined)) && (
          <Alert tone="danger">{error ?? (state.status === 'anonymous' ? state.reason : '')}</Alert>
        )}
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Mật khẩu" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-sm text-navy-600 hover:text-navy-900 hover:underline">
            Quên mật khẩu?
          </Link>
        </div>
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
    </AuthLayout>
  );
}

// ───────────────────────────── Quên mật khẩu

export function ForgotPasswordPage({ meta }: { meta: AppMeta }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(z.object({ email: z.email('Email không hợp lệ') })), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await unwrap(publicApi().POST('/api/v1/core/auth/forgot-password', { body: { email, app: meta.key } }));
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout meta={meta} title="Quên mật khẩu" description="Nhập email tài khoản, chúng tôi sẽ gửi liên kết đặt lại mật khẩu.">
      {sent ? (
        <Alert tone="success" title="Đã gửi yêu cầu">
          Nếu email tồn tại trong hệ thống, bạn sẽ nhận được liên kết trong vài phút (hiệu lực 60 phút). Kiểm tra cả hộp thư rác.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
          </Field>
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            Gửi liên kết
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-block text-sm text-navy-600 hover:underline">
        ← Quay lại đăng nhập
      </Link>
    </AuthLayout>
  );
}

// ───────────────────────────── Đặt lại mật khẩu (từ link email)

const resetSchema = z
  .object({ newPassword: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Mật khẩu nhập lại không khớp' });

export function ResetPasswordPage({ meta }: { meta: AppMeta }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm({ resolver: zodResolver(resetSchema), defaultValues: { newPassword: '', confirm: '' } });

  const onSubmit = form.handleSubmit(async ({ newPassword }) => {
    setError(null);
    try {
      await unwrap(publicApi().POST('/api/v1/core/auth/reset-password', { body: { token, newPassword } }));
      setDone(true);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError, ['newPassword'])) setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout meta={meta} title="Đặt mật khẩu mới">
      {!token ? (
        <Alert tone="danger">Liên kết không hợp lệ. Hãy mở lại liên kết trong email.</Alert>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">Đã đặt lại mật khẩu. Mọi thiết bị khác đã được đăng xuất.</Alert>
          <Button size="lg" onClick={() => navigate('/login')}>
            Đăng nhập
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Mật khẩu mới" error={form.formState.errors.newPassword?.message} hint="Tối thiểu 8 ký tự, có chữ và số">
            <PasswordInput autoComplete="new-password" autoFocus {...form.register('newPassword')} />
          </Field>
          <Field label="Nhập lại mật khẩu" error={form.formState.errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            Lưu mật khẩu
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

// ───────────────────────────── Đổi mật khẩu (dùng ở màn bắt buộc và trong hồ sơ)

const changeSchema = z
  .object({ currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'), newPassword: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Mật khẩu nhập lại không khớp' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Mật khẩu mới phải khác mật khẩu hiện tại' });

export function ChangePasswordForm({ onDone, submitLabel = 'Đổi mật khẩu' }: { onDone: () => void; submitLabel?: string }) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(changeSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    try {
      await unwrap(api.POST('/api/v1/core/auth/change-password', { body: { currentPassword, newPassword } }));
      form.reset();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WRONG_CURRENT_PASSWORD') {
        form.setError('currentPassword', { message: err.title });
      } else if (!applyFieldErrors(err, form.setError, ['newPassword'])) {
        setError(errorMessage(err));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Mật khẩu hiện tại" error={form.formState.errors.currentPassword?.message}>
        <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
      </Field>
      <Field label="Mật khẩu mới" error={form.formState.errors.newPassword?.message} hint="Tối thiểu 8 ký tự, có chữ và số">
        <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
      </Field>
      <Field label="Nhập lại mật khẩu mới" error={form.formState.errors.confirm?.message}>
        <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
      </Field>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ForcePasswordChange({ meta }: { meta: AppMeta }) {
  const session = useSession();
  return (
    <AuthLayout meta={meta} title="Đổi mật khẩu" description="Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được cấp lại. Hãy đặt mật khẩu của riêng bạn để tiếp tục.">
      <ChangePasswordForm submitLabel="Đổi mật khẩu và tiếp tục" onDone={() => void session.refresh()} />
      <button type="button" onClick={() => void session.logout()} className="mt-6 text-sm text-navy-600 hover:underline">
        Đăng xuất
      </button>
    </AuthLayout>
  );
}

export function NoAppAccess({ meta, canUseOther }: { meta: AppMeta; canUseOther: boolean }) {
  const session = useSession();
  const other = otherApp(meta.key);
  return (
    <AuthLayout meta={meta} title={`Không có quyền vào ${meta.name}`} description="Vai trò của bạn không dùng ứng dụng này.">
      <div className="flex flex-col gap-3">
        {canUseOther && (
          <a href={APP_URLS[other]} className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-primary-hover">
            Mở {other.toUpperCase()}
          </a>
        )}
        <Button variant="outline" size="lg" onClick={() => void session.logout()}>
          Đăng xuất
        </Button>
      </div>
    </AuthLayout>
  );
}

export function FullScreenLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="Đang tải…" />
    </div>
  );
}
