-- =============================================================================
-- Migration: Flywheel columns — added in v8.7.52-v8.7.53 backend code
-- Adds all columns referenced in code but missing from schema.
-- Run in order after all previous migrations.
-- =============================================================================

BEGIN;

-- ── consultation_bookings: refund tracking ────────────────────────────────────
ALTER TABLE consultation_bookings
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_id           TEXT,        -- Stripe refund_id or null
  ADD COLUMN IF NOT EXISTS reminder_sent       TIMESTAMPTZ; -- set when 24hr reminder fires

-- ── cases: outcome tracking (feeds attorney match scoring) ────────────────────
-- Note: 'outcome' TEXT column already exists in 20260710000004.
-- Adding the surrounding metadata columns.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS outcome_notes          TEXT,
  ADD COLUMN IF NOT EXISTS outcome_recorded_by    BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS outcome_recorded_at    TIMESTAMPTZ;

-- ── attorney_profiles: platform-level metrics ─────────────────────────────────
-- These are maintained by the application layer (reviews, outcomes, bookings)
-- and read by the match algorithm for scoring.
ALTER TABLE attorney_profiles
  ADD COLUMN IF NOT EXISTS lawyer_id              BIGINT REFERENCES lawyers(id),
  ADD COLUMN IF NOT EXISTS availability_schedule  JSONB,       -- {mon:['morning','afternoon'],...}
  ADD COLUMN IF NOT EXISTS practice_areas         JSONB,       -- ['Criminal Defense','DUI',...]
  ADD COLUMN IF NOT EXISTS bar_verification_status TEXT DEFAULT 'pending',  -- pending|approved|rejected
  ADD COLUMN IF NOT EXISTS platform_rating        NUMERIC(3,1),-- avg from reviews_app (1.0–5.0)
  ADD COLUMN IF NOT EXISTS platform_review_count  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outcome_score          NUMERIC(3,1),-- 3.0 base + up to 2.0 from wins
  ADD COLUMN IF NOT EXISTS outcome_count          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_at            TIMESTAMPTZ; -- when attorney accepted a case_assignment

-- ── case_assignments: accepted_at (set when attorney accepts from inbox) ──────
ALTER TABLE case_assignments
  ADD COLUMN IF NOT EXISTS accepted_at            TIMESTAMPTZ;

-- ── expungement_check_log: tracks who has visited ExpungementScreen ───────────
-- Used by nightly scheduler to avoid re-triggering expungement push for users
-- who have already engaged with the expungement flow.
CREATE TABLE IF NOT EXISTS expungement_check_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id     BIGINT REFERENCES cases(id) ON DELETE SET NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT DEFAULT 'screen_visit'  -- screen_visit | push_tapped | completed
);

CREATE INDEX IF NOT EXISTS idx_expunge_log_user  ON expungement_check_log (user_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_expunge_log_case  ON expungement_check_log (case_id);

ALTER TABLE expungement_check_log ENABLE ROW LEVEL SECURITY;

-- ── Indexes for new query patterns ────────────────────────────────────────────
-- attorney_profiles.lawyer_id is joined in match.js and consultations.js
CREATE INDEX IF NOT EXISTS idx_attorney_profiles_lawyer_id
  ON attorney_profiles (lawyer_id)
  WHERE lawyer_id IS NOT NULL;

-- consultation_bookings: cancel/refund queries
CREATE INDEX IF NOT EXISTS idx_bookings_status_date
  ON consultation_bookings (status, date_slot)
  WHERE status = 'confirmed';

-- cases: outcome queries from scheduler
CREATE INDEX IF NOT EXISTS idx_cases_outcome_recorded
  ON cases (outcome_recorded_at, status)
  WHERE outcome IS NOT NULL;

COMMIT;
