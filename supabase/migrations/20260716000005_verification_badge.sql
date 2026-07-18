-- Attorney verification badge: live status display
ALTER TABLE IF EXISTS lawyer_profiles
  ADD COLUMN IF NOT EXISTS verification_badge    TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS insurance_verified    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_expires_at  DATE,
  ADD COLUMN IF NOT EXISTS bar_verified_badge    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_updated_at      TIMESTAMPTZ;

-- Trigger: when bar verification changes, update badge
CREATE OR REPLACE FUNCTION update_verification_badge()
RETURNS TRIGGER AS $$
BEGIN
  NEW.verification_badge :=
    CASE
      WHEN NEW.is_verified = true AND NEW.insurance_verified = true THEN 'full_verified'
      WHEN NEW.is_verified = true THEN 'bar_verified'
      WHEN NEW.insurance_verified = true THEN 'insurance_only'
      ELSE 'unverified'
    END;
  NEW.badge_updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_badge ON lawyer_profiles;
CREATE TRIGGER trg_update_badge
  BEFORE UPDATE ON lawyer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_verification_badge();
