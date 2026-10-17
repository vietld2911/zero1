import { createContext, useContext, type ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, createApiClient, type ApiClient } from '@zero1/api-client';
import type { Session } from './auth/session';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi phải nằm trong <ApiProvider>');
  return client;
}

export const apiBaseUrl = import.meta.env.VITE_API_URL ?? '';

/** Client cho mọi request nghiệp vụ: tự gắn token còn hạn, xử lý 401. */
export function createAuthedApiClient(session: Session) {
  return createApiClient({
    baseUrl: apiBaseUrl,
    getAccessToken: () => session.getAccessToken(),
    onUnauthorized: (problem) => session.handleUnauthorized(problem.code),
  });
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Lỗi 4xx là lỗi nghiệp vụ/quyền — thử lại không giúp gì.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  });
}

/** URL file đã tải lên (`/files/...` khi lưu cục bộ) → URL đầy đủ khi API ở domain khác. */
export const fileUrl = (url: string) => (url.startsWith('/') ? `${apiBaseUrl}${url}` : url);
