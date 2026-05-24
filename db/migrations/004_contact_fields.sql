CREATE TABLE IF NOT EXISTS coexistence.contact_field_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'phone', 'email', 'date', 'url', 'textarea')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_field_definitions_sort ON coexistence.contact_field_definitions(sort_order);

-- Add custom_fields JSONB to contacts table
ALTER TABLE coexistence.contacts
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_contacts_custom_fields ON coexistence.contacts USING GIN(custom_fields);
