-- Migration number: 0036
-- Idempotent Quo call ingestion outcomes.

CREATE TABLE IF NOT EXISTS quo_call_ingestions (
  event_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  integration_id TEXT,
  call_id TEXT,
  caller_phone TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('processing', 'noted', 'lead_created', 'ignored')),
  reason TEXT,
  customer_id TEXT,
  contact_id TEXT,
  activity_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (activity_id) REFERENCES customer_activities(id)
);

CREATE INDEX IF NOT EXISTS quo_call_ingestions_workspace_idx
  ON quo_call_ingestions (workspace_id, received_at DESC);
