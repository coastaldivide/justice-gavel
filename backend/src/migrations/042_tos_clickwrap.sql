-- Migration 042: ToS Clickwrap Acceptance Tracking
-- ─────────────────────────────────────────────────────────────────────────────
-- Upgrades from browsewrap ("by continuing you agree") to clickwrap.
-- Every acceptance is timestamped, versioned, and logged for legal defensibility.
--
-- LEGAL BASIS:
--   Clickwrap agreements are consistently enforced by US courts.
--   GDPR Article 7(2) requires unambiguous, affirmative consent.
--   For a legal platform with a not-legal-advice disclaimer, logged clickwrap
--   is the minimum standard for enforceable liability protection.
--
-- HOW IT WORKS:
--   1. On first login (or after ToS version update), app shows modal
--   2. User must scroll to bottom to activate "I Agree" button
--   3. User checks both checkboxes and taps "I Agree"
--   4. POST /api/auth/accept-tos records the acceptance
--   5. On subsequent logins: check tos_version_accepted vs CURRENT_TOS_VERSION
--   6. If mismatch: show modal again for the new version only
-- ─────────────────────────────────────────────────────────────────────────────

-- Add ToS acceptance columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at    TEXT DEFAULT NULL;
  -- ISO 8601 timestamp of acceptance — null = not yet accepted
  -- Example: 2026-05-11T14:32:07.000Z

ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version_accepted TEXT DEFAULT NULL;
  -- Which version of the ToS was accepted
  -- Example: '2.1' — allows re-prompt when ToS is updated

ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_platform       TEXT DEFAULT NULL;
  -- 'ios' | 'android' | 'web' — which platform the acceptance was given on

ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_ip_hash        TEXT DEFAULT NULL;
  -- SHA-256 hash of accepting IP address (not raw IP — privacy-preserving)
  -- Provides additional identity confirmation without storing PII

-- Acceptance audit log — immutable record of every acceptance event
-- (handles the case where a user accepts multiple ToS versions over time)
CREATE TABLE IF NOT EXISTS tos_acceptance_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  tos_version       TEXT    NOT NULL,
  accepted_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  platform          TEXT    DEFAULT NULL,    -- 'ios'|'android'|'web'
  ip_hash           TEXT    DEFAULT NULL,    -- SHA-256 of IP
  device_id         TEXT    DEFAULT NULL,    -- anonymized device fingerprint
  scroll_completed  INTEGER DEFAULT 1,       -- 1 = user scrolled to bottom
  checkbox_tos      INTEGER DEFAULT 1,       -- 1 = "I agree to ToS" checked
  checkbox_no_advice INTEGER DEFAULT 1,      -- 1 = "not legal advice" checked
  user_agent        TEXT    DEFAULT NULL     -- platform/version info
);

CREATE INDEX IF NOT EXISTS idx_tal_user    ON tos_acceptance_log(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_tal_version ON tos_acceptance_log(tos_version, accepted_at DESC);
