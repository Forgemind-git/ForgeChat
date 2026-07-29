-- Add support for non-template message types in broadcasts
-- (text, link, image, video, audio, document)

ALTER TABLE coexistence.broadcasts
  ALTER COLUMN template_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'template',
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS media_library_id BIGINT,
  ADD COLUMN IF NOT EXISTS caption TEXT;
