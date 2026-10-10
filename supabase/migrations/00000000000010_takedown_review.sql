-- 00000000000010_takedown_review.sql
--
-- Arrest-record takedown requests are reviewed by staff before a record is
-- suppressed (routes/alerts.js). Previously DELETE /api/alerts/record/:id let
-- any signed-in user suppress any arrest record immediately, with no check
-- that they were the person named in it.
--
-- arrest_takedown_log becomes the review queue:
--   status       'pending'  — filed by a user, record still visible
--                'approved' — staff approved; the record is suppressed
--                'rejected' — staff rejected; nothing changed
--                'suppressed' — legacy rows written by the old immediate flow
--   reason, requestor (contact the reviewer can reach), relationship
--   reviewed_by / reviewed_at / review_note — who decided, when and why
--   taken_down_at / taken_down_by — set only when a record is actually suppressed
--
-- One open request per (record, user). Existing rows are not changed.
-- Idempotent: safe to run any number of times.

BEGIN;

SET client_min_messages = warning;

ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS relationship TEXT;
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS reviewed_by  BIGINT;
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ;
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS review_note  TEXT;

-- A pending request has not taken anything down yet.
ALTER TABLE arrest_takedown_log ALTER COLUMN taken_down_at DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS arrest_takedown_log_one_pending
  ON arrest_takedown_log (arrest_id, requested_by)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS arrest_takedown_log_status_idx
  ON arrest_takedown_log (status, requested_at);

COMMIT;
