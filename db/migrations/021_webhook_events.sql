-- Webhook audit log: stores every inbound Meta/n8n webhook payload + processing
-- outcome. Used by the Admin Settings → Webhooks tab for debugging delivery
-- pipelines, replaying failed payloads, and verifying message extraction.
--
-- Retention: 30 days (cleanupWebhookEvents.js cron). Indexed on received_at
-- so the cleanup DELETE stays cheap even with millions of rows.

CREATE TABLE IF NOT EXISTS coexistence.webhook_events (
  id                 BIGSERIAL PRIMARY KEY,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source             TEXT,                     -- 'meta' | 'n8n' | 'replay' | 'verify'
  remote_ip          TEXT,
  request_headers    JSONB,
  payload            JSONB NOT NULL,
  payload_kind       TEXT,                     -- 'messages' | 'statuses' | 'template_status_update' | 'account_update' | 'verify' | 'unknown'
  records_extracted  INTEGER NOT NULL DEFAULT 0,
  processing_status  TEXT NOT NULL DEFAULT 'received'
                       CHECK (processing_status IN ('received','processed','partial','error','verified')),
  processing_error   TEXT,
  processing_ms      INTEGER,
  meta_object        TEXT,                     -- 'whatsapp_business_account' etc.
  phone_number_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received  ON coexistence.webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_kind      ON coexistence.webhook_events(payload_kind);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status    ON coexistence.webhook_events(processing_status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_phone     ON coexistence.webhook_events(phone_number_id);
