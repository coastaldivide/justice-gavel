-- 016_civil_leads.sql
-- Personal Injury and Civil Rights lead marketplace
-- Mirrors the bondsman lead marketplace model.
-- PI/Civil Rights attorneys pay $50–$500 per accepted referral.

CREATE TABLE IF NOT EXISTS civil_attorney_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER UNIQUE,
  firm_name        TEXT,
  practice_type    TEXT NOT NULL,          -- 'Personal Injury' | 'Civil Rights' | 'Employment' | 'Immigration'
  bar_number       TEXT,
  license_state    TEXT,
  counties         TEXT DEFAULT '[]',       -- JSON array
  max_lead_fee     INTEGER DEFAULT 50000,   -- cents, max they'll pay per lead
  active           INTEGER DEFAULT 1,
  stripe_cus_id    TEXT,
  payment_method_id TEXT,
  leads_received   INTEGER DEFAULT 0,
  leads_accepted   INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS civil_leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_type        TEXT NOT NULL,           -- 'personal_injury' | 'civil_rights' | 'employment' | 'ice_detention'
  -- Submitter info (anonymous until purchased)
  submitter_user_id INTEGER,
  city             TEXT,
  state            TEXT,
  county           TEXT,
  -- Incident summary (shown to attorney before purchase)
  incident_type    TEXT,                    -- 'car accident' | 'slip fall' | 'police brutality' | 'wrongful arrest' etc
  incident_summary TEXT,                    -- 1–3 sentences, no PII
  incident_date    TEXT,
  injury_severity  TEXT,                    -- 'minor' | 'moderate' | 'serious' | 'catastrophic'
  -- Contact (hidden until purchased)
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_email    TEXT,
  -- Lead fee
  lead_fee_cents   INTEGER DEFAULT 15000,   -- $150 default
  -- Status
  status           TEXT DEFAULT 'open',     -- 'open' | 'purchased' | 'expired'
  created_at       TEXT DEFAULT (datetime('now')),
  expires_at       TEXT                     -- leads expire after 30 days
);

CREATE TABLE IF NOT EXISTS civil_lead_purchases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  attorney_id      INTEGER NOT NULL,
  lead_id          INTEGER NOT NULL,
  lead_fee_cents   INTEGER,
  status           TEXT DEFAULT 'charged',
  stripe_pi_id     TEXT,
  contact_revealed INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cl_type   ON civil_leads(lead_type, status);
CREATE INDEX IF NOT EXISTS idx_cl_state  ON civil_leads(state, city);
CREATE INDEX IF NOT EXISTS idx_clp_atty  ON civil_lead_purchases(attorney_id);
