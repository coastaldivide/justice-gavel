-- Migration 044: Composite indexes for high-traffic query patterns
-- Prevents full table scans on matters, cases, audit_log

-- matters table — queried by firm_id+status and user_id+status in nearly every attorney route
CREATE INDEX IF NOT EXISTS idx_matters_firm_status ON matters(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_matters_user_status ON matters(user_id, status);
CREATE INDEX IF NOT EXISTS idx_matters_firm_updated ON matters(firm_id, updated_at DESC);

-- firms — name lookups in conflict detection
CREATE INDEX IF NOT EXISTS idx_firms_name ON firms(name);

-- audit_log — queried by firm+date range for compliance reports; currently PK-only
CREATE INDEX IF NOT EXISTS idx_audit_log_firm_created ON audit_log(firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at DESC);

-- cases — defendant case lists by user+status
CREATE INDEX IF NOT EXISTS idx_cases_user_status ON cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_next_court ON cases(next_court_date) WHERE next_court_date IS NOT NULL;

-- docket_entries — upcoming deadline queries (most frequent calendar query)
CREATE INDEX IF NOT EXISTS idx_docket_entries_matter_due ON docket_entries(matter_id, due_date) WHERE completed = 0;

-- time_entries — billing summary by matter
CREATE INDEX IF NOT EXISTS idx_time_entries_matter ON time_entries(matter_id, created_at DESC);

-- subscriptions — active subscription lookup per user
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);

-- push_tokens — push delivery per user (active only)
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id) WHERE active = 1;
