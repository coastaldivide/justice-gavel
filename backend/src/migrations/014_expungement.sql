-- 014_expungement.sql
-- Expungement eligibility checks + referral tracking

CREATE TABLE IF NOT EXISTS expungement_referrals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  case_id         INTEGER,
  state           TEXT DEFAULT 'TN',
  charge_summary  TEXT DEFAULT '',
  eligible        INTEGER DEFAULT 1,         -- 1=likely eligible, 0=likely not
  referral_partner TEXT DEFAULT 'general',   -- 'recordseal' | 'general'
  referral_status TEXT DEFAULT 'initiated',  -- initiated | clicked | converted
  referral_fee_est_cents INTEGER DEFAULT 7500, -- $75 est midpoint
  utm_code        TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now')),
  converted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_expunge_user ON expungement_referrals(user_id);
CREATE INDEX IF NOT EXISTS idx_expunge_case ON expungement_referrals(case_id);

-- Add expungement_notified flag to cases so we don't re-notify
ALTER TABLE cases ADD COLUMN expungement_notified INTEGER DEFAULT 0;
