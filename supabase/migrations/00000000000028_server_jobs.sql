-- 028 · Section H (server-wide): background jobs that are safe with more than
-- one API instance (Render scaling / zero-downtime deploys), AI job status that
-- any instance can answer, Expo push receipts, and one live copy of each
-- planned reminder. Idempotent.

-- ── Scheduled-job claims ──────────────────────────────────────────────────────
-- One row per job per run window (e.g. nightly:2026-10-20). The instance whose
-- INSERT wins runs the job; the others skip it (utils/jobLock.js).
CREATE TABLE IF NOT EXISTS job_runs (
  job         TEXT        NOT NULL,
  run_key     TEXT        NOT NULL,
  instance    TEXT,
  status      TEXT        NOT NULL DEFAULT 'running',   -- running | ok | failed
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error       TEXT,
  PRIMARY KEY (job, run_key)
);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs (started_at);
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

-- ── AI job status (services/aiQueue.js) ───────────────────────────────────────
-- The job runs in the instance that accepted it; its status is written here so
-- GET /api/jobs/:id answers from any instance. Rows go 15 minutes after the job ends.
CREATE TABLE IF NOT EXISTS ai_job_state (
  id           TEXT        PRIMARY KEY,
  type         TEXT        NOT NULL,
  user_id      BIGINT      REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  result       JSONB,
  code         TEXT,
  instance     TEXT,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_job_state_completed ON ai_job_state (completed_at);
ALTER TABLE ai_job_state ENABLE ROW LEVEL SECURITY;

-- ── Expo push tickets → receipts (services/expoPush.js, pushDelivery.js) ──────
-- Expo reports a dead device (DeviceNotRegistered) in the receipt, fetched
-- later; the token is then removed so nothing keeps sending to it.
CREATE TABLE IF NOT EXISTS push_tickets (
  ticket_id      TEXT        PRIMARY KEY,
  token          TEXT        NOT NULL,
  user_id        BIGINT      REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at     TIMESTAMPTZ,
  receipt_status TEXT,
  receipt_error  TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_tickets_unchecked ON push_tickets (created_at) WHERE checked_at IS NULL;
ALTER TABLE push_tickets ENABLE ROW LEVEL SECURITY;

-- ── One live copy of each planned reminder ────────────────────────────────────
-- Two instances planning the same reminder (backfill sweeps after a deploy)
-- must not both insert it. Older duplicates are cancelled first.
UPDATE scheduled_pushes s
   SET status = 'cancelled', error = 'duplicate_v28'
 WHERE s.status IN ('pending', 'sending')
   AND s.dedupe_key IS NOT NULL
   AND EXISTS (SELECT 1 FROM scheduled_pushes o
                WHERE o.dedupe_key = s.dedupe_key
                  AND o.status IN ('pending', 'sending')
                  AND o.id < s.id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_pushes_live_dedupe
  ON scheduled_pushes (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'sending');

-- ── Cases an attorney closed were written as 'closed'; the app, the reminder
-- planner and the dispatcher use 'Closed'. ─────────────────────────────────────
UPDATE cases SET status = 'Closed' WHERE status = 'closed';

-- ── Docket entries: due_time is a time of day ('HH:MM', what routes/docket.js
-- writes and the scheduler reads); the column was TIMESTAMPTZ, so every entry
-- with a due time failed to save. ──────────────────────────────────────────────
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'docket_entries' AND column_name = 'due_time') = 'timestamp with time zone' THEN
    ALTER TABLE docket_entries ALTER COLUMN due_time TYPE TEXT USING to_char(due_time AT TIME ZONE 'UTC', 'HH24:MI');
  END IF;
END $$;
