-- 00000000000031_sms_consent_record.sql — proof of consent for text reminders (Telnyx)
--
-- Automated texts need the person's prior express consent (TCPA) and US carriers'
-- 10DLC campaign review asks how consent is collected and recorded. Before this, the
-- app stored only users.sms_reminders = 1. Now every opt-in records when it happened,
-- the number it covers, the wording shown (cdd_sms_consent) and the app language;
-- an opt-out records when. Idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_phone   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_text_v  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_consent_lang    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_opt_out_at      TIMESTAMPTZ;
