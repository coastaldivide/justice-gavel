-- =============================================================================
-- Migration 003: High-Capacity Indexes for 500+ Concurrent Users
-- Generated from §1 workflow audit — July 2026
-- =============================================================================

-- ── cases table ─────────────────────────────────────────────────────────────
-- Attorney dashboard filter: cases by state + status (most common query)
CREATE INDEX IF NOT EXISTS idx_cases_state_status
  ON cases(state, status) WHERE status NOT IN ('dismissed','closed');

-- Court date calendar view
CREATE INDEX IF NOT EXISTS idx_cases_court_date
  ON cases(user_id, court_date) WHERE court_date IS NOT NULL;

-- Jurisdiction filter for federal cases
CREATE INDEX IF NOT EXISTS idx_cases_jurisdiction
  ON cases(jurisdiction) WHERE jurisdiction IS NOT NULL;

-- ── users table ─────────────────────────────────────────────────────────────
-- Primary key already has implicit index, but explicit btree helps query planner
CREATE INDEX IF NOT EXISTS idx_users_id_btree ON users USING btree(id);

-- ── lawyers / attorneys table ─────────────────────────────────────────────
-- Practice area filter — most common attorney search
CREATE INDEX IF NOT EXISTS idx_lawyers_practice
  ON lawyers(practice_area, state) WHERE verified = true;

-- Geo bounding box queries (lat/lng range searches)
CREATE INDEX IF NOT EXISTS idx_lawyers_lat  ON lawyers(lat)  WHERE verified = true;
CREATE INDEX IF NOT EXISTS idx_lawyers_lng  ON lawyers(lng)  WHERE verified = true;

-- ── bail_agents table ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bail_zip    ON bail_agents(zip);
CREATE INDEX IF NOT EXISTS idx_bail_lat    ON bail_agents(lat);
CREATE INDEX IF NOT EXISTS idx_bail_lng    ON bail_agents(lng);

-- ── push_tokens ─────────────────────────────────────────────────────────────
-- Sending push notifications requires looking up all tokens for a user
CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON push_tokens(user_id) WHERE token IS NOT NULL;

-- ── case_messages (real-time chat) ──────────────────────────────────────────
-- Load message history for a case (most frequent query in messages.js)
CREATE INDEX IF NOT EXISTS idx_messages_case_time
  ON case_messages(case_id, sent_at DESC);

-- Unread count badge (hits on every app load)
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON case_messages(case_id, sender_id, read_at) WHERE read_at IS NULL;

-- ── checkins ────────────────────────────────────────────────────────────────
-- Daily check-in scheduler queries all users with check-in due today
CREATE INDEX IF NOT EXISTS idx_checkins_time
  ON checkins(expected_time) WHERE completed = false;

-- Per-user check-in history
CREATE INDEX IF NOT EXISTS idx_checkins_user_time
  ON checkins(user_id, check_in_time DESC);

-- ── user_subscriptions ──────────────────────────────────────────────────────
-- Feature gating: lookup subscription by user_id + status (happens on every API call)
CREATE INDEX IF NOT EXISTS idx_subs_user_status
  ON user_subscriptions(user_id, status);

-- Dunning: find all past_due subscriptions
CREATE INDEX IF NOT EXISTS idx_subs_status_tier
  ON user_subscriptions(status, tier) WHERE status = 'past_due';

-- ── docket_entries (document management) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_docket_matter
  ON docket_entries(matter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_docket_user
  ON docket_entries(user_id, created_at DESC);

-- ── scheduled_pushes ────────────────────────────────────────────────────────
-- Scheduler queries pending pushes by deliver_at (already indexed in schema)
-- Add user-level index for "all scheduled pushes for this user" queries
CREATE INDEX IF NOT EXISTS idx_pushes_user
  ON scheduled_pushes(user_id) WHERE delivered_at IS NULL;

-- ── family_contacts ─────────────────────────────────────────────────────────
-- Emergency alert: get all contacts for a user
CREATE INDEX IF NOT EXISTS idx_family_contacts_user
  ON family_contacts(user_id);

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Compliance queries: all actions by user, time-range
CREATE INDEX IF NOT EXISTS idx_audit_user_time
  ON audit_log(user_id, created_at DESC);

-- Security review: all actions by type in a time window
CREATE INDEX IF NOT EXISTS idx_audit_action_time
  ON audit_log(action, created_at DESC);

-- ── research_sessions ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_research_user
  ON research_sessions(user_id, created_at DESC);

-- ── video_sessions ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_video_user_active
  ON video_sessions(user_id, expires_at) WHERE ended_at IS NULL;

-- ── legal_documents (RAG) ───────────────────────────────────────────────────
-- Already has IVFFlat for embeddings — add B-tree for filter-then-vector queries
CREATE INDEX IF NOT EXISTS idx_legal_docs_practice_year
  ON legal_documents(practice_area, year DESC);

CREATE INDEX IF NOT EXISTS idx_legal_docs_jurisdiction_year
  ON legal_documents(jurisdiction, year DESC);


-- Stripe webhook idempotency log
CREATE TABLE IF NOT EXISTS stripe_event_log (
  id               BIGSERIAL PRIMARY KEY,
  stripe_event_id  TEXT UNIQUE NOT NULL,
  event_type       TEXT,
  processed_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_id ON stripe_event_log(stripe_event_id);
ALTER TABLE stripe_event_log ENABLE ROW LEVEL SECURITY;

-- Dispute flag on user_subscriptions
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS dispute_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_subs_customer ON user_subscriptions(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Lawyer profile enhancements (Feature 3)
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS languages_spoken TEXT DEFAULT 'English';
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS free_consultation BOOLEAN DEFAULT FALSE;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS avg_response_hours INTEGER;

-- Reviews table unique constraint (one review per user per provider)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS provider_id BIGINT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS comment TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_provider_user ON reviews(provider_id, user_id);

ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS supervisor_note TEXT;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS next_check_in_at TIMESTAMPTZ;

-- Alert history log (Feature 5)
CREATE TABLE IF NOT EXISTS alert_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT,
  category      TEXT DEFAULT 'emergency',
  message       TEXT,
  lat           NUMERIC(10,6),
  lng           NUMERIC(10,6),
  contact_count INTEGER DEFAULT 0,
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_log_user ON alert_log(user_id, sent_at DESC);
ALTER TABLE alert_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS rate_cents INTEGER DEFAULT 25000; -- $250/hr default
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS firm_id BIGINT;

-- Lesson points column
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 10;
UPDATE lessons SET points = CASE difficulty WHEN 'advanced' THEN 30 WHEN 'intermediate' THEN 20 ELSE 10 END WHERE points = 10;

-- Golden Gavel event log
ALTER TABLE golden_gavel_log ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE golden_gavel_log ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;
ALTER TABLE golden_gavel_log ADD COLUMN IF NOT EXISTS reference_id BIGINT;
