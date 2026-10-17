import { asc, desc, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { Errors } from './errors.js';

/**
 * Đọc tham số `sort` (`-createdAt,fullName`) thành ORDER BY.
 * Chỉ cho phép field khai báo trong `allowed` — field lạ → 400.
 */
export function parseSort(sort: string | undefined, allowed: Record<string, MySqlColumn>, fallback: SQL[]): SQL[] {
  if (!sort) return fallback;
  return sort.split(',').map((raw) => {
    const field = raw.trim().replace(/^-/, '');
    const column = allowed[field];
    if (!column) {
      throw Errors.validation([
        { path: 'query.sort', message: `Không sắp xếp được theo "${field}". Cho phép: ${Object.keys(allowed).join(', ')}` },
      ]);
    }
    return raw.trim().startsWith('-') ? desc(column) : asc(column);
  });
}

export function pageOffset(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total };
}

/** Escape ký tự đặc biệt của LIKE để tìm kiếm tự do an toàn. */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Danh sách giá trị cách nhau dấu phẩy trong query string (`status=A,B`). */
export function csvList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}
