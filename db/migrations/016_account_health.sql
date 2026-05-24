-- 016: WhatsApp account health tracking
-- When Meta returns 401/190 (token expired/invalid), the send queue marks
-- the account so the UI can show a "Update token" banner instead of silent
-- failures.

ALTER TABLE coexistence.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown','healthy','invalid_token','rate_limited','unknown_error')),
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
