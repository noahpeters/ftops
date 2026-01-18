-- schema_migrations
--
-- Tracks which migrations have been applied to a given database.
-- This prevents accidental double-application and enables "apply all" tooling later.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,          -- e.g. '0001_init_projects'
  applied_at TEXT NOT NULL      -- ISO-8601 timestamp
);
