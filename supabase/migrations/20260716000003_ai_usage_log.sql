-- AI Usage & Cost Tracking
-- Every Claude API call is logged here — the finance team needs this
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         TEXT,                           -- BullMQ job ID if queued
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  route          TEXT NOT NULL,                  -- e.g. 'chat', 'research', 'motion'
  model          TEXT DEFAULT 'claude-sonnet-4-6',
  input_tokens   INTEGER DEFAULT 0,
  output_tokens  INTEGER DEFAULT 0,
  cost_usd       NUMERIC(10,6) DEFAULT 0,        -- in dollars
  duration_ms    INTEGER,
  status         TEXT DEFAULT 'pending',        -- pending, completed, failed
  error          TEXT,
  queued_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  subscription_tier TEXT                         -- tier at time of call
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id
  ON ai_usage_log (user_id, queued_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_route
  ON ai_usage_log (route, queued_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_cost
  ON ai_usage_log (queued_at DESC)
  WHERE cost_usd > 0;

-- Daily cost summary view (for dashboard)
CREATE OR REPLACE VIEW ai_daily_costs AS
SELECT
  date_trunc('day', queued_at)            AS day,
  route,
  COUNT(*)                                  AS calls,
  SUM(input_tokens)                         AS total_input_tokens,
  SUM(output_tokens)                        AS total_output_tokens,
  SUM(cost_usd)                             AS total_cost_usd,
  AVG(cost_usd)                             AS avg_cost_per_call,
  AVG(duration_ms)                          AS avg_duration_ms,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_calls
FROM ai_usage_log
WHERE queued_at > NOW() - INTERVAL '90 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 5 DESC;

-- Per-user monthly spend (for enforcing AI rate budgets)
CREATE OR REPLACE VIEW ai_user_monthly_spend AS
SELECT
  user_id,
  date_trunc('month', queued_at) AS month,
  COUNT(*)                         AS total_calls,
  SUM(cost_usd)                    AS total_cost_usd,
  MAX(subscription_tier)           AS subscription_tier
FROM ai_usage_log
WHERE user_id IS NOT NULL
GROUP BY 1, 2
ORDER BY 3 DESC;
