export type Env = {
  DB: D1Database;
  EVENT_QUEUE: Queue;
};

export type EventQueuePayload = {
  source: string;
  type: string;
  externalId?: string | null;
  idempotencyKey: string;
  payload?: unknown;
  receivedAt?: string;
};
