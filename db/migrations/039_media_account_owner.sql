-- Media now belongs to a single WhatsApp account (the "connected account").
-- This replaces the shared / multi-account library model (one upload synced to
-- many WABAs). Existing media is backfilled to the default account so previously
-- uploaded files remain owned and usable. Files themselves are never deleted.
--
-- ON DELETE SET NULL (not CASCADE): if an account is removed, its media rows and
-- MinIO objects are preserved (just left unowned), honoring "preserve uploaded
-- media files".

ALTER TABLE coexistence.media_library
  ADD COLUMN IF NOT EXISTS whatsapp_account_id BIGINT
    REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL;

UPDATE coexistence.media_library
   SET whatsapp_account_id = COALESCE(
     (SELECT id FROM coexistence.whatsapp_accounts WHERE is_default = TRUE LIMIT 1),
     (SELECT id FROM coexistence.whatsapp_accounts ORDER BY id LIMIT 1)
   )
 WHERE whatsapp_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_media_library_account
  ON coexistence.media_library (whatsapp_account_id)
  WHERE deleted_at IS NULL;
