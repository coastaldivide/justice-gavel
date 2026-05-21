-- Migration 027: Performance indices on high-query tables
-- These indices prevent full table scans on ORDER BY created_at DESC queries.
-- At 10k+ rows, an unindexed ORDER BY on created_at causes 100ms+ query times.
-- These are the tables queried most frequently in time-order by the app.

-- Messages (loaded on every conversation open, ordered newest-first)
CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_session
  ON messages(user_id, session_id, created_at DESC);

-- Cases (case list ordered by court date / created)
CREATE INDEX IF NOT EXISTS idx_cases_created_at
  ON cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_user_court
  ON cases(user_id, next_court_date ASC);

-- Motions (motion history ordered newest-first)
CREATE INDEX IF NOT EXISTS idx_motions_created_at
  ON motions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_motions_user
  ON motions(user_id, created_at DESC);

-- Subscriptions (status lookups on every auth'd request)
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at
  ON subscriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions(user_id, status);

-- Scheduled pushes (drain query: WHERE deliver_at <= now AND status = 'pending')
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_created_at
  ON scheduled_pushes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_deliver
  ON scheduled_pushes(deliver_at ASC, status);

-- Refund requests (admin lookup by status and date)
CREATE INDEX IF NOT EXISTS idx_refund_requests_created_at
  ON refund_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status
  ON refund_requests(status, created_at DESC);
