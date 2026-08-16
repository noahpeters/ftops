ALTER TABLE customer_activities ADD COLUMN is_human_authored INTEGER NOT NULL DEFAULT 0;

UPDATE customer_activities
SET is_human_authored = 1
WHERE activity_type = 'note' AND source = 'ftops' AND created_by IS NOT NULL;

CREATE TABLE customer_follow_up_guidance (
  customer_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL,
  guidance_type TEXT NOT NULL CHECK (guidance_type IN ('date', 'cadence', 'none')),
  interpreted_date TEXT,
  cadence_json TEXT,
  confidence REAL NOT NULL,
  explanation TEXT NOT NULL,
  model TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (source_note_id) REFERENCES customer_activities(id) ON DELETE CASCADE
);

CREATE INDEX customer_follow_up_guidance_workspace_idx
  ON customer_follow_up_guidance (workspace_id, interpreted_date);
