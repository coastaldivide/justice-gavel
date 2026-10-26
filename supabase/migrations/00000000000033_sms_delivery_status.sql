-- 00000000000033_sms_delivery_status.sql — did each text actually arrive?
--
-- Telnyx reports a final status per message (webhook message.finalized): delivered,
-- delivery_failed, sending_failed, delivery_unconfirmed. Recorded here by the
-- provider's message id (routes/webhooks/telnyx.js). Bond Desk shows the status next to
-- each text it sent for an agent; monitoring/smsHealth.js alerts when many fail.
-- No message text and no full phone number is stored. Idempotent.
BEGIN;
CREATE TABLE IF NOT EXISTS sms_delivery (
  provider_id  TEXT PRIMARY KEY,
  status       TEXT NOT NULL,
  error_code   TEXT,
  to_masked    TEXT,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_delivery_at ON sms_delivery (finalized_at);
COMMIT;
