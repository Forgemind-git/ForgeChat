-- 038: Starred messages (WhatsApp-style "Star" in the message context menu).
-- A simple per-message flag; starred state is account-level (not per user),
-- consistent with conversation_reads.
ALTER TABLE coexistence.chat_history
  ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_chat_history_starred
  ON coexistence.chat_history(wa_number, contact_number)
  WHERE starred = TRUE;
