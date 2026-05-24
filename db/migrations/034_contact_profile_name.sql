-- 034_contact_profile_name.sql
-- Separate the WhatsApp profile/push name from the CRM-captured name.
--
-- Problem: the inbound webhook was writing the customer's WhatsApp profile name
-- into coexistence.contacts.name on every message, so the automation condition
-- "name is not empty" was always true and the AI "ask for name" branch never ran.
--
-- Fix: store the WhatsApp profile name in its own column. `name` now means a name
-- WE captured (AI ask-name flow or manual save) and is no longer overwritten by
-- inbound messages. Display falls back to COALESCE(name, profile_name).

ALTER TABLE coexistence.contacts ADD COLUMN IF NOT EXISTS profile_name TEXT;

-- Backfill so existing contacts keep showing a name (current `name` values are
-- really WhatsApp profile names). We KEEP `name` here (grandfather existing
-- contacts as "known" so the live automation does not mass-ask real customers);
-- only brand-new or explicitly-cleared contacts will be asked going forward.
UPDATE coexistence.contacts
   SET profile_name = name
 WHERE profile_name IS NULL AND name IS NOT NULL AND name <> '';
