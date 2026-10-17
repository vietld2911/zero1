import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import type { DataScope } from './principal.js';

export interface ScopeColumns {
  /** Cột chi nhánh của bản ghi. */
  branch?: MySqlColumn;
  /** Cột người phụ trách (SALE / CS …). */
  owner?: MySqlColumn;
  /** Các cột giáo viên / trợ giảng. */
  teachers?: MySqlColumn[];
}

/** Luôn sai — dùng khi phạm vi rỗng để không lộ dữ liệu. */
const NOTHING = sql`1 = 0`;

/**
 * Điều kiện WHERE theo phạm vi dữ liệu. Trả `undefined` nghĩa là không lọc (ALL).
 * Thiếu cột cần cho phạm vi → không trả gì (an toàn mặc định), không bỏ qua lọc.
 */
export function scopeWhere(scope: DataScope, cols: ScopeColumns): SQL | undefined {
  if (scope.kind === 'ALL') return undefined;

  const branchCond = cols.branch
    ? scope.branchIds.length
      ? inArray(cols.branch, scope.branchIds)
      : NOTHING
    : undefined;

  switch (scope.kind) {
    case 'BRANCHES':
      return branchCond ?? NOTHING;
    case 'TEAM':
      if (!cols.owner) return NOTHING;
      return and(branchCond, scope.userIds.length ? inArray(cols.owner, scope.userIds) : NOTHING);
    case 'OWN':
      if (!cols.owner) return NOTHING;
      return and(branchCond, eq(cols.owner, scope.userId));
    case 'TEACHING': {
      if (!cols.teachers?.length) return NOTHING;
      return and(branchCond, or(...cols.teachers.map((c) => eq(c, scope.userId))));
    }
  }
}
