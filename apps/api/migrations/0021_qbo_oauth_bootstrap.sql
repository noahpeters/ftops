-- Migration number: 0021
-- QuickBooks OAuth lifecycle and resumable bootstrap imports.

ALTER TABLE integrations ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE integrations ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'connected';
ALTER TABLE integrations ADD COLUMN connection_error TEXT;
ALTER TABLE integrations ADD COLUMN last_successful_sync_at TEXT;

CREATE TABLE IF NOT EXISTS qbo_oauth_states (
  state_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  environment TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qbo_oauth_states_expiry_idx ON qbo_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS qbo_bootstrap_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  start_position INTEGER NOT NULL DEFAULT 1,
  imported_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (integration_id)
);
CREATE INDEX IF NOT EXISTS qbo_bootstrap_jobs_workspace_idx
  ON qbo_bootstrap_jobs (workspace_id, updated_at);
