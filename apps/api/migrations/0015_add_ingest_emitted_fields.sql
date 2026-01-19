-- Migration number: 0015 2026-01-19
-- ingest_requests emit tracking

ALTER TABLE ingest_requests ADD COLUMN emitted_event_id TEXT;
ALTER TABLE ingest_requests ADD COLUMN emitted_at TEXT;
ALTER TABLE ingest_requests ADD COLUMN emit_error TEXT;
