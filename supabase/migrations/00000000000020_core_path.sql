-- 00000000000020_core_path.sql — "Just arrested?" core path
--
-- 1. rights_cards: reviewed rights content can live in the database next to
--    its source. New columns are left NULL (never invented): source_url,
--    reviewed_by (the licensed attorney who reviewed it), language, sort_order.
--    One row per (state, topic, language) instead of one per topic, so a
--    state-specific card can sit next to the general one. The table is empty
--    in every environment today; services/rightsContent.js serves the app's
--    existing card text (with its recorded source/date) until rows are added.
--
-- 2. listing_reports: "Report a problem with this listing". A report NEVER
--    touches the lawyers / bail_agents row (owner rule: provider data is read
--    only); it waits here for an admin (GET/POST /api/admin/listing-reports).
--    One open report per (listing, reason, reporter) — a double tap or a retry
--    does not create a second row.
--
-- 3. court_dates: many hearings per case; past ones stay as an archive.
--    cases.next_court_date is kept as the derived "next upcoming date" so the
--    existing list / offline cache / share link keep working. Existing case
--    court dates are copied in once (idempotent).
--
-- 4. scheduled_pushes.court_date_id: each reminder belongs to one hearing, so
--    two hearings of one case each get their own 7d / 3d / 1d / morning-of set.
--
-- 5. case_family_access: family follower with explicit, revocable consent.
--    The owner must tick consent (owner_consent_at), the follower accepts with
--    a one-time invite code (only its SHA-256 is stored), either side can end
--    it (status 'revoked'). share_reminders = the follower also gets the court
--    reminders. The follower only ever sees court dates — never notes/charges.
--
-- 6. users.sms_reminders: text-message reminders are opt-in (only used when
--    Twilio is configured).
--
-- 7. listing_claims (+ bondsman_profiles.bail_agent_id): "claim your listing"
--    requests, approved by an admin; never edits the listing row.
--
-- Idempotent. RLS on, no policies (deny-all), like every table.

-- ── 1. rights_cards ─────────────────────────────────────────────────────────
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS source_url  TEXT;
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS language    TEXT NOT NULL DEFAULT 'en';
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS sort_order  INTEGER;
ALTER TABLE rights_cards DROP CONSTRAINT IF EXISTS rights_cards_topic_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rights_cards_state_topic_lang
  ON rights_cards (COALESCE(state, 'US'), topic, language);

-- ── 2. listing_reports ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_reports (
  id                BIGSERIAL   PRIMARY KEY,
  table_name        TEXT        NOT NULL CHECK (table_name IN ('lawyers', 'bail_agents')),
  record_id         BIGINT      NOT NULL,
  reason            TEXT        NOT NULL CHECK (reason IN ('wrong_phone', 'closed', 'wrong_address', 'wrong_hours', 'not_this_service', 'other')),
  details           TEXT,
  reporter_user_id  BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  reporter_key      TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  reviewed_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_reports_open
  ON listing_reports (table_name, record_id, reason, reporter_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_listing_reports_status ON listing_reports (status, created_at DESC);
ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;

-- ── 3. court_dates ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS court_dates (
  id             BIGSERIAL   PRIMARY KEY,
  case_id        BIGINT      NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  court_date     DATE        NOT NULL,
  court_time     TIME,
  hearing_type   TEXT,
  courthouse_id  BIGINT      REFERENCES courthouses(id) ON DELETE SET NULL,
  location       TEXT,
  status         TEXT        NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'attended', 'missed', 'rescheduled', 'cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_court_dates_user ON court_dates (user_id, court_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_court_dates_case ON court_dates (case_id, court_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_court_dates_case_day_time
  ON court_dates (case_id, court_date, COALESCE(court_time, TIME '00:00')) WHERE deleted_at IS NULL;
ALTER TABLE court_dates ENABLE ROW LEVEL SECURITY;

INSERT INTO court_dates (case_id, user_id, court_date)
SELECT c.id, c.user_id, c.next_court_date
  FROM cases c
  JOIN users u ON u.id = c.user_id
 WHERE c.next_court_date IS NOT NULL AND c.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM court_dates cd
                    WHERE cd.case_id = c.id AND cd.court_date = c.next_court_date AND cd.deleted_at IS NULL);

-- ── 4. scheduled_pushes.court_date_id ───────────────────────────────────────
ALTER TABLE scheduled_pushes ADD COLUMN IF NOT EXISTS court_date_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_court_date
  ON scheduled_pushes (court_date_id, status) WHERE court_date_id IS NOT NULL;
UPDATE scheduled_pushes sp
   SET court_date_id = cd.id
  FROM court_dates cd
 WHERE sp.court_date_id IS NULL
   AND sp.notification_type = 'court_reminder'
   AND sp.case_id = cd.case_id
   AND sp.data LIKE '%"court_date":"' || CAST(cd.court_date AS text) || '"%';

-- ── 5. case_family_access: consented, revocable family followers ────────────
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS invite_email      TEXT;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS invite_name       TEXT;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS invite_code_hash  TEXT;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS status            TEXT;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS owner_consent_at  TIMESTAMPTZ;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS accepted_at       TIMESTAMPTZ;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS revoked_at        TIMESTAMPTZ;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS expires_at        TIMESTAMPTZ;
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS share_reminders   INTEGER NOT NULL DEFAULT 1;
UPDATE case_family_access SET status = CASE WHEN accepted = 1 THEN 'active' ELSE 'pending' END WHERE status IS NULL;
ALTER TABLE case_family_access ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE case_family_access ALTER COLUMN status SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_family_access_status_check') THEN
    ALTER TABLE case_family_access ADD CONSTRAINT case_family_access_status_check
      CHECK (status IN ('pending', 'active', 'revoked', 'declined', 'expired'));
  END IF;
END $$;
-- an older duplicate invite (same case + person) is retired before the unique index
UPDATE case_family_access d SET status = 'expired'
  FROM case_family_access k
 WHERE d.case_id = k.case_id AND d.user_id = k.user_id AND d.user_id IS NOT NULL
   AND d.id > k.id AND d.status IN ('pending', 'active') AND k.status IN ('pending', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_family_access_code
  ON case_family_access (invite_code_hash) WHERE invite_code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_family_access_follower
  ON case_family_access (case_id, user_id) WHERE user_id IS NOT NULL AND status IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_case_family_access_user ON case_family_access (user_id, status);
CREATE INDEX IF NOT EXISTS idx_case_family_access_case ON case_family_access (case_id, status);

-- ── 7. listing_claims: "Claim your listing" ──────────────────────────────────
-- A lawyer / bail agent asks to link their account to their directory listing
-- so families' in-app messages reach them. An admin checks the licence and
-- approves; approval links the claimant's own profile (attorney_profiles.
-- lawyer_id / bondsman_profiles.bail_agent_id) — the listing row itself is
-- never modified.
CREATE TABLE IF NOT EXISTS listing_claims (
  id              BIGSERIAL   PRIMARY KEY,
  table_name      TEXT        NOT NULL CHECK (table_name IN ('lawyers', 'bail_agents')),
  record_id       BIGINT      NOT NULL,
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_number  TEXT,
  license_state   TEXT,
  contact_phone   TEXT,
  note            TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_claims_open
  ON listing_claims (table_name, record_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_listing_claims_status ON listing_claims (status, created_at DESC);
ALTER TABLE listing_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS bail_agent_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bondsman_profiles_bail_agent
  ON bondsman_profiles (bail_agent_id) WHERE bail_agent_id IS NOT NULL;

-- ── 6. users.sms_reminders ──────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_reminders INTEGER NOT NULL DEFAULT 0;
