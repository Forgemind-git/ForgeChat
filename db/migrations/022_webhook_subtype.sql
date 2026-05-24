-- Capture the specific payload subtype (text/image/voice/delivered/read/etc.)
-- in addition to the broader kind (messages/statuses). Lets the Webhooks tab
-- show "what kind of message" at a glance without expanding the payload.

ALTER TABLE coexistence.webhook_events
  ADD COLUMN IF NOT EXISTS payload_subtype TEXT;

CREATE INDEX IF NOT EXISTS idx_webhook_events_subtype
  ON coexistence.webhook_events(payload_subtype);

-- Backfill existing rows so the column isn't NULL-everywhere out of the gate.
-- Best-effort: anything we can't parse stays NULL.
UPDATE coexistence.webhook_events
   SET payload_subtype = COALESCE(
     payload #>> '{entry,0,changes,0,value,messages,0,type}',
     payload #>> '{entry,0,changes,0,value,statuses,0,status}',
     payload #>> '{entry,0,changes,0,value,message_template_status_update,event}',
     CASE WHEN (payload->>'verify')::boolean THEN 'handshake' ELSE NULL END
   )
 WHERE payload_subtype IS NULL;
