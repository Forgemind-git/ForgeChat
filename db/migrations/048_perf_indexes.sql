-- 048: Performance indexes (review lane 15)
--
-- Additive, idempotent index tuning for the hot read paths. All CREATE INDEX
-- IF NOT EXISTS; safe to re-run. No data or column changes.

-- ── chat_history: inbound-message lookups ──────────────────────────────────
-- secondsSinceLastIncoming() (every send + window check) filters by
-- phone_number_id + contact_number + direction='incoming'; the unread/numbers
-- query filters by wa_number + contact_number + direction='incoming'. Neither
-- was covered by an existing index. Partial indexes keep them small.
CREATE INDEX IF NOT EXISTS idx_chat_incoming
  ON coexistence.chat_history (wa_number, contact_number, timestamp DESC)
  WHERE direction = 'incoming';

CREATE INDEX IF NOT EXISTS idx_chat_phone_number_id_contact
  ON coexistence.chat_history (phone_number_id, contact_number, timestamp DESC)
  WHERE direction = 'incoming';

-- idx_chat_msg_id is redundant: the UNIQUE constraint on message_id already
-- provides an index for message_id lookups. Drop it to cut write amplification.
DROP INDEX IF EXISTS coexistence.idx_chat_msg_id;

-- ── chatbots: evaluateTriggers loads active automations per inbound message ──
CREATE INDEX IF NOT EXISTS idx_chatbots_status
  ON coexistence.chatbots (status);

-- ── automation_executions: webhook resume-lookup also filters expires_at ─────
-- The old partial index omitted expires_at, forcing a heap recheck on every
-- resume. Recreate it including expires_at.
DROP INDEX IF EXISTS coexistence.idx_executions_resume_lookup;
CREATE INDEX IF NOT EXISTS idx_executions_resume_lookup
  ON coexistence.automation_executions (wa_number, contact_number, expires_at)
  WHERE status = 'paused';

-- ── deals: pipeline metrics + Kanban ordering ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_status
  ON coexistence.deals (pipeline_id, status);

CREATE INDEX IF NOT EXISTS idx_deals_won_at
  ON coexistence.deals (won_at DESC)
  WHERE status = 'won';

CREATE INDEX IF NOT EXISTS idx_deals_pipeline_position
  ON coexistence.deals (pipeline_id, stage_id, position ASC);

-- ── broadcast_logs: rollup join on wa_message_id ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_wa_message_id
  ON coexistence.broadcast_logs (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- ── contacts: saved-contacts sort by display name ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_contacts_display_name
  ON coexistence.contacts (wa_number, (COALESCE(name, profile_name)));

-- ── message_templates: language filter/group ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_message_templates_language
  ON coexistence.message_templates (language);

-- ── user_audit_log: per-entity history lookups ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_target
  ON coexistence.user_audit_log (target_type, target_id, created_at DESC);
