-- 042 · Fixes from the independent review (Oct 27 2026). Idempotent.
--
--   telnyx_event_log           Telnyx messaging webhooks already received (data.id): a replayed or
--                              retried event is acknowledged and not processed again. status =
--                              received / done / failed (+ the error) for the slow part, which runs
--                              after Telnyx has its 200.
--   voice_keypad_lookups       every phone number typed on the phone line's keypad (an HMAC of the
--                              number, never the number): a number can be looked up only a few times
--                              a day, whoever calls — keypad enumeration of one person's number stops.
--   pd_unroutable_texts        a text from a number that is a client of MORE THAN ONE public defender
--                              office: delivered to no office (the sender is asked to call their
--                              office); shown to Justice Gavel admins. Body encrypted, like
--                              pd_messages; the number as an HMAC + last 4 digits.
--   custody_alerts.text_status 'held' = a custody alert text kept back during the night (21:00–08:00
--                              in the follower's zone); the 'custody-held-texts' job sends it in the
--                              morning.

BEGIN;

CREATE TABLE IF NOT EXISTS telnyx_event_log (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT,
  status       TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'done', 'failed')),
  error        TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telnyx_event_log_received ON telnyx_event_log (received_at);
ALTER TABLE telnyx_event_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS voice_keypad_lookups (
  id               BIGSERIAL PRIMARY KEY,
  number_hash      TEXT NOT NULL,
  call_control_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_keypad_lookups_number ON voice_keypad_lookups (number_hash, created_at DESC);
ALTER TABLE voice_keypad_lookups ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pd_unroutable_texts (
  id           BIGSERIAL PRIMARY KEY,
  phone_hash   TEXT NOT NULL,
  phone_last4  TEXT,
  body_enc     TEXT,
  office_ids   BIGINT[] NOT NULL DEFAULT '{}',
  replied      TEXT,                      -- sent / opted_out / skipped / failed
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_unroutable_received ON pd_unroutable_texts (received_at DESC);
ALTER TABLE pd_unroutable_texts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_custody_alerts_held ON custody_alerts (id) WHERE text_status = 'held';

COMMIT;
