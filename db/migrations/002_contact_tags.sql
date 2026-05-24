-- 002: Contact Tags, Categories, and Tags Schema

CREATE TABLE IF NOT EXISTS coexistence.categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coexistence.tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#dc2626',
  category_id TEXT NOT NULL REFERENCES coexistence.categories(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add tags JSONB to contacts for storing assigned tag references
ALTER TABLE coexistence.contacts
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

-- Seed default categories and tags
INSERT INTO coexistence.categories (id, name, description)
VALUES
  ('cat-1', 'Admission', 'Admission related enquiries and stages'),
  ('cat-2', 'Fees', 'Fee payments, enquiries and follow-ups')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coexistence.tags (id, name, color, category_id)
VALUES
  ('tag-1', 'FIRST MESSAGE', '#e9edef', 'cat-1'),
  ('tag-2', 'LVL TEST COMPLETED', '#e3d5f6', 'cat-1'),
  ('tag-3', 'FEES DETAILS', '#d1e7f6', 'cat-2'),
  ('tag-4', 'ADMISSION', '#d1f6e3', 'cat-1')
ON CONFLICT (id) DO NOTHING;
