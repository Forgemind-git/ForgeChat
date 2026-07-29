-- 050: Generic OAuth credentials.
--
-- Provider-keyed so the same table holds Google (v1: Sheets), and later Gmail,
-- Calendar, Slack, HubSpot, etc. — no schema migration when we add providers.
-- refresh/access tokens are AES-256-GCM ciphertexts produced by
-- backend/src/util/crypto.js. NEVER store plain tokens in these columns.
--
-- Indexing: lookup by (user_id, provider) is the hot path (list-my-google-accounts).

CREATE TABLE IF NOT EXISTS coexistence.oauth_credentials (
  id                         BIGSERIAL PRIMARY KEY,
  user_id                    BIGINT NOT NULL REFERENCES coexistence.forgecrm_users(id) ON DELETE CASCADE,
  provider                   TEXT NOT NULL,                       -- 'google' in v1
  account_label              TEXT NOT NULL,                       -- e.g. user's Google email
  refresh_token_encrypted    TEXT NOT NULL,
  access_token_encrypted     TEXT,
  access_token_expires_at    TIMESTAMPTZ,
  scopes                     TEXT[] NOT NULL DEFAULT '{}',        -- e.g. ['drive.file','spreadsheets']
  health_status              TEXT NOT NULL DEFAULT 'ok',          -- 'ok' | 'error'
  last_error_message         TEXT,
  last_refreshed_at          TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, account_label)
);

CREATE INDEX IF NOT EXISTS idx_oauth_credentials_user_provider
  ON coexistence.oauth_credentials (user_id, provider);
