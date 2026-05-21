-- 017_golden_gavel.sql
-- Golden Gavel account tier — elite status earned, not purchased
--
-- Eligibility is calculated nightly by the scheduler and written here.
-- The badge is awarded automatically when all criteria are met.
-- It is revoked automatically if criteria drop below threshold.
--
-- Criteria (checked nightly):
--   ATTORNEY:  verified bar license + 12mo active + 25 consultations
--              + avg rating >= 4.8 with >= 10 reviews + 0 compliance flags
--   CONSUMER:  24mo active + 3 paid referrals + full lesson completion
--              + consistent check-in compliance (if enrolled)
--   BONDSMAN:  verified license + 12mo active + 50 leads accepted + 0 opt-out complaints

-- Add Golden Gavel fields to users
ALTER TABLE users ADD COLUMN golden_gavel          INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN golden_gavel_awarded_at TEXT;
ALTER TABLE users ADD COLUMN golden_gavel_tier      TEXT DEFAULT '';   -- 'attorney' | 'consumer' | 'bondsman'
ALTER TABLE users ADD COLUMN golden_gavel_revoked_at TEXT;
ALTER TABLE users ADD COLUMN bar_verified           INTEGER DEFAULT 0;  -- attorney license verified
ALTER TABLE users ADD COLUMN license_verified       INTEGER DEFAULT 0;  -- bondsman license verified
ALTER TABLE users ADD COLUMN compliance_flags       INTEGER DEFAULT 0;  -- incremented on violations

-- Golden Gavel audit log — every award and revocation recorded
CREATE TABLE IF NOT EXISTS golden_gavel_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  action       TEXT NOT NULL,              -- 'awarded' | 'revoked' | 'criteria_check'
  tier         TEXT DEFAULT '',            -- 'attorney' | 'consumer' | 'bondsman'
  reason       TEXT DEFAULT '',            -- human-readable reason
  criteria     TEXT DEFAULT '',            -- JSON snapshot of criteria at time of action
  actioned_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gg_log_user ON golden_gavel_log(user_id);
CREATE INDEX IF NOT EXISTS idx_gg_log_action ON golden_gavel_log(action, actioned_at);

-- Hall of Justice — public-facing Golden Gavel member list
-- Populated when a user opts in to public recognition
CREATE TABLE IF NOT EXISTS golden_gavel_hall (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  tier          TEXT    NOT NULL,
  state         TEXT    DEFAULT '',        -- state they practice / reside in
  people_helped INTEGER DEFAULT 0,        -- consultations + motions + family connects
  opted_in_at   TEXT    DEFAULT (datetime('now')),
  featured      INTEGER DEFAULT 0         -- manually featured by admin
);

CREATE INDEX IF NOT EXISTS idx_gg_hall_tier ON golden_gavel_hall(tier);
