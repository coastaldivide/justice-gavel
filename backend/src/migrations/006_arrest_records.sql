-- 006_arrest_records.sql
-- Public arrest record index + attorney alert log
-- Safe to run multiple times (CREATE IF NOT EXISTS throughout)

CREATE TABLE IF NOT EXISTS arrest_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  booking_date       TEXT,
  charges            TEXT,
  bail_amount        REAL,
  court_date         TEXT,
  attorney_of_record TEXT,
  has_attorney       INTEGER DEFAULT 0,
  case_number        TEXT,
  jail_location      TEXT,
  county             TEXT,
  state              TEXT DEFAULT 'TN',
  source             TEXT,
  alert_sent         INTEGER DEFAULT 0,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ar_name    ON arrest_records(name);
CREATE INDEX IF NOT EXISTS idx_ar_county  ON arrest_records(county);
CREATE INDEX IF NOT EXISTS idx_ar_state   ON arrest_records(state);
CREATE INDEX IF NOT EXISTS idx_ar_date    ON arrest_records(booking_date);
CREATE INDEX IF NOT EXISTS idx_ar_atty    ON arrest_records(has_attorney);
CREATE INDEX IF NOT EXISTS idx_ar_alert   ON arrest_records(alert_sent);
CREATE INDEX IF NOT EXISTS idx_ar_bail    ON arrest_records(bail_amount);

CREATE TABLE IF NOT EXISTS attorney_alerts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id   INTEGER,
  recipient_type TEXT,
  subject        TEXT,
  body           TEXT,
  count          INTEGER DEFAULT 0,
  sent_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aa_recipient ON attorney_alerts(recipient_id, recipient_type);
CREATE INDEX IF NOT EXISTS idx_aa_sent      ON attorney_alerts(sent_at);
