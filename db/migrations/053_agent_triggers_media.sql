-- 053_agent_triggers_media.sql
-- Adds trigger-gating + media-send config to AI agents.
--   trigger_mode='any'      → legacy behaviour: agent replies to every inbound
--                             on its number that no keyword automation caught.
--   trigger_mode='keyword'  → agent only ENGAGES when an inbound matches the
--                             keyword; once engaged it keeps replying to that
--                             contact's follow-ups for trigger_session_minutes
--                             (a "sticky" session) so it can hold a conversation.
--   media_groups            → JSONB array of { description, mediaIds:[int] }.
--                             Each group is surfaced to the LLM as a send_media
--                             tool; the model sends a group (all its media) when
--                             the conversation matches the group's description.
-- Idempotent: safe to re-run.

ALTER TABLE coexistence.agents
  ADD COLUMN IF NOT EXISTS trigger_mode            TEXT    NOT NULL DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS trigger_keyword         TEXT,
  ADD COLUMN IF NOT EXISTS trigger_match_type      TEXT    NOT NULL DEFAULT 'contains',
  ADD COLUMN IF NOT EXISTS trigger_case_sensitive  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trigger_session_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS media_groups            JSONB   NOT NULL DEFAULT '[]'::jsonb;

-- CHECK constraints (PG15 has no ADD CONSTRAINT IF NOT EXISTS, so guard them).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_trigger_mode_check') THEN
    ALTER TABLE coexistence.agents
      ADD CONSTRAINT agents_trigger_mode_check CHECK (trigger_mode IN ('any', 'keyword'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_trigger_match_type_check') THEN
    ALTER TABLE coexistence.agents
      ADD CONSTRAINT agents_trigger_match_type_check CHECK (trigger_match_type IN ('exact', 'contains', 'starts'));
  END IF;
END $$;
