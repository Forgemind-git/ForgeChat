-- 036_chat_history_context.sql
-- "Reply to a specific message" (WhatsApp-style quote reply).
--
-- WhatsApp Cloud API carries the quoted message as `context.message_id` on the
-- outbound payload, and reports inbound replies as `msg.context.id`. We store
-- that wamid here so a reply bubble can render the quoted message it refers to
-- (for both directions).
--
-- Nullable + additive: existing rows and all non-reply messages keep NULL.

ALTER TABLE coexistence.chat_history
  ADD COLUMN IF NOT EXISTS context_message_id TEXT;

-- Lets us resolve "which message quoted X" / look up the quoted row quickly.
CREATE INDEX IF NOT EXISTS idx_chat_history_context
  ON coexistence.chat_history (context_message_id)
  WHERE context_message_id IS NOT NULL;
