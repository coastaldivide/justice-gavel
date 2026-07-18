-- Add Calendly integration fields to attorney/lawyer profiles
ALTER TABLE IF EXISTS lawyer_profiles
  ADD COLUMN IF NOT EXISTS calendly_uri        TEXT,
  ADD COLUMN IF NOT EXISTS calendly_access_token TEXT,  -- encrypted in app
  ADD COLUMN IF NOT EXISTS calendly_connected   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendly_connected_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS attorney_profiles
  ADD COLUMN IF NOT EXISTS calendly_uri        TEXT,
  ADD COLUMN IF NOT EXISTS calendly_connected  BOOLEAN DEFAULT false;

-- Track bookings with source (calendly vs manual)
ALTER TABLE IF EXISTS consultations
  ADD COLUMN IF NOT EXISTS booking_source     TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS calendly_event_uri TEXT,
  ADD COLUMN IF NOT EXISTS cancel_url         TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_url     TEXT;

CREATE INDEX IF NOT EXISTS idx_lawyer_profiles_calendly
  ON lawyer_profiles (calendly_connected)
  WHERE calendly_connected = true;
