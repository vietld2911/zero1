import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'];

/** Lỗi API đã chuẩn hoá theo RFC 7807 — UI xử lý theo `code`, hiển thị `title`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: Problem['errors'];
  readonly requestId?: string;

  constructor(problem: Partial<Problem> & { status: number }) {
    super(problem.detail ?? problem.title ?? `HTTP ${problem.status}`);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code ?? 'UNKNOWN_ERROR';
    this.title = problem.title ?? 'Có lỗi xảy ra';
    this.detail = problem.detail;
    this.errors = problem.errors;
    this.requestId = problem.requestId;
  }
}

export interface ApiClientOptions {
  /** Mặc định '' — gọi cùng origin (dev dùng proxy của Vite). */
  baseUrl?: string;
  /** Trả access token còn hạn (có thể refresh trước khi trả). */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Gọi khi API trả 401 (token bị thu hồi, tài khoản bị khoá…). */
  onUnauthorized?: (problem: Partial<Problem>) => void;
}

export function createApiClient({ baseUrl = '', getAccessToken, onUnauthorized }: ApiClientOptions = {}) {
  const client = createClient<paths>({ baseUrl, credentials: 'include' });

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await getAccessToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401 && onUnauthorized) {
        const problem = (await response.clone().json().catch(() => ({}))) as Partial<Problem>;
        onUnauthorized(problem);
      }
      return response;
    },
  };
  if (getAccessToken || onUnauthorized) client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Lấy body từ kết quả openapi-fetch, ném ApiError nếu lỗi.
 * Dùng trong queryFn/mutationFn của TanStack Query.
 */
export async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await promise;
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', title: 'Không kết nối được máy chủ' });
  }
  const { data, error, response } = result;
  if (response.ok) return data as T;
  const problem = (error && typeof error === 'object' ? error : {}) as Partial<Problem>;
  throw new ApiError({ ...problem, status: response.status });
}

type JsonData<R> = R extends { content: { 'application/json': { data: infer D } } } ? D : never;

/**
 * Kiểu `data` trả về của một endpoint (200 hoặc 201) — dùng cho schema khai báo inline.
 * Ví dụ: `ApiData<'/api/v1/crm/appointments'>[number]`.
 */
export type ApiData<P extends keyof paths, M extends 'get' | 'post' | 'patch' = 'get'> = paths[P] extends Record<M, { responses: infer R }>
  ? R extends { 200: infer OK }
    ? JsonData<OK>
    : R extends { 201: infer Created }
      ? JsonData<Created>
      : never
  : never;
