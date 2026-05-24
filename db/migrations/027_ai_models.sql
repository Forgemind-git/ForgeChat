-- AI model API credentials. One row per (provider, api_key) the workspace
-- has connected. `available_models` is a JSONB array of `{id, name}` objects
-- discovered by calling the provider's /models endpoint on save.

CREATE TABLE IF NOT EXISTS coexistence.ai_models (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,                       -- openai | anthropic | kimi | gemini
  label TEXT,                                   -- optional friendly name
  api_key_encrypted TEXT NOT NULL,
  available_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_models_provider_idx ON coexistence.ai_models(provider);
