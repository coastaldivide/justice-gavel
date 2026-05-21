-- 021b_family_access.sql
-- Family case access — allows a family member with their own account
-- to view a case and participate in the messaging thread.
--
-- Roles:
--   'family'   — view case details, send/receive messages, cannot edit case
--   'support'  — same as family (for attorneys/advocates added manually)

CREATE TABLE IF NOT EXISTS case_family_access (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,           -- the family member's user_id
  invited_by INTEGER NOT NULL,           -- case owner user_id
  role       TEXT    DEFAULT 'family',   -- 'family' | 'support'
  accepted   INTEGER DEFAULT 0,          -- 1 when family member accepts
  invited_at TEXT    DEFAULT (datetime('now')),
  accepted_at TEXT   DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfa_unique   ON case_family_access(case_id, user_id);
CREATE INDEX        IF NOT EXISTS idx_cfa_user     ON case_family_access(user_id, accepted);
CREATE INDEX        IF NOT EXISTS idx_cfa_case     ON case_family_access(case_id);
