-- 046 · Source re-checks and batch processing (AI step 3, Nov 2 2026; docs/AI_PLATFORM.md §9–§10,
-- docs/LEGAL_ACCURACY_REVIEW.md §3c). Idempotent.
--
-- ai_batches / ai_batch_items — one Message Batches API batch and its requests (services/aiBatch.js).
--   An item is keyed by custom_id inside its batch (the API matches results by custom_id, in any
--   order). `logical_key` names the work across retries (a retried item gets a new row in a new
--   batch with attempt + 1). `params` keeps the exact request so an errored item can be resent;
--   only non-personal content is batched (legal rows, eval questions, app strings).
--   idempotency_key: creating the same work twice returns the existing batch.
-- legal_source_checks — the "checked on" overlay for every sourced legal row the app shows or
--   withholds (services/sourceChecks): the date a re-check last VERIFIED the row (a "still matches"
--   verdict whose quote is on the fetched official page) or an admin approved it, plus a withhold
--   flag and an admin-approved source. Rows themselves never change automatically.
-- legal_source_reviews — the admin review queue: every verdict that is not a verified "still
--   matches" (changed / page gone / can't tell / quote not found) and every proposed source for a
--   withheld row. Decisions (approve / edit / withhold) are audited in audit_log.

CREATE TABLE IF NOT EXISTS ai_batches (
  id                 BIGSERIAL PRIMARY KEY,
  kind               TEXT NOT NULL,
  anthropic_batch_id TEXT,
  status             TEXT NOT NULL DEFAULT 'creating',   -- creating | in_progress | canceling | ended | processed | failed
  idempotency_key    TEXT,
  parent_id          BIGINT REFERENCES ai_batches(id) ON DELETE SET NULL,
  root_id            BIGINT,
  item_count         INTEGER NOT NULL DEFAULT 0,
  request_counts     JSONB,
  worst_case_usd     NUMERIC(12,6),
  cost_usd           NUMERIC(12,6) NOT NULL DEFAULT 0,
  meta               JSONB,
  output             JSONB,
  error              TEXT,
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at       TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  processed_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  polled_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_batches_idem ON ai_batches (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_batches_anthropic ON ai_batches (anthropic_batch_id) WHERE anthropic_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_batches_open ON ai_batches (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_batches_kind ON ai_batches (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_batch_items (
  id           BIGSERIAL PRIMARY KEY,
  batch_id     BIGINT NOT NULL REFERENCES ai_batches(id) ON DELETE CASCADE,
  custom_id    TEXT NOT NULL,
  logical_key  TEXT NOT NULL,
  attempt      INTEGER NOT NULL DEFAULT 1,
  task         TEXT NOT NULL,
  ref          JSONB,
  params       JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | succeeded | invalid | refused | errored | canceled | expired | retried | failed
  result       JSONB,
  error_type   TEXT,
  error        TEXT,
  stop_reason  TEXT,
  model        TEXT,
  usage        JSONB,
  cost_usd     NUMERIC(12,6),
  handled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, custom_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_batch_items_logical ON ai_batch_items (logical_key, attempt);
CREATE INDEX IF NOT EXISTS idx_ai_batch_items_status ON ai_batch_items (batch_id, status);

CREATE TABLE IF NOT EXISTS legal_source_checks (
  dataset              TEXT NOT NULL,
  row_key              TEXT NOT NULL,
  source_url           TEXT,
  checked_on           DATE,              -- last date the row was VERIFIED against its source (automatic or admin)
  checked_how          TEXT,              -- auto_quote | admin_approved | admin_edited
  last_attempt_at      TIMESTAMPTZ,       -- last time a re-check ran for the row (any outcome)
  last_outcome         TEXT,              -- verified | queued | no_source_found | skipped_not_official | failed
  last_verdict         TEXT,
  last_quote           TEXT,
  last_fetched_url     TEXT,
  last_batch_id        BIGINT REFERENCES ai_batches(id) ON DELETE SET NULL,
  withheld             BOOLEAN NOT NULL DEFAULT FALSE,
  withheld_reason      TEXT,
  approved_source_url  TEXT,
  approved_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  correction           TEXT,              -- admin-entered correction for a row that lives in code (applied by a developer)
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dataset, row_key)
);
CREATE INDEX IF NOT EXISTS idx_legal_source_checks_attempt ON legal_source_checks (last_attempt_at);

CREATE TABLE IF NOT EXISTS legal_source_reviews (
  id                   BIGSERIAL PRIMARY KEY,
  dataset              TEXT NOT NULL,
  row_key              TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'recheck',   -- recheck | proposal
  label                TEXT,
  state                TEXT,
  source_url           TEXT,
  old_text             TEXT NOT NULL,
  verdict              TEXT NOT NULL,     -- still_matches | changed | page_gone | cant_tell | source_found
  quote                TEXT,
  quote_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  reason               TEXT,              -- why it is here (quote_not_on_page, pdf_not_verifiable, changed, …)
  what_changed         TEXT,
  fetched_url          TEXT,
  proposed_source_url  TEXT,
  batch_id             BIGINT REFERENCES ai_batches(id) ON DELETE SET NULL,
  batch_item_id        BIGINT REFERENCES ai_batch_items(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | edited | withheld | superseded
  decided_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at           TIMESTAMPTZ,
  decision_note        TEXT,
  edited_text          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_source_reviews_pending ON legal_source_reviews (dataset, row_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_legal_source_reviews_status ON legal_source_reviews (status, created_at DESC);

-- The "checked on" date for the two gated tables that had only verified_by.
ALTER TABLE victim_compensation ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;
ALTER TABLE specialty_courts ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

-- Batch calls are metered like any other call; this marks them (priced at the batch rate).
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS batch_id BIGINT;
