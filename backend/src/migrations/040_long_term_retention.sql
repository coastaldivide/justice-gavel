-- Migration 040: Long-Term Case Retention Infrastructure
-- ─────────────────────────────────────────────────────────────────────────────
-- Court cases drag on for months and years. This migration ensures every piece
-- of case data is preserved indefinitely, with explicit controls for archiving,
-- legal holds, subscription grace periods, and matter change history.
--
-- Tables added:
--   matter_versions         — immutable audit log of every matter field change
--   legal_holds             — freezes a matter/case from any deletion
--   docket_archive          — completed docket entries older than 90 days
--   firm_retention_policy   — per-firm retention settings (defaults: indefinite)
--   account_inactivity_log  — tracks accounts with no login in 90+ days
--
-- Columns added:
--   matters.archived_at     — null = active; set = archived (still readable)
--   matters.legal_hold      — 1 = frozen, cannot be deleted until released
--   cases.archived_at       — null = active; set = archived (still readable)
--   cases.legal_hold        — 1 = frozen, cannot be deleted
--   firms.subscription_grace_until — date subscription lapses into read-only mode
--   firms.data_export_requested_at — when GDPR export was last requested
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Matter version history ─────────────────────────────────────────────────
-- Every PATCH/PUT to a matter writes the previous values here before updating.
-- Attorneys can see who changed what and when — critical for multi-year cases
-- where strategies and facts evolve.

CREATE TABLE IF NOT EXISTS matter_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id     INTEGER NOT NULL,
  firm_id       INTEGER,
  changed_by    INTEGER NOT NULL,             -- user_id who made the change
  changed_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  change_type   TEXT    NOT NULL DEFAULT 'update',  -- 'create'|'update'|'status_change'|'archive'
  field_changes TEXT    NOT NULL,             -- JSON: {field: {from: old, to: new}}
  changed_via   TEXT    DEFAULT 'api'         -- 'api'|'import'|'system'|'migration'
);

