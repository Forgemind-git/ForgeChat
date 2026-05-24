-- Add variable mapping for template variables to contact fields
ALTER TABLE coexistence.broadcasts
ADD COLUMN IF NOT EXISTS variable_mapping JSONB DEFAULT '{}';

-- Add name column if not exists (used for broadcast naming)
ALTER TABLE coexistence.broadcasts
ADD COLUMN IF NOT EXISTS name TEXT;
