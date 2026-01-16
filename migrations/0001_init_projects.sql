-- projects
--
-- Core unit of work in the ops system.
-- A project may be:
--   - customer-facing (linked to a commercial record like an invoice or order)
--   - internal (R&D, shop improvements, prototypes)
--
-- Projects are created by:
--   - external events (QuickBooks payment, Shopify order)
--   - manual creation
--
-- Workflow state lives primarily in `status` and related task records.

CREATE TABLE IF NOT EXISTS projects (
  -- Internal UUID for the project
  id TEXT PRIMARY KEY,

  -- Human-readable project title (e.g. "Walnut Dining Table – Smith")
  title TEXT NOT NULL,

  -- High-level classification that selects a workflow template
  -- Examples: 'dining_table', 'cabinet_run', 'design_only', 'internal'
  project_type TEXT NOT NULL,

  -- Current lifecycle state of the project
  -- Examples: 'intake', 'design', 'production', 'delivery', 'closed'
  status TEXT NOT NULL,

  -- Optional display name for the customer
  -- (authoritative customer data will live in a separate table later)
  customer_name TEXT,

  -- ISO-8601 timestamp when the project record was created
  created_at TEXT NOT NULL,

  -- ISO-8601 timestamp of last meaningful update
  updated_at TEXT NOT NULL
);
