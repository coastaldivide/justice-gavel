-- Migration 031: additional performance indices
-- Added after load testing revealed hot query patterns
-- without adequate index coverage.

-- messages table: replies lookup (sender→recipient thread view)
CREATE INDEX IF NOT EXISTS idx_messages_case_sender
  ON messages(case_id, sender_id, created_at DESC);

-- cases: attorney/defender access by user + status
CREATE INDEX IF NOT EXISTS idx_cases_status_court
  ON cases(user_id, status, next_court_date ASC);

-- checkin_records: most recent check-in per enrollment
CREATE INDEX IF NOT EXISTS idx_checkin_recent
  ON checkin_records(enrollment_id, checked_in_at DESC);

-- scheduled_pushes: pending delivery queries
CREATE INDEX IF NOT EXISTS idx_pushes_pending
  ON scheduled_pushes(delivered, deliver_at ASC)
  WHERE delivered = 0;

-- lawyers: full-text search support (state+city+availability)
CREATE INDEX IF NOT EXISTS idx_lawyers_search
  ON lawyers(state, city, availability, rating DESC)
  WHERE active = 1;
