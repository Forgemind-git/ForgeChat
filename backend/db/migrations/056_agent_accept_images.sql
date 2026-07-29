-- 056_agent_accept_images.sql
-- Per-agent toggle: when on, the agent "sees" an inbound WhatsApp image by
-- passing the image to its (vision-capable) LLM along with any caption. Mirrors
-- transcribe_audio (migration 054). Additive + idempotent.

ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS accept_images BOOLEAN NOT NULL DEFAULT FALSE;
