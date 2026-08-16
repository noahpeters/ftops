export type Env = {
  DB: D1Database;
  EVENT_QUEUE: Queue;
  R2_TASK_FILES_BUCKET: R2Bucket;
  R2_TASK_FILES_BUCKET_NAME?: string;
  R2_TASK_FILES_PUBLIC_HOST?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  ALLOW_R2_FALLBACK_UPLOADS?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  INTEGRATIONS_KEY_ID?: string;
  QBO_CLIENT_ID?: string;
  QBO_CLIENT_SECRET?: string;
  QBO_OAUTH_STATE_SECRET?: string;
  QBO_REDIRECT_URI?: string;
  RESEND_API_KEY?: string;
  DAILY_SUMMARY_FROM_EMAIL?: string;
  DAILY_SUMMARY_FROM_NAME?: string;
  DAILY_SUMMARY_TIMEZONE?: string;
  DAILY_SUMMARY_EMAIL_API_URL?: string;
  APP_BASE_URL?: string;
  QUO_API_KEY?: string;
  QUO_API_BASE_URL?: string;
};

export type EventQueuePayload = {
  source: string;
  type: string;
  externalId?: string | null;
  idempotencyKey: string;
  payload?: unknown;
  receivedAt?: string;
};
