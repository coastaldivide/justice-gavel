-- ─────────────────────────────────────────────────────────────────────────────
-- 00000000000015_provider_refresh_staging.sql — data refresh on Postgres
--
-- The operator scrapers / importers (backend/src/scripts/*) and the nightly
-- LIVE_REFRESH pipeline used to write a local SQLite file
-- (backend/data/providers.sqlite) that the app never read. They now write the
-- main database through backend/src/services/dataRefresh/. The owner rule for
-- the provider directory is enforced by the design, not by convention:
--
--   * a provider the scrape finds that is NOT already in the table
--     (matched by Google place id / source_id, then normalized phone, then
--     normalized name + city + state) is INSERTED with source / source_id /
--     timestamps;
--   * a difference between a scrape and an EXISTING row (phone, hours,
--     address, website, rating, ...) is never written to the row. It is
--     recorded here, in provider_update_proposals, as status 'pending' for an
--     admin to apply or reject (/api/admin/proposals). Applying writes only
--     that one field and is logged to provider_update_log + audit_log;
--   * rows a scrape does not return are never touched (never deleted,
--     deactivated or hidden).
--
-- 1. scrape_runs — one row per scraper / importer / scheduler run with its
--    counts (fetched / inserted / proposed / unchanged / updated / skipped /
--    errors) and final status. Skipped runs (e.g. GOOGLE_PLACES_KEY unset when
--    the scheduler fires) are recorded too.
--
-- 2. provider_update_proposals — staged field changes for lawyers,
--    bail_agents and recovery_agents. Idempotency: at most ONE open row per
--    (table, record, field, proposed value) — the partial unique index covers
--    every status except 'applied', so
--      · re-running a scrape refreshes last_seen_at / seen_count instead of
--        adding a duplicate,
--      · a REJECTED value is never proposed again,
--      · a value that was superseded by a newer one and comes back is revived
--        (status back to 'pending') rather than duplicated.
--    Once a proposal is applied the row holds that value, so it cannot be
--    proposed again unless the row later changes.
--
-- RLS: enabled with no policies (deny-all to anon / authenticated), exactly
-- like every other table (00000000000008_enable_rls.sql). The backend
-- connects as the table owner.
--
-- lawyers / bail_agents / recovery_agents / courthouses are NOT touched.
-- Idempotent: IF NOT EXISTS guards throughout; safe to apply twice.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scrape_runs (
  id            BIGSERIAL PRIMARY KEY,
  job           TEXT        NOT NULL,
  trigger       TEXT        NOT NULL DEFAULT 'manual',
  params        JSONB,
  dry_run       BOOLEAN     NOT NULL DEFAULT FALSE,
  status        TEXT        NOT NULL DEFAULT 'running',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  fetched       INTEGER     NOT NULL DEFAULT 0,
  inserted      INTEGER     NOT NULL DEFAULT 0,
  proposed      INTEGER     NOT NULL DEFAULT 0,
  unchanged     INTEGER     NOT NULL DEFAULT 0,
  updated       INTEGER     NOT NULL DEFAULT 0,
  skipped       INTEGER     NOT NULL DEFAULT 0,
  errors        INTEGER     NOT NULL DEFAULT 0,
  message       TEXT,
  error_sample  TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scrape_runs_status_check') THEN
    ALTER TABLE scrape_runs ADD CONSTRAINT scrape_runs_status_check
      CHECK (status IN ('running', 'ok', 'partial', 'failed', 'skipped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scrape_runs_trigger_check') THEN
    ALTER TABLE scrape_runs ADD CONSTRAINT scrape_runs_trigger_check
      CHECK (trigger IN ('manual', 'scheduler', 'admin', 'test'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scrape_runs_job_started ON scrape_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started     ON scrape_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS provider_update_proposals (
  id             BIGSERIAL PRIMARY KEY,
  table_name     TEXT        NOT NULL,
  record_id      BIGINT      NOT NULL,
  field          TEXT        NOT NULL,
  old_value      TEXT,
  new_value      TEXT        NOT NULL,
  new_value_hash TEXT        GENERATED ALWAYS AS (md5(new_value)) STORED,
  source         TEXT        NOT NULL,
  source_ref     TEXT,
  run_id         BIGINT      REFERENCES scrape_runs(id) ON DELETE SET NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_count     INTEGER     NOT NULL DEFAULT 1,
  status         TEXT        NOT NULL DEFAULT 'pending',
  decided_by     BIGINT,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_update_proposals_status_check') THEN
    ALTER TABLE provider_update_proposals ADD CONSTRAINT provider_update_proposals_status_check
      CHECK (status IN ('pending', 'applied', 'rejected', 'superseded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_update_proposals_table_check') THEN
    ALTER TABLE provider_update_proposals ADD CONSTRAINT provider_update_proposals_table_check
      CHECK (table_name IN ('lawyers', 'bail_agents', 'recovery_agents'));
  END IF;
END $$;

-- One open proposal per (row, field, value); 'applied' rows are history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_proposals_open
  ON provider_update_proposals (table_name, record_id, field, new_value_hash)
  WHERE status <> 'applied';
CREATE INDEX IF NOT EXISTS idx_provider_proposals_status
  ON provider_update_proposals (status, table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_proposals_record
  ON provider_update_proposals (table_name, record_id, field);

ALTER TABLE scrape_runs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_update_proposals ENABLE ROW LEVEL SECURITY;
