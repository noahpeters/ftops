-- Idempotent production configuration for the default workspace inbound mailboxes.
-- A mailbox always resolves to exactly one workspace; forwarding authorization is
-- copied only from users in that same workspace, with explicit operational sources
-- added separately.

INSERT INTO email_ingestion_mailboxes (
  id,
  workspace_id,
  address,
  enabled,
  created_by,
  created_at,
  updated_at
) VALUES (
  'mailbox:default:notes@ops.fromtrees.studio',
  'default',
  'notes@ops.fromtrees.studio',
  1,
  'github-actions',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(address) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  enabled = 1,
  updated_at = excluded.updated_at;

INSERT INTO email_ingestion_mailboxes (
  id,
  workspace_id,
  address,
  enabled,
  created_by,
  created_at,
  updated_at
) VALUES (
  'mailbox:default:doodle@ops.fromtrees.studio',
  'default',
  'doodle@ops.fromtrees.studio',
  1,
  'github-actions',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(address) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  enabled = 1,
  updated_at = excluded.updated_at;

INSERT INTO email_ingestion_forwarders (
  id,
  workspace_id,
  email,
  enabled,
  created_by,
  created_at,
  updated_at
)
SELECT
  'forwarder:' || workspace_id || ':' || lower(email),
  workspace_id,
  lower(email),
  1,
  'github-actions',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users
WHERE workspace_id = 'default'
ON CONFLICT(workspace_id, email) DO UPDATE SET
  enabled = 1,
  updated_at = excluded.updated_at;

-- Shared operational mailboxes may forward on behalf of the default workspace
-- without corresponding to an individual FTOPS user account.
INSERT INTO email_ingestion_forwarders (
  id,
  workspace_id,
  email,
  enabled,
  created_by,
  created_at,
  updated_at
) VALUES (
  'forwarder:default:furniture@from-trees.com',
  'default',
  'furniture@from-trees.com',
  1,
  'github-actions',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(workspace_id, email) DO UPDATE SET
  enabled = 1,
  updated_at = excluded.updated_at;

-- The Email Worker rewrites only strongly recognized Doodle booking notifications
-- arriving at doodle@ops.fromtrees.studio to this synthetic authorization identity.
INSERT INTO email_ingestion_forwarders (
  id,
  workspace_id,
  email,
  enabled,
  created_by,
  created_at,
  updated_at
) VALUES (
  'forwarder:default:doodle@doodle.com',
  'default',
  'doodle@doodle.com',
  1,
  'github-actions',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(workspace_id, email) DO UPDATE SET
  enabled = 1,
  updated_at = excluded.updated_at;
