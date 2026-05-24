-- 032_conversation_reads.sql
-- Tracks when an agent last opened a conversation in the CRM, so we can derive
-- WhatsApp-style unread badges. "Unread" = incoming messages newer than last_read_at.
-- Read state is account-level (per wa_number + contact_number), not per user.
CREATE TABLE IF NOT EXISTS coexistence.conversation_reads (
  wa_number      TEXT        NOT NULL,
  contact_number TEXT        NOT NULL,
  last_read_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wa_number, contact_number)
);
