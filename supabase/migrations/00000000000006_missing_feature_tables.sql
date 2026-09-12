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


-- Additional missing feature tables
-- ability_to_pay (bail reform — Humphrey hearings, CA/NY)
CREATE TABLE IF NOT EXISTS ability_to_pay (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT,
  case_id      BIGINT,
  monthly_income DOUBLE PRECISION,
  dependents   BIGINT DEFAULT 0,
  assets_text  TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  BIGINT,
  determination TEXT
);


-- account_deletion_log
CREATE TABLE IF NOT EXISTS account_deletion_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  reason     TEXT,
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_by BIGINT,
  data_purged BOOLEAN DEFAULT FALSE
);


-- acquisition_leads
CREATE TABLE IF NOT EXISTS acquisition_leads (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT,
  source      TEXT,
  campaign    TEXT,
  referrer    TEXT,
  converted   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ai_daily_costs
CREATE TABLE IF NOT EXISTS ai_daily_costs (
  id          BIGSERIAL PRIMARY KEY,
  date        DATE UNIQUE,
  total_cost_usd DOUBLE PRECISION DEFAULT 0,
  request_count  BIGINT DEFAULT 0,
  token_count    BIGINT DEFAULT 0,
  by_tier     TEXT -- JSON: { free: X, pro: Y, ... }
);


-- ai_user_monthly_spend
CREATE TABLE IF NOT EXISTS ai_user_monthly_spend (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  month       TEXT, -- YYYY-MM
  cost_usd    DOUBLE PRECISION DEFAULT 0,
  token_count BIGINT DEFAULT 0,
  UNIQUE(user_id, month)
);


-- arrest_takedown_log
CREATE TABLE IF NOT EXISTS arrest_takedown_log (
  id           BIGSERIAL PRIMARY KEY,
  record_id    BIGINT,
  requestor    TEXT,
  reason       TEXT,
  taken_down_at TIMESTAMPTZ DEFAULT NOW(),
  taken_down_by BIGINT
);


-- cases_fts (full-text search index for cases)
CREATE TABLE IF NOT EXISTS cases_fts (
  id       BIGSERIAL PRIMARY KEY,
  case_id  BIGINT UNIQUE,
  content  TEXT, -- tsvector-ready text
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- cle_completions (CLE credit tracking for attorneys)
CREATE TABLE IF NOT EXISTS cle_completions (
  id          BIGSERIAL PRIMARY KEY,
  lawyer_id   BIGINT,
  course_id   BIGINT,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  credits     DOUBLE PRECISION DEFAULT 1.0,
  certificate_url TEXT
);


-- cle_courses
CREATE TABLE IF NOT EXISTS cle_courses (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT,
  provider    TEXT,
  credits     DOUBLE PRECISION DEFAULT 1.0,
  subject     TEXT,
  url         TEXT,
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- client_assignments
CREATE TABLE IF NOT EXISTS client_assignments (
  id          BIGSERIAL PRIMARY KEY,
  client_id   BIGINT,
  lawyer_id   BIGINT,
  case_id     BIGINT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  status      TEXT DEFAULT 'active',
  UNIQUE(client_id, lawyer_id, case_id)
);


-- codefendant_links
CREATE TABLE IF NOT EXISTS codefendant_links (
  id           BIGSERIAL PRIMARY KEY,
  case_id      BIGINT,
  user_id      BIGINT,
  codefendant_name TEXT,
  relationship TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- conflict_waivers
CREATE TABLE IF NOT EXISTS conflict_waivers (
  id          BIGSERIAL PRIMARY KEY,
  firm_id     BIGINT,
  matter_id   BIGINT,
  client_id   BIGINT,
  waiver_text TEXT,
  signed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- contract_redlines
CREATE TABLE IF NOT EXISTS contract_redlines (
  id          BIGSERIAL PRIMARY KEY,
  contract_id BIGINT,
  user_id     BIGINT,
  field       TEXT,
  original    TEXT,
  redlined    TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- contract_reviews
CREATE TABLE IF NOT EXISTS contract_reviews (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  document_url TEXT,
  analysis    TEXT,
  risk_score  BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- evidence_score (AI evidence strength assessment)
CREATE TABLE IF NOT EXISTS evidence_score (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT,
  score       DOUBLE PRECISION,
  factors     TEXT, -- JSON
  scored_at   TIMESTAMPTZ DEFAULT NOW(),
  scored_by   TEXT DEFAULT 'ai'
);


-- expungement_applications
CREATE TABLE IF NOT EXISTS expungement_applications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT,
  case_id       BIGINT,
  state         TEXT,
  charge_type   TEXT,
  status        TEXT DEFAULT 'draft',
  submitted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- firm_pricing_configs
CREATE TABLE IF NOT EXISTS firm_pricing_configs (
  id          BIGSERIAL PRIMARY KEY,
  firm_id     BIGINT UNIQUE,
  hourly_rate BIGINT, -- cents
  flat_fee    BIGINT, -- cents
  contingency_pct DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- firm_trials
CREATE TABLE IF NOT EXISTS firm_trials (
  id          BIGSERIAL PRIMARY KEY,
  firm_id     BIGINT UNIQUE,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  ends_at     TIMESTAMPTZ,
  converted   BOOLEAN DEFAULT FALSE
);


-- firm_upgrade_requests
CREATE TABLE IF NOT EXISTS firm_upgrade_requests (
  id          BIGSERIAL PRIMARY KEY,
  firm_id     BIGINT,
  requested_plan TEXT,
  reason      TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


-- last_active (session presence tracking)
CREATE TABLE IF NOT EXISTS last_active (
  user_id    BIGINT PRIMARY KEY,
  seen_at    TIMESTAMPTZ DEFAULT NOW(),
  device     TEXT,
  version    TEXT
);


-- lessons_fts (full-text search for bar prep lessons)
CREATE TABLE IF NOT EXISTS lessons_fts (
  id        BIGSERIAL PRIMARY KEY,
  lesson_id BIGINT UNIQUE,
  content   TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- material_support_screening (immigration — 8 U.S.C. § 1182)
CREATE TABLE IF NOT EXISTS material_support_screening (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  case_id     BIGINT,
  result      TEXT,
  screened_at TIMESTAMPTZ DEFAULT NOW(),
  screened_by BIGINT
);


-- password_resets
CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  token      TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- session_events
CREATE TABLE IF NOT EXISTS session_events (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT,
  user_id    BIGINT,
  event      TEXT,
  payload    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- soc2_controls (compliance tracking)
CREATE TABLE IF NOT EXISTS soc2_controls (
  id          BIGSERIAL PRIMARY KEY,
  control_id  TEXT UNIQUE,
  title       TEXT,
  status      TEXT DEFAULT 'not_started',
  evidence    TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT
);


-- translation_logs
CREATE TABLE IF NOT EXISTS translation_logs (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT,
  from_lang   TEXT,
  to_lang     TEXT,
  char_count  BIGINT DEFAULT 0,
  cost_usd    DOUBLE PRECISION DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);


COMMIT;
