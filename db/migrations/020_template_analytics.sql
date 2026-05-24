-- Phase 3: per-day analytics cache for message templates.
-- Mirrors Meta's WABA template_analytics output (sent/delivered/read + per-button clicks).
-- Refreshed by scripts/syncTemplateAnalytics.js cron and on-demand via API.

CREATE TABLE IF NOT EXISTS coexistence.message_template_analytics_daily (
  template_id      INTEGER NOT NULL REFERENCES coexistence.message_templates(id) ON DELETE CASCADE,
  day              DATE NOT NULL,
  sent             INTEGER NOT NULL DEFAULT 0,
  delivered        INTEGER NOT NULL DEFAULT 0,
  read_count       INTEGER NOT NULL DEFAULT 0,  -- "read" is reserved-ish; suffix avoids accidental SQL parse fuss
  clicked_total    INTEGER NOT NULL DEFAULT 0,
  clicked_by_button JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{type, button_content, count}, …]
  last_fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, day)
);

CREATE INDEX IF NOT EXISTS idx_template_analytics_day
  ON coexistence.message_template_analytics_daily(day DESC);
