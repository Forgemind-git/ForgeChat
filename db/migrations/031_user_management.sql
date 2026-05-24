-- User management foundation:
--   * Widen forgecrm_users with status, audit, and per-user permission overrides
--   * Many-to-many user→WhatsApp-number assignments (a BDA can own multiple numbers)
--   * Per-contact assignment override (transfer a customer to another BDA without
--     changing the WhatsApp number they wrote to)
--   * Append-only audit log for sensitive admin actions

ALTER TABLE coexistence.forgecrm_users
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS permissions   JSONB       DEFAULT NULL,  -- { grant: [...], revoke: [...] } overlays on role defaults
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by    BIGINT      REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL;

-- Widen role to support the new vocabulary. We keep 'viewer' as legacy so existing
-- rows aren't invalidated, and add 'bda_sales' for the new role.
ALTER TABLE coexistence.forgecrm_users
  DROP CONSTRAINT IF EXISTS forgecrm_users_role_check;
ALTER TABLE coexistence.forgecrm_users
  ADD CONSTRAINT forgecrm_users_role_check
  CHECK (role IN ('admin','bda_sales','viewer'));

-- Many-to-many: a user may own multiple WhatsApp business numbers.
-- BDA Sales users with no rows here are effectively scoped to nothing.
CREATE TABLE IF NOT EXISTS coexistence.user_wa_assignments (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES coexistence.forgecrm_users(id) ON DELETE CASCADE,
  wa_number   TEXT   NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  UNIQUE (user_id, wa_number)
);
CREATE INDEX IF NOT EXISTS idx_user_wa_assignments_wa ON coexistence.user_wa_assignments(wa_number);

-- Per-contact assignment override. NULL = follow the wa_number→user mapping
-- (default behaviour). Set to a user id to override and transfer the contact.
ALTER TABLE coexistence.contacts
  ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_user ON coexistence.contacts(assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

-- Audit log: append-only record of sensitive admin actions
CREATE TABLE IF NOT EXISTS coexistence.user_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_user_id   BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  actor_username  TEXT,
  action          TEXT NOT NULL,              -- e.g. 'user.create', 'user.delete', 'user.role_change', 'contact.reassign', 'user.password_reset'
  target_type     TEXT,                       -- 'user' | 'contact' | etc.
  target_id       TEXT,                       -- string to accommodate composite ids
  payload         JSONB,                      -- before/after snapshot or other context
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON coexistence.user_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON coexistence.user_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON coexistence.user_audit_log(created_at DESC);
