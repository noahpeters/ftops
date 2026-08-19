-- Migration number: 0034
-- Inbound customer email sources, authorized forwarders, and reviewable note candidates.

CREATE TABLE IF NOT EXISTS email_ingestion_mailboxes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_ingestion_mailboxes_workspace_idx
  ON email_ingestion_mailboxes (workspace_id, enabled);

CREATE TABLE IF NOT EXISTS email_ingestion_forwarders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS email_ingestion_forwarders_email_idx
  ON email_ingestion_forwarders (workspace_id, email, enabled);

CREATE TABLE IF NOT EXISTS customer_email_ingestions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  forwarding_email TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  original_sender_email TEXT,
  original_sender_name TEXT,
  contact_id TEXT,
  customer_id TEXT,
  subject TEXT,
  message_id TEXT,
  sent_at TEXT,
  raw_storage_key TEXT NOT NULL,
  raw_sha256 TEXT NOT NULL,
  raw_size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','needs_match','ready','applied','dismissed','failed')),
  failure_reason TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, raw_sha256)
);
CREATE INDEX IF NOT EXISTS customer_email_ingestions_review_idx
  ON customer_email_ingestions (workspace_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS customer_email_ingestions_customer_idx
  ON customer_email_ingestions (workspace_id, customer_id, received_at DESC);

CREATE TABLE IF NOT EXISTS customer_email_attachments (
  id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  applied_activity_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ingestion_id) REFERENCES customer_email_ingestions(id)
);
CREATE INDEX IF NOT EXISTS customer_email_attachments_ingestion_idx
  ON customer_email_attachments (workspace_id, ingestion_id);

CREATE TABLE IF NOT EXISTS customer_email_note_candidates (
  id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  category TEXT NOT NULL,
  proposed_subject TEXT NOT NULL,
  proposed_body TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
  applied_activity_id TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  FOREIGN KEY (ingestion_id) REFERENCES customer_email_ingestions(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS customer_email_note_candidates_review_idx
  ON customer_email_note_candidates (workspace_id, customer_id, status, created_at DESC);
