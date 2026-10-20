-- 00000000000024_directory_reviews_bookings.sql — review moderation and
-- time-zone-exact consultation bookings.
--
-- Reviews: every review now has a moderation status. 'published' reviews are
-- shown; a review whose comment carries contact details or a link waits as
-- 'pending' until an admin publishes it; an admin can 'hide' any review. People
-- can report a review (one report per person per review); reported reviews go
-- to the admin queue. Existing reviews stay published.
--
-- Bookings: date_slot / time_slot are the wall-clock slot in the lawyer's zone;
-- starts_at is the exact instant and time_zone the zone the slot was offered in,
-- so a booking made from another zone is stored and shown correctly.
--
-- Lawyer / bail-agent rows are not touched. Idempotent.

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderated_by BIGINT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_status_check') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_status_check
      CHECK (status IN ('published', 'pending', 'hidden'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_entity_status ON reviews (entity_type, entity_id, status);

CREATE TABLE IF NOT EXISTS review_reports (
  id          BIGSERIAL PRIMARY KEY,
  review_id   BIGINT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT review_reports_reason_check CHECK (reason IN ('false', 'offensive', 'private_info', 'spam', 'other')),
  CONSTRAINT review_reports_status_check CHECK (status IN ('open', 'closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_reports_user ON review_reports (review_id, user_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_open ON review_reports (status, created_at DESC);
ALTER TABLE review_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS time_zone TEXT;
