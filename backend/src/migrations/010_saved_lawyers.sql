-- 010_saved_lawyers.sql
-- Saved lawyers — user's personal attorney contact list
-- Also tracks referral credits ($5 off Quick Connect)

CREATE TABLE IF NOT EXISTS saved_lawyers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  provider_id INTEGER,           -- ref to lawyers table
  name        TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  specialties TEXT DEFAULT '[]',
  rating      REAL,
  notes       TEXT,              -- user's personal notes
  saved_at    TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sl_user_provider ON saved_lawyers(user_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_sl_user ON saved_lawyers(user_id);

-- Referral credits table (already has referrals but add credit balance)
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_credit_cents INTEGER DEFAULT 0;
