-- 033_chat_template_meta.sql
-- Snapshot of a sent template's structure (header/footer/buttons) so the Chats
-- view can render the full WhatsApp template card, not just the body. Body stays
-- in message_body; this holds the surrounding components captured at send time.
ALTER TABLE coexistence.chat_history
  ADD COLUMN IF NOT EXISTS template_meta JSONB;
