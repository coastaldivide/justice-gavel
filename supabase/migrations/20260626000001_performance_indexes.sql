-- ══════════════════════════════════════════════════════════════════
-- Justice Gavel — Performance Migration
-- June 2026
-- ══════════════════════════════════════════════════════════════════

-- Enable pg_stat_statements for query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Enable pg_trgm for fast LIKE/ILIKE searches on names
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for fast attorney name search
CREATE INDEX IF NOT EXISTS idx_attorneys_name_trgm
  ON attorneys USING gin(name gin_trgm_ops);

-- Trigram index for fast city search
CREATE INDEX IF NOT EXISTS idx_attorneys_city_trgm
  ON attorneys USING gin(city gin_trgm_ops);

-- Composite index for geo-proximity queries (most common search)
CREATE INDEX IF NOT EXISTS idx_attorneys_geo_state
  ON attorneys(state, lat, lng)
  WHERE verified = true;

-- Partial index: only active subscriptions (99% of subscription queries)
CREATE INDEX IF NOT EXISTS idx_subscriptions_active
  ON subscriptions(user_id, stripe_subscription_id)
  WHERE status = 'active';

-- Partial index: unread notifications only
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, created_at DESC)
  WHERE read = false;

-- Covering index for message list query (avoid table lookup)
CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON messages(case_id, created_at DESC)
  INCLUDE (sender_id, content, read);

-- Add missing indexes on arrest_records table
-- Critical for bail lead marketplace performance
CREATE INDEX IF NOT EXISTS idx_arrest_records_state
  ON arrest_records (state);

CREATE INDEX IF NOT EXISTS idx_arrest_records_bail_amount
  ON arrest_records (bail_amount);

CREATE INDEX IF NOT EXISTS idx_arrest_records_county_state
  ON arrest_records (county, state);

CREATE INDEX IF NOT EXISTS idx_arrest_records_created_at
  ON arrest_records (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_records_name_search
  ON arrest_records (defendant_name text_pattern_ops);

-- Composite for the most common filter: state + bail range
CREATE INDEX IF NOT EXISTS idx_arrest_records_state_bail
  ON arrest_records (state, bail_amount)
  WHERE bail_amount > 0;
