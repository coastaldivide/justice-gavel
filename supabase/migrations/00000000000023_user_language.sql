-- 00000000000023_user_language.sql — the person's app language
--
-- Court reminders (push / e-mail / SMS), follower notices and reminder
-- e-mails are written in the recipient's language. The app sends its language
-- (Accept-Language) and saves an explicit choice (POST /api/push/language);
-- the server keeps it here. NULL = not known yet → English.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded CHECK constraint.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_language_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_preferred_language_check
      CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'es', 'pt', 'vi'));
  END IF;
END $$;
