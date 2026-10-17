import { monotonicFactory } from 'ulid';

const next = monotonicFactory();

/** ULID 26 ký tự, tăng dần theo thời gian (docs/api-conventions.md §2). */
export function newId(): string {
  return next();
}
