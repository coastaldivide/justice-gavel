-- 038 · Re-arrest alerts (A4), release / transfer alerts for families (A9), sharing a forfeited
-- bond with a recovery agent (B4) (Oct 27 2026). docs/BUILD_PLAN_COMPETITOR_FEATURES.md;
-- docs/BOND_DESK.md; docs/CUSTODY_ALERTS.md. Idempotent.
--
--   arrest_records.dob / source_key / last_seen_at / delisted_at / jail_phone
--                                  what the roster feed says about one booking: date of birth when
--                                  the feed gives it, a stable key per (source, booking) so a booking
--                                  seen again is updated instead of inserted twice, when it was last
--                                  listed and when it stopped being listed, and the jail's phone
--   bd_bonds.defendant_dob         already exists (migration 32); kept here for older databases
--   bd_rearrests                   one row per (bond, arrest): 'strong' = first + last name + date of
--                                  birth; 'possible' = name only, the agent confirms or dismisses
--   bd_alert_settings              the agent's own choice to be texted about re-arrests (5¢)
--   bd_bond_events                 the bond timeline (re-arrest matches, recovery sharing)
--   booking_follows                a signed-in person following one booking, with consent
--   custody_events                 a change the roster showed for a followed booking (status,
--                                  facility, no longer listed, listed again)
--   custody_alerts                 one row per (follow, event): never alerted twice
--   bd_recovery_shares             one forfeited bond shared with a recovery agent by e-mail invite
--   bd_recovery_views              every view of a shared bond (shown to the bail agent)
--   bd_texts.purpose               + 'rearrest_alert' (billed 5¢ with the other agent texts)

BEGIN;

-- ── Arrest records: identity of a booking in its feed ───────────────────────
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS dob          DATE;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS source_key   TEXT;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS delisted_at  TIMESTAMPTZ;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS jail_phone   TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_arrest_records_source_key
  ON arrest_records (source, source_key) WHERE source_key IS NOT NULL;

ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS defendant_dob DATE;

-- ── A4 re-arrest matches ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_rearrests (
  id            BIGSERIAL PRIMARY KEY,
  bond_id       BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  arrest_id     BIGINT NOT NULL REFERENCES arrest_records(id) ON DELETE CASCADE,
  agent_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match         TEXT NOT NULL CHECK (match IN ('strong', 'possible')),
  status        TEXT NOT NULL CHECK (status IN ('alerted', 'pending', 'confirmed', 'dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ,
  push_status   TEXT,
  email_status  TEXT,
  text_status   TEXT,
  bd_text_id    BIGINT,
  UNIQUE (bond_id, arrest_id)
);
CREATE INDEX IF NOT EXISTS idx_bd_rearrests_agent ON bd_rearrests (agent_id, created_at DESC);
ALTER TABLE bd_rearrests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bd_alert_settings (
  agent_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rearrest_text BOOLEAN NOT NULL DEFAULT FALSE,
  alert_phone   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE bd_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bd_bond_events (
  id          BIGSERIAL PRIMARY KEY,
  bond_id     BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('rearrest_strong', 'rearrest_possible', 'rearrest_confirmed', 'rearrest_dismissed',
                                            'recovery_shared', 'recovery_accepted', 'recovery_ended')),
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_bond_events_bond ON bd_bond_events (bond_id, created_at DESC);
ALTER TABLE bd_bond_events ENABLE ROW LEVEL SECURITY;

-- ── A9 booking follows and custody events ──────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_follows (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  arrest_id        BIGINT NOT NULL REFERENCES arrest_records(id) ON DELETE CASCADE,
  case_id          BIGINT REFERENCES cases(id) ON DELETE SET NULL,
  consent_at       TIMESTAMPTZ NOT NULL,
  consent_version  TEXT NOT NULL,
  text_opt_in      BOOLEAN NOT NULL DEFAULT FALSE,
  text_phone       TEXT,
  text_consent_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  ended_reason     TEXT CHECK (ended_reason IS NULL OR ended_reason IN ('unfollowed', 'record_removed')),
  CHECK (NOT text_opt_in OR (text_phone IS NOT NULL AND text_consent_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_follows_live ON booking_follows (user_id, arrest_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_booking_follows_arrest ON booking_follows (arrest_id) WHERE ended_at IS NULL;
ALTER TABLE booking_follows ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS custody_events (
  id           BIGSERIAL PRIMARY KEY,
  arrest_id    BIGINT NOT NULL REFERENCES arrest_records(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('status_changed', 'facility_changed', 'not_listed', 'listed_again')),
  old_value    TEXT,
  new_value    TEXT,
  source       TEXT NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custody_events_arrest ON custody_events (arrest_id, observed_at DESC);
ALTER TABLE custody_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS custody_alerts (
  id            BIGSERIAL PRIMARY KEY,
  follow_id     BIGINT NOT NULL REFERENCES booking_follows(id) ON DELETE CASCADE,
  event_id      BIGINT NOT NULL REFERENCES custody_events(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_status   TEXT,
  email_status  TEXT,
  text_status   TEXT,
  provider_id   TEXT,
  UNIQUE (follow_id, event_id)
);
ALTER TABLE custody_alerts ENABLE ROW LEVEL SECURITY;

-- ── B4 recovery-agent sharing ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_recovery_shares (
  id                BIGSERIAL PRIMARY KEY,
  bond_id           BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  agent_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_email      TEXT NOT NULL CHECK (length(invite_email) BETWEEN 3 AND 254),
  token_hash        TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invite_expires_at TIMESTAMPTZ NOT NULL,
  share_locations   BOOLEAN NOT NULL DEFAULT FALSE,
  rule_state        TEXT,
  recovery_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at          TIMESTAMPTZ,
  ended_reason      TEXT CHECK (ended_reason IS NULL OR ended_reason IN ('revoked', 'reinstated', 'exonerated', 'surrendered', 'forfeiture_paid', 'closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_recovery_shares_live ON bd_recovery_shares (bond_id, lower(invite_email)) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bd_recovery_shares_recovery ON bd_recovery_shares (recovery_user_id) WHERE recovery_user_id IS NOT NULL;
ALTER TABLE bd_recovery_shares ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bd_recovery_views (
  id                BIGSERIAL PRIMARY KEY,
  share_id          BIGINT NOT NULL REFERENCES bd_recovery_shares(id) ON DELETE CASCADE,
  viewer_user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  what              TEXT NOT NULL CHECK (what IN ('details', 'photo')),
  viewed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bd_recovery_views_share ON bd_recovery_views (share_id, viewed_at DESC);
ALTER TABLE bd_recovery_views ENABLE ROW LEVEL SECURITY;

-- bd_texts.purpose: add 'rearrest_alert' to whatever the constraint allows now (another
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
    SELECT array_agg(DISTINCT m[1]) INTO vals FROM regexp_matches(def, '([a-z][a-z_]*)', 'g') AS m
     WHERE m[1] NOT IN ('purpose', 'text');
  END IF;
  FOREACH v IN ARRAY ARRAY['signing_link', 'payment_reminder', 'rearrest_alert'] LOOP
    IF NOT (v = ANY (COALESCE(vals, ARRAY[]::TEXT[]))) THEN vals := array_append(vals, v); END IF;
  END LOOP;
  ALTER TABLE bd_texts DROP CONSTRAINT IF EXISTS bd_texts_purpose_check;
  EXECUTE format('ALTER TABLE bd_texts ADD CONSTRAINT bd_texts_purpose_check CHECK (purpose = ANY (%L::text[]))', vals);
END $$;

COMMIT;