CREATE INDEX IF NOT EXISTS idx_mv_matter    ON matter_versions(matter_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mv_firm      ON matter_versions(firm_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mv_user      ON matter_versions(changed_by, changed_at DESC);

-- ── 2. Legal holds ────────────────────────────────────────────────────────────
-- A legal hold prevents deletion of any record it references.
-- Applied to matters, cases, or entire firms during litigation preservation.
-- Must be explicitly released by a firm_admin.

CREATE TABLE IF NOT EXISTS legal_holds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hold_type     TEXT    NOT NULL,             -- 'matter'|'case'|'firm'|'user'
  target_id     INTEGER NOT NULL,             -- matter_id, case_id, firm_id, or user_id
  firm_id       INTEGER,
  applied_by    INTEGER NOT NULL,             -- user_id who applied the hold
  reason        TEXT    NOT NULL,             -- why the hold was applied
  applied_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  released_by   INTEGER DEFAULT NULL,         -- user_id who released it
  released_at   TEXT    DEFAULT NULL,
  active        INTEGER NOT NULL DEFAULT 1   -- 1=hold active, 0=released
);

CREATE INDEX IF NOT EXISTS idx_lh_target  ON legal_holds(hold_type, target_id, active);
CREATE INDEX IF NOT EXISTS idx_lh_firm    ON legal_holds(firm_id, active);

-- ── 3. Docket archive ─────────────────────────────────────────────────────────
-- Completed docket entries older than 90 days are moved here by the nightly job.
-- This keeps the active docket_entries table clean and fast while preserving
-- the full historical record. Archive entries are read-only.

CREATE TABLE IF NOT EXISTS docket_archive (
  id              INTEGER PRIMARY KEY,        -- original docket_entries.id preserved
  matter_id       INTEGER,
  firm_id         INTEGER,
  title           TEXT    NOT NULL,
  entry_type      TEXT,
  due_date        TEXT,
  due_time        TEXT,
  completed_at    TEXT,
  priority        TEXT,
  status          TEXT,
  notes           TEXT,
  assigned_to     INTEGER,
  original_created_at TEXT,
  archived_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_da_matter   ON docket_archive(matter_id, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_da_firm     ON docket_archive(firm_id, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_da_archived ON docket_archive(archived_at DESC);

-- ── 4. Firm retention policy ──────────────────────────────────────────────────
-- Each firm can configure its retention preferences.
-- Default: INDEFINITE for all legal data — never delete without explicit action.
-- Firms may set shorter retention if required by their jurisdiction.
-- IMPORTANT: these are MINIMUMS from the firm's perspective, not maximums.
-- The platform never deletes data before these periods expire.

CREATE TABLE IF NOT EXISTS firm_retention_policy (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id                 INTEGER NOT NULL UNIQUE,
  -- Retention periods in days. NULL = indefinite (default).
  matters_retain_days     INTEGER DEFAULT NULL,   -- NULL = keep forever
  cases_retain_days       INTEGER DEFAULT NULL,   -- NULL = keep forever
  messages_retain_days    INTEGER DEFAULT NULL,   -- NULL = keep forever
  docket_archive_days     INTEGER DEFAULT 90,     -- move completed entries after 90 days
  -- Grace period after subscription lapses (read-only mode, no deletion)
  grace_period_days       INTEGER DEFAULT 30,
  -- Notify attorney this many days before any data would be purged
  purge_warning_days      INTEGER DEFAULT 30,
  -- Legal hold overrides all retention periods (cannot delete anything with a hold)
  honor_legal_holds       INTEGER DEFAULT 1,      -- always 1 — legal holds are never optional
  -- Audit
  updated_by              INTEGER,
  updated_at              TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_frp_firm ON firm_retention_policy(firm_id);

-- Seed: default policy (indefinite) for any firms created before this migration
-- This INSERT will be skipped for firms that already have a policy.
-- The application layer creates a row on firm creation going forward.

-- ── 5. Subscription grace period columns ──────────────────────────────────────
-- When a subscription lapses, the firm enters read-only mode for grace_period_days.
-- During grace period: existing matters/cases are readable but no new creation.
-- After grace period expires AND firm has not resubscribed: read-only continues
-- indefinitely — data is NEVER automatically deleted on subscription lapse.

ALTER TABLE firms ADD COLUMN IF NOT EXISTS subscription_grace_until TEXT DEFAULT NULL;
  -- NULL = active subscription or grace period not started
  -- Date = last day of read-only access after which admin must contact support

ALTER TABLE firms ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active';
  -- 'active' | 'trialing' | 'grace' | 'lapsed' | 'cancelled'
  -- 'lapsed': past grace period — read-only, no new matters/trackers
  -- Data is NEVER deleted on any subscription status

ALTER TABLE firms ADD COLUMN IF NOT EXISTS data_export_requested_at TEXT DEFAULT NULL;
  -- When the firm last requested a GDPR/data export

-- ── 6. Matter and case preservation flags ─────────────────────────────────────

ALTER TABLE matters ADD COLUMN IF NOT EXISTS archived_at   TEXT    DEFAULT NULL;
  -- NULL = active; date = archived (fully readable, read-only)
  -- Archive does NOT delete — it removes from active dashboard views only

ALTER TABLE matters ADD COLUMN IF NOT EXISTS legal_hold    INTEGER DEFAULT 0;
  -- 1 = frozen — DELETE will be rejected until hold is released by firm_admin

ALTER TABLE matters ADD COLUMN IF NOT EXISTS closed_reason TEXT    DEFAULT NULL;
  -- Why this matter was closed: 'resolved'|'settled'|'dismissed'|'transferred'|'declined'

ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_at     TEXT    DEFAULT NULL;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legal_hold      INTEGER DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS closed_reason   TEXT    DEFAULT NULL;

-- ── 7. Account inactivity tracking ───────────────────────────────────────────
-- When a user hasn't logged in for 90 days, we track this to:
--   1. Alert the firm_admin that the account has active data
--   2. Prompt data export before any voluntary deletion
-- We never automatically delete data due to inactivity.

CREATE TABLE IF NOT EXISTS account_inactivity_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  firm_id         INTEGER,
  last_seen_at    TEXT    NOT NULL,
  days_inactive   INTEGER NOT NULL,
  alert_sent_at   TEXT    DEFAULT NULL,       -- when we notified the admin
  alert_type      TEXT    DEFAULT '90_day',   -- '90_day'|'180_day'|'1_year'
  matters_count   INTEGER DEFAULT 0,
  cases_count     INTEGER DEFAULT 0,
  logged_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ail_user   ON account_inactivity_log(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_ail_firm   ON account_inactivity_log(firm_id, logged_at DESC);

-- ── 8. Performance indexes for long-running matter queries ────────────────────
-- As matters accumulate over years, these indexes keep queries fast.

CREATE INDEX IF NOT EXISTS idx_matters_firm_status   ON matters(firm_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_matters_firm_vertical ON matters(firm_id, vertical, status);
CREATE INDEX IF NOT EXISTS idx_matters_archived      ON matters(firm_id, archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_legal_hold    ON matters(legal_hold) WHERE legal_hold = 1;
CREATE INDEX IF NOT EXISTS idx_cases_user_status     ON cases(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_archived        ON cases(user_id, archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_legal_hold      ON cases(legal_hold) WHERE legal_hold = 1;

-- ── 9. Matter version index ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mv_matter_field ON matter_versions(matter_id, changed_at DESC);
