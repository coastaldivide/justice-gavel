-- 009_consumer_tiers.sql
-- Consumer subscription tiers + chat usage tracking

-- Consumer subscription tiers
-- basic_free: account only, 3 AI msgs/day, no contact info
-- starter:    $9.99/mo — unlimited AI, lessons, resources, arrest search
-- pro:        $14.99/mo — starter + arrest monitoring alerts
-- intel:      $19.99/mo — pro + county analytics, weekly reports (attorneys/bondsmen)

ALTER TABLE subscriptions ADD COLUMN consumer_tier TEXT DEFAULT NULL;
-- Values: 'starter' | 'pro' | 'intel' | NULL (free)

-- Track chat message usage per user per day
CREATE TABLE IF NOT EXISTS chat_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  session_id  TEXT,
  date        TEXT DEFAULT (date('now')),  -- YYYY-MM-DD
  msg_count   INTEGER DEFAULT 0,
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cu_user_date ON chat_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_cu_user ON chat_usage(user_id);

-- Arrest monitoring subscriptions (who gets alerted when someone they care about is arrested)
CREATE TABLE IF NOT EXISTS arrest_monitors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  monitor_name TEXT NOT NULL,   -- name to watch for
  county      TEXT,
  state       TEXT DEFAULT 'TN',
  active      INTEGER DEFAULT 1,
  last_hit_at TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_am_user ON arrest_monitors(user_id);
