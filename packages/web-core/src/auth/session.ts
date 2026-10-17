import { ApiError, createApiClient, unwrap, type Schemas } from '@zero1/api-client';

export type Me = Schemas['Me'];

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: string }
  | { status: 'authenticated'; user: Me };

interface SessionPayload {
  accessToken: string;
  expiresIn: number;
  user: Me;
}

/** Làm mới trước khi access token hết hạn chừng này. */
const REFRESH_MARGIN_MS = 30_000;

/**
 * Phiên đăng nhập của web app.
 * - Access token chỉ giữ trong bộ nhớ (không localStorage → XSS không đọc được lâu dài).
 * - Refresh token nằm trong cookie httpOnly; mọi tab dùng chung cookie, nên refresh được
 *   xếp hàng qua `navigator.locks` để hai tab không xoay cùng một token.
 * - Đăng nhập / đăng xuất ở một tab được báo cho các tab khác qua BroadcastChannel.
 */
export function createSession(baseUrl = '') {
  // Client "trần" cho các endpoint auth — không gắn token, không tự refresh (tránh vòng lặp).
  const raw = createApiClient({ baseUrl });
  let state: SessionState = { status: 'loading' };
  let accessToken: string | null = null;
  let expiresAt = 0;
  let inflight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('zero1-auth') : null;

  function set(next: SessionState) {
    state = next;
    for (const l of listeners) l();
  }

  function apply(payload: SessionPayload) {
    accessToken = payload.accessToken;
    expiresAt = Date.now() + payload.expiresIn * 1000;
    set({ status: 'authenticated', user: payload.user });
  }

  function clear(reason?: string) {
    accessToken = null;
    expiresAt = 0;
    set({ status: 'anonymous', reason });
  }

  async function doRefresh(): Promise<boolean> {
    const run = async () => {
      try {
        const res = await unwrap(raw.POST('/api/v1/core/auth/refresh', { body: {} }));
        apply(res.data as SessionPayload);
        return true;
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status >= 400 && status < 500) {
          // Server trả lời rõ ràng: phiên không còn dùng được → về màn đăng nhập.
          clear(err instanceof ApiError && err.code === 'ACCOUNT_LOCKED' ? 'Tài khoản đã bị khoá' : undefined);
        } else if (state.status === 'loading') {
          // Mất mạng / server lỗi lúc mở app. Đang đăng nhập dở thì giữ phiên, lần gọi sau thử lại.
          clear('Không kết nối được máy chủ');
        }
        return false;
      }
    };
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('zero1-auth-refresh', run)
      : run();
  }

  function refresh(): Promise<boolean> {
    inflight ??= doRefresh().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  channel?.addEventListener('message', (e: MessageEvent<string>) => {
    if (e.data === 'logout') clear();
    if (e.data === 'login' && state.status !== 'authenticated') void refresh();
  });

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Khôi phục phiên từ cookie khi mở app. */
    bootstrap: () => refresh(),

    refresh,

    /** Token còn hạn — tự refresh nếu sắp hết. Dùng cho mọi request API. */
    async getAccessToken(): Promise<string | null> {
      if (accessToken && Date.now() < expiresAt - REFRESH_MARGIN_MS) return accessToken;
      if (state.status !== 'authenticated') return accessToken;
      await refresh();
      return accessToken;
    },

    /** API trả 401 giữa chừng (token bị thu hồi, tài khoản bị khoá) → thử refresh, thất bại thì về màn đăng nhập. */
    handleUnauthorized(code?: string) {
      if (state.status !== 'authenticated') return;
      if (code === 'ACCOUNT_LOCKED') return clear('Tài khoản đã bị khoá');
      void refresh();
    },

    async login(email: string, password: string) {
      const res = await unwrap(raw.POST('/api/v1/core/auth/login', { body: { email, password } }));
      apply(res.data as SessionPayload);
      channel?.postMessage('login');
    },

    async logout() {
      try {
        await raw.POST('/api/v1/core/auth/logout', { body: {} });
      } finally {
        clear();
        channel?.postMessage('logout');
      }
    },

    /** Cập nhật thông tin người dùng sau khi đổi hồ sơ / mật khẩu. */
    setUser(user: Me) {
      if (state.status === 'authenticated') set({ status: 'authenticated', user });
    },
  };
}

export type Session = ReturnType<typeof createSession>;
