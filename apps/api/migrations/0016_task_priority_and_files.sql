-- Migration number: 0016
-- Add task priority + attachments

ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS task_files (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  uploaded_by_email TEXT,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS task_files_task_idx
ON task_files (workspace_id, task_id);

CREATE INDEX IF NOT EXISTS task_files_workspace_idx
ON task_files (workspace_id);
