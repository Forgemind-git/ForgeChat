-- Foundational user table.
--
-- This table is also created at runtime by the backend (backend/src/auth.js
-- `ensureTables()`), but later migrations — e.g. 031_user_management.sql — ALTER
-- it, so it must exist as part of the migration set for a fresh database to be
-- built from migrations alone (same pattern as 042_media_pg_storage.sql, which
-- mirrors backend/src/util/pgStorage.js).
--
-- Definition is kept in sync with auth.js. CREATE TABLE IF NOT EXISTS makes this
-- a no-op on existing deployments where the app already created the table.

CREATE TABLE IF NOT EXISTS coexistence.forgecrm_users (
  id           BIGSERIAL PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE,
  password     TEXT NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'viewer',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
