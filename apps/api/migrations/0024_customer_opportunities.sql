-- Migration number: 0024
-- Sales opportunities pursued for a customer.

CREATE TABLE IF NOT EXISTS customer_opportunities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  description TEXT NOT NULL,
  opportunity_type TEXT NOT NULL CHECK (opportunity_type IN ('furniture', 'cabinets', 'other')),
  budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
  status TEXT NOT NULL DEFAULT 'scoping' CHECK (status IN ('scoping', 'quoted', 'accepted', 'lost')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS customer_opportunities_customer_idx
  ON customer_opportunities (workspace_id, customer_id, status, updated_at);
