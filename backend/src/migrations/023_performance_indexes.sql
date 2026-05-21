-- 023_performance_indexes.sql
-- Performance indexes for high-traffic query patterns
-- These target columns identified in production query analysis

-- cases table — queried by user_id on every CaseScreen load
CREATE INDEX IF NOT EXISTS idx_cases_user_id         ON cases(user_id);
CREATE INDEX IF NOT EXISTS idx_cases_status          ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_next_court_date ON cases(next_court_date);

-- messages — queried by case_id on every thread open
CREATE INDEX IF NOT EXISTS idx_cmsg_unread_sender    ON case_messages(case_id, read_at, sender_id);

-- subscriptions — checked on every AI route for tier gating
CREATE INDEX IF NOT EXISTS idx_subs_user_status      ON subscriptions(user_id, status);

-- motion_history — user's motion list
CREATE INDEX IF NOT EXISTS idx_motions_user          ON motion_history(user_id, created_at);

-- billing — frequent lookups
CREATE INDEX IF NOT EXISTS idx_billing_user_type     ON subscriptions(user_id, provider_type, status);

-- research sessions
CREATE INDEX IF NOT EXISTS idx_research_user         ON research_sessions(user_id, updated_at);

-- discovery analyses
CREATE INDEX IF NOT EXISTS idx_discovery_user        ON discovery_analyses(user_id, created_at);

-- push tokens — looked up on every notification send
CREATE INDEX IF NOT EXISTS idx_push_tokens_user      ON push_tokens(user_id);

-- rewards — points balance lookup
CREATE INDEX IF NOT EXISTS idx_rewards_user          ON rewards(user_id);

-- referrals — code lookup on redemption
CREATE INDEX IF NOT EXISTS idx_referrals_code        ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_owner       ON referrals(owner_user_id);
