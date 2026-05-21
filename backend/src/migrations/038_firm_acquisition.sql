-- Migration 038: Firm Acquisition Funnel
-- acquisition_leads, firm_trials, firm_upgrade_requests, firm_onboarding

CREATE TABLE IF NOT EXISTS acquisition_leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL,
  firm_name   TEXT    NOT NULL,
  vertical    TEXT    DEFAULT 'general',
  org_size    INTEGER DEFAULT 0,
  message     TEXT,
  status      TEXT    DEFAULT 'new',  -- new | contacted | converted | dead
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now')),
  UNIQUE(email, firm_name)
);
CREATE INDEX IF NOT EXISTS idx_al_email    ON acquisition_leads(email);
CREATE INDEX IF NOT EXISTS idx_al_vertical ON acquisition_leads(vertical);
CREATE INDEX IF NOT EXISTS idx_al_status   ON acquisition_leads(status);

CREATE TABLE IF NOT EXISTS firm_trials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id      INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  vertical     TEXT    DEFAULT 'general',
  trial_start  TEXT    NOT NULL,
  trial_end    TEXT    NOT NULL,
  status       TEXT    DEFAULT 'active',  -- active | expired | converted | cancelled
  converted_at TEXT,
  created_at   TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ft_firm   ON firm_trials(firm_id);
CREATE INDEX IF NOT EXISTS idx_ft_status ON firm_trials(status);

CREATE TABLE IF NOT EXISTS firm_upgrade_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id       INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  current_tier  TEXT    NOT NULL,
  target_tier   TEXT    NOT NULL,
  notes         TEXT,
  status        TEXT    DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  created_at    TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fur_firm   ON firm_upgrade_requests(firm_id);
CREATE INDEX IF NOT EXISTS idx_fur_status ON firm_upgrade_requests(status);

CREATE TABLE IF NOT EXISTS firm_onboarding (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id       INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  checklist_key TEXT    NOT NULL,
  completed_at  TEXT    DEFAULT (datetime('now')),
  UNIQUE(firm_id, checklist_key)
);
CREATE INDEX IF NOT EXISTS idx_fo_firm ON firm_onboarding(firm_id);

-- Add owner_id to firms if missing (needed for trial creation)
ALTER TABLE firms ADD COLUMN IF NOT EXISTS owner_id INTEGER;
