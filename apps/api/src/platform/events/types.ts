export type EventSource = 'core' | 'crm' | 'lms';

/** Envelope chung cho mọi sự kiện (docs/events.md §2). */
export interface EventEnvelope<TData = unknown> {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  source: EventSource;
  aggregateId: string;
  branchId: string | null;
  actorId: string | null;
  data: TData;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface Subscription {
  /** Tên duy nhất, dùng làm khóa idempotency cùng event id. Ví dụ `lms.learners.onEnrollmentActivated`. */
  name: string;
  type: string;
  handle: EventHandler;
}

/** Nguồn đọc outbox của một database. Tách interface để dispatcher test được không cần DB. */
export interface OutboxSource {
  name: EventSource;
  fetchPending(limit: number): Promise<EventEnvelope[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
