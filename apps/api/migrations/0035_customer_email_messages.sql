-- Migration number: 0035
-- Persist individual messages from forwarded threads for workspace-scoped
-- deduplication and one-summary-per-message review.

CREATE TABLE IF NOT EXISTS customer_email_messages (
  id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  contact_id TEXT,
  message_fingerprint TEXT NOT NULL,
  source_message_id TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  subject TEXT,
  sent_at TEXT,
  body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  UNIQUE (workspace_id, message_fingerprint),
  FOREIGN KEY (ingestion_id) REFERENCES customer_email_ingestions(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);
CREATE INDEX IF NOT EXISTS customer_email_messages_customer_idx
  ON customer_email_messages (workspace_id, customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS customer_email_messages_ingestion_idx
  ON customer_email_messages (workspace_id, ingestion_id);

ALTER TABLE customer_email_note_candidates ADD COLUMN email_message_id TEXT REFERENCES customer_email_messages(id);
CREATE INDEX IF NOT EXISTS customer_email_note_candidates_message_idx
  ON customer_email_note_candidates (workspace_id, email_message_id);

ALTER TABLE customer_email_attachments ADD COLUMN email_message_id TEXT REFERENCES customer_email_messages(id);
CREATE INDEX IF NOT EXISTS customer_email_attachments_message_idx
  ON customer_email_attachments (workspace_id, email_message_id);
