-- Add bar verification fields to lawyer/attorney profiles
ALTER TABLE IF EXISTS lawyer_profiles
  ADD COLUMN IF NOT EXISTS bar_number         TEXT,
  ADD COLUMN IF NOT EXISTS bar_state          CHAR(2),
  ADD COLUMN IF NOT EXISTS license_status     TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_source TEXT,
  ADD COLUMN IF NOT EXISTS is_verified        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Track verification history
CREATE TABLE IF NOT EXISTS bar_verification_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id       UUID REFERENCES lawyer_profiles(id) ON DELETE CASCADE,
  verified_at     TIMESTAMPTZ DEFAULT NOW(),
  old_status      TEXT,
  new_status      TEXT,
  source          TEXT,
  changed         BOOLEAN DEFAULT false,
  raw_response    TEXT
);

-- Index for nightly sweep query
CREATE INDEX IF NOT EXISTS idx_lawyer_profiles_verify_date
  ON lawyer_profiles (last_verified_at ASC NULLS FIRST)
  WHERE bar_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lawyer_profiles_license_status
  ON lawyer_profiles (license_status)
  WHERE license_status != 'active';
