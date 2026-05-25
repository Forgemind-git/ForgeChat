-- 049: Persist which Media Library item backs a template's media header.
--
-- The template `media_handle` (Meta Resumable Upload handle) is single-use and
-- not a viewable URL, so the builder cannot render a preview of an existing
-- template's header image from it. We additionally remember the source Media
-- Library row id so the editor/preview can re-show the image after a reload or
-- submit. Additive + idempotent; no data changes.

ALTER TABLE coexistence.message_templates
  ADD COLUMN IF NOT EXISTS header_media_library_id INTEGER;
