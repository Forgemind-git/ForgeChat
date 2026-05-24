-- Add name column to broadcasts for better identification
ALTER TABLE coexistence.broadcasts
  ADD COLUMN IF NOT EXISTS name TEXT;
