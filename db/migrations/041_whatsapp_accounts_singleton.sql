-- 041: Enforce a SINGLE WhatsApp account at the database level.
--
-- This product connects to exactly ONE WhatsApp Business Account (WABA).
-- Enforcement is layered:
--   * Frontend  — the "Connect account" button is hidden once one account exists.
--   * Backend   — POST /whatsapp-accounts returns 409 if a row already exists,
--                 and DELETE refuses to remove the last account.
--   * Database  — this index is the final guard so the invariant holds even if a
--                 row is inserted out-of-band (psql, another service, etc.).
--
-- A UNIQUE index on a constant expression permits at most one row in the table:
-- every row produces the same key (TRUE), so a second insert raises
-- unique_violation (SQLSTATE 23505) — which the API already surfaces as a 409.
--
-- Requires the table to currently hold <= 1 row (it does: the app has capped at
-- one since the single-account change). If a legacy DB somehow has multiples,
-- reduce to one account before applying rather than letting a migration delete
-- a connected WABA silently.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_singleton
  ON coexistence.whatsapp_accounts ((TRUE));
