-- Migration number: 0011
-- Tasks + project materializations

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  group_key TEXT,
  line_item_uri TEXT,
  template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT,
  due_at TEXT,
  assigned_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_project_status_idx
ON tasks (workspace_id, project_id, status);

CREATE INDEX IF NOT EXISTS tasks_project_scope_pos_idx
ON tasks (workspace_id, project_id, scope, group_key, position);

CREATE INDEX IF NOT EXISTS tasks_line_item_idx
ON tasks (workspace_id, line_item_uri);

CREATE TABLE IF NOT EXISTS project_materializations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  commercial_record_uri TEXT NOT NULL,
  record_snapshot_hash TEXT NOT NULL,
  template_config_hash TEXT NOT NULL,
  materialization_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, materialization_key)
);
