-- 012: Media storage columns
-- Adds durable storage tracking for inbound WhatsApp media so we can serve
-- images / video / audio / documents from a local disk volume long after
-- Meta's CDN URLs expire (~5 min) and the binary is purged (~30 days).

ALTER TABLE coexistence.chat_history
  ADD COLUMN IF NOT EXISTS media_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS media_status       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_size_bytes   BIGINT,
  ADD COLUMN IF NOT EXISTS media_filename     TEXT,
  ADD COLUMN IF NOT EXISTS media_error        TEXT,
  ADD COLUMN IF NOT EXISTS media_downloaded_at TIMESTAMPTZ;

-- media_status:
--   NULL          → not a media message (or never queued)
--   'pending'     → queued, downloader hasn't picked it up
--   'downloading' → downloader fetched Meta URL, streaming to disk
--   'stored'      → file on disk, ready to serve via /api/media/:messageId
--   'failed'      → fetch or write error, see media_error
--   'expired'     → media older than ~30 days, no longer in Meta's CDN

CREATE INDEX IF NOT EXISTS idx_chat_media_status
  ON coexistence.chat_history(media_status)
  WHERE media_status IS NOT NULL;
