-- 011_scheduled_pushes.sql
-- Scheduled push notifications queue
-- Nightly scheduler (step 7) picks up due messages and delivers via Expo

CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  push_token   TEXT,                    -- Expo push token (stored on register)
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  data         TEXT DEFAULT '{}',       -- JSON: { screen, params }
  deliver_at   TEXT NOT NULL,           -- ISO datetime
  delivered    INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sp_deliver ON scheduled_pushes(deliver_at, delivered);
CREATE INDEX IF NOT EXISTS idx_sp_user    ON scheduled_pushes(user_id);

-- Store push tokens on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;
