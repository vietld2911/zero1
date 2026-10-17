import { newId } from '../../../../platform/ids.js';
import type { CoreExecutor } from '../../db/types.js';
import { auditLogs } from '../../db/schema.js';

export interface AuditEntry {
  actorId: string | null;
  /** Ví dụ `user.created`, `role.permissions_changed`. */
  action: string;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const SECRET_KEYS = new Set(['passwordHash', 'password', 'tokenHash']);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, v]) => [k, redact(v)]),
  );
}

/** Ghi nhật ký thay đổi trong cùng transaction với thay đổi. Không bao giờ lưu mật khẩu / hash. */
export async function writeAudit(tx: CoreExecutor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    id: newId(),
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    branchId: entry.branchId ?? null,
    before: redact(entry.before),
    after: redact(entry.after),
    ip: entry.ip ?? null,
  });
}
