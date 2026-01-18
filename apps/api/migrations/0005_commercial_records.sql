-- Migration number: 0005 	 2026-01-17T03:26:59.763Z
-- commercial_records
--
-- Canonical commercial root objects that can spawn/drive projects:
--   - QuickBooks invoice
--   - Shopify order
--   - Manual proposal/agreement
--
-- URI-first: the external system remains authoritative.

CREATE TABLE IF NOT EXISTS commercial_records (
  -- Canonical identifier. Examples:
  --   'qbo://invoice/<id>'
  --   'shopify://order/<id>'
  --   'manual://proposal/<id>'
  uri TEXT PRIMARY KEY,

  -- Source system + kind of commercial object
  -- Examples: source='qbo', kind='invoice'
  source TEXT NOT NULL,
  kind TEXT NOT NULL,

  -- External ID as string (for convenience querying)
  external_id TEXT NOT NULL,

  -- Optional customer reference (URI-first); display snapshot optional
  customer_uri TEXT,
  customer_display TEXT,

  -- Quoted commitments (not requests)
  -- Store as ISO-8601 date string: 'YYYY-MM-DD' (or datetime if you prefer)
  quoted_delivery_date TEXT,
  quoted_install_date TEXT,

  -- Optional convenience fields (not authoritative)
  currency TEXT,
  total_amount_cents INTEGER,

  -- Snapshot + hash for change detection
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,

  -- Bookkeeping timestamps (ISO-8601)
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,

  -- Optional: the events.id that most recently updated this snapshot
  last_event_id TEXT,

  -- ISO-8601 timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- Guardrail: the same external object shouldn’t map to two URIs
  UNIQUE (source, kind, external_id)
);

CREATE INDEX IF NOT EXISTS commercial_records_source_kind_external_idx
ON commercial_records (source, kind, external_id);

CREATE INDEX IF NOT EXISTS commercial_records_customer_uri_idx
ON commercial_records (customer_uri);

CREATE INDEX IF NOT EXISTS commercial_records_last_seen_idx
ON commercial_records (last_seen_at);
