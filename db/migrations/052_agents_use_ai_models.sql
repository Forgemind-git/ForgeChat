-- 052: Move agent LLM credentials into the shared ai_models registry.
--
-- Before this migration each agent carried its own provider + (optional) BYOK
-- key (llm_provider, llm_api_key_encrypted on coexistence.agents). That meant
-- pasting an API key every time you created an agent and duplicating the same
-- secret across agents. We now reference a single workspace-wide credential in
-- coexistence.ai_models (the dormant table from migrations 027–029) by FK, so
-- a key is added once under Admin Settings → Integrations → AI Models and every
-- agent picks a connected provider + a specific model.
--
-- Also adds an explicit draft/active lifecycle to agents: an agent saved mid-
-- creation (e.g. the operator jumped to the Integrations page to connect a key)
-- is persisted as 'draft' and never handles live traffic until completed and
-- activated.
--
-- Idempotency: install.sh re-applies every migration on each deploy, so this
-- file must be safe to run repeatedly. The new columns use IF NOT EXISTS and
-- the one-time data move is wrapped in a guard that only fires while the legacy
-- llm_api_key_encrypted column still exists; once dropped, the whole block is a
-- no-op.

-- 1. New columns ------------------------------------------------------------
ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS ai_model_id BIGINT
    REFERENCES coexistence.ai_models(id) ON DELETE SET NULL;

ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- status check constraint (guarded so re-runs don't error on the duplicate).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_status_check'
  ) THEN
    ALTER TABLE coexistence.agents
      ADD CONSTRAINT agents_status_check CHECK (status IN ('draft', 'active'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_ai_model ON coexistence.agents (ai_model_id);

-- Drafts can be saved before a model is chosen, so llm_model must be nullable
-- (051 created it NOT NULL). Safe to run repeatedly.
ALTER TABLE coexistence.agents ALTER COLUMN llm_model DROP NOT NULL;

-- 2. One-time data migration ------------------------------------------------
-- Lift each agent's embedded key into an ai_models row and repoint the agent,
-- then drop the legacy credential columns. Guarded on the legacy column still
-- existing so the block is a no-op on subsequent deploys.
DO $$
DECLARE
  r            RECORD;
  new_model_id BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'coexistence'
       AND table_name   = 'agents'
       AND column_name  = 'llm_api_key_encrypted'
  ) THEN
    -- Only agents that actually carried their own key need a registry row.
    -- Agents that relied on the server-wide ANTHROPIC_API_KEY / OPENAI_API_KEY
    -- env fallback get ai_model_id = NULL and surface in the UI as "needs an
    -- AI model" (the admin re-selects one after connecting a key).
    FOR r IN
      SELECT id, llm_provider, llm_api_key_encrypted
        FROM coexistence.agents
       WHERE llm_api_key_encrypted IS NOT NULL
         AND ai_model_id IS NULL
    LOOP
      INSERT INTO coexistence.ai_models (provider, label, api_key_encrypted, available_models)
      VALUES (
        r.llm_provider,
        'Migrated from agent #' || r.id,
        r.llm_api_key_encrypted,
        '[]'::jsonb
      )
      RETURNING id INTO new_model_id;

      UPDATE coexistence.agents SET ai_model_id = new_model_id WHERE id = r.id;
    END LOOP;

    -- Agents that relied on the server-wide env key (llm_api_key_encrypted was
    -- NULL) have no key to lift into the registry, so they end up with
    -- ai_model_id = NULL. Demote them to drafts (and off live traffic) so the
    -- engine never runs them with an unresolvable provider — the admin connects
    -- a model under Integrations → AI Models and re-selects it to reactivate.
    UPDATE coexistence.agents
       SET status = 'draft', is_active = FALSE
     WHERE ai_model_id IS NULL;

    -- Keys now live in the registry — drop the per-agent credential columns.
    -- llm_model (the specific model id, e.g. 'gpt-4o-mini') is intentionally
    -- kept: the provider comes from the joined ai_models row, the exact model
    -- stays on the agent.
    ALTER TABLE coexistence.agents DROP COLUMN IF EXISTS llm_api_key_encrypted;
    ALTER TABLE coexistence.agents DROP COLUMN IF EXISTS llm_provider;
  END IF;
END $$;
