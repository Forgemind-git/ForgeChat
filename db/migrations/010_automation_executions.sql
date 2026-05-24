CREATE TABLE IF NOT EXISTS coexistence.automation_executions (
  id            BIGSERIAL PRIMARY KEY,
  automation_id BIGINT NOT NULL REFERENCES coexistence.chatbots(id) ON DELETE CASCADE,
  status        VARCHAR(16) NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','success','error','cancelled')),
  trigger_type  VARCHAR(32) NOT NULL,
  trigger_data  JSONB NOT NULL DEFAULT '{}',
  contact_number TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_executions_automation_id ON coexistence.automation_executions(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_executions_status ON coexistence.automation_executions(status);
CREATE INDEX IF NOT EXISTS idx_automation_executions_started_at ON coexistence.automation_executions(started_at DESC);

CREATE TABLE IF NOT EXISTS coexistence.automation_execution_steps (
  id             BIGSERIAL PRIMARY KEY,
  execution_id   BIGINT NOT NULL REFERENCES coexistence.automation_executions(id) ON DELETE CASCADE,
  node_id        TEXT NOT NULL,
  node_type      VARCHAR(32) NOT NULL,
  node_name      TEXT,
  input_data     JSONB NOT NULL DEFAULT '{}',
  output_data    JSONB NOT NULL DEFAULT '{}',
  status         VARCHAR(16) NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','success','error','skipped')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_steps_execution_id ON coexistence.automation_execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_steps_node_id ON coexistence.automation_execution_steps(node_id);
