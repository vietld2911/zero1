import type { RequestHandler } from 'express';
import { newId } from '../ids.js';

const VALID = /^[\w-]{8,64}$/;

/** Nhận X-Request-Id từ client (nếu hợp lệ) hoặc tự sinh; trả lại trong response để truy vết log. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && VALID.test(incoming) ? incoming : newId();
  res.setHeader('x-request-id', id);
  next();
};
