-- 020_case_sharing.sql
-- Adds share_token to cases for family view access
-- A share token lets a family member view a case read-only via a link/QR
-- without needing an account. Token is single-use or time-limited.

ALTER TABLE cases ADD COLUMN IF NOT EXISTS share_token TEXT DEFAULT NULL;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS share_expires_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_cases_share_token ON cases(share_token);
