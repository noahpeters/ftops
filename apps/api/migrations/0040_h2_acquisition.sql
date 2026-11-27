CREATE TABLE h2_acquisition_events (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('arrival','view','inquiry_cta','configurator_cta','inquiry_accepted','ad_attribution')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (kind, id),
  CHECK ((kind = 'arrival' AND visitor_id IS NULL AND session_id IS NULL)
      OR (kind <> 'arrival' AND visitor_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE INDEX h2_acquisition_time ON h2_acquisition_events (workspace_id, occurred_at, id);
CREATE INDEX h2_acquisition_session ON h2_acquisition_events (workspace_id, session_id, occurred_at, id);
CREATE INDEX h2_acquisition_visitor ON h2_acquisition_events (workspace_id, visitor_id, occurred_at, id);
CREATE TRIGGER h2_acquisition_no_update
  BEFORE UPDATE ON h2_acquisition_events BEGIN
  SELECT RAISE(ABORT, 'h2 acquisition evidence is immutable');
END;

CREATE TABLE h2_acquisition_delivery_state (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  caught_up_at TEXT NOT NULL
);
