CREATE TABLE IF NOT EXISTS coexistence.chatbots (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  trigger_type TEXT NOT NULL DEFAULT 'keyword',
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
