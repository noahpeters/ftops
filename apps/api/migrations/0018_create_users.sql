-- Migration number: 0018
-- Workspace users

CREATE TABLE IF NOT EXISTS users (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS users_workspace_idx
ON users (workspace_id);
