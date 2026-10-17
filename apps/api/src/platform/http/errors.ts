export interface FieldError {
  path: string;
  message: string;
}

/**
 * Lỗi nghiệp vụ có chủ đích. `code` là hằng số ổn định cho client,
 * `title`/`detail` là tiếng Việt để hiển thị (docs/api-conventions.md §3).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (errors: FieldError[]) =>
    new AppError(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', undefined, errors),
  unauthenticated: (detail?: string) => new AppError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập', detail),
  forbidden: (detail?: string) => new AppError(403, 'FORBIDDEN', 'Không có quyền thực hiện', detail),
  notFound: (entity: string) => new AppError(404, 'NOT_FOUND', `Không tìm thấy ${entity}`),
  conflict: (code: string, title: string, detail?: string) => new AppError(409, code, title, detail),
  unprocessable: (code: string, title: string, detail?: string) => new AppError(422, code, title, detail),
};
