-- 012_consultation_bookings.sql
-- Lawyer video consultation booking + platform fee ($10-$25)

CREATE TABLE IF NOT EXISTS consultation_bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  lawyer_id        INTEGER,
  lawyer_name      TEXT    NOT NULL,
  lawyer_phone     TEXT,
  date_slot        TEXT    NOT NULL,   -- ISO date  e.g. "2025-06-15"
  time_slot        TEXT    NOT NULL,   -- "10:00 AM"
  duration_min     INTEGER DEFAULT 30,
  platform_fee_cents INTEGER NOT NULL DEFAULT 1500,  -- $15 default
  notes            TEXT    DEFAULT '',
  status           TEXT    DEFAULT 'pending',        -- pending|confirmed|completed|cancelled
  stripe_pi_id     TEXT    DEFAULT '',
  meeting_link     TEXT    DEFAULT '',               -- populated on confirm
  created_at       TEXT    DEFAULT (datetime('now')),
  confirmed_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_user   ON consultation_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_lawyer ON consultation_bookings(lawyer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date   ON consultation_bookings(date_slot);

-- Track available slots per lawyer (optionally populated)
CREATE TABLE IF NOT EXISTS lawyer_availability (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lawyer_id  INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,  -- 0=Sun … 6=Sat
  start_time TEXT NOT NULL,      -- "09:00"
  end_time   TEXT NOT NULL,      -- "17:00"
  active     INTEGER DEFAULT 1
);
