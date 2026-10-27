-- 040 · Help getting to court (A8), the court-date phone line (A10, phone line only), phone
-- verification (security fix), published results (B11) (Oct 27 2026).
-- docs/BUILD_PLAN_COMPETITOR_FEATURES.md; docs/COURT_DAY_HELP.md; docs/PHONE_LINE.md. Idempotent.
--
--   users.phone_verified_at / phone_verified_phone
--                                  the phone number the person proved by a texted code, and when.
--                                  A trigger clears both whenever users.phone changes to another
--                                  number, so a verification never carries over to a new number.
--   phone_verifications            one row per code texted: only an HMAC of the code is stored,
--                                  10-minute expiry, 5 attempts
--   checkin_enrollments.held_user_id / held_at
--                                  links to an account made BEFORE this change (by an unverified
--                                  phone or e-mail) are taken off the account and remembered
--                                  here: they come back only when that account verifies the
--                                  enrollment's phone number. Done once (the first time the column
--                                  is added), so replaying this file never unlinks a verified link.
--   court_dates.plan / plan_updated_at
--                                  "Plan your court day": ride, time off work, child care,
--                                  documents, address and room (JSON, owner only)
--   ride_offers                    a family follower's "Offer a ride" for one court date, and the
--                                  owner's answer
--   voice_calls                    the phone line's call log: no recordings, no full numbers (a
--                                  salted hash for the per-caller limit, the last 4 digits shown)
--   results_snapshots              published results: written once by an admin, never changed
--                                  (a trigger refuses UPDATE and DELETE)

BEGIN;

-- ── Phone verification ──────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at    TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_phone TEXT;

CREATE OR REPLACE FUNCTION jg_users_phone_verification_reset() RETURNS trigger AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND NEW.phone_verified_phone IS DISTINCT FROM NEW.phone THEN
    NEW.phone_verified_at := NULL;
    NEW.phone_verified_phone := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_phone_verification_reset ON users;
CREATE TRIGGER trg_users_phone_verification_reset BEFORE UPDATE OF phone ON users
  FOR EACH ROW EXECUTE FUNCTION jg_users_phone_verification_reset();
CREATE INDEX IF NOT EXISTS idx_users_phone_verified ON users (phone_verified_phone) WHERE phone_verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS phone_verifications (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,                 -- E.164
  code_hash    TEXT NOT NULL,                 -- HMAC-SHA256 of the 6-digit code
  attempts     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'verified', 'locked', 'superseded', 'expired', 'not_sent')),
  provider_id  TEXT,                          -- Telnyx message id (sms_delivery reports on it)
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_user ON phone_verifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone ON phone_verifications (phone, created_at DESC);
ALTER TABLE phone_verifications ENABLE ROW LEVEL SECURITY;

-- Existing enrollment links were made by unverified contact details: hold them (once).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'checkin_enrollments' AND column_name = 'held_user_id') THEN
    ALTER TABLE checkin_enrollments ADD COLUMN held_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE checkin_enrollments ADD COLUMN held_at TIMESTAMPTZ;
    UPDATE checkin_enrollments SET held_user_id = user_id, held_at = NOW(), user_id = NULL, updated_at = NOW()
     WHERE user_id IS NOT NULL;
    -- their app check-in reminders stop until the link is back
    UPDATE scheduled_pushes SET status = 'cancelled', error = 'link_held_until_phone_verified'
     WHERE notification_type = 'checkin_reminder' AND status = 'pending';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_checkin_enrollments_held ON checkin_enrollments (held_user_id) WHERE held_user_id IS NOT NULL;

-- ── A8 Plan your court day ──────────────────────────────────────────────────
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS plan            JSONB;
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ride_offers (
  id              BIGSERIAL PRIMARY KEY,
  court_date_id   BIGINT NOT NULL REFERENCES court_dates(id) ON DELETE CASCADE,
  case_id         BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  follower_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'withdrawn')),
  owner_push      TEXT,
  follower_push   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (court_date_id, follower_id)
);
CREATE INDEX IF NOT EXISTS idx_ride_offers_owner ON ride_offers (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_offers_follower ON ride_offers (follower_id, created_at DESC);
ALTER TABLE ride_offers ENABLE ROW LEVEL SECURITY;

-- ── A10 phone line call log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_calls (
  id               BIGSERIAL PRIMARY KEY,
  call_control_id  TEXT NOT NULL UNIQUE,
  caller_hash      TEXT,                      -- HMAC of the caller's number (per-caller limit)
  caller_last4     TEXT,
  lang             TEXT CHECK (lang IS NULL OR lang IN ('en', 'es')),
  matched          TEXT CHECK (matched IS NULL OR matched IN ('caller_id', 'keypad', 'none')),
  heard_date       BOOLEAN NOT NULL DEFAULT FALSE,
  texted           TEXT,                      -- sent / skipped:<reason> / failed
  text_provider_id TEXT,
  text_to_hash     TEXT,                      -- HMAC of the number texted (one text an hour per number)
  heard_missed     BOOLEAN NOT NULL DEFAULT FALSE,
  keypad_tries     INTEGER NOT NULL DEFAULT 0,
  refused          TEXT,                      -- rate_limited / disabled
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_voice_calls_caller ON voice_calls (caller_hash, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_started ON voice_calls (started_at DESC);
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS text_to_hash TEXT;
ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;

-- ── B11 published results ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS results_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  published_by  BIGINT,                       -- the admin's user id (no FK: the row is never changed)
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  data          JSONB NOT NULL,
  methods       TEXT NOT NULL,
  CHECK (period_to >= period_from)
);
CREATE INDEX IF NOT EXISTS idx_results_snapshots_published ON results_snapshots (published_at DESC);
ALTER TABLE results_snapshots ENABLE ROW LEVEL SECURITY;

-- The only way round it: an operator (or a test cleaning up after itself) deleting inside a
-- transaction that first ran SELECT set_config('jg.results_purge', 'on', true). Never an UPDATE.
CREATE OR REPLACE FUNCTION jg_results_snapshots_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('jg.results_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'results_snapshots rows are immutable' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_results_snapshots_immutable ON results_snapshots;
CREATE TRIGGER trg_results_snapshots_immutable BEFORE UPDATE OR DELETE ON results_snapshots
  FOR EACH ROW EXECUTE FUNCTION jg_results_snapshots_immutable();

COMMIT;
