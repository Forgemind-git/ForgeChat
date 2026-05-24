-- Media Library: shared MinIO-backed media + per-WABA Meta sync state.
-- Designed so one uploaded file (single MinIO object) can be synced
-- independently to many WABAs, each producing its own 28-day Meta media_id.

CREATE TABLE IF NOT EXISTS coexistence.media_library (
  id              BIGSERIAL PRIMARY KEY,
  filename        TEXT NOT NULL,                -- generated storage name
  original_name   TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  media_type      TEXT NOT NULL CHECK (media_type IN ('image','video','audio','document')),
  minio_bucket    TEXT NOT NULL,
  minio_object_key TEXT NOT NULL,
  sha256          TEXT,
  auto_resync     BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  uploaded_by     INT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_library_uploaded_at
  ON coexistence.media_library (uploaded_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_media_library_type
  ON coexistence.media_library (media_type)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS coexistence.media_meta_sync (
  id            BIGSERIAL PRIMARY KEY,
  media_id      BIGINT NOT NULL REFERENCES coexistence.media_library(id) ON DELETE CASCADE,
  account_id    INT NOT NULL REFERENCES coexistence.whatsapp_accounts(id) ON DELETE CASCADE,
  meta_media_id TEXT,
  synced_at     TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,   -- synced_at + 28 days (Meta's documented TTL)
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','syncing','synced','failed','expired')),
  last_error    TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (media_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_media_meta_sync_account
  ON coexistence.media_meta_sync (account_id);

CREATE INDEX IF NOT EXISTS idx_media_meta_sync_expiring
  ON coexistence.media_meta_sync (expires_at)
  WHERE status = 'synced';
