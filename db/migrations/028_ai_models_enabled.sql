-- Track which models from `available_models` the user has explicitly enabled
-- for use elsewhere (e.g. the AI Agent automation node). NULL means "all
-- available models are enabled" (the default behaviour). An explicit array
-- restricts to those model ids.

ALTER TABLE coexistence.ai_models
  ADD COLUMN IF NOT EXISTS enabled_models JSONB DEFAULT NULL;
