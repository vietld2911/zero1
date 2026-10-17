import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Me, Session } from './session';

const SessionContext = createContext<Session | null>(null);

export function AuthProvider({ session, children }: { session: Session; children: ReactNode }) {
  useEffect(() => {
    void session.bootstrap();
  }, [session]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession phải nằm trong <AuthProvider>');
  return session;
}

export function useAuthState() {
  const session = useSession();
  return useSyncExternalStore(session.subscribe, session.getState);
}

/** Người dùng hiện tại — chỉ dùng bên trong vùng đã đăng nhập. */
export function useMe(): Me {
  const state = useAuthState();
  if (state.status !== 'authenticated') throw new Error('useMe chỉ dùng khi đã đăng nhập');
  return state.user;
}

/** Có ít nhất một trong các quyền. */
export function hasPermission(user: Me, permission: string | string[] | undefined): boolean {
  if (!permission) return true;
  const list = Array.isArray(permission) ? permission : [permission];
  return list.some((p) => user.permissions.includes(p));
}

export function usePermission(permission: string | string[]): boolean {
  return hasPermission(useMe(), permission);
}

/** Ẩn phần giao diện khi không có quyền. Server vẫn kiểm tra lại — đây chỉ là trải nghiệm. */
export function RequirePermission({ permission, children, fallback = null }: { permission: string | string[]; children: ReactNode; fallback?: ReactNode }) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>;
}
