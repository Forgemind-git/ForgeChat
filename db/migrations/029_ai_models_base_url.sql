-- Optional custom base URL for OpenAI-compatible providers (Moonshot/Kimi
-- via gateways like Kimi Code, OpenRouter, SiliconFlow, etc.). When set,
-- requests use this instead of the provider's default endpoint.
-- Should be the API root, e.g. https://api.moonshot.ai/v1 — `/models` and
-- `/chat/completions` are appended by the engine.

ALTER TABLE coexistence.ai_models
  ADD COLUMN IF NOT EXISTS base_url TEXT DEFAULT NULL;
