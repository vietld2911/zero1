import { useEffect } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet, useLocation, type RouteObject } from 'react-router';
import { AppShell, buttonVariants, Card, cn, PageHeader } from '@zero1/ui';
import { ApiStatus } from './api-status';
import { AppSwitchLink } from './app-switch';
import { otherApp, type AppMeta } from './app-meta';
import { useAuthState } from './auth/auth-context';
import {
  ForcePasswordChange,
  ForgotPasswordPage,
  FullScreenLoading,
  LoginPage,
  NoAppAccess,
  ResetPasswordPage,
} from './auth/auth-pages';
import { ModuleGate, PlannedModulePage, toNav, type ModuleDef, type ModuleGroup } from './modules';
import { PunchButton, UserMenu } from './shell/topbar';
import { NotificationBell } from './shell/notifications';

/** Vùng cần đăng nhập: phiên → quyền vào app → bắt buộc đổi mật khẩu → layout. */
function Protected({ meta, groups }: { meta: AppMeta; groups: ModuleGroup[] }) {
  const state = useAuthState();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (state.status === 'loading') return <FullScreenLoading />;
  if (state.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  const user = state.user;
  if (!user.apps.includes(meta.key)) return <NoAppAccess meta={meta} canUseOther={user.apps.includes(otherApp(meta.key))} />;
  if (user.mustChangePassword) return <ForcePasswordChange meta={meta} />;

  return (
    <AppShell
      appName={meta.name}
      appTagline={meta.tagline}
      nav={toNav(groups, user)}
      sidebarFooter={
        <>
          <ApiStatus />
          {user.apps.includes(otherApp(meta.key)) && <AppSwitchLink to={otherApp(meta.key)} />}
        </>
      }
      topbarEnd={
        <>
          <PunchButton />
          <NotificationBell app={meta.key} />
          <UserMenu />
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}

function NotFound() {
  return (
    <>
      <PageHeader title="Không tìm thấy trang" />
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Đường dẫn không tồn tại hoặc đã được đổi.</p>
        <Link to="/" className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}>
          Về trang chính
        </Link>
      </Card>
    </>
  );
}

function lazyPage(module: ModuleDef, load: NonNullable<ModuleDef['page']>): RouteObject['lazy'] {
  return async () => {
    const Page = (await load()).default;
    return {
      Component: () => (
        <ModuleGate module={module}>
          <Page />
        </ModuleGate>
      ),
    };
  };
}

function toRoutes(module: ModuleDef): RouteObject[] {
  const route: RouteObject = module.path === '/' ? { index: true } : { path: module.path.slice(1) };
  const extra = (module.routes ?? []).map((r) => ({ path: r.path.slice(1), lazy: lazyPage(module, r.page) }));
  if (module.page) {
    route.lazy = lazyPage(module, module.page);
  } else {
    route.element = (
      <ModuleGate module={module}>
        <PlannedModulePage module={module} />
      </ModuleGate>
    );
  }
  return [route, ...extra];
}

/** Router của một app: các trang đăng nhập + layout chung + mỗi module một route + 404. */
export function createAppRouter(meta: AppMeta, groups: ModuleGroup[]) {
  document.title = `Zero1 ${meta.name}`;
  return createBrowserRouter([
    { path: '/login', element: <LoginPage meta={meta} /> },
    { path: '/forgot-password', element: <ForgotPasswordPage meta={meta} /> },
    { path: '/reset-password', element: <ResetPasswordPage meta={meta} /> },
    {
      path: '/',
      element: <Protected meta={meta} groups={groups} />,
      children: [...groups.flatMap((g) => g.modules.flatMap(toRoutes)), { path: '*', element: <NotFound /> }],
    },
  ]);
}
