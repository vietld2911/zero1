import { useQuery } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@zero1/api-client';
import { useApi } from './api';

export type Branch = Schemas['Branch'];
export type Role = Schemas['Role'];
export type User = Schemas['User'];

export const coreKeys = {
  branches: (includeInactive = false) => ['core', 'branches', { includeInactive }] as const,
  branchesAll: ['core', 'branches'] as const,
  roles: ['core', 'roles'] as const,
  users: ['core', 'users'] as const,
  orgTree: ['core', 'org-tree'] as const,
  settings: ['core', 'settings'] as const,
};

/** Chi nhánh người dùng thấy được (ADMIN: tất cả). */
export function useBranches(includeInactive = false) {
  const api = useApi();
  return useQuery({
    queryKey: coreKeys.branches(includeInactive),
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/branches', { params: { query: { includeInactive } } }))).data,
    staleTime: 5 * 60_000,
  });
}

export function useRoles() {
  const api = useApi();
  return useQuery({
    queryKey: coreKeys.roles,
    queryFn: async () => (await unwrap(api.GET('/api/v1/core/roles'))).data,
    staleTime: 5 * 60_000,
  });
}

/** Nhãn tiếng Việt cho mã vai trò. */
export function useRoleNames() {
  const { data } = useRoles();
  return new Map((data ?? []).map((r) => [r.code, r.name]));
}

/**
 * Nhân sự đang làm việc theo vai trò (để chọn GV, sale phụ trách…).
 * Cần quyền core.users.read — không có quyền thì trả rỗng.
 */
export function useStaffOptions(roles: string[], branchId?: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...coreKeys.users, 'options', { roles, branchId }],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await unwrap(
        api.GET('/api/v1/core/users', { params: { query: { role: roles.join(','), status: 'ACTIVE', branchId, pageSize: 100, page: 1 } } }),
      );
      return res.data;
    },
  });
}
