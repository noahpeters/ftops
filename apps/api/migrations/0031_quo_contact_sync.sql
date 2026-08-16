-- Migration number: 0031
-- Durable one-way FTOPS -> Quo contact mappings and sync outbox.

CREATE TABLE IF NOT EXISTS quo_contact_sync (
  contact_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  quo_contact_id TEXT,
  desired_action TEXT NOT NULL DEFAULT 'upsert'
    CHECK (desired_action = 'upsert'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  version INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS quo_contact_sync_remote_idx
  ON quo_contact_sync (quo_contact_id)
  WHERE quo_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quo_contact_sync_due_idx
  ON quo_contact_sync (status, next_attempt_at, updated_at);
