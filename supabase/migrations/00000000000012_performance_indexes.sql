-- ─────────────────────────────────────────────────────────────────────────────
-- 00000000000012_performance_indexes.sql — indexes for the app's hottest queries
--
-- Step 9 (performance & operations). Every index below was proven useful with
-- EXPLAIN (ANALYZE, BUFFERS) on a migrated database carrying the real seeded
-- reference data (2,055 lawyers / 1,265 bail agents / 600 arrest rows) plus
-- synthetic volume in the user tables (50k users, 200k cases, 200k
-- case_messages, 300k chat_sessions, 200k arrest_records, 150k refresh_tokens,
-- 100k saved_lawyers). Measured gains (execution time, before → after):
--
--   GET /api/messages/:caseId thread          22.3 ms → 0.08 ms  (idx_case_messages_case_sent)
--   GET /api/messages/unread badge            22.8 ms → 0.14 ms  (idx_case_messages_unread)
--   read-marking UPDATE on thread open        seq scan → index   (idx_case_messages_unread)
--   GET /api/chat/history/:sessionId          31.5 ms → 0.07 ms  (idx_chat_sessions_session_created)
--   chat daily free-tier quota count          35.1 ms → 0.03 ms  (idx_chat_sessions_user_created)
--   GET /api/arrests/search?name=…           154.5 ms → 6.1 ms   (idx_arrest_records_name_trgm)
--   GET /api/arrests/recent?county=…          93.1 ms → 0.39 ms  (idx_arrest_records_county_lower)
--   arrest_alerts / outbound_bot 24h scan     85.9 ms → 0.50 ms  (idx_arrest_records_created)
--   GET /api/saved/lawyers                    16.3 ms → 0.05 ms  (idx_saved_lawyers_user_saved)
--   GET /api/providers/lawyers?city=…          1.5 ms → 0.12 ms  (idx_lawyers_city_lower)
--   GET /api/providers/bail bbox pre-filter    0.8 ms → 0.08 ms  (idx_bail_agents_lat_lng)
--
-- Candidates tested and REJECTED (planner never chose them, or the gain was
-- negligible): arrest_records(state, booking_date DESC); a partial
-- docket_entries(due_date) WHERE status='pending' (the overdue query LIMITs out
-- of a seq scan first); a partial consultation_bookings reminder index (the
-- un-indexable timestamp expression dominates; the hourly sweep is already
-- < 5 ms at 30k rows). refresh_tokens rotation needs nothing: the
-- (user_id, token_hash) primary key already serves it, and bar_prep_progress
-- (user_id, study_date) is already covered by migration 4.
--
-- Data-safe: index-only, no rows are modified. Idempotent: IF NOT EXISTS
-- everywhere; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Case message threads: WHERE case_id = ? AND deleted_at IS NULL
-- ORDER BY sent_at DESC LIMIT ? (routes/messages.js GET /:caseId).
CREATE INDEX IF NOT EXISTS idx_case_messages_case_sent
  ON case_messages (case_id, sent_at DESC)
  WHERE deleted_at IS NULL;

-- Unread badge count (JOIN per case, read_at IS NULL) and the read-marking
-- UPDATE on thread open. Predicate is read_at IS NULL only — the UPDATE has no
-- deleted_at filter, so a deleted_at IS NULL predicate would disqualify it.
CREATE INDEX IF NOT EXISTS idx_case_messages_unread
  ON case_messages (case_id)
  WHERE read_at IS NULL;

-- AI chat history: WHERE session_id = ? [AND user_id = ?] ORDER BY created_at
-- DESC LIMIT ? (routes/chat/_helpers.js getHistory, history.js DELETE).
CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_created
  ON chat_sessions (session_id, created_at DESC);

-- Free-tier daily quota: WHERE user_id = ? AND role='user' AND created_at >=
-- CURRENT_DATE (routes/chat/ask.js + stream.js — runs on every free chat turn).
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_created
  ON chat_sessions (user_id, created_at DESC);

-- Saved lawyers list: WHERE user_id = ? ORDER BY saved_at DESC (routes/saved.js);
-- the user_id prefix also serves the duplicate-save check (user_id, provider_id).
CREATE INDEX IF NOT EXISTS idx_saved_lawyers_user_saved
  ON saved_lawyers (user_id, saved_at DESC);

-- Scheduler + /arrests/recent 24-hour window: created_at >= NOW() - INTERVAL
-- (services/arrest_alerts.js, services/outbound_bot.js, routes/arrests.js).
CREATE INDEX IF NOT EXISTS idx_arrest_records_created
  ON arrest_records (created_at DESC);

-- County-scoped arrest lookups: LOWER(county) = LOWER(?) with a created_at
-- range (routes/arrests.js /search, /recent, /stats/county/:county).
CREATE INDEX IF NOT EXISTS idx_arrest_records_county_lower
  ON arrest_records (LOWER(county), created_at DESC);

-- Name search is `name ILIKE '%…%'` (family looking up a loved one) — only a
-- trigram index can serve a leading-wildcard match. pg_trgm ships with
-- PostgreSQL (and is enabled on Supabase), but creating extensions needs a
-- privileged role, so degrade gracefully: without pg_trgm the query stays a
-- (correct) sequential scan and the migration still succeeds.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN insufficient_privilege OR undefined_file THEN
    RAISE NOTICE 'pg_trgm unavailable — skipping idx_arrest_records_name_trgm (name search stays unindexed)';
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_arrest_records_name_trgm
      ON arrest_records USING gin (name gin_trgm_ops);
  END IF;
END $$;

-- Lawyer directory city path: WHERE COALESCE(active,1)=1 AND LOWER(city) =
-- LOWER(?) [AND UPPER(state) = ?] (routes/providers.js /lawyers). The partial
-- predicate matches the query text exactly. (These were planned in the baseline
-- schema but SKIPPED because lawyers.active/lat/lng did not exist yet —
-- migration 3 added the columns and the indexes were never revisited.)
CREATE INDEX IF NOT EXISTS idx_lawyers_city_lower
  ON lawyers (LOWER(city), state)
  WHERE COALESCE(active, 1) = 1;

-- Bail agent bbox pre-filter: lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
-- (routes/providers.js /bail GPS path).
CREATE INDEX IF NOT EXISTS idx_bail_agents_lat_lng
  ON bail_agents (lat, lng)
  WHERE COALESCE(active, 1) = 1;
