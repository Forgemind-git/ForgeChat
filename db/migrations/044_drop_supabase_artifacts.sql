-- 044: Remove all Supabase-specific database artifacts.
--
-- The project now runs on plain PostgreSQL with no Supabase service. This drops
-- the leftovers from the Supabase era:
--   * the RLS policy + row-level security on chat_history (it only existed so
--     Supabase's service_role could bypass RLS; our backend connects as the DB
--     owner and never relied on it)
--   * the anon / authenticated / service_role roles and every privilege granted
--     to them (created by the old bootstrap, unused by the app)
--   * normalises media_library.storage_backend to 'postgres'
-- Every step is idempotent / guarded so the migration is safe on a fresh DB too.

-- 1. Drop the RLS policy + disable row-level security on chat_history.
DROP POLICY IF EXISTS service_role_all ON coexistence.chat_history;
ALTER TABLE coexistence.chat_history DISABLE ROW LEVEL SECURITY;

-- 2. Normalise the storage-backend marker on existing rows + the column default.
UPDATE coexistence.media_library SET storage_backend = 'postgres'
 WHERE storage_backend IS DISTINCT FROM 'postgres';
ALTER TABLE coexistence.media_library ALTER COLUMN storage_backend SET DEFAULT 'postgres';

-- 3. Remove the Supabase roles and everything tied to them. DROP OWNED BY
--    revokes all grants and drops dependent objects/policies; then the role can
--    be dropped. Guarded so it no-ops when a role doesn't exist.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['service_role', 'authenticated', 'anon'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('DROP OWNED BY %I CASCADE', r);
      EXECUTE format('DROP ROLE %I', r);
    END IF;
  END LOOP;
END $$;
