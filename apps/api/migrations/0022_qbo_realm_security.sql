-- Migration number: 0022
-- Hash QBO realm IDs for routing; newly connected realm IDs live in encrypted integration secrets.

ALTER TABLE integrations ADD COLUMN external_account_hash TEXT;
CREATE INDEX IF NOT EXISTS integrations_provider_env_account_hash_idx
  ON integrations (provider, environment, external_account_hash);
