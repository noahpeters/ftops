-- Migration number: 0037
-- Checkpointed Quo conversation reconciliation and per-message outcomes.

CREATE TABLE IF NOT EXISTS quo_conversation_sync_state (
  integration_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_successful_sync_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quo_message_ingestions (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  external_phone TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('noted', 'lead_created', 'ignored')),
  reason TEXT NOT NULL,
  customer_id TEXT,
  contact_id TEXT,
  activity_id TEXT,
  message_created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (activity_id) REFERENCES customer_activities(id)
);

CREATE INDEX IF NOT EXISTS quo_message_ingestions_workspace_idx
  ON quo_message_ingestions (workspace_id, message_created_at DESC);

CREATE INDEX IF NOT EXISTS quo_message_ingestions_conversation_idx
  ON quo_message_ingestions (conversation_id, message_created_at);
