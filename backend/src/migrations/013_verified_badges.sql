-- 013_verified_badges.sql
-- Bondsman Verified badge program ($49/month B2B subscription)
-- Plus post-release check-in system

-- Verified badge subscriptions
CREATE TABLE IF NOT EXISTS verified_badge_subscriptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL UNIQUE,
  status           TEXT DEFAULT 'active',      -- active | cancelled | past_due
  stripe_sub_id    TEXT DEFAULT '',
  stripe_cus_id    TEXT DEFAULT '',
  amount_cents     INTEGER DEFAULT 4900,       -- $49/month
  started_at       TEXT DEFAULT (datetime('now')),
  renews_at        TEXT,
  cancelled_at     TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vbadge_user ON verified_badge_subscriptions(user_id);

-- Add verified_badge flag to bondsman_profiles
ALTER TABLE bondsman_profiles ADD COLUMN verified_badge INTEGER DEFAULT 0;
ALTER TABLE bondsman_profiles ADD COLUMN badge_expires_at TEXT;

-- Add jtb_verified flag to bail_agents for display in search results
ALTER TABLE bail_agents ADD COLUMN jtb_verified INTEGER DEFAULT 0;
ALTER TABLE bail_agents ADD COLUMN jtb_verified_since TEXT;

-- Post-release check-in: bondsman enrolls a defendant
CREATE TABLE IF NOT EXISTS checkin_enrollments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bondsman_id     INTEGER NOT NULL,
  defendant_name  TEXT    NOT NULL,
  defendant_phone TEXT    DEFAULT '',
  defendant_email TEXT    DEFAULT '',
  case_number     TEXT    DEFAULT '',
  court_date      TEXT,
  check_in_freq   TEXT    DEFAULT 'daily',    -- daily | weekly | custom
  active          INTEGER DEFAULT 1,
  monthly_fee_cents INTEGER DEFAULT 999,      -- $9.99/month per defendant
  stripe_sub_id   TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enrollments_bondsman ON checkin_enrollments(bondsman_id);

-- Defendant check-in log
CREATE TABLE IF NOT EXISTS checkin_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id   INTEGER NOT NULL,
  user_id         INTEGER,                    -- if defendant has account
  lat             REAL,
  lng             REAL,
  location_label  TEXT DEFAULT '',
  selfie_url      TEXT DEFAULT '',            -- future: S3/CDN
  notes           TEXT DEFAULT '',
  status          TEXT DEFAULT 'submitted',   -- submitted | verified | flagged | missed
  checked_in_at   TEXT DEFAULT (datetime('now')),
  device_info     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_checkin_enrollment ON checkin_records(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_checkin_date       ON checkin_records(checked_in_at);
