-- 013: WhatsApp Business Accounts
-- Each row represents one WhatsApp Business Account (WABA) that the CRM
-- can submit templates against, send broadcasts from, and route messages
-- through. Templates and broadcasts FK back to whichever account they
-- belong to so multi-account setups work cleanly.
--
-- access_token_encrypted holds an AES-256-GCM ciphertext (see backend
-- src/util/crypto.js). NEVER store plain tokens in this column.

CREATE TABLE IF NOT EXISTS coexistence.whatsapp_accounts (
  id                       BIGSERIAL PRIMARY KEY,
  display_name             TEXT NOT NULL,
  display_phone_number     TEXT NOT NULL,
  phone_number_id          TEXT NOT NULL UNIQUE,
  waba_id                  TEXT NOT NULL,
  access_token_encrypted   TEXT NOT NULL,
  is_default               BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one row can hold is_default=true at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_accounts_one_default
  ON coexistence.whatsapp_accounts((is_default))
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_phone_number_id
  ON coexistence.whatsapp_accounts(phone_number_id);

-- message_templates now references the account they belong to (nullable —
-- existing rows stay 'Unassigned' until an admin manually assigns them)
ALTER TABLE coexistence.message_templates
  ADD COLUMN IF NOT EXISTS whatsapp_account_id BIGINT
    REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_message_templates_whatsapp_account
  ON coexistence.message_templates(whatsapp_account_id);

-- broadcasts also need to know which account to send from (same nullability)
ALTER TABLE coexistence.broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_account_id BIGINT
    REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_broadcasts_whatsapp_account
  ON coexistence.broadcasts(whatsapp_account_id);
