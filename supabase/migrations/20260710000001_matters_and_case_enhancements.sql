-- ============================================================================
-- Migration: 20260710000001_matters_and_case_enhancements.sql
--
-- Adds:
--   1. matters table — law firm matter management (missing from schema)
--   2. cases table enhancements — landmark case fields (jurisdiction, type, etc.)
--   3. conflict_index table — party conflict tracking (confirm exists)
--   4. Indexes for matter and case queries at scale
--
-- Required by:
--   All 20 landmark case simulations (Enron, Madoff, J6, Trump, etc.)
-- ============================================================================

-- ── 1. MATTERS TABLE (law firm matter management) ──────────────────────────
CREATE TABLE IF NOT EXISTS matters (
  id                 BIGSERIAL PRIMARY KEY,
  firm_id            BIGINT REFERENCES workspaces(id) ON DELETE CASCADE,
  client_name        TEXT    NOT NULL,
  client_email       TEXT,
  matter_number      TEXT,                    -- firm's internal reference
  title              TEXT    NOT NULL,
  matter_type        TEXT    DEFAULT 'criminal', -- criminal|civil|MDL|bankruptcy|constitutional|IP|antitrust
  status             TEXT    DEFAULT 'active',   -- active|closed|on_hold|settled|appealing
  state              TEXT,
  jurisdiction       TEXT,                    -- federal|state|international|multi-district
  charge             TEXT,
  bail_amount        BIGINT  DEFAULT 0,       -- in cents to avoid float issues
  bail_status        TEXT,                    -- set|denied|reduced|revoked|released
  capital_case       BOOLEAN DEFAULT FALSE,
  related_matter_id  BIGINT  REFERENCES matters(id),  -- MDL consolidation, linked cases
  co_defendant_count INTEGER DEFAULT 0,       -- J6: 1265, Enron: 29, etc.
  victim_count       INTEGER DEFAULT 0,       -- Madoff: 37000, Weinstein: 80, etc.
  court_date         TIMESTAMPTZ,
  next_court_date    TIMESTAMPTZ,
  hearing_time       TEXT,                    -- '09:00 AM CST' — specific time
  trial_start_date   TIMESTAMPTZ,
  trial_end_date     TIMESTAMPTZ,
  assigned_attorney_id BIGINT REFERENCES users(id),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE matters ENABLE ROW LEVEL SECURITY;

-- ── 2. CASES TABLE ENHANCEMENTS ────────────────────────────────────────────
ALTER TABLE cases ADD COLUMN IF NOT EXISTS jurisdiction     TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_type        TEXT DEFAULT 'criminal';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS hearing_time     TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS related_case_id  BIGINT REFERENCES cases(id);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS capital_case     BOOLEAN DEFAULT FALSE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS co_defendant_count INTEGER DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS bail_amount_cents BIGINT DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS bail_status      TEXT DEFAULT 'not_applicable';

-- ── 3. CONFLICT INDEX TABLE (if not exists) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS conflict_index (
  id               BIGSERIAL PRIMARY KEY,
  firm_id          BIGINT REFERENCES workspaces(id) ON DELETE CASCADE,
  matter_id        BIGINT REFERENCES matters(id) ON DELETE SET NULL,
  party_name_norm  TEXT NOT NULL,
  party_name_orig  TEXT NOT NULL,
  party_role       TEXT NOT NULL DEFAULT 'client',  -- client|adverse|witness|expert|co_defendant
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conflict_index ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_conflict_firm_role  ON conflict_index(firm_id, party_role);
CREATE INDEX IF NOT EXISTS idx_conflict_name_norm  ON conflict_index(firm_id, party_name_norm);

-- ── 4. MATTER INDEXES ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_matters_firm_id      ON matters(firm_id);
CREATE INDEX IF NOT EXISTS idx_matters_status       ON matters(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_matters_attorney     ON matters(assigned_attorney_id);
CREATE INDEX IF NOT EXISTS idx_matters_court_date   ON matters(court_date) WHERE court_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_related      ON matters(related_matter_id) WHERE related_matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_capital      ON matters(firm_id) WHERE capital_case = TRUE;

-- ── 5. CASE ENHANCED INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cases_jurisdiction   ON cases(jurisdiction) WHERE jurisdiction IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_type           ON cases(case_type);
CREATE INDEX IF NOT EXISTS idx_cases_related        ON cases(related_case_id) WHERE related_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_capital        ON cases(user_id) WHERE capital_case = TRUE;

-- ── 6. UPDATED_AT TRIGGER FOR MATTERS ───────────────────────────────────────
CREATE OR REPLACE TRIGGER update_matters_updated_at
  BEFORE UPDATE ON matters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
