-- 007_billing.sql — Subscriptions, per-lead billing, family connections

-- Attorney subscription tiers
CREATE TABLE IF NOT EXISTS subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER,
  provider_id     INTEGER,
  provider_type   TEXT DEFAULT 'lawyer',   -- 'lawyer' | 'bail_agent'
  tier            TEXT DEFAULT 'basic',     -- 'basic' | 'alert' | 'featured'
  status          TEXT DEFAULT 'trialing', -- 'trialing' | 'active' | 'cancelled' | 'past_due'
  amount_cents    INTEGER DEFAULT 0,
  stripe_sub_id   TEXT,
  stripe_cus_id   TEXT,
  trial_ends_at   TEXT,
  current_period_end TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sub_user     ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_provider ON subscriptions(provider_id, provider_type);
CREATE INDEX IF NOT EXISTS idx_sub_status   ON subscriptions(status);

-- Per-lead purchases (bondsmen)
CREATE TABLE IF NOT EXISTS lead_purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bondsman_id     INTEGER,
  arrest_id       INTEGER,
  bail_amount     REAL,
  lead_fee_cents  INTEGER,
  status          TEXT DEFAULT 'pending',  -- 'pending' | 'charged' | 'failed' | 'refunded'
  stripe_pi_id    TEXT,
  contact_revealed INTEGER DEFAULT 0,
  purchased_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lp_bondsman ON lead_purchases(bondsman_id);
CREATE INDEX IF NOT EXISTS idx_lp_arrest   ON lead_purchases(arrest_id);
CREATE INDEX IF NOT EXISTS idx_lp_status   ON lead_purchases(status);

-- Family emergency connections ($29 one-time)
CREATE TABLE IF NOT EXISTS family_connections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  arrest_id       INTEGER,
  family_name     TEXT,
  family_phone    TEXT,
  family_email    TEXT,
  amount_cents    INTEGER DEFAULT 2900,
  status          TEXT DEFAULT 'pending',  -- 'pending' | 'paid' | 'failed'
  stripe_pi_id    TEXT,
  attorneys_sent  TEXT DEFAULT '[]',       -- JSON array of attorney IDs
  agents_sent     TEXT DEFAULT '[]',       -- JSON array of bail agent IDs
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fc_arrest ON family_connections(arrest_id);
CREATE INDEX IF NOT EXISTS idx_fc_status ON family_connections(status);

-- Bondsman profiles (who is subscribed to receive leads)
CREATE TABLE IF NOT EXISTS bondsman_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER UNIQUE,
  company_name    TEXT,
  license_number  TEXT,
  counties        TEXT DEFAULT '[]',  -- JSON array of counties they cover
  states          TEXT DEFAULT '[]',
  max_bail_amount REAL DEFAULT 999999,
  min_bail_amount REAL DEFAULT 0,
  active          INTEGER DEFAULT 1,
  stripe_cus_id   TEXT,
  payment_method_id TEXT,
  leads_received  INTEGER DEFAULT 0,
  leads_accepted  INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);
