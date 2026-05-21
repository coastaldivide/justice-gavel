-- Migration 028: case_events timeline
-- Stores timestamped events for each case so users see a chronological
-- history of their case. Events are created automatically (e.g. when
-- bail amount is updated) or manually by the user (custom notes).
--
-- event_type values: arrest | bail_set | arraignment | hearing |
--   motion_filed | continuance | verdict | sentencing | appeal |
--   attorney_added | document_added | note | other

CREATE TABLE IF NOT EXISTS case_events (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER  NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT     NOT NULL DEFAULT 'note',
  title       TEXT     NOT NULL,
  description TEXT,
  event_date  TEXT,                    -- ISO date the event occurred (may differ from created_at)
  amount_cents INTEGER,                -- bail amount, fine, etc. in cents
  location    TEXT,                    -- court name, jail, etc.
  created_at  TEXT     NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_case_events_case   ON case_events(case_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_case_events_user   ON case_events(user_id, created_at DESC);
