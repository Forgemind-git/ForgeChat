-- 054_agent_transcribe_audio.sql
-- Per-agent toggle: when on, the agent transcribes inbound WhatsApp voice notes
-- with OpenAI Whisper (using the workspace's OpenAI key from the AI Models
-- registry) and acts on the transcript. Additive + idempotent.

ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS transcribe_audio BOOLEAN NOT NULL DEFAULT FALSE;
