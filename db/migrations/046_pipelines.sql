-- 046: Sales Pipelines / Deals (Kanban) module.
--
-- Adds a deal-pipeline CRM tab. Access is role-scoped at the API layer:
--   * admin     — full access: manage pipelines/stages, see ALL deals, edit/delete.
--   * bda_sales — sees ONLY deals assigned to them; may MOVE their own deals
--                 between stages; cannot create/edit details or delete.
-- Deals can optionally link to a contact (wa_number + contact_number, the same
-- composite key used elsewhere) — kept loose (no FK) so a deal survives if the
-- contact row is later removed.

CREATE TABLE IF NOT EXISTS coexistence.pipelines (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  position    INT     NOT NULL DEFAULT 0,
  created_by  BIGINT  REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coexistence.pipeline_stages (
  id           BIGSERIAL PRIMARY KEY,
  pipeline_id  BIGINT NOT NULL REFERENCES coexistence.pipelines(id) ON DELETE CASCADE,
  name         TEXT   NOT NULL,
  probability  INT    NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  position     INT    NOT NULL DEFAULT 0,
  stage_type   TEXT   NOT NULL DEFAULT 'open' CHECK (stage_type IN ('open','won','lost')),
  color        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON coexistence.pipeline_stages(pipeline_id);

CREATE TABLE IF NOT EXISTS coexistence.deals (
  id                  BIGSERIAL PRIMARY KEY,
  pipeline_id         BIGINT NOT NULL REFERENCES coexistence.pipelines(id) ON DELETE CASCADE,
  stage_id            BIGINT NOT NULL REFERENCES coexistence.pipeline_stages(id) ON DELETE RESTRICT,
  title               TEXT   NOT NULL,
  value               NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency            TEXT   NOT NULL DEFAULT 'INR',
  status              TEXT   NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  assigned_user_id    BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  contact_wa_number   TEXT,
  contact_number      TEXT,
  contact_name        TEXT,
  expected_close_date DATE,
  notes               TEXT,
  position            INT    NOT NULL DEFAULT 0,   -- ordering within a stage
  won_at              TIMESTAMPTZ,
  lost_at             TIMESTAMPTZ,
  created_by          BIGINT REFERENCES coexistence.forgecrm_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON coexistence.deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage    ON coexistence.deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_assigned ON coexistence.deals(assigned_user_id);

-- Seed a default "Sales Pipeline" with the standard stages (only if none exist).
DO $$
DECLARE pid BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM coexistence.pipelines) THEN
    INSERT INTO coexistence.pipelines (name, is_default, position)
      VALUES ('Sales Pipeline', TRUE, 0)
      RETURNING id INTO pid;
    INSERT INTO coexistence.pipeline_stages (pipeline_id, name, probability, position, stage_type, color) VALUES
      (pid, 'New Lead',      10, 0, 'open', '#3B82F6'),
      (pid, 'Qualified',     30, 1, 'open', '#EAB308'),
      (pid, 'Proposal Sent', 50, 2, 'open', '#F97316'),
      (pid, 'Negotiation',   70, 3, 'open', '#A855F7'),
      (pid, 'Won',          100, 4, 'won',  '#16A34A'),
      (pid, 'Lost',           0, 5, 'lost', '#DC2626');
  END IF;
END $$;
