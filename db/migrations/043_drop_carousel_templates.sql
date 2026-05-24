-- 043: Remove the carousel template feature
--
-- The CAROUSEL template type (2–10 product cards with horizontal scroll) has
-- been removed from the app. This migration drops the two columns that existed
-- solely to support it (both added in migration 018):
--   * carousel_cards  — JSONB array of card definitions, only ever populated
--                       for template_type='CAROUSEL'.
--   * template_type    — only ever distinguished 'STANDARD' vs 'CAROUSEL'.
--                       With carousel gone, every template is standard, so the
--                       column (and its CHECK constraint) is vestigial.
--
-- Dropping a column also drops its constraints, so the
-- message_templates_template_type_check added in 018 is removed automatically.

ALTER TABLE coexistence.message_templates
  DROP COLUMN IF EXISTS carousel_cards,
  DROP COLUMN IF EXISTS template_type;
