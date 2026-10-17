/** Lỗi trùng khoá unique của MySQL / MariaDB (Drizzle bọc lỗi gốc trong `cause`). */
export function isDuplicateKey(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return true;
  }
  return false;
}
