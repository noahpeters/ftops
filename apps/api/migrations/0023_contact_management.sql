-- Migration number: 0023
-- Contact lifecycle fields for safe contact management.

ALTER TABLE contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive', 'archived'));
ALTER TABLE contacts ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS contacts_customer_status_idx
  ON contacts (workspace_id, customer_id, status, is_primary);
