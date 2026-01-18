-- Migration number: 0008 	 2026-01-17T03:27:45.000Z
-- workspaces + templates + rules + steps

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  category_key TEXT,
  deliverable_key TEXT,
  is_active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS templates_workspace_scope_active_idx
ON templates (workspace_id, scope, is_active);

CREATE INDEX IF NOT EXISTS templates_workspace_category_deliverable_idx
ON templates (workspace_id, category_key, deliverable_key);

CREATE TABLE IF NOT EXISTS template_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  priority INTEGER NOT NULL,
  match_json TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS template_rules_workspace_active_priority_idx
ON template_rules (workspace_id, is_active, priority);

CREATE TABLE IF NOT EXISTS template_steps (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  default_state_json TEXT,
  is_active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, template_key, position),
  UNIQUE (workspace_id, template_key, step_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE INDEX IF NOT EXISTS template_steps_workspace_template_active_idx
ON template_steps (workspace_id, template_key, is_active);
