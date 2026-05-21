-- Migration 043: Tables referenced in routes but not in any migration
-- Fixes runtime crashes when these routes execute

-- recovery_agents: bail enforcement agents (referenced in recovery_agents.js)
CREATE TABLE IF NOT EXISTS recovery_agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  company       TEXT,
  state         TEXT    NOT NULL,
  city          TEXT    NOT NULL,
  phone         TEXT,
  email         TEXT,
  license_num   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  lat           REAL,
  lng           REAL,
  source        TEXT    DEFAULT 'seed',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recovery_agents_state ON recovery_agents(state);

-- feedback: user feedback / bug reports (referenced in feedback.js)
CREATE TABLE IF NOT EXISTS feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT    NOT NULL DEFAULT 'general',  -- 'bug','feature','rating','general'
  rating        INTEGER,  -- 1-5
  body          TEXT    NOT NULL,
  screen        TEXT,    -- which screen it came from
  app_version   TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- firm_invites: pending firm membership invitations (referenced in firms.js)
CREATE TABLE IF NOT EXISTS firm_invites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id       INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email         TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'associate',
  token         TEXT    NOT NULL UNIQUE,
  invited_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accepted_at   DATETIME,
  expires_at    DATETIME NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_firm_invites_token ON firm_invites(token);
CREATE INDEX IF NOT EXISTS idx_firm_invites_firm ON firm_invites(firm_id);

-- account_deletion_log: GDPR right to erasure audit trail (referenced in auth.js)
CREATE TABLE IF NOT EXISTS account_deletion_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,   -- kept after deletion for audit
  email_hash    TEXT,      -- hashed email for uniqueness enforcement
  reason        TEXT,
  deleted_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ai_jobs: async AI job queue (referenced in auth.js for job status checks)
CREATE TABLE IF NOT EXISTS ai_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL,  -- 'motion','research','review','translate'
  status        TEXT    NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
  input         TEXT,   -- JSON
  output        TEXT,   -- JSON result
  error         TEXT,
  started_at    DATETIME,
  completed_at  DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs(user_id, status);
