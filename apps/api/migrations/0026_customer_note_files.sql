-- Migration number: 0026
-- Protected attachments linked to immutable customer-note activities.

CREATE TABLE customer_note_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  uploaded_by_email TEXT,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT,
  deprecated_at TEXT,
  deprecated_by_email TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (activity_id) REFERENCES customer_activities(id)
);

CREATE INDEX customer_note_files_customer_idx
  ON customer_note_files (workspace_id, customer_id, deprecated_at, created_at DESC);

CREATE INDEX customer_note_files_activity_idx
  ON customer_note_files (workspace_id, activity_id, created_at DESC);
