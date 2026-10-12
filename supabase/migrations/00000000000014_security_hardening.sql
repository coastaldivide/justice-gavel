-- 00000000000014_security_hardening.sql — schema support for the audit11
-- security fixes (step 11). Idempotent: safe to run any number of times.
--
--  H7  translation_sessions: per-session participant binding, secret token
--      hashes and a message budget (an unguessable token, not the 6-char code,
--      authorises posting/reading).
--  H8  sso_configurations: entity_id / sp_entity_id are IdP/SP entity IDs
--      (URLs/URNs) — they were BIGINT, so a real IdP config could not be saved.
--      sso_request_cache: SAML AuthnRequest IDs (InResponseTo) and single-use
--      assertion IDs (replay protection), shared by every app instance.
--  C2  Lead purchases recorded by the old free/demo accept paths (no Stripe
--      charge) no longer count as purchases — contact details stay hidden.
--  C1  case_assignments lookups by (case_id, defender_id, status).
--  C3  matters.firm_id referenced `workspaces` (a recovered placeholder table
--      nothing writes), so a firm member could not create a firm matter at all
--      on Postgres and firm scoping had nothing to scope. It now references
--      firms(id) — the table every firm route and membership check uses.
--  C4  privilege_log.doc_number was INTEGER but the log numbers entries
--      "PRIV-0001", so no entry could be written on Postgres (the legitimate
--      flow the scoped routes must keep serving). It is now TEXT.

-- ── H7 translation sessions ─────────────────────────────────────────────────
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS host_token_hash        TEXT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS participant_id         BIGINT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS participant_token_hash TEXT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS joined_at              TIMESTAMPTZ;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS message_count          INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_translation_sessions_code ON translation_sessions (code);

-- ── H8 SSO ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'sso_configurations'
                AND column_name = 'entity_id' AND data_type <> 'text') THEN
    ALTER TABLE sso_configurations ALTER COLUMN entity_id TYPE TEXT USING entity_id::text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'sso_configurations'
                AND column_name = 'sp_entity_id' AND data_type <> 'text') THEN
    ALTER TABLE sso_configurations ALTER COLUMN sp_entity_id TYPE TEXT USING sp_entity_id::text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sso_request_cache (
  cache_key  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sso_request_cache_created ON sso_request_cache (created_at);
ALTER TABLE sso_request_cache ENABLE ROW LEVEL SECURITY;   -- deny-all like every other table (08)

-- ── C2 unpaid "purchases" never unlock contact details ───────────────────────
UPDATE civil_lead_purchases SET status = 'void_unpaid'
 WHERE status = 'charged' AND COALESCE(stripe_pi_id, '') IN ('', 'pi_civil_demo');
UPDATE lead_purchases SET status = 'void_unpaid'
 WHERE status = 'charged' AND COALESCE(stripe_pi_id, '') IN ('', 'pi_mock_demo');

-- ── C1 assignment lookups ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_case_assignments_case_defender
  ON case_assignments (case_id, defender_id, status);

-- ── C3 matters belong to firms ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'matters_firm_id_fkey'
                AND conrelid = 'public.matters'::regclass
                AND confrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE matters DROP CONSTRAINT matters_firm_id_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'matters_firm_id_fkey'
                    AND conrelid = 'public.matters'::regclass) THEN
    -- NOT VALID: legacy rows (if any) pointing at workspaces are left alone;
    -- every new/updated row must reference a real firm.
    ALTER TABLE matters ADD CONSTRAINT matters_firm_id_fkey
      FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_matters_firm ON matters (firm_id);

-- ── C4 privilege log numbering ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'privilege_log'
                AND column_name = 'doc_number' AND data_type <> 'text') THEN
    ALTER TABLE privilege_log ALTER COLUMN doc_number TYPE TEXT USING doc_number::text;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_privilege_log_firm_matter ON privilege_log (firm_id, matter_id);
