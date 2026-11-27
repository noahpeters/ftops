ALTER TABLE h2_acquisition_events ADD COLUMN integration_id TEXT REFERENCES integrations(id);
ALTER TABLE h2_acquisition_delivery_state ADD COLUMN integration_id TEXT REFERENCES integrations(id);

-- Attach any evidence received under the first receiver revision to the
-- canonical production website integration before restoring immutability.
DROP TRIGGER h2_acquisition_no_update;
CREATE TRIGGER h2_acquisition_require_integration
  BEFORE UPDATE ON h2_acquisition_events WHEN NEW.integration_id IS NULL BEGIN
  SELECT RAISE(ABORT, 'h2 acquisition integration not found');
END;
UPDATE h2_acquisition_events
  SET integration_id = (SELECT i.id FROM integrations i WHERE i.workspace_id=h2_acquisition_events.workspace_id
    AND i.provider='website' AND i.environment='production' AND i.external_account_id='from-trees.com');
DROP TRIGGER h2_acquisition_require_integration;
CREATE TRIGGER h2_acquisition_no_update
  BEFORE UPDATE ON h2_acquisition_events BEGIN
  SELECT RAISE(ABORT, 'h2 acquisition evidence is immutable');
END;

UPDATE h2_acquisition_delivery_state
  SET integration_id = (SELECT i.id FROM integrations i WHERE i.workspace_id=h2_acquisition_delivery_state.workspace_id
    AND i.provider='website' AND i.environment='production' AND i.external_account_id='from-trees.com');

CREATE TRIGGER h2_acquisition_check_integration
  BEFORE INSERT ON h2_acquisition_events WHEN NOT EXISTS (
    SELECT 1 FROM integrations i WHERE i.id=NEW.integration_id AND i.workspace_id=NEW.workspace_id
      AND i.provider='website' AND i.environment='production'
  ) BEGIN
  SELECT RAISE(ABORT, 'h2 acquisition integration does not own the event');
END;
