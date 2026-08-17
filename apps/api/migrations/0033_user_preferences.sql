-- Migration number: 0033
-- Extensible per-user application preferences.

CREATE TABLE user_preferences (
  user_email TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_email, preference_key)
);

CREATE INDEX user_preferences_updated_at_idx
ON user_preferences (updated_at);
