-- Migration number: 0020
-- Phase-one customer management and QuickBooks mirrors.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  company_name TEXT,
  customer_type TEXT,
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'prospect', 'active', 'past', 'archived')),
  lead_source TEXT,
  primary_contact_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS customers_workspace_status_idx ON customers (workspace_id, status, updated_at);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS contacts_customer_idx ON contacts (workspace_id, customer_id, is_primary);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  address_type TEXT NOT NULL CHECK (address_type IN ('billing', 'shipping', 'project_site', 'other')),
  line1 TEXT,
  line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses (workspace_id, customer_id);

CREATE TABLE IF NOT EXISTS external_entities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'estimate', 'invoice')),
  local_entity_type TEXT NOT NULL,
  local_entity_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_sync_token TEXT,
  external_updated_at TEXT,
  last_synced_at TEXT,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('not_linked', 'linked', 'pending_push', 'pending_refresh', 'conflict', 'error')),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, integration_id, entity_type, external_id),
  UNIQUE (workspace_id, integration_id, local_entity_type, local_entity_id)
);
CREATE INDEX IF NOT EXISTS external_entities_local_idx ON external_entities (workspace_id, local_entity_type, local_entity_id);

CREATE TABLE IF NOT EXISTS estimates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT,
  project_id TEXT,
  external_entity_id TEXT NOT NULL UNIQUE,
  doc_number TEXT,
  status TEXT,
  transaction_date TEXT,
  expiration_date TEXT,
  currency TEXT,
  subtotal REAL,
  tax_total REAL,
  discount_total REAL,
  total REAL,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS estimates_customer_idx ON estimates (workspace_id, customer_id, transaction_date);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT,
  project_id TEXT,
  external_entity_id TEXT NOT NULL UNIQUE,
  doc_number TEXT,
  status TEXT,
  transaction_date TEXT,
  due_date TEXT,
  currency TEXT,
  subtotal REAL,
  tax_total REAL,
  discount_total REAL,
  total REAL,
  balance REAL,
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices (workspace_id, customer_id, transaction_date);

CREATE TABLE IF NOT EXISTS customer_activities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  source TEXT NOT NULL,
  external_entity_id TEXT,
  occurred_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_activities_customer_idx ON customer_activities (workspace_id, customer_id, occurred_at DESC);
