-- Migration number: 0019
-- Add admin flags to users

ALTER TABLE users ADD COLUMN workspace_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN system_admin INTEGER NOT NULL DEFAULT 0;
