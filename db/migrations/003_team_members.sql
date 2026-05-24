CREATE TABLE IF NOT EXISTS coexistence.team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT,
  bda_id TEXT UNIQUE,
  address TEXT,
  email TEXT,
  profile_picture_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on bda_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_team_members_bda_id ON coexistence.team_members(bda_id);
