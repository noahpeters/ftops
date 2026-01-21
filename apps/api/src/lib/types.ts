export type Env = {
  DB: D1Database;
  EVENT_QUEUE: Queue;
  R2_TASK_FILES_BUCKET: R2Bucket;
  R2_TASK_FILES_BUCKET_NAME?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  ALLOW_R2_FALLBACK_UPLOADS?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  INTEGRATIONS_KEY_ID?: string;
};

export type EventQueuePayload = {
  source: string;
  type: string;
  externalId?: string | null;
  idempotencyKey: string;
  payload?: unknown;
  receivedAt?: string;
};
