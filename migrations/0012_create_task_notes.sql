-- Migration number: 0012 2026-01-18
-- task notes

CREATE TABLE IF NOT EXISTS task_notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS task_notes_task_idx
  ON task_notes (workspace_id, task_id, created_at);
