-- 00000000000019_idempotency.sql — duplicate protection for create endpoints
--
-- 1. idempotency_keys: the app sends an `Idempotency-Key` header on the POSTs
--    that create things (a case, a timeline event, a message, a reminder, a
--    saved lawyer, a review, feedback, an SOS alert, a booking …). The server
--    (backend/src/middleware/idempotency.js) records the key before running
--    the request and the 2xx response after it; a retry with the same key —
--    the app retries a POST once when the network drops — gets the stored
--    response instead of creating a second row. A concurrent duplicate gets
--    409 idempotency_in_progress. Keys expire after 24 h (purged by the daily
--    token-cleanup job). `scope` is a hash of the caller's credentials (or of
--    the client IP for anonymous calls), so one caller can never replay
--    another caller's response.
--
-- 2. saved_lawyers: at most one bookmark per (user, directory lawyer). Two
--    taps that race past the route's "already saved?" check used to insert two
--    rows. Existing duplicates are collapsed first (the oldest bookmark is
--    kept, its notes preserved when the kept row has none). These are user
--    bookmark rows, not directory rows — the lawyers table is not touched.
--
-- Idempotent. RLS on, no policies (deny-all), like every table.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope            TEXT        NOT NULL,
  key              TEXT        NOT NULL,
  fingerprint      TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  response_status  INTEGER,
  response_body    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys (created_at);
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- keep notes from a duplicate when the surviving (oldest) row has none
  UPDATE saved_lawyers k
     SET notes = d.notes
    FROM saved_lawyers d
   WHERE d.user_id = k.user_id AND d.provider_id = k.provider_id
     AND d.id > k.id AND COALESCE(k.notes, '') = '' AND COALESCE(d.notes, '') <> ''
     AND k.id = (SELECT MIN(x.id) FROM saved_lawyers x WHERE x.user_id = k.user_id AND x.provider_id = k.provider_id);

  DELETE FROM saved_lawyers d
   USING saved_lawyers k
   WHERE d.user_id = k.user_id AND d.provider_id = k.provider_id
     AND d.provider_id IS NOT NULL AND d.id > k.id;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_lawyers_user_provider
  ON saved_lawyers (user_id, provider_id) WHERE provider_id IS NOT NULL;
