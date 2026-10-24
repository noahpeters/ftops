-- Native billing is independent of legacy accounting mirrors.
CREATE UNIQUE INDEX IF NOT EXISTS customers_workspace_id_unique ON customers(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_id_unique ON contacts(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_workspace_id_unique ON projects(workspace_id,id);

CREATE TABLE native_billing_settings (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), issuer_name TEXT NOT NULL,
 reply_email TEXT NOT NULL, disclosure TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 secrets_key_id TEXT NOT NULL, secrets_ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE native_terms_versions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), version_label TEXT NOT NULL,
 title TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,version_label)
);
CREATE TABLE native_estimates (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), customer_id TEXT NOT NULL,
 project_id TEXT, contact_id TEXT NOT NULL, current_revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,customer_id) REFERENCES customers(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
 FOREIGN KEY(workspace_id,contact_id) REFERENCES contacts(workspace_id,id)
);
CREATE TABLE native_estimate_revisions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, estimate_id TEXT NOT NULL, revision INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','issued','signing','signed','withdrawn')),
 title TEXT NOT NULL, snapshot_json TEXT NOT NULL, public_json TEXT NOT NULL, content_hash TEXT NOT NULL,
 terms_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(estimate_id,revision),
 FOREIGN KEY(workspace_id,estimate_id) REFERENCES native_estimates(workspace_id,id),
 FOREIGN KEY(workspace_id,terms_id) REFERENCES native_terms_versions(workspace_id,id)
);
CREATE TRIGGER native_revision_content_immutable BEFORE UPDATE OF snapshot_json,public_json,content_hash,terms_id,title,revision,expires_at ON native_estimate_revisions BEGIN SELECT RAISE(ABORT,'immutable_revision'); END;
CREATE TRIGGER native_terms_immutable BEFORE UPDATE ON native_terms_versions BEGIN SELECT RAISE(ABORT,'immutable_terms'); END;
CREATE TABLE native_guest_grants (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision_id TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
 code_hash TEXT, code_expires_at TEXT, code_sent_at TEXT, code_attempts INTEGER NOT NULL DEFAULT 0,
 session_hash TEXT UNIQUE, session_expires_at TEXT, verified_at TEXT,
 FOREIGN KEY(workspace_id,revision_id) REFERENCES native_estimate_revisions(workspace_id,id)
);
CREATE TABLE native_signature_evidence (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision_id TEXT NOT NULL UNIQUE,
 grant_id TEXT NOT NULL REFERENCES native_guest_grants(id), signer_name TEXT NOT NULL, signer_email TEXT NOT NULL,
 content_hash TEXT NOT NULL, terms_hash TEXT NOT NULL, disclosure TEXT NOT NULL, intent TEXT NOT NULL,
 verified_at TEXT NOT NULL, signed_at TEXT NOT NULL, user_agent TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 FOREIGN KEY(workspace_id,revision_id) REFERENCES native_estimate_revisions(workspace_id,id)
);
CREATE TRIGGER native_signature_immutable BEFORE UPDATE ON native_signature_evidence BEGIN SELECT RAISE(ABORT,'immutable_signature'); END;
CREATE TABLE native_documents (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), revision_id TEXT, terms_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('terms_master','issued_estimate','approved_estimate','accepted_terms','invoice')),
 source_key TEXT NOT NULL, object_key TEXT NOT NULL, sha256 TEXT NOT NULL, certificate_fingerprint TEXT NOT NULL,
 signing_profile TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,source_key),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES native_estimate_revisions(workspace_id,id)
);
CREATE TABLE native_invoices (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision_id TEXT NOT NULL, number TEXT NOT NULL,
 label TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('deposit','milestone','final')), amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 status TEXT NOT NULL CHECK(status IN ('draft','issued','processing','paid','refunded','disputed','failed')),
 created_at TEXT NOT NULL, refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK(refunded_cents>=0), UNIQUE(workspace_id,id), UNIQUE(workspace_id,number),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES native_estimate_revisions(workspace_id,id)
);
CREATE TABLE native_payment_attempts (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('creating','open','processing','paid','failed','expired')),
 provider TEXT NOT NULL DEFAULT 'stripe', environment TEXT NOT NULL, amount_cents INTEGER NOT NULL, session_id TEXT UNIQUE,
 payment_intent_id TEXT, checkout_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,invoice_id) REFERENCES native_invoices(workspace_id,id)
);
CREATE UNIQUE INDEX native_one_active_attempt ON native_payment_attempts(invoice_id) WHERE state IN ('creating','open','processing','paid');
CREATE TABLE native_payment_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, provider_event_id TEXT NOT NULL,
 event_type TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id,provider_event_id)
);
CREATE TABLE native_payment_ledger (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, invoice_id TEXT, provider_id TEXT NOT NULL,
 kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, fee_cents INTEGER, net_cents INTEGER,
 status TEXT NOT NULL, available_at TEXT, details_json TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,provider_id,kind),
 FOREIGN KEY(workspace_id,invoice_id) REFERENCES native_invoices(workspace_id,id)
);
CREATE TABLE native_billing_audit (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision_id TEXT, action TEXT NOT NULL,
 actor TEXT NOT NULL, occurred_at TEXT NOT NULL, details_json TEXT NOT NULL
);
CREATE TABLE native_billing_deliveries (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision_id TEXT NOT NULL, recipient TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, sent_at TEXT,
 FOREIGN KEY(workspace_id,revision_id) REFERENCES native_estimate_revisions(workspace_id,id)
);

-- Preserve separate test/live credentials so historical payment reconciliation
-- does not accidentally use the currently selected checkout environment.
CREATE TABLE native_stripe_configs (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id), environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 secrets_key_id TEXT NOT NULL, secrets_ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,environment)
);
