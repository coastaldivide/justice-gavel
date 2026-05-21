-- Migration 030: case status history
-- Automatically tracks every status transition on a case.
-- Triggered by the application layer when status is updated.

CREATE TABLE IF NOT EXISTS case_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  note        TEXT,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_csh_case ON case_status_history(case_id, changed_at DESC);
