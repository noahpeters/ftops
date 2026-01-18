-- Migration number: 0013 2026-01-18
-- ingest requests

CREATE TABLE IF NOT EXISTS ingest_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL,
  received_at TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_json TEXT,
  signature_header TEXT,
  signature_verified INTEGER NOT NULL,
  verify_error TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS ingest_requests_provider_time_idx
  ON ingest_requests (workspace_id, provider, received_at);

CREATE INDEX IF NOT EXISTS ingest_requests_time_idx
  ON ingest_requests (workspace_id, received_at);
