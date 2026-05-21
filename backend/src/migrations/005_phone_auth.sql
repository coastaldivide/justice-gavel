-- 005_phone_auth.sql
-- Adds phone number support and display_name to users

ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN login_identifier TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login_identifier);

-- Backfill login_identifier from email for existing users
UPDATE users SET login_identifier = email WHERE login_identifier IS NULL AND email IS NOT NULL;
-- Backfill display_name from name
UPDATE users SET display_name = name WHERE display_name IS NULL AND name IS NOT NULL AND name != '';
