-- 018: Full Meta template lifecycle tracking
-- After Meta reviews a template (~24h), it can transition to APPROVED,
-- REJECTED, PAUSED (quality dropped), or DISABLED. We need columns for
-- every signal Meta returns so the UI can show actionable status.

-- 1. Expand status enum to include PAUSED + DISABLED
ALTER TABLE coexistence.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_status_check;

ALTER TABLE coexistence.message_templates
  ADD CONSTRAINT message_templates_status_check
  CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAUSED','DISABLED'));

-- 2. Quality + rejection + category-change signals
ALTER TABLE coexistence.message_templates
  ADD COLUMN IF NOT EXISTS quality_score TEXT,                  -- GREEN | YELLOW | RED | UNKNOWN
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,               -- INVALID_FORMAT, ABUSIVE_CONTENT, etc.
  ADD COLUMN IF NOT EXISTS previous_category TEXT,              -- when Meta auto-reclassifies
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- 3. Template type — opens the door for CAROUSEL (Phase D) without breaking
--    existing STANDARD rows
ALTER TABLE coexistence.message_templates
  ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (template_type IN ('STANDARD','CAROUSEL'));

-- 4. Carousel cards (only used when template_type='CAROUSEL'). Each card is
--    { header_handle, body, buttons[] } — same shape as Meta's spec.
ALTER TABLE coexistence.message_templates
  ADD COLUMN IF NOT EXISTS carousel_cards JSONB DEFAULT '[]'::jsonb;

-- 5. Translation grouping — same template name in multiple languages forms
--    one logical group. NULL for legacy rows; populated on save going forward.
ALTER TABLE coexistence.message_templates
  ADD COLUMN IF NOT EXISTS template_group_key TEXT;
CREATE INDEX IF NOT EXISTS idx_message_templates_group_key
  ON coexistence.message_templates(template_group_key);

-- Backfill: group_key = lower(name) so existing single-language rows stay
-- coherent. New rows compute the same way in code so siblings auto-group.
UPDATE coexistence.message_templates
   SET template_group_key = lower(name)
 WHERE template_group_key IS NULL;
