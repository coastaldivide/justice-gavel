-- ══════════════════════════════════════════════════════════════
-- Justice Gavel — Complete Database Schema
-- Migration: 20260525000001_justice_gavel_schema
-- ══════════════════════════════════════════════════════════════

-- ── Users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    BIGSERIAL PRIMARY KEY,
  email                 TEXT UNIQUE,
  phone                 TEXT UNIQUE,
  login_identifier      TEXT UNIQUE,
  password_hash         TEXT NOT NULL,
  name                  TEXT,
  display_name          TEXT,
  role                  TEXT DEFAULT 'user',
  bar_number            TEXT,
  bar_verified          INTEGER DEFAULT 0,
  push_token            TEXT,
  is_premium            INTEGER DEFAULT 0,
  credit_cents          INTEGER DEFAULT 0,
  stripe_cus_id         TEXT,
  stripe_sub_id         TEXT,
  refresh_token_hash    TEXT,
  last_seen             TIMESTAMPTZ,
  account_status        TEXT DEFAULT 'active',
  failed_login_attempts INTEGER DEFAULT 0,
  lock_until            TIMESTAMPTZ,
  golden_gavel          INTEGER DEFAULT 0,
  golden_gavel_awarded_at TIMESTAMPTZ,
  golden_gavel_tier     TEXT,
  gavel_level           INTEGER DEFAULT 0,
  gavel_level_awarded_at TIMESTAMPTZ,
  gavel_bronze_at       TIMESTAMPTZ,
  gavel_silver_at       TIMESTAMPTZ,
  gavel_gold_at         TIMESTAMPTZ,
  gavel_platinum_at     TIMESTAMPTZ,
  notif_court_reminders INTEGER DEFAULT 1,
  notif_legal_tips      INTEGER DEFAULT 1,
  notif_arrest_alerts   INTEGER DEFAULT 1,
  notif_motion_updates  INTEGER DEFAULT 1,
  notif_checkin_reminders INTEGER DEFAULT 1,
  notif_expungement     INTEGER DEFAULT 1,
  avatar_url            TEXT,
  website               TEXT,
  bar_state             TEXT,
  firm_name             TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login_identifier);

-- ── Cases ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT DEFAULT 'open',
  state           TEXT,
  charge          TEXT,
  court_date      TEXT,
  next_court_date TEXT,
  attorney_id     BIGINT,
  notes           TEXT,
  offline_id      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id);

