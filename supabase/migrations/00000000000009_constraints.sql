-- 00000000000009_constraints.sql
--
-- 1. Restores the uniqueness the original SQLite schema had and the Postgres
--    consolidation lost:
--      firm_members            (firm_id, user_id)      backend/src/__tests__ fixtures / original firm schema
--      integration_connections (firm_id, provider)     original integrations schema
--      vertical_deadline_presets (vertical, rule_key)  backend/src/migrations/037_firm_verticals.sql
--    Each unique index is created only when the table holds no duplicates;
--    otherwise a WARNING names the table and nothing is changed (duplicates
--    must be resolved by a human — rows are never deleted here).
-- 2. matter_team_members.can_edit defaults back to 0 (deny write unless granted;
--    the original secure default). Applied to matter_teams.can_edit too if that
--    column exists. Existing rows are not changed.
-- 3. User-entered calendar dates that were TIMESTAMPTZ become DATE, so a court
--    date entered as '2026-11-20' is returned as '2026-11-20' (the API's DATE
--    type parser keeps DATE as a string) instead of '2026-11-20T00:00:00Z',
--    which devices west of UTC displayed as the previous day. Existing values
--    are converted with their UTC calendar day (the server stores date-only
--    input as UTC midnight). Only columns the app writes as 'YYYY-MM-DD' are
--    converted; real timestamps (firm_trials, arrests, *_at) are left alone.
-- 4. message_attachments: metadata for files attached to case messages
--    (POST /api/messages/attachment). File bytes live in object storage / the
--    data volume, encrypted (AES-256-GCM); only metadata is stored here.
--
-- lawyers / bail_agents are not touched.
-- Idempotent: safe to run any number of times.

BEGIN;

SET client_min_messages = warning;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Uniqueness
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  spec   record;
  dupes  bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('firm_members',              'uq_firm_members_firm_user',              'firm_id, user_id'),
      ('integration_connections',   'uq_integration_connections_firm_provider','firm_id, provider'),
      ('vertical_deadline_presets', 'uq_vertical_deadline_presets_rule',      'vertical, rule_key')
    ) AS t(tbl, idx, cols)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE WARNING '[09] table % does not exist; unique index % skipped', spec.tbl, spec.idx;
      CONTINUE;
    END IF;
    IF to_regclass('public.' || spec.idx) IS NOT NULL THEN
      CONTINUE;  -- already in place
    END IF;
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM public.%I GROUP BY %s HAVING count(*) > 1) d',
      spec.tbl, spec.cols) INTO dupes;
    IF dupes > 0 THEN
      RAISE WARNING '[09] % has % duplicated (%) group(s); unique index % NOT created — resolve the duplicates and re-run this migration',
        spec.tbl, dupes, spec.cols, spec.idx;
    ELSE
      EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I (%s)', spec.idx, spec.tbl, spec.cols);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Secure default for team edit rights
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.data_type
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name IN ('matter_team_members', 'matter_teams')
       AND c.column_name = 'can_edit'
  LOOP
    IF r.data_type = 'boolean' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN can_edit SET DEFAULT false', r.table_name);
    ELSE
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN can_edit SET DEFAULT 0', r.table_name);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Date-only columns: TIMESTAMPTZ -> DATE
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('cases',             'next_court_date'),
      ('cases',             'court_date'),
      ('matters',           'court_date'),
      ('matters',           'next_court_date'),
      ('matters',           'opened_date'),
      ('matters',           'trial_start_date'),
      ('matters',           'trial_end_date'),
      ('eviction_trackers', 'court_date'),
      ('civil_leads',       'incident_date'),
      ('pi_leads',          'incident_date')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = spec.col
         AND data_type IN ('timestamp with time zone', 'timestamp without time zone')
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE date USING ((%I AT TIME ZONE ''UTC'')::date)',
        spec.tbl, spec.col, spec.col);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. message_attachments
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS message_attachments (
  id            BIGSERIAL PRIMARY KEY,
  uploader_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id       BIGINT REFERENCES cases(id) ON DELETE CASCADE,
  message_id    BIGINT REFERENCES case_messages(id) ON DELETE SET NULL,
  original_name TEXT   NOT NULL,
  mime_type     TEXT   NOT NULL,
  size_bytes    BIGINT NOT NULL,
  sha256        TEXT   NOT NULL,
  storage       TEXT   NOT NULL,   -- 'local' | 'supabase'
  storage_key   TEXT   NOT NULL,
  encrypted     INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_case     ON message_attachments (case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_attachments_uploader ON message_attachments (uploader_id, created_at);

-- Same policy as 00000000000008_enable_rls.sql: RLS on, no client roles.
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.message_attachments FROM anon, authenticated;
    REVOKE ALL ON SEQUENCE public.message_attachments_id_seq FROM anon, authenticated;
  END IF;
END $$;

COMMIT;
