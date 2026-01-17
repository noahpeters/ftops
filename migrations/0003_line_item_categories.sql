-- Migration number: 0003 	 2026-01-17T03:26:39.245Z
-- line_item_categories
--
-- Extensible registry of high-level line item categories.
-- Replaces hardcoded enums in code.

CREATE TABLE IF NOT EXISTS line_item_categories (
  -- Stable key used in commercial_line_items.category_key
  -- Examples: 'furniture', 'cabinetry', 'design', 'delivery'
  key TEXT PRIMARY KEY,

  -- Human-readable label for UI / debugging
  label TEXT NOT NULL,

  -- Optional longer description
  description TEXT,

  -- Soft-disable without deleting keys
  is_active INTEGER NOT NULL,

  -- ISO-8601 timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS line_item_categories_active_idx
ON line_item_categories (is_active);
