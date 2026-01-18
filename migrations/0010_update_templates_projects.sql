-- Migration number: 0010
-- Extend templates + projects for task-based model

ALTER TABLE templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';
ALTER TABLE templates ADD COLUMN default_state_json TEXT;
ALTER TABLE templates ADD COLUMN default_position INTEGER;

ALTER TABLE projects ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE projects ADD COLUMN commercial_record_uri TEXT;
ALTER TABLE projects ADD COLUMN customer_display TEXT;
ALTER TABLE projects ADD COLUMN quoted_delivery_date TEXT;
ALTER TABLE projects ADD COLUMN quoted_install_date TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT;
ALTER TABLE projects ADD COLUMN debug_plan_json TEXT;
ALTER TABLE projects ADD COLUMN debug_plan_hash TEXT;

CREATE INDEX IF NOT EXISTS projects_workspace_record_idx
ON projects (workspace_id, commercial_record_uri);
