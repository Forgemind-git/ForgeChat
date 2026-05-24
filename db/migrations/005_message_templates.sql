-- Message Templates for WhatsApp Business API
CREATE TABLE IF NOT EXISTS coexistence.message_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(512) NOT NULL,
  category VARCHAR(32) NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  header_type VARCHAR(16) NOT NULL DEFAULT 'NONE' CHECK (header_type IN ('NONE','TEXT','IMAGE','VIDEO','DOCUMENT')),
  header_text TEXT,
  media_handle TEXT,
  body TEXT NOT NULL,
  footer TEXT,
  buttons JSONB DEFAULT '[]',
  samples JSONB DEFAULT '{}',
  security_recommendation BOOLEAN DEFAULT FALSE,
  code_expiry_minutes INTEGER,
  allow_category_change BOOLEAN DEFAULT TRUE,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  meta_template_id TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_templates_status ON coexistence.message_templates(status);
CREATE INDEX IF NOT EXISTS idx_message_templates_category ON coexistence.message_templates(category);
CREATE INDEX IF NOT EXISTS idx_message_templates_name ON coexistence.message_templates(name);