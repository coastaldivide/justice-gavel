-- 044 · AI gateway metering (Nov 2 2026; services/aiClient.js, ai/pricing.js, docs/AI_PLATFORM.md). Idempotent.
--
-- One ai_usage_log row per model attempt now also records:
--   task / task_class              the gateway task (ai/tasks.js) and its class: quick | standard | deep
--   requested_model                the model the class asked for (model = the one that answered;
--                                  they differ after a refusal fallback)
--   cache_read_tokens              usage.cache_read_input_tokens
--   cache_write_5m_tokens          usage.cache_creation.ephemeral_5m_input_tokens
--   cache_write_1h_tokens          usage.cache_creation.ephemeral_1h_input_tokens
--   stop_reason                    end_turn | max_tokens | refusal | …
--   refusal / refusal_category     the model (or the first model, before a fallback) declined
--   fallback_model                 the model that served the answer after a refusal fallback
--   error_code                     ai_busy | ai_timeout | ai_invalid_output | http_<status> | …
--   request_id / trace_id          the API's request-id header; the W3C trace id we sent
--   input_tokens_estimated         the preflight figure; preflight = counted | estimated
-- status gains: refused (final), declined (refused, retried on the fallback model),
-- invalid (the answer failed its schema and was not shown).

ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS task TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS task_class TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS requested_model TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS cache_write_5m_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS cache_write_1h_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS stop_reason TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS refusal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS refusal_category TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS fallback_model TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS trace_id TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS input_tokens_estimated BIGINT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS preflight TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_usage_route_time ON ai_usage_log (route, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_class_time ON ai_usage_log (task_class, queued_at DESC);
