-- 022_admin_flag.sql
-- Adds is_admin flag to users table for admin-gated features
-- (bar verification queue, platform analytics, provider management)
-- Set manually: UPDATE users SET is_admin=1 WHERE email='admin@justicegavel.app';

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);
