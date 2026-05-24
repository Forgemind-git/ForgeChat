-- WhatsApp click-to-chat link generator table
CREATE TABLE IF NOT EXISTS coexistence.wa_links (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  message       TEXT,
  phone_number  TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_links_slug ON coexistence.wa_links (slug);
CREATE INDEX idx_wa_links_created_at ON coexistence.wa_links (created_at DESC);
