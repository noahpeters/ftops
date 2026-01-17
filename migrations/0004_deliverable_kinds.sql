-- Migration number: 0004 	 2026-01-17T03:26:46.189Z
-- deliverable_kinds
--
-- Extensible registry of deliverables ("what is being built")
-- Linked to a category for templating and planning.

CREATE TABLE IF NOT EXISTS deliverable_kinds (
  -- Stable key used in commercial_line_items.deliverable_key
  -- Examples: 'dining_table', 'cabinet_run', 'design_services'
  key TEXT PRIMARY KEY,

  -- FK to line_item_categories.key
  category_key TEXT NOT NULL,

  -- Human-readable label for UI / debugging
  label TEXT NOT NULL,

  description TEXT,

  is_active INTEGER NOT NULL,

  -- ISO-8601 timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (category_key) REFERENCES line_item_categories(key)
);

CREATE INDEX IF NOT EXISTS deliverable_kinds_category_idx
ON deliverable_kinds (category_key);

CREATE INDEX IF NOT EXISTS deliverable_kinds_active_idx
ON deliverable_kinds (is_active);
