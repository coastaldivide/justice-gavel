-- 00000000000008_enable_rls.sql
--
-- Turn on Row Level Security for every table in the public schema.
--
-- Why: Supabase exposes the public schema through its REST API (PostgREST) to
-- the "anon" and "authenticated" roles. With RLS off, anyone holding the
-- project's anon key could read or write every table directly, bypassing the
-- Express backend and all of its auth checks.
--
-- No policies are created, so anon / authenticated are denied everything.
-- The backend is not affected:
--   * it connects with DATABASE_URL as the "postgres" role, which owns these
--     tables (owners bypass RLS unless FORCE ROW LEVEL SECURITY is set, which
--     this migration deliberately does not do) and on Supabase also has
--     BYPASSRLS;
--   * the Supabase "service_role" key has BYPASSRLS.
-- If a future feature needs direct client access to a table, add a policy for
-- that table in a new migration.
--
-- Views: a view runs with its owner's rights by default, which would let
-- anon read the underlying table through it even with RLS on. Every view in
-- public is switched to security_invoker (PostgreSQL 15+), so RLS of the
-- underlying table applies to whoever queries the view, and direct grants on
-- views to anon/authenticated are revoked.
--
-- Runs on plain PostgreSQL too: statements that name Supabase roles only run
-- when those roles exist. Idempotent.

DO $$
DECLARE r record;
BEGIN
  -- every ordinary and partitioned table in public
  FOR r IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;

  -- views: evaluate with the caller's permissions (PG >= 15)
  IF current_setting('server_version_num')::int >= 150000 THEN
    FOR r IN
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v'
         AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'], false)
    LOOP
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', r.relname);
    END LOOP;
  END IF;

  -- Supabase API roles: no direct access to views (tables are covered by RLS)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOR r IN
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.relname);
    END LOOP;
  END IF;
END $$;

-- Sanity check: fail loudly if any public table is still without RLS, or if
-- FORCE RLS is set anywhere (FORCE would block the table-owner backend role).
DO $$
DECLARE missing text; forced text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS not enabled on: %', missing;
  END IF;
  SELECT string_agg(c.relname, ', ') INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity;
  IF forced IS NOT NULL THEN
    RAISE WARNING 'FORCE ROW LEVEL SECURITY is set on: % (the backend owner role will be filtered by RLS there)', forced;
  END IF;
END $$;
