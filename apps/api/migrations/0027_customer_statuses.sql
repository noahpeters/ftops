-- Migration number: 0027
-- Simplify the customer lifecycle to lead, active, completed, archived.

DROP INDEX IF EXISTS customers_workspace_status_idx;

ALTER TABLE customers RENAME COLUMN status TO legacy_status;

ALTER TABLE customers ADD COLUMN status TEXT NOT NULL DEFAULT 'lead'
  CHECK (status IN ('lead', 'active', 'completed', 'archived'));

UPDATE customers
SET status = CASE legacy_status
  WHEN 'active' THEN 'active'
  WHEN 'past' THEN 'completed'
  WHEN 'archived' THEN 'archived'
  ELSE 'lead'
END;

ALTER TABLE customers DROP COLUMN legacy_status;

CREATE INDEX customers_workspace_status_idx
  ON customers (workspace_id, status, updated_at);
