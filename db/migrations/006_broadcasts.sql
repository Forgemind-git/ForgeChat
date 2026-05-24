-- Broadcast campaigns (drafts and sent)
CREATE TABLE IF NOT EXISTS coexistence.broadcasts (
  id SERIAL PRIMARY KEY,
  from_number TEXT NOT NULL,
  recipient_numbers JSONB NOT NULL DEFAULT '[]',
  template_id INTEGER NOT NULL REFERENCES coexistence.message_templates(id),
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT')),
  test_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity log: each test send or broadcast creates a row here
CREATE TABLE IF NOT EXISTS coexistence.broadcast_logs (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER NOT NULL REFERENCES coexistence.broadcasts(id) ON DELETE CASCADE,
  action VARCHAR(16) NOT NULL CHECK (action IN ('TEST','BROADCAST')),
  sent_to TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON coexistence.broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at ON coexistence.broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_broadcast_id ON coexistence.broadcast_logs(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_sent_at ON coexistence.broadcast_logs(sent_at DESC);
