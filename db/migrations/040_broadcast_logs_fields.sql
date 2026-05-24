-- Bring broadcast_logs in line with what the broadcasts route + send queue have
-- always written/read: per-recipient wa_message_id, error_message, and the
-- lowercase delivery statuses ('sent','delivered','read','failed') that the send
-- pipeline sets. Without these the broadcast detail view (campaign history) and
-- status rollup error out ("column error_message does not exist").
--
-- Non-destructive: adds nullable columns and widens the status CHECK; existing
-- log rows (PENDING/SENT/FAILED) remain valid and are preserved.

ALTER TABLE coexistence.broadcast_logs
  ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE coexistence.broadcast_logs
  DROP CONSTRAINT IF EXISTS broadcast_logs_status_check;

ALTER TABLE coexistence.broadcast_logs
  ADD CONSTRAINT broadcast_logs_status_check
  CHECK (status IN ('PENDING','SENT','FAILED','sent','delivered','read','failed'));
