-- 00000000000051_account_security.sql
-- Sandbox review 2026-11-17 (second agent pass). Idempotent.
--
--  1. users.token_version: every access and refresh token carries it ("tv"). Changing or
--     resetting the password, confirming a new e-mail address and "sign out everywhere" add
--     one, so every token issued before stops working at once (middleware/auth.js).
--  2. users.pending_email*: a new e-mail address is used only after the link sent to it is
--     opened (POST /api/auth/confirm-email). Only a SHA-256 of the link token is stored.
--  3. users.failed_login_window_start: the per-account failure count is a rolling
--     15-minute window that starts over after a lock (routes/auth.js recordFailedLogin).
--  4. One account per phone number, sign-in identifier and e-mail address (case-insensitive).
--     If the database already holds duplicates this migration STOPS with a list of the
--     account ids involved: it never merges or edits accounts by itself. Resolve them
--     (HANDOFF_SECURITY_2026-11-17.md at the repo root, "Duplicate accounts") and run it again.
--  5. firm_invites.token holds a SHA-256 of the invitation token, never the token itself.
--  6. chat_quota_log: one row per free AI question asked (reserved before the answer,
--     refunded when no answer was delivered). The free limit counts these over a rolling
--     24 hours, so deleting chat history or changing the device time zone does not reset it.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_token      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_window_start TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_pending_email_token ON users (pending_email_token) WHERE pending_email_token IS NOT NULL;

-- Empty strings are "no value" (older rows): make them NULL so they do not collide.
UPDATE users SET phone = NULL            WHERE phone IS NOT NULL AND btrim(phone) = '';
UPDATE users SET login_identifier = NULL WHERE login_identifier IS NOT NULL AND btrim(login_identifier) = '';
UPDATE users SET email = NULL            WHERE email IS NOT NULL AND btrim(email) = '';

DO $$
DECLARE
  d_phone TEXT; d_login TEXT; d_email TEXT;
BEGIN
  SELECT string_agg(format('number ending %s: accounts %s', right(phone, 4), ids), '; ')
    INTO d_phone
    FROM (SELECT phone, string_agg(id::text, ', ' ORDER BY id) AS ids
            FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1) x;
  SELECT string_agg(format('accounts %s', ids), '; ')
    INTO d_login
    FROM (SELECT string_agg(id::text, ', ' ORDER BY id) AS ids
            FROM users WHERE login_identifier IS NOT NULL GROUP BY LOWER(login_identifier) HAVING COUNT(*) > 1) x;
  SELECT string_agg(format('accounts %s', ids), '; ')
    INTO d_email
    FROM (SELECT string_agg(id::text, ', ' ORDER BY id) AS ids
            FROM users WHERE email IS NOT NULL GROUP BY LOWER(email) HAVING COUNT(*) > 1) x;
  IF d_phone IS NOT NULL OR d_login IS NOT NULL OR d_email IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 051 stopped: some accounts share a sign-in value. Nothing was changed. '
      'Same phone: [%] Same sign-in identifier: [%] Same e-mail: [%]. '
      'See HANDOFF_SECURITY_2026-11-17.md (repo root) "Duplicate accounts", resolve them, then run the migration again.',
      COALESCE(d_phone, 'none'), COALESCE(d_login, 'none'), COALESCE(d_email, 'none');
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone            ON users (phone)                   WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_login_identifier ON users (LOWER(login_identifier)) WHERE login_identifier IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower      ON users (LOWER(email))            WHERE email IS NOT NULL;

-- Invitation tokens: keep only a hash (64 hex characters). Older rows held the raw token.
UPDATE firm_invites
   SET token = encode(sha256(convert_to(token, 'UTF8')), 'hex')
 WHERE token IS NOT NULL AND token !~ '^[0-9a-f]{64}$';

CREATE TABLE IF NOT EXISTS chat_quota_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_msg_id TEXT,
  state         TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'used', 'refunded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_quota_log_user_time ON chat_quota_log (user_id, created_at DESC);
ALTER TABLE chat_quota_log ENABLE ROW LEVEL SECURITY;

-- Questions already asked in the last 24 hours keep counting after the deploy.
INSERT INTO chat_quota_log (user_id, client_msg_id, state, created_at)
SELECT cs.user_id, cs.client_msg_id, 'used', cs.created_at
  FROM chat_sessions cs
 WHERE cs.role = 'user' AND cs.user_id IS NOT NULL AND cs.created_at > NOW() - INTERVAL '24 hours'
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = cs.user_id)
   AND NOT EXISTS (SELECT 1 FROM chat_quota_log q WHERE q.user_id = cs.user_id AND q.created_at = cs.created_at);
