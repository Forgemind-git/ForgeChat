-- Multi-turn conversation state: allow an automation execution to pause at a
-- Message node (when `waitForReply` is set on that node) and resume when the
-- customer's next inbound message arrives.
--
-- Status is widened to include 'paused'. Three columns track where we paused,
-- when, and when the pause expires. `wa_number` is denormalised from
-- trigger_data for fast resume-lookup.
-- A partial index keeps the lookup O(1) regardless of historical row volume.

ALTER TABLE coexistence.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_status_check;

ALTER TABLE coexistence.automation_executions
  ADD CONSTRAINT automation_executions_status_check
  CHECK (status IN ('queued','running','success','error','cancelled','paused'));

ALTER TABLE coexistence.automation_executions
  ADD COLUMN IF NOT EXISTS awaiting_node_id TEXT,
  ADD COLUMN IF NOT EXISTS paused_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wa_number        TEXT;

CREATE INDEX IF NOT EXISTS idx_executions_resume_lookup
  ON coexistence.automation_executions (wa_number, contact_number, status)
  WHERE status = 'paused';
