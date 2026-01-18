-- Migration number: 0014 2026-01-18
-- workspaces + integrations + ingest routing columns

ALTER TABLE workspaces ADD COLUMN slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_idx
  ON workspaces (slug);

UPDATE workspaces
SET slug = 'default'
WHERE slug IS NULL AND id = 'default';

INSERT OR IGNORE INTO workspaces (id, slug, name, created_at, updated_at)
VALUES ('ws_unknown', 'unknown', 'Unknown', datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT,
  secrets_key_id TEXT NOT NULL,
  secrets_ciphertext TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, environment, external_account_id)
);

CREATE INDEX IF NOT EXISTS integrations_workspace_idx
  ON integrations (workspace_id, provider, environment);

ALTER TABLE ingest_requests ADD COLUMN environment TEXT;
ALTER TABLE ingest_requests ADD COLUMN external_account_id TEXT;
ALTER TABLE ingest_requests ADD COLUMN integration_id TEXT;

CREATE INDEX IF NOT EXISTS ingest_requests_workspace_time_idx
  ON ingest_requests (workspace_id, received_at);
