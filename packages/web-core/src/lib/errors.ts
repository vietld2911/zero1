import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@zero1/api-client';
import { toast } from '@zero1/ui';

/** Câu thông báo cho người dùng từ một lỗi bất kỳ. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail ? `${err.title}: ${err.detail}` : err.title;
  return 'Có lỗi xảy ra, vui lòng thử lại';
}

export function toastError(err: unknown) {
  toast.error(errorMessage(err));
}

/**
 * Gắn lỗi validation từ server (`body.email`) vào đúng ô trong form.
 * Trả về true nếu đã gắn được ít nhất một lỗi.
 */
export function applyFieldErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): boolean {
  if (!(err instanceof ApiError) || !err.errors?.length) return false;
  let applied = false;
  for (const e of err.errors) {
    const field = e.path.replace(/^body\./, '').split('.')[0]!;
    if (fields.includes(field)) {
      setError(field as Path<T>, { type: 'server', message: e.message });
      applied = true;
    }
  }
  return applied;
}
