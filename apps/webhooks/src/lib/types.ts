export type Env = {
  DB: D1Database;
  QB_INGEST_QUEUE: Queue;
  INTEGRATIONS_MASTER_KEY?: string;
  INTEGRATIONS_KEY_ID?: string;
};
