import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { AppError, Errors } from './errors.js';

export interface UploadOptions {
  field: string;
  maxBytes: number;
  /** Kiểu MIME cho phép, ví dụ ['image/', 'application/pdf'] (so tiền tố). */
  accept: string[];
}

/** Nhận một file multipart vào bộ nhớ (giới hạn dung lượng + kiểu file). */
export function uploadSingle({ field, maxBytes, accept }: UploadOptions): RequestHandler {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (accept.some((a) => file.mimetype.startsWith(a))) cb(null, true);
      else cb(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Loại file không được hỗ trợ', file.mimetype));
    },
  }).single(field);

  return (req, res, next) => {
    handler(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'FILE_TOO_LARGE', `File vượt quá ${Math.round(maxBytes / 1_048_576)} MB`));
        return next(Errors.validation([{ path: field, message: err.message }]));
      }
      next(err);
    });
  };
}

/** File đã nhận (ném 400 nếu thiếu). Tên file từ trình duyệt là latin1 → đổi về UTF-8. */
export function requireFile(req: Request, field: string) {
  if (!req.file) throw Errors.validation([{ path: field, message: 'Chưa chọn file' }]);
  return { buffer: req.file.buffer, name: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), mimeType: req.file.mimetype };
}
