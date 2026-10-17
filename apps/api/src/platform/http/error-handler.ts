import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logger.js';
import { AppError } from './errors.js';

function send(res: Parameters<RequestHandler>[1], err: AppError) {
  res
    .status(err.status)
    .type('application/problem+json')
    .json({
      type: `urn:zero1:error:${err.code}`,
      title: err.title,
      status: err.status,
      code: err.code,
      ...(err.detail ? { detail: err.detail } : {}),
      ...(err.errors ? { errors: err.errors } : {}),
      requestId: String(res.getHeader('x-request-id') ?? ''),
    });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  send(res, new AppError(404, 'ROUTE_NOT_FOUND', 'Không tìm thấy endpoint', `${req.method} ${req.path}`));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      send(res, err);
      return;
    }
    // Body JSON hỏng (express.json)
    if (err?.type === 'entity.parse.failed') {
      send(res, new AppError(400, 'INVALID_JSON', 'Body không phải JSON hợp lệ'));
      return;
    }
    if (err?.type === 'entity.too.large') {
      send(res, new AppError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn'));
      return;
    }
    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    send(res, new AppError(500, 'INTERNAL_ERROR', 'Lỗi hệ thống, vui lòng thử lại sau'));
  };
}
