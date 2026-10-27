-- 00000000000035_bond_desk_court_dates_and_attendance.sql — Bond Desk court-date reminders to the
-- defendant and every indemnitor (A1), the morning-after text (A6) and "Did you make it to court?"
-- (A7) for Bond Desk bonds and app users. docs/BUILD_PLAN_COMPETITOR_FEATURES.md, docs/BOND_DESK.md.
--
--   bd_court_dates   many hearings per bond. bd_bonds.court_date stays as the "next hearing" (kept in
--                    sync by services/bondDesk/courtDates.js) so existing screens and reports work.
--   bd_reminders     every planned / sent text for a hearing; unique per hearing + day + phone + step,
--                    so a step can never be texted twice to one number for one court day.
--   bd_bonds / bd_indemnitors: the agent's per-number confirmation "the person gave me this number
--                    for texts about this bond" (when, and for which number), the per-bond on/off
--                    switch and the language of the texts.
--   court_dates      (app users) when the "Did you make it?" question went out, to which number,
--                    and who set the status (app / text reply).
-- Idempotent.
BEGIN;

-- ── Bond: switch, language, defendant's text consent ─────────────────────────────────────────
ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS court_reminders BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS text_lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS defendant_text_consent_at TIMESTAMPTZ;
ALTER TABLE bd_bonds ADD COLUMN IF NOT EXISTS defendant_text_consent_phone TEXT;
DO $$ BEGIN
  ALTER TABLE bd_bonds ADD CONSTRAINT bd_bonds_text_lang_check CHECK (text_lang IN ('en','es','pt','vi'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE bd_indemnitors ADD COLUMN IF NOT EXISTS text_consent_at TIMESTAMPTZ;
ALTER TABLE bd_indemnitors ADD COLUMN IF NOT EXISTS text_consent_phone TEXT;

-- ── Hearings ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_court_dates (
  id             BIGSERIAL PRIMARY KEY,
  bond_id        BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  court_date     DATE NOT NULL,
  court_time     TIME,
  court_name     TEXT CHECK (court_name IS NULL OR length(court_name) <= 160),
  room           TEXT CHECK (room IS NULL OR length(room) <= 60),
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','attended','missed','rescheduled','cancelled')),
  status_source  TEXT CHECK (status_source IS NULL OR status_source IN ('agent','reply')),
  status_at      TIMESTAMPTZ,
  asked_at       TIMESTAMPTZ,              -- "Did you make it to court?" text sent to the defendant
  followup_at    TIMESTAMPTZ,              -- morning-after step done (defendant text and/or agent alert)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bd_court_dates_bond ON bd_court_dates (bond_id, court_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bd_court_dates_open ON bd_court_dates (court_date) WHERE deleted_at IS NULL AND followup_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bd_court_dates_bond_day_time
  ON bd_court_dates (bond_id, court_date, COALESCE(court_time, TIME '00:00')) WHERE deleted_at IS NULL;

-- the existing single court date of each bond becomes its first hearing
INSERT INTO bd_court_dates (bond_id, court_date, court_name)
SELECT b.id, b.court_date, b.court_name FROM bd_bonds b
 WHERE b.court_date IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM bd_court_dates cd WHERE cd.bond_id = b.id);

-- ── Texts planned / sent for a hearing ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bd_reminders (
  id             BIGSERIAL PRIMARY KEY,
  court_date_id  BIGINT NOT NULL REFERENCES bd_court_dates(id) ON DELETE CASCADE,
  bond_id        BIGINT NOT NULL REFERENCES bd_bonds(id) ON DELETE CASCADE,
  signer_type    TEXT NOT NULL CHECK (signer_type IN ('defendant','indemnitor')),
  indemnitor_id  BIGINT REFERENCES bd_indemnitors(id) ON DELETE SET NULL,
  phone          TEXT NOT NULL,            -- E.164
  step           TEXT NOT NULL CHECK (step IN ('d7','d3','d1','d0','now','ask','missed')),
  court_day      DATE NOT NULL,            -- the hearing day this text was planned for
  send_at        TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sending','sent','skipped','cancelled','failed')),
  reason         TEXT,
  text_id        BIGINT REFERENCES bd_texts(id) ON DELETE SET NULL,
  claimed_at     TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (court_date_id, phone, step, court_day)
);
CREATE INDEX IF NOT EXISTS idx_bd_reminders_due ON bd_reminders (send_at) WHERE status IN ('pending','sending');
CREATE INDEX IF NOT EXISTS idx_bd_reminders_bond ON bd_reminders (bond_id, send_at);
CREATE INDEX IF NOT EXISTS idx_bd_reminders_asked ON bd_reminders (phone, sent_at) WHERE step = 'ask' AND status = 'sent';

-- Texts for agents: new purposes (all billed at 5¢ like the others).
ALTER TABLE bd_texts DROP CONSTRAINT IF EXISTS bd_texts_purpose_check;
ALTER TABLE bd_texts ADD CONSTRAINT bd_texts_purpose_check
  CHECK (purpose IN ('signing_link','payment_reminder','court_reminder','court_ask','court_missed','court_reply'));

-- ── App users: "Did you make it to court?" ──────────────────────────────────────────────────
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS asked_at TIMESTAMPTZ;
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS asked_phone TEXT;     -- E.164, only when asked by text
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS status_source TEXT;   -- 'app' | 'reply'
ALTER TABLE court_dates ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_court_dates_asked_phone ON court_dates (asked_phone, asked_at) WHERE asked_phone IS NOT NULL;

COMMIT;
