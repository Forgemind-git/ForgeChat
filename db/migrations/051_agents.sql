-- 051: AI Agents (standalone, not workflow nodes).
--
-- An "agent" is a configured LLM that handles inbound WhatsApp messages on a
-- bound WA account: system prompt + provider + model + BYOK key + tools. Tools
-- are stored separately so we can extend the tool registry (Gmail, Calendar,
-- HTTP, ...) without changing the agent row shape.
--
-- Per the agreed plan, agents are *always-on* for their bound WA account — the
-- webhook's automation evaluation runs first, and only when no keyword auto
-- fires do we hand the message to the active agent. Precedence is enforced in
-- backend/src/services/agentRouter.js, not here.
--
-- llm_api_key_encrypted is AES-256-GCM (backend/src/util/crypto.js). Null
-- means "fall back to ANTHROPIC_API_KEY / OPENAI_API_KEY from the server env".

CREATE TABLE IF NOT EXISTS coexistence.agents (
  id                       BIGSERIAL PRIMARY KEY,
  name                     TEXT NOT NULL,
  description              TEXT,
  system_prompt            TEXT NOT NULL,
  llm_provider             TEXT NOT NULL CHECK (llm_provider IN ('anthropic','openai')),
  llm_model                TEXT NOT NULL,
  llm_api_key_encrypted    TEXT,
  wa_account_id            BIGINT REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL,
  is_active                BOOLEAN NOT NULL DEFAULT FALSE,
  context_window_messages  INT NOT NULL DEFAULT 20,
  max_tool_iterations      INT NOT NULL DEFAULT 6,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single active agent per WA account: enforced with a partial unique index so
-- multiple paused/inactive drafts can coexist for the same number while only
-- one ever takes inbound traffic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_one_active_per_account
  ON coexistence.agents (wa_account_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS coexistence.agent_tools (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL REFERENCES coexistence.agents(id) ON DELETE CASCADE,
  tool_type    TEXT NOT NULL,            -- 'google_sheets' in v1
  config       JSONB NOT NULL,           -- shape varies by tool_type; see backend
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tools_agent
  ON coexistence.agent_tools (agent_id);

-- One row per LLM-invocation chain (i.e. per inbound message handled).
CREATE TABLE IF NOT EXISTS coexistence.agent_runs (
  id                   BIGSERIAL PRIMARY KEY,
  agent_id             BIGINT NOT NULL REFERENCES coexistence.agents(id) ON DELETE CASCADE,
  wa_account_id        BIGINT REFERENCES coexistence.whatsapp_accounts(id) ON DELETE SET NULL,
  contact_number       TEXT NOT NULL,
  inbound_message_id   TEXT,
  status               TEXT NOT NULL CHECK (status IN ('running','completed','failed','capped')),
  total_input_tokens   INT,
  total_output_tokens  INT,
  final_reply          TEXT,
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started
  ON coexistence.agent_runs (agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_contact
  ON coexistence.agent_runs (contact_number, started_at DESC);

CREATE TABLE IF NOT EXISTS coexistence.agent_run_steps (
  id              BIGSERIAL PRIMARY KEY,
  run_id          BIGINT NOT NULL REFERENCES coexistence.agent_runs(id) ON DELETE CASCADE,
  step_index      INT NOT NULL,
  step_type       TEXT NOT NULL CHECK (step_type IN ('llm_call','tool_call')),
  tool_type       TEXT,                          -- set when step_type='tool_call'
  input           JSONB,
  output          JSONB,
  status          TEXT NOT NULL CHECK (status IN ('ok','error')),
  latency_ms      INT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run
  ON coexistence.agent_run_steps (run_id, step_index);
