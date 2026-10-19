-- 00000000000021_idempotency_owner.sql — idempotency rows belong to their user
--
-- idempotency_keys (migration 19) caches the response body of a create POST
-- for 24 h so a retry can replay it. Those bodies are personal data (a case
-- title, a court date, a follow) and the rows were keyed only by a hash of
-- the caller's credentials, so DELETE /api/auth/account could not find them
-- and they outlived the account. `user_id` is now recorded when the response
-- is stored (middleware/idempotency.js) and account deletion removes the
-- user's rows (services/accountDeletion.js USER_REFS). Rows without a user
-- (guest requests) still expire after 24 h.
--
-- Idempotent. RLS stays on (deny-all), like every table.
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user ON idempotency_keys (user_id) WHERE user_id IS NOT NULL;
