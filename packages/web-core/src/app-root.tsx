import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from '@zero1/ui';
import { ApiProvider, apiBaseUrl, createAuthedApiClient, createQueryClient } from './api';
import { AuthProvider } from './auth/auth-context';
import { createSession, type Session } from './auth/session';
import { createAppRouter } from './app-router';
import type { AppMeta } from './app-meta';
import type { ModuleGroup } from './modules';

/** Đăng xuất → xoá toàn bộ dữ liệu đã cache để người sau không thấy. */
function useClearCacheOnLogout(session: Session, queryClient: QueryClient) {
  useEffect(
    () =>
      session.subscribe(() => {
        if (session.getState().status === 'anonymous') queryClient.clear();
      }),
    [session, queryClient],
  );
}

function AppRoot({ meta, groups }: { meta: AppMeta; groups: ModuleGroup[] }) {
  const [session] = useState(() => createSession(apiBaseUrl));
  const [apiClient] = useState(() => createAuthedApiClient(session));
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter(meta, groups));
  useClearCacheOnLogout(session, queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={apiClient}>
        <AuthProvider session={session}>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

/** Điểm khởi động chung của CRM và LMS. */
export function mountApp(meta: AppMeta, groups: ModuleGroup[], elementId = 'root') {
  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Không tìm thấy #${elementId}`);
  createRoot(el).render(
    <StrictMode>
      <AppRoot meta={meta} groups={groups} />
    </StrictMode>,
  );
}
