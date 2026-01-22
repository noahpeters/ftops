-- Migration number: 0017
-- Extend tasks fields + migrate status names

ALTER TABLE tasks ADD COLUMN description TEXT;
ALTER TABLE tasks ADD COLUMN template_id TEXT;
ALTER TABLE tasks ADD COLUMN customer_id TEXT;
ALTER TABLE tasks ADD COLUMN completed_at TEXT;

UPDATE tasks
SET template_id = template_key
WHERE template_id IS NULL;

UPDATE tasks
SET status = 'scheduled'
WHERE status IN ('todo', 'due_this_week', 'overdue');

UPDATE tasks
SET status = 'in progress'
WHERE status = 'doing';
