-- Migration: 20260715000002_foreign_key_constraints.sql
-- Explicit FK constraints for critical relationships
-- Adds referential integrity beyond the existing 2 constraints

-- Ensure uuid-ossp is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core user-owned tables
ALTER TABLE IF EXISTS cases
  ADD CONSTRAINT IF NOT EXISTS fk_cases_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS chat_sessions
  ADD CONSTRAINT IF NOT EXISTS fk_chat_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS chat_messages
  ADD CONSTRAINT IF NOT EXISTS fk_chat_messages_session
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS subscriptions
  ADD CONSTRAINT IF NOT EXISTS fk_subscriptions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS user_subscriptions
  ADD CONSTRAINT IF NOT EXISTS fk_user_subscriptions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Matters (attorney-owned)
ALTER TABLE IF EXISTS matters
  ADD CONSTRAINT IF NOT EXISTS fk_matters_firm
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS docket_entries
  ADD CONSTRAINT IF NOT EXISTS fk_docket_entries_matter
  FOREIGN KEY (matter_id) REFERENCES matters(id) ON DELETE CASCADE;

-- Check-ins
ALTER TABLE IF EXISTS checkin_enrollments
  ADD CONSTRAINT IF NOT EXISTS fk_checkin_enrollments_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS checkin_submissions
  ADD CONSTRAINT IF NOT EXISTS fk_checkin_submissions_enrollment
  FOREIGN KEY (enrollment_id) REFERENCES checkin_enrollments(id) ON DELETE CASCADE;

-- Bail / leads
ALTER TABLE IF EXISTS arrest_monitors
  ADD CONSTRAINT IF NOT EXISTS fk_arrest_monitors_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Attorneys / firms
ALTER TABLE IF EXISTS firm_memberships
  ADD CONSTRAINT IF NOT EXISTS fk_firm_memberships_firm
  FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS firm_memberships
  ADD CONSTRAINT IF NOT EXISTS fk_firm_memberships_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Video / consultations
ALTER TABLE IF EXISTS video_sessions
  ADD CONSTRAINT IF NOT EXISTS fk_video_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS consultations
  ADD CONSTRAINT IF NOT EXISTS fk_consultations_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Documents
ALTER TABLE IF EXISTS documents
  ADD CONSTRAINT IF NOT EXISTS fk_documents_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Push tokens
ALTER TABLE IF EXISTS push_tokens
  ADD CONSTRAINT IF NOT EXISTS fk_push_tokens_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Reviews
ALTER TABLE IF EXISTS reviews
  ADD CONSTRAINT IF NOT EXISTS fk_reviews_lawyer
  FOREIGN KEY (lawyer_id) REFERENCES lawyers(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS reviews
  ADD CONSTRAINT IF NOT EXISTS fk_reviews_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Refresh tokens
ALTER TABLE IF EXISTS refresh_tokens
  ADD CONSTRAINT IF NOT EXISTS fk_refresh_tokens_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Lesson progress
ALTER TABLE IF EXISTS lesson_progress
  ADD CONSTRAINT IF NOT EXISTS fk_lesson_progress_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
