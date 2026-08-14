-- Migration number: 0030
-- Idempotency ledger for scheduled daily summary emails.

CREATE TABLE daily_summary_deliveries (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  summary_date TEXT NOT NULL,
  provider_message_id TEXT,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, summary_date)
);

CREATE INDEX daily_summary_deliveries_sent_at_idx
ON daily_summary_deliveries (sent_at);
