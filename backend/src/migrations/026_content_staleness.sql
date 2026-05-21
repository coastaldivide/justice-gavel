-- Migration 026: Content staleness tracking columns
-- Adds content_verified_at, law_effective_date, stale_since, needs_review
-- to all legal content tables so the refresh service and API can surface
-- "last verified X days ago" to users (ABA/LawHelpInteractive standard).

-- expungement_rules
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS content_verified_at TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS law_effective_date   TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS stale_since          TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS needs_review         INTEGER DEFAULT 0;

-- rights_cards
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS content_verified_at TEXT;
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS law_effective_date   TEXT;
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS stale_since          TEXT;
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS needs_review         INTEGER DEFAULT 0;

-- crisis_resources
ALTER TABLE crisis_resources ADD COLUMN IF NOT EXISTS last_verified        TEXT;
ALTER TABLE crisis_resources ADD COLUMN IF NOT EXISTS needs_verification   INTEGER DEFAULT 0;

-- content_refresh_log — detailed per-run audit trail
CREATE TABLE IF NOT EXISTS content_refresh_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at        TEXT DEFAULT (datetime('now')),
  category      TEXT,
  items_checked INTEGER,
  items_stale   INTEGER,
  results       TEXT,  -- JSON array of update messages
  warnings      TEXT,  -- JSON array of stale content warnings
  errors        TEXT,  -- JSON array of error messages
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_refresh_log_run_at ON content_refresh_log(run_at);

-- Seed current timestamps so nothing is immediately stale on first deploy
UPDATE expungement_rules SET content_verified_at = datetime('now') WHERE content_verified_at IS NULL;
UPDATE rights_cards       SET content_verified_at = datetime('now') WHERE content_verified_at IS NULL;
UPDATE crisis_resources   SET last_verified       = datetime('now') WHERE last_verified IS NULL;
