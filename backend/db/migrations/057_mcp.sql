-- 057_mcp.sql
-- External MCP access: bearer API keys + a singleton settings row (master switch
-- + per-capability toggles). Mirrors services/mcpService.ensureMcpTables().
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS coexistence.mcp_api_keys (
  id           BIGSERIAL PRIMARY KEY,
  label        TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_last4    TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,      -- sha256(plaintext) hex
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_by   BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coexistence.mcp_settings (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  master_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  capabilities   JSONB NOT NULL DEFAULT '{"discovery":true,"create_agent":true,"update_agent":true,"manage_tools":true,"delete":true}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO coexistence.mcp_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
