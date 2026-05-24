-- 037: WhatsApp-style message reactions.
--
-- A reaction is NOT a chat bubble — it's an emoji attached to the bottom of the
-- message it reacts to. One reaction per side per target message:
--   direction='incoming'  → the customer reacted
--   direction='outgoing'  → our agent reacted (sent to Meta as type:'reaction')
-- Latest wins (upsert); an empty emoji from Meta means the reaction was removed
-- (we delete the row).
CREATE TABLE IF NOT EXISTS coexistence.message_reactions (
  id                BIGSERIAL PRIMARY KEY,
  wa_number         TEXT NOT NULL,
  contact_number    TEXT NOT NULL,
  target_message_id TEXT NOT NULL,                 -- wamid of the reacted-to message
  direction         TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  emoji             TEXT NOT NULL,
  reactor           TEXT,                           -- phone of who reacted (optional)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_message_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_message_reactions_target ON coexistence.message_reactions(target_message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_convo  ON coexistence.message_reactions(wa_number, contact_number);

-- Backfill from reaction rows previously stored as chat bubbles in chat_history.
-- Best-effort: extracts the target wamid + emoji from the saved raw_payload.
INSERT INTO coexistence.message_reactions
  (wa_number, contact_number, target_message_id, direction, emoji, reactor, updated_at)
SELECT
  wa_number, contact_number,
  raw_payload->'entry'->0->'changes'->0->'value'->'messages'->0->'reaction'->>'message_id',
  direction,
  raw_payload->'entry'->0->'changes'->0->'value'->'messages'->0->'reaction'->>'emoji',
  raw_payload->'entry'->0->'changes'->0->'value'->'messages'->0->>'from',
  timestamp
FROM coexistence.chat_history
WHERE message_type = 'reaction'
  AND raw_payload->'entry'->0->'changes'->0->'value'->'messages'->0->'reaction'->>'message_id' IS NOT NULL
  AND COALESCE(raw_payload->'entry'->0->'changes'->0->'value'->'messages'->0->'reaction'->>'emoji','') <> ''
ON CONFLICT (target_message_id, direction) DO NOTHING;
