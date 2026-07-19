-- ── 20260717000004_bar_prep_schema_corrections.sql ───────────────────────────
-- Fixes 8 gaps found between Phase 1 schema (I-01) and Phase 2 route code (B-03).
--
-- Changes:
--   1. quiz_sessions       — add subject_id, category, mode, question_count,
--                            started_at, total_answered, subject_filter alias
--   2. bar_prep_progress   — add questions_answered_total (view/column),
--                            notifications_enabled, updated_at
--   3. user_badges         — create table (B-09 / barPrepGavel.js)
--
-- All changes are additive (ALTER TABLE ADD COLUMN IF NOT EXISTS / CREATE TABLE
-- IF NOT EXISTS) — safe to run on an existing database.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. quiz_sessions: add Phase 2 columns ────────────────────────────────────
-- The I-01 schema used session_type, subject_filter, total_questions.
-- Phase 2 routes use mode, subject_id, category, question_count, started_at,
-- total_answered. Add the Phase 2 columns so both old and new code can coexist.

ALTER TABLE quiz_sessions
  ADD COLUMN IF NOT EXISTS subject_id    TEXT,          -- bar_subjects.id FK (loose)
  ADD COLUMN IF NOT EXISTS category      TEXT,          -- category filter
  ADD COLUMN IF NOT EXISTS mode          TEXT           -- 'practice' | 'timed'
                           DEFAULT 'practice'
                           CHECK (mode IN ('practice','timed')),
  ADD COLUMN IF NOT EXISTS question_count INTEGER,      -- alias for total_questions
  ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS total_answered INTEGER DEFAULT 0;

-- Back-fill question_count from total_questions for any existing rows
UPDATE quiz_sessions
   SET question_count = total_questions
 WHERE question_count IS NULL;

-- ── 2. bar_prep_progress: add lifetime counter + settings columns ─────────────
-- The existing table is per-day (study_date PRIMARY KEY with user_id).
-- checkSampleLimit needs questions_answered_total as a rolling lifetime counter.
-- We add it as a running sum view AND as a column on a separate summary row
-- (user_id only, no study_date — handled via UNIQUE constraint relaxation).
--
-- Simplest solution: add questions_answered_total, notifications_enabled,
-- and updated_at to the DAILY progress table — barPrep.js will write the
-- lifetime total on each submission.

ALTER TABLE bar_prep_progress
  ADD COLUMN IF NOT EXISTS questions_answered_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_total            INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_days              INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pass_probability         NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peer_percentile          NUMERIC(5,2) DEFAULT 50,
  ADD COLUMN IF NOT EXISTS questions_due            INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exam_date                DATE,
  ADD COLUMN IF NOT EXISTS notifications_enabled    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ DEFAULT NOW();

-- Create a unique row per user for lifetime totals (study_date = '1970-01-01' sentinel)
-- This avoids restructuring the daily-per-row design.
-- The barPrep.js checkSampleLimit and GoldenGavel queries use this row.
CREATE UNIQUE INDEX IF NOT EXISTS bar_prep_progress_lifetime_idx
  ON bar_prep_progress (user_id) WHERE study_date = '1970-01-01';

-- ── 3. user_badges: create table ─────────────────────────────────────────────
-- Required by barPrepGavel.js (B-09 GoldenGavel integration).
-- Stores per-user achievement badges — shared with the rest of the platform.

CREATE TABLE IF NOT EXISTS user_badges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key   TEXT        NOT NULL,     -- e.g. 'mbe_scholar', 'mbe_streak_7'
  label       TEXT        NOT NULL,
  emoji       TEXT,
  awarded_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, badge_key)
);

CREATE INDEX IF NOT EXISTS user_badges_user_idx ON user_badges (user_id);

-- ── RLS for new table ─────────────────────────────────────────────────────────
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "users can view own badges"
  ON user_badges FOR SELECT
  USING (auth.uid() = user_id);

-- Only server-side (service role) writes badges — no user insert policy.

COMMIT;
