-- Pretrial Services Agency (B2G) support
ALTER TABLE IF EXISTS checkin_enrollments
  ADD COLUMN IF NOT EXISTS agency_id      TEXT,          -- pretrial services agency
  ADD COLUMN IF NOT EXISTS officer_id     TEXT,          -- supervising officer
  ADD COLUMN IF NOT EXISTS case_number    TEXT,
  ADD COLUMN IF NOT EXISTS court_date     DATE,
  ADD COLUMN IF NOT EXISTS conditions     JSONB,         -- court-ordered conditions
  ADD COLUMN IF NOT EXISTS enrolled_by    UUID,          -- who enrolled the defendant
  ADD COLUMN IF NOT EXISTS enrolled_at    TIMESTAMPTZ DEFAULT NOW();

-- Agencies table (courts and pretrial services agencies)
CREATE TABLE IF NOT EXISTS pretrial_agencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  county          TEXT,
  state           CHAR(2),
  contact_email   TEXT,
  contact_phone   TEXT,
  contract_tier   TEXT DEFAULT 'basic',    -- basic, standard, enterprise
  monthly_rate    NUMERIC(10,2),           -- per-defendant/month
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Officers who manage defendants
CREATE TABLE IF NOT EXISTS pretrial_officers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  agency_id  UUID REFERENCES pretrial_agencies(id),
  badge_num  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkin_enrollments_agency
  ON checkin_enrollments (agency_id)
  WHERE status = 'active';
