-- Migration number: 0006 	 2026-01-17T03:27:15.655Z
-- commercial_line_items
--
-- Local, normalized line items needed for:
--   - templating + planning
--   - diffing / change detection
--   - grouping rules (samples/install/etc)
--
-- Each line item has its own stable URI.

CREATE TABLE IF NOT EXISTS commercial_line_items (
  -- Canonical line identifier. Examples:
  --   'shopify://order/<orderId>/line/<lineItemId>'
  --   'qbo://invoice/<invoiceId>/line/<lineId-or-derived>'
  uri TEXT PRIMARY KEY,

  -- Parent commercial record
  record_uri TEXT NOT NULL,

  -- Extensible keys that map into templates
  category_key TEXT NOT NULL,
  deliverable_key TEXT NOT NULL,

  -- Optional grouping key (shared tasks across items)
  -- Example: all cabinetry lines in a room share samples once
  group_key TEXT,

  -- Human readable label (line description/title)
  title TEXT,

  -- Quantity: REAL supports fractional qty if needed
  quantity REAL NOT NULL,

  -- Optional pricing convenience
  unit_price_cents INTEGER,
  amount_cents INTEGER,

  -- Ordering within record (if source has one)
  position INTEGER NOT NULL,

  -- Config/options + hash for change detection
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,

  -- Optional raw snapshot of the line for debugging
  snapshot_json TEXT,
  snapshot_hash TEXT,

  -- ISO-8601 timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (record_uri) REFERENCES commercial_records(uri) ON DELETE CASCADE,
  FOREIGN KEY (category_key) REFERENCES line_item_categories(key),
  FOREIGN KEY (deliverable_key) REFERENCES deliverable_kinds(key)
);

CREATE INDEX IF NOT EXISTS commercial_line_items_record_idx
ON commercial_line_items (record_uri);

CREATE INDEX IF NOT EXISTS commercial_line_items_category_deliverable_idx
ON commercial_line_items (category_key, deliverable_key);

CREATE INDEX IF NOT EXISTS commercial_line_items_group_idx
ON commercial_line_items (group_key);

CREATE INDEX IF NOT EXISTS commercial_line_items_position_idx
ON commercial_line_items (record_uri, position);
