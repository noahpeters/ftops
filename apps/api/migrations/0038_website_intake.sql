-- Append-only intake evidence is separate from mutable CRM records.
ALTER TABLE contacts ADD COLUMN marketing_email_permission TEXT NOT NULL DEFAULT 'unknown'
 CHECK (marketing_email_permission IN ('allowed','not_allowed','unknown'));
ALTER TABLE contacts ADD COLUMN marketing_email_updated_at TEXT;
CREATE INDEX contacts_workspace_email_idx ON contacts(workspace_id,lower(trim(email)));
CREATE TABLE website_submissions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, integration_id TEXT NOT NULL,
 external_event_id TEXT NOT NULL, email TEXT NOT NULL, fields_json TEXT NOT NULL,
 raw_payload TEXT NOT NULL, received_at TEXT NOT NULL, customer_id TEXT, contact_id TEXT,
 reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('linked','needs_review')),
 UNIQUE(integration_id,external_event_id)
);
CREATE INDEX website_submissions_workspace_idx ON website_submissions(workspace_id,received_at);
CREATE TABLE contact_marketing_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, contact_id TEXT NOT NULL,
 permission TEXT NOT NULL CHECK (permission IN ('allowed','not_allowed','unknown')),
 source TEXT NOT NULL, submission_id TEXT UNIQUE, disclosure_version TEXT,
 captured_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor_email TEXT
);
CREATE INDEX contact_marketing_events_contact_idx ON contact_marketing_events(workspace_id,contact_id,captured_at);
CREATE TABLE website_submission_opportunities (
 submission_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, opportunity_id TEXT NOT NULL
);
CREATE TRIGGER website_submissions_no_update BEFORE UPDATE ON website_submissions
BEGIN SELECT RAISE(ABORT, 'website_submissions_are_immutable'); END;
CREATE TRIGGER website_submissions_no_delete BEFORE DELETE ON website_submissions
BEGIN SELECT RAISE(ABORT, 'website_submissions_are_immutable'); END;
CREATE TRIGGER contact_marketing_events_no_update BEFORE UPDATE ON contact_marketing_events
BEGIN SELECT RAISE(ABORT, 'marketing_events_are_immutable'); END;
CREATE TRIGGER contact_marketing_events_no_delete BEFORE DELETE ON contact_marketing_events
BEGIN SELECT RAISE(ABORT, 'marketing_events_are_immutable'); END;
