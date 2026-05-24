-- Add WhatsApp-specific fields to execution steps for message tracking and filtering

ALTER TABLE coexistence.automation_execution_steps
  ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_message_status VARCHAR(16);

-- Update execution status enum to include 'queued'
ALTER TABLE coexistence.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_status_check;

ALTER TABLE coexistence.automation_executions
  ADD CONSTRAINT automation_executions_status_check
  CHECK (status IN ('queued','running','success','error','cancelled'));

-- Update step status enum to include 'queued'
ALTER TABLE coexistence.automation_execution_steps
  DROP CONSTRAINT IF EXISTS automation_execution_steps_status_check;

ALTER TABLE coexistence.automation_execution_steps
  ADD CONSTRAINT automation_execution_steps_status_check
  CHECK (status IN ('queued','running','success','error','skipped'));

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_execution_steps_wa_status ON coexistence.automation_execution_steps(wa_message_status);
CREATE INDEX IF NOT EXISTS idx_execution_steps_wa_msg_id ON coexistence.automation_execution_steps(wa_message_id);

-- Composite index for execution list filtering by message status
CREATE INDEX IF NOT EXISTS idx_execution_steps_exec_wa_status ON coexistence.automation_execution_steps(execution_id, wa_message_status);
