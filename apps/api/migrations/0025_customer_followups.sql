-- Migration number: 0025
-- Allow customer outreach tasks to exist without a project.

CREATE TABLE tasks_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
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
  description TEXT,
  template_id TEXT,
  customer_id TEXT,
  completed_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

INSERT INTO tasks_next
SELECT id, workspace_id, project_id, scope, group_key, line_item_uri, template_key,
       title, kind, position, status, state_json, due_at, assigned_to, description,
       template_id, customer_id, completed_at, priority, created_at, updated_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_next RENAME TO tasks;

CREATE INDEX tasks_project_status_idx ON tasks (workspace_id, project_id, status);
CREATE INDEX tasks_project_scope_pos_idx ON tasks (workspace_id, project_id, scope, group_key, position);
CREATE INDEX tasks_line_item_idx ON tasks (workspace_id, line_item_uri);
CREATE INDEX tasks_customer_due_idx ON tasks (workspace_id, customer_id, status, due_at);
