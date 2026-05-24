-- 015: Outbound message lifecycle states
-- Adds 'sending' to chat_history.status so the UI can render an optimistic
-- bubble while the BullMQ send worker is in-flight to Meta. Adds 'SENDING'
-- and 'FAILED' to broadcasts.status so the campaign view can reflect partial
-- progress.

ALTER TABLE coexistence.chat_history
  DROP CONSTRAINT IF EXISTS chat_history_status_check;

ALTER TABLE coexistence.chat_history
  ADD CONSTRAINT chat_history_status_check
  CHECK (status IN ('received','sending','sent','delivered','read','failed','error','unknown'));

ALTER TABLE coexistence.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_status_check;

ALTER TABLE coexistence.broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN ('DRAFT','SENDING','SENT','FAILED'));

-- Add an error column on chat_history for failed send reasons
ALTER TABLE coexistence.chat_history
  ADD COLUMN IF NOT EXISTS error_message TEXT;
