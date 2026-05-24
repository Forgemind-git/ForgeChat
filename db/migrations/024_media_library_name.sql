-- Add display name to media_library (separate from original filename)
ALTER TABLE coexistence.media_library ADD COLUMN IF NOT EXISTS name TEXT;
