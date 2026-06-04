-- 055: Google OAuth *app* credentials (Client ID / Secret / Redirect URI).
--
-- This is the application-level OAuth client identity — what identifies this
-- ForgeChat install to Google — configured once by an admin in the UI under
-- Settings -> Integrations -> Google. It is distinct from
-- coexistence.oauth_credentials (migration 050), which holds the per-USER
-- connection tokens minted after each user approves consent.
--
-- Single workspace-wide row (the newest row by id wins). client_id and
-- client_secret are AES-256-GCM ciphertexts produced by backend/src/util/crypto.js
-- — NEVER store the plaintext. redirect_uri is not a secret (Google shows it on
-- the consent screen) so it is stored in the clear for easy display/copy.

CREATE TABLE IF NOT EXISTS coexistence.google_oauth_credentials (
  id                       SERIAL PRIMARY KEY,
  client_id_encrypted      TEXT NOT NULL,
  client_secret_encrypted  TEXT NOT NULL,
  redirect_uri             TEXT NOT NULL,
  updated_by               BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
