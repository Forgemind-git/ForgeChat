-- 001: ForgeChat Chat History Schema
-- Stores WhatsApp messages received via Meta Cloud API webhooks (processed by n8n)

CREATE SCHEMA IF NOT EXISTS coexistence;

CREATE TABLE IF NOT EXISTS coexistence.chat_history (
  id                BIGSERIAL PRIMARY KEY,
  message_id        TEXT NOT NULL UNIQUE,
  phone_number_id   TEXT,
  wa_number         TEXT NOT NULL,
  contact_number    TEXT NOT NULL,
  to_number         TEXT,
  direction         TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type      TEXT NOT NULL DEFAULT 'unknown',
  message_body      TEXT,
  raw_payload       JSONB,
  media_url         TEXT,
  media_mime_type   TEXT,
  status            TEXT DEFAULT 'received' CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed', 'error', 'unknown')),
  timestamp         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_chat_wa_number
  ON coexistence.chat_history(wa_number, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chat_contact
  ON coexistence.chat_history(wa_number, contact_number, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chat_msg_id
  ON coexistence.chat_history(message_id);

CREATE INDEX IF NOT EXISTS idx_chat_timestamp
  ON coexistence.chat_history(timestamp DESC);

-- Optional: contacts table for name mapping
CREATE TABLE IF NOT EXISTS coexistence.contacts (
  id            BIGSERIAL PRIMARY KEY,
  wa_number     TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(wa_number, contact_number)
);

CREATE INDEX IF NOT EXISTS idx_contacts_lookup
  ON coexistence.contacts(wa_number, contact_number);
