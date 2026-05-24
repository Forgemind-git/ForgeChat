-- 017: Meta App ID per WhatsApp account
-- Required for the Resumable Upload API (template media handles). Different
-- from waba_id and phone_number_id — this is the Meta App that owns the
-- WhatsApp Business Account. Nullable so existing accounts keep working;
-- only required when submitting templates with media headers.

ALTER TABLE coexistence.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS meta_app_id TEXT;
