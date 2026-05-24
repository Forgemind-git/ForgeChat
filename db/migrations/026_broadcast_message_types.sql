-- Add support for non-template message types in broadcasts
-- (text, link, image, video, audio, document)

ALTER TABLE coexistence.broadcasts
  ALTER COLUMN template_id DROP NOT NULL,
  ADD COLUMN message_type TEXT NOT NULL DEFAULT 'template',
  ADD COLUMN body TEXT,
  ADD COLUMN url TEXT,
  ADD COLUMN media_library_id BIGINT,
  ADD COLUMN caption TEXT;
