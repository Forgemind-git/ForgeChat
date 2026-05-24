-- 042: Move Media Library file storage from MinIO into Postgres.
--
-- The deployment runs only Postgres (no object-storage service), so uploaded
-- Media Library files are stored as bytea rows in this database instead of a
-- MinIO bucket. One row per stored file, keyed by the same object_key string
-- the media_library row references.

CREATE TABLE IF NOT EXISTS coexistence.media_objects (
  object_key  TEXT PRIMARY KEY,
  data        BYTEA NOT NULL,
  mime_type   TEXT,
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rename the now storage-agnostic columns on media_library. The bytes live in
-- media_objects keyed by storage_key; storage_backend records which backend
-- holds them ('postgres'). Guarded so the migration is safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'coexistence' AND table_name = 'media_library'
       AND column_name = 'minio_object_key'
  ) THEN
    ALTER TABLE coexistence.media_library RENAME COLUMN minio_object_key TO storage_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'coexistence' AND table_name = 'media_library'
       AND column_name = 'minio_bucket'
  ) THEN
    ALTER TABLE coexistence.media_library RENAME COLUMN minio_bucket TO storage_backend;
  END IF;
END $$;

ALTER TABLE coexistence.media_library ALTER COLUMN storage_backend SET DEFAULT 'postgres';
