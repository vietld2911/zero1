import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ShieldX } from 'lucide-react';
import { Card, PageHeader, PlannedModule, type NavGroup } from '@zero1/ui';
import { hasPermission, useMe } from './auth/auth-context';
import type { Me } from './auth/session';

/** Một màn hình trong app: dùng chung cho menu, router, phân quyền và màn "đang xây dựng". */
export interface ModuleDef {
  path: string;
  label: string;
  icon: LucideIcon;
  description: string;
  phase: number;
  features: string[];
  /** Cần ít nhất một trong các quyền này để thấy trên menu và mở được trang. */
  permission?: string | string[];
  /**
   * Trang thật, tải lười để mỗi module là một chunk riêng.
   * Chưa có → hiển thị màn "đang xây dựng".
   */
  page?: () => Promise<{ default: ComponentType }>;
  /** Trang con (chi tiết…) dùng chung quyền của module, không hiện trên menu. Ví dụ `{ path: '/leads/:id', page }`. */
  routes?: Array<{ path: string; page: () => Promise<{ default: ComponentType }> }>;
}

export interface ModuleGroup {
  label?: string;
  modules: ModuleDef[];
}

/** Menu chỉ gồm module người dùng có quyền; nhóm rỗng bị ẩn. */
export function toNav(groups: ModuleGroup[], user: Me): NavGroup[] {
  return groups
    .map((g) => ({
      label: g.label,
      items: g.modules.filter((m) => hasPermission(user, m.permission)).map((m) => ({ to: m.path, label: m.label, icon: m.icon })),
    }))
    .filter((g) => g.items.length > 0);
}

export function PlannedModulePage({ module }: { module: ModuleDef }) {
  return (
    <>
      <PageHeader title={module.label} description={module.description} />
      <PlannedModule phase={module.phase} features={module.features} />
    </>
  );
}

/** Chặn mở trang bằng URL khi không có quyền (server vẫn kiểm tra lại). */
export function ModuleGate({ module, children }: { module: ModuleDef; children: ReactNode }) {
  const me = useMe();
  if (hasPermission(me, module.permission)) return <>{children}</>;
  return (
    <>
      <PageHeader title={module.label} />
      <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <ShieldX className="size-5 text-danger" aria-hidden />
        Bạn không có quyền xem trang này.
      </Card>
    </>
  );
}