-- ── Case events / timeline ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_events (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT REFERENCES cases(id) ON DELETE CASCADE,
  matter_id   BIGINT,
  user_id     BIGINT REFERENCES users(id),
  title       TEXT NOT NULL,
  type        TEXT DEFAULT 'note',
  event_date  TEXT,
  location    TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Check-ins ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkins (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT REFERENCES users(id) ON DELETE CASCADE,
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  location_label TEXT,
  notes          TEXT,
  streak         INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id);

-- ── Family / emergency contacts ──────────────────────────────────
CREATE TABLE IF NOT EXISTS family_contacts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  relationship TEXT DEFAULT 'family',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scheduled push notifications ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT,
  push_token        TEXT,
  title             TEXT NOT NULL,
  body              TEXT,
  data              TEXT,
  deliver_at        TEXT NOT NULL,
  notification_type TEXT DEFAULT 'reminder',
  case_id           BIGINT,
  channelId         TEXT DEFAULT 'default',
  expo_ticket_id    TEXT,
  status            TEXT DEFAULT 'pending',
  sent_at           TIMESTAMPTZ,
  error             TEXT,
  max_retries       INTEGER DEFAULT 3,
  retry_count       INTEGER DEFAULT 0,
  priority          TEXT DEFAULT 'normal',
  delivered         INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pushes_deliver ON scheduled_pushes(deliver_at) WHERE status = 'pending';

-- ── Push tokens ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Saved lawyers ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_lawyers (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  provider_id BIGINT,
  name        TEXT,
  phone       TEXT,
  address     TEXT,
  specialties TEXT,
  rating      DOUBLE PRECISION,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Attorneys / lawyers ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lawyers (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  firm          TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  specialties   TEXT DEFAULT '["Criminal Defense"]',
  rating        DOUBLE PRECISION DEFAULT 4.5,
  review_count  INTEGER DEFAULT 0,
  bar_number    TEXT,
  bar_verified  INTEGER DEFAULT 0,
  free_consult  INTEGER DEFAULT 0,
  languages     TEXT DEFAULT '["English"]',
  bio           TEXT,
  photo_url     TEXT,
  website       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lawyers_state ON lawyers(state);

-- ── Bail agents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bail_agents (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  company       TEXT,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  rate_pct      DOUBLE PRECISION DEFAULT 10,
  rating        DOUBLE PRECISION DEFAULT 4.0,
  verified      INTEGER DEFAULT 0,
  available_now INTEGER DEFAULT 1,
  payment_plan  INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Consultations / bookings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultations (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT REFERENCES users(id),
  lawyer_id    BIGINT,
  duration_min INTEGER,
  fee_cents    INTEGER,
  date_slot    TEXT,
  time_slot    TEXT,
  notes        TEXT,
  status       TEXT DEFAULT 'pending',
  stripe_pi_id TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Reviews ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews_app (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  provider_id BIGINT,
  rating      INTEGER CHECK(rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Chat sessions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id),
  title      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_msgs_session ON chat_messages(session_id);

-- ── Legal research sessions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id),
  topic      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_messages (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT REFERENCES research_sessions(id) ON DELETE CASCADE,
  role       TEXT,
  content    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Motions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS motions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  motion_type TEXT,
  title       TEXT,
  draft       TEXT,
  fields      TEXT,
  status      TEXT DEFAULT 'draft',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Discovery analyses ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discovery_analyses (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  filename    TEXT,
  file_type   TEXT,
  summary     TEXT,
  issues      TEXT,
  risk_score  INTEGER,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── User subscriptions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT UNIQUE REFERENCES users(id),
  tier                TEXT DEFAULT 'free',
  stripe_cus_id       TEXT,
  stripe_sub_id       TEXT,
  status              TEXT DEFAULT 'active',
  current_period_end  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Arrest monitors ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arrest_monitors (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT,
  county     TEXT,
  state      TEXT,
  is_pro     INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PI leads ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pi_leads (
  id          BIGSERIAL PRIMARY KEY,
  case_type   TEXT,
  city        TEXT,
  state       TEXT,
  description TEXT,
  status      TEXT DEFAULT 'open',
  accepted_by BIGINT,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Bondsman profiles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bondsman_profiles (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT UNIQUE REFERENCES users(id),
  company_name      TEXT,
  license_number    TEXT,
  phone             TEXT,
  address           TEXT,
  state             TEXT,
  verified          INTEGER DEFAULT 0,
  stripe_cus_id     TEXT,
  payment_method_id TEXT,
  credit_cents      INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Golden Gavel ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_gavel (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT UNIQUE REFERENCES users(id),
  points     INTEGER DEFAULT 0,
  streak     INTEGER DEFAULT 0,
  opted_in   INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Offline cases (sync queue) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS offline_cases (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT,
  data       TEXT,
  synced     INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Docket entries ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS docket_entries (
  id          BIGSERIAL PRIMARY KEY,
  matter_id   BIGINT,
  firm_id     BIGINT,
  entry_date  TEXT,
  description TEXT,
  filing_type TEXT,
  due_date    TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Audit log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT,
  action        TEXT,
  resource_type TEXT,
  resource_id   TEXT,
  details       TEXT,
  ip            TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Expungement referrals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expungement_referrals (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  case_id    BIGINT,
  state      TEXT,
  partner    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════════

-- Sample attorneys
INSERT INTO lawyers (name, firm, phone, email, address, city, state, lat, lng, specialties, rating, free_consult)
VALUES
  ('James Thompson', 'Thompson Criminal Defense', '615-555-0101', 'j.thompson@tcdf.law', '100 Broadway', 'Nashville', 'TN', 36.1627, -86.7816, '["Criminal Defense","DUI"]', 4.8, 1),
  ('Maria Rodriguez', 'Rodriguez Law Firm', '615-555-0102', 'm.rodriguez@rlf.law', '200 Commerce St', 'Nashville', 'TN', 36.1595, -86.7784, '["Criminal Defense","Immigration"]', 4.7, 1),
  ('David Kim', 'Kim & Associates', '615-555-0103', 'd.kim@kimlaw.com', '300 Church St', 'Nashville', 'TN', 36.1610, -86.7798, '["Drug Offenses","Criminal Defense"]', 4.6, 0),
  ('Sarah Williams', 'Public Defense Group', '404-555-0201', 's.williams@pdg.law', '100 Peachtree', 'Atlanta', 'GA', 33.7490, -84.3880, '["Criminal Defense","Appeals"]', 4.9, 1),
  ('Robert Johnson', 'Johnson Criminal Law', '404-555-0202', 'r.johnson@jcl.law', '200 Spring St', 'Atlanta', 'GA', 33.7516, -84.3862, '["Criminal Defense","Bail"]', 4.5, 1),
  ('Lisa Chen', 'Chen Defense', '310-555-0301', 'l.chen@chendef.law', '100 Grand Ave', 'Los Angeles', 'CA', 34.0522, -118.2437, '["Criminal Defense","Drug Offenses"]', 4.7, 1),
  ('Michael Brown', 'Brown Law', '312-555-0401', 'm.brown@brownlaw.com', '100 Michigan Ave', 'Chicago', 'IL', 41.8781, -87.6298, '["Criminal Defense","DUI"]', 4.6, 1)
ON CONFLICT DO NOTHING;

-- Sample bail agents
INSERT INTO bail_agents (name, company, phone, address, city, state, lat, lng, rate_pct, rating, verified, available_now, payment_plan)
VALUES
  ('Fast Freedom Bail', 'Fast Freedom Bail Bonds', '615-555-1001', '101 Jefferson St', 'Nashville', 'TN', 36.168, -86.785, 10, 4.7, 1, 1, 1),
  ('Nashville Bail Co', 'Nashville Bail Company', '615-555-1002', '202 Rosa Parks Blvd', 'Nashville', 'TN', 36.168, -86.785, 8, 4.5, 1, 1, 0),
  ('ATL Bail Bonds', 'Atlanta Bail Bonds Inc', '404-555-2001', '200 Marietta St', 'Atlanta', 'GA', 33.753, -84.389, 10, 4.3, 1, 1, 1)
ON CONFLICT DO NOTHING;

-- ── Additional tables identified during functional audit ─────────────────────

CREATE TABLE IF NOT EXISTS hague_intakes (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id           TEXT,
  country_code      TEXT NOT NULL,
  child_name        TEXT NOT NULL,
  child_dob         DATE,
  left_on           DATE,
  retained_by       TEXT,
  petitioner_name   TEXT,
  petitioner_contact TEXT,
  status            TEXT NOT NULL DEFAULT 'intake',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT,
  auth_key    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_messages (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'user',
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_external_ids (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service         TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  access_token    TEXT,
  refresh_token   TEXT,
  expires_at      TIMESTAMPTZ,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, service)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id          BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Tables identified in second functional audit ─────────────────────────────

CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text search virtual tables (Postgres tsvector approach)
-- ── Full-Text Search views (Postgres — mirrors SQLite FTS5 query pattern) ────
-- search.js queries these as if they were FTS5 virtual tables
-- In Postgres we use tsvector + GIN indexes and expose them as views

CREATE OR REPLACE VIEW cases_fts AS
  SELECT id, title, status, user_id,
         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(status,'')) AS tsv
  FROM cases;

CREATE OR REPLACE VIEW lessons_fts AS
  SELECT id, title, category, body AS content, difficulty, duration_min,
         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(category,'')) AS tsv
  FROM lessons;

CREATE OR REPLACE VIEW messages_fts AS
  SELECT cm.id, cm.session_id, cm.content, cm.role, cm.user_id,
         to_tsvector('english', coalesce(cm.content,'')) AS tsv
  FROM chat_messages cm;

-- GIN indexes for efficient FTS queries
CREATE INDEX IF NOT EXISTS idx_cases_fts    ON cases    USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(status,'')));
CREATE INDEX IF NOT EXISTS idx_lessons_fts  ON lessons  USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')));
CREATE INDEX IF NOT EXISTS idx_messages_fts ON chat_messages USING gin(to_tsvector('english', coalesce(content,'')));

CREATE TABLE IF NOT EXISTS callback_requests (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lawyer_id     BIGINT,
  lawyer_name   TEXT NOT NULL,
  phone         TEXT,
  requested_at  TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS civil_attorney_profiles (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_cus_id       TEXT,
  payment_method_id   TEXT,
  bar_number          TEXT,
  practice_areas      TEXT[],
  accepts_pi          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_history (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL,
  description   TEXT,
  stripe_pi_id  TEXT,
  status        TEXT NOT NULL DEFAULT 'succeeded',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Refresh token store (single-use, rotated) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
