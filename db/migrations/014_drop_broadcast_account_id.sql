-- 014: Drop broadcasts.whatsapp_account_id
-- The column was redundant: broadcasts already carry `from_number`, and the
-- WABA is derivable from that phone number via whatsapp_accounts lookup.
-- Templates still need their own whatsapp_account_id (no from_number there).

DROP INDEX IF EXISTS coexistence.idx_broadcasts_whatsapp_account;

ALTER TABLE coexistence.broadcasts
  DROP COLUMN IF EXISTS whatsapp_account_id;
