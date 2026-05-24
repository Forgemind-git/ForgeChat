-- Phase 1: revision history for message templates
-- Every edit (manual via UI, restore from history, or detected Meta-side change)
-- snapshots the full template body before mutation.

CREATE TABLE IF NOT EXISTS coexistence.message_template_revisions (
  id           BIGSERIAL PRIMARY KEY,
  template_id  INTEGER NOT NULL REFERENCES coexistence.message_templates(id) ON DELETE CASCADE,
  revised_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revised_by   TEXT,                  -- username from JWT; nullable when source is a cron/sync
  source       TEXT NOT NULL DEFAULT 'manual_edit'
                 CHECK (source IN ('manual_edit','restore','meta_sync','initial')),
  change_summary TEXT,                -- short human label (e.g. "Edited body and buttons")
  snapshot     JSONB NOT NULL         -- full template row at the time of the revision
);

CREATE INDEX IF NOT EXISTS idx_template_revisions_template
  ON coexistence.message_template_revisions(template_id, revised_at DESC);
