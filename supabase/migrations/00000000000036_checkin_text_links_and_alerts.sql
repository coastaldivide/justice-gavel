-- 036 · Check-ins by text link, missed-check-in alerts, location alerts (Oct 27 2026).
-- docs/BUILD_PLAN_COMPETITOR_FEATURES.md A2, A3, B1; docs/CHECKINS.md. Idempotent.
--
--   checkin_enrollments.channel       'app' (the defendant checks in from the app, push reminders)
--                                     or 'sms' (texted a personal link, no account needed)
--   checkin_enrollments.sms_consent_* the agent confirmed the person gave this number for texts
--   checkin_enrollments.active_since  when monitoring last started (enroll / restart): days before
--                                     it are never "missed" (paused enrollments are not alerted)
--   checkin_enrollments.time_zone     the defendant's zone without an account (agent or link page)
--   checkin_enrollments.missed_text_defendant  gentle "you missed your check-in" text (default on
--                                     for the text channel)
--   checkin_enrollments.home_*        location alerts (B1): a home point and a radius in miles
--   checkin_link_tokens               the links texted to the defendant. Only the SHA-256 of the
--                                     token is stored, never the token. Each text carries its own
--                                     token (30 days); "reset link" revokes every earlier one.
--   checkin_texts                     every text sent for an enrollment (link / reminder / missed),
--                                     one reminder and one missed text per enrollment and local day
--   checkin_missed                    one row per enrollment and missed local day (A3)
--   checkin_agent_settings            the agent's own alert choices (text me when a check-in is missed)
--   checkin_records.via / counted / distance_miles / outside_radius
--                                     how the check-in came in; extra check-ins on a day that is
--                                     already done are recorded but not counted; the distance from
--                                     the home point when location was shared
--   bd_texts.purpose                  + the check-in texts, so services/bondDesk/textBilling.js bills
--                                     them at 5¢ with the other texts sent for the agent

BEGIN;

ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'app';
ALTER TABLE checkin_enrollments DROP CONSTRAINT IF EXISTS checkin_enrollments_channel_check;
ALTER TABLE checkin_enrollments ADD CONSTRAINT checkin_enrollments_channel_check CHECK (channel IN ('app', 'sms'));
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS sms_consent_phone TEXT;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS active_since TIMESTAMPTZ;
UPDATE checkin_enrollments SET active_since = COALESCE(enrolled_at, created_at, NOW()) WHERE active_since IS NULL;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS missed_text_defendant BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS time_zone TEXT;   -- the defendant's zone when they have no account (set by the agent or the link page)
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS lang TEXT;        -- language of the texts to the defendant (en / es / pt / vi)
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS home_radius_miles DOUBLE PRECISION;
ALTER TABLE checkin_enrollments DROP CONSTRAINT IF EXISTS checkin_enrollments_home_check;
ALTER TABLE checkin_enrollments ADD CONSTRAINT checkin_enrollments_home_check CHECK (
  (home_lat IS NULL AND home_lng IS NULL AND home_radius_miles IS NULL)
  OR (home_lat BETWEEN -90 AND 90 AND home_lng BETWEEN -180 AND 180 AND home_radius_miles > 0 AND home_radius_miles <= 500));
CREATE INDEX IF NOT EXISTS idx_checkin_enrollments_agent ON checkin_enrollments (bondsman_id, active);
CREATE INDEX IF NOT EXISTS idx_checkin_enrollments_user ON checkin_enrollments (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkin_records_enrollment ON checkin_records (enrollment_id, checked_in_at DESC);

CREATE TABLE IF NOT EXISTS checkin_link_tokens (
  id             BIGSERIAL PRIMARY KEY,
  enrollment_id  BIGINT NOT NULL REFERENCES checkin_enrollments(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_checkin_link_tokens_enrollment ON checkin_link_tokens (enrollment_id);
ALTER TABLE checkin_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS checkin_texts (
  id             BIGSERIAL PRIMARY KEY,
  enrollment_id  BIGINT NOT NULL REFERENCES checkin_enrollments(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('link', 'reminder', 'missed')),
  local_day      DATE,
  status         TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'skipped', 'failed', 'opted_out', 'no_plan')),
  bd_text_id     BIGINT REFERENCES bd_texts(id) ON DELETE SET NULL,
  provider_id    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_texts_daily ON checkin_texts (enrollment_id, kind, local_day) WHERE kind IN ('reminder', 'missed');
CREATE INDEX IF NOT EXISTS idx_checkin_texts_enrollment ON checkin_texts (enrollment_id, created_at DESC);
ALTER TABLE checkin_texts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS checkin_missed (
  id               BIGSERIAL PRIMARY KEY,
  enrollment_id    BIGINT NOT NULL REFERENCES checkin_enrollments(id) ON DELETE CASCADE,
  local_day        DATE NOT NULL,
  time_zone        TEXT NOT NULL,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_push       TEXT,
  agent_email      TEXT,
  agent_text       TEXT,
  defendant_text   TEXT,
  UNIQUE (enrollment_id, local_day)
);
CREATE INDEX IF NOT EXISTS idx_checkin_missed_recent ON checkin_missed (enrollment_id, local_day DESC);
ALTER TABLE checkin_missed ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS checkin_agent_settings (
  agent_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  missed_alert_text  BOOLEAN NOT NULL DEFAULT FALSE,
  alert_phone        TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE checkin_agent_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS via TEXT NOT NULL DEFAULT 'app';
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS counted BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS distance_miles DOUBLE PRECISION;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS outside_radius BOOLEAN;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS location_alert_at TIMESTAMPTZ;

-- bd_texts.purpose: add the check-in texts to whatever the constraint allows now (another
-- migration may have added purposes of its own — keep them all).
DO $$
DECLARE
  def  TEXT;
  vals TEXT[];
  v    TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.bd_texts'::regclass AND conname = 'bd_texts_purpose_check';
  vals := ARRAY[]::TEXT[];
  IF def IS NOT NULL THEN
    -- both spellings: ARRAY['a'::text, …] and '{a,b}'::text[] (lower-case words only: the
    -- keywords CHECK / ANY / ARRAY are upper case; 'purpose' and 'text' are not values)
    SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(def, '([a-z][a-z_]*)', 'g') AS m
     WHERE m[1] NOT IN ('purpose', 'text');
  END IF;
  FOREACH v IN ARRAY ARRAY['signing_link', 'payment_reminder', 'checkin_link', 'checkin_reminder', 'checkin_missed', 'checkin_alert'] LOOP
    IF NOT (v = ANY (COALESCE(vals, ARRAY[]::TEXT[]))) THEN vals := array_append(vals, v); END IF;
  END LOOP;
  ALTER TABLE bd_texts DROP CONSTRAINT IF EXISTS bd_texts_purpose_check;
  EXECUTE format('ALTER TABLE bd_texts ADD CONSTRAINT bd_texts_purpose_check CHECK (purpose = ANY (%L::text[]))', vals);
END $$;

COMMIT;
