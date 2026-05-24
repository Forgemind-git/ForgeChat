-- 045: Webhook verify token on the WhatsApp account.
--
-- The connection form was simplified to the four credentials Meta actually
-- needs (Phone Number ID, WhatsApp Business Account ID, Permanent Access Token,
-- Webhook Verify Token) plus a read-only webhook callback URL. The verify
-- token is a custom string the user creates and enters identically in the Meta
-- App Dashboard; the GET /api/webhook/whatsapp handshake compares against it.
--
-- Stored encrypted (AES-256-GCM, same as the access token). Nullable so the
-- column can be added without a value, and so the env-var verify token keeps
-- working for any account created before this migration.
ALTER TABLE coexistence.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS verify_token_encrypted TEXT;

-- display_name / display_phone_number are now auto-derived from the Meta Graph
-- API at save time instead of being typed in the form. They stay NOT NULL (the
-- backend always writes at least an empty string), so no constraint change is
-- needed here — this comment just records the behavioural shift.
