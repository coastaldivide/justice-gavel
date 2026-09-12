-- 00000000000006_missing_feature_tables.sql
-- Tables queried by routes that were not in the 6-file consolidated chain.
-- Each table here causes a 500 error in the corresponding feature route.
-- These are non-core feature tables; the core product functions without them.
-- Applied after: 00000000000005_bar_prep_questions.sql

BEGIN;

-- ── ai_usage_log ─────────────────────────────────────────────────────────────
-- Tracks per-request AI token usage for cost monitoring
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  session_id  TEXT,
  model       TEXT,
  input_tokens  BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cost_usd    DOUBLE PRECISION DEFAULT 0,
  endpoint    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── alert_log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  alert_type TEXT,
  payload    TEXT,
  sent_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── callback_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS callback_requests (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  lawyer_id   BIGINT,
  phone       TEXT,
  notes       TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── civil_attorney_profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS civil_attorney_profiles (
  id               BIGSERIAL PRIMARY KEY,
  lawyer_id        BIGINT UNIQUE,
  practice_areas   TEXT,
  contingency_fee  BOOLEAN DEFAULT FALSE,
  free_consultation BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── collateral_consequences ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collateral_consequences (
  id          BIGSERIAL PRIMARY KEY,
  state       TEXT,
  charge_type TEXT,
  consequence TEXT,
  category    TEXT,
  source      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── conflict_index ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conflict_index (
  id        BIGSERIAL PRIMARY KEY,
  firm_id   BIGINT,
  name      TEXT,
  role      TEXT,
  matter_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── eviction_trackers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eviction_trackers (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  address    TEXT,
  status     TEXT DEFAULT 'active',
  court_date TIMESTAMPTZ,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── firm_invites ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_invites (
  id         BIGSERIAL PRIMARY KEY,
  firm_id    BIGINT,
  email      TEXT,
  role       TEXT DEFAULT 'member',
  token      TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── firm_onboarding ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_onboarding (
  id         BIGSERIAL PRIMARY KEY,
  firm_id    BIGINT UNIQUE,
  step       TEXT DEFAULT 'profile',
  completed  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── golden_gavel_hall ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_gavel_hall (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT UNIQUE,
  score      BIGINT DEFAULT 0,
  rank       TEXT,
  inducted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── hague_intakes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hague_intakes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  child_name TEXT,
  country    TEXT,
  status     TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── lawyer_profiles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lawyer_profiles (
  id               BIGSERIAL PRIMARY KEY,
  lawyer_id        BIGINT UNIQUE REFERENCES lawyers(id) ON DELETE CASCADE,
  verified_badge   BOOLEAN DEFAULT FALSE,
  tier             TEXT,
  bio_extended     TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── matter_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_events (
  id         BIGSERIAL PRIMARY KEY,
  matter_id  BIGINT,
  user_id    BIGINT,
  event_type TEXT,
  payload    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── matter_parties ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_parties (
  id        BIGSERIAL PRIMARY KEY,
  matter_id BIGINT,
  name      TEXT,
  role      TEXT,
  email     TEXT,
  phone     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── matter_team_members ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_team_members (
  id        BIGSERIAL PRIMARY KEY,
  matter_id BIGINT,
  user_id   BIGINT,
  role      TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(matter_id, user_id)
);

-- ── motion_history ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS motion_history (
  id         BIGSERIAL PRIMARY KEY,
  matter_id  BIGINT,
  user_id    BIGINT,
  motion_id  BIGINT,
  action     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── office_members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_members (
  id        BIGSERIAL PRIMARY KEY,
  office_id BIGINT,
  user_id   BIGINT,
  role      TEXT DEFAULT 'attorney',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(office_id, user_id)
);

-- ── padilla_warnings ─────────────────────────────────────────────────────────
-- Documents that immigration consequences were disclosed before plea (Padilla v. Kentucky)
CREATE TABLE IF NOT EXISTS padilla_warnings (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT,
  user_id     BIGINT,
  issued_by   BIGINT,
  content     TEXT,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── payment_history ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_history (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT,
  amount_cents   BIGINT,
  currency       TEXT DEFAULT 'usd',
  stripe_pi_id   TEXT,
  status         TEXT,
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── provider_update_log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_update_log (
  id          BIGSERIAL PRIMARY KEY,
  provider_id BIGINT,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  updated_by  BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── rights_cards ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rights_cards (
  id       BIGSERIAL PRIMARY KEY,
  topic    TEXT UNIQUE,
  title    TEXT,
  content  TEXT,
  state    TEXT,
  source   TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── scan_results ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_results (
  id          BIGSERIAL PRIMARY KEY,
  scan_type   TEXT,
  result      TEXT,
  action_taken TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── translation_messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS translation_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT,
  role        TEXT,
  content     TEXT,
  language    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── translation_sessions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS translation_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  language    TEXT,
  case_id     BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── user_badges ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_badges (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  badge_type TEXT,
  earned_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_type)
);

-- ── verified_badge_subscriptions ─────────────────────────────────────────────
-- Legacy table — superseded by bondsman_subscriptions but still queried
CREATE TABLE IF NOT EXISTS verified_badge_subscriptions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT UNIQUE,
  stripe_sub_id    TEXT,
  status           TEXT DEFAULT 'active',
  amount_cents     BIGINT DEFAULT 4900,
  badge_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── webhook_deliveries ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT,
  payload     TEXT,
  status      TEXT DEFAULT 'pending',
  attempts    BIGINT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── bot_runs ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_runs (
  id         BIGSERIAL PRIMARY KEY,
  bot_type   TEXT,
  status     TEXT DEFAULT 'running',
  records    BIGINT DEFAULT 0,
  error      TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at   TIMESTAMPTZ
);

COMMIT;
