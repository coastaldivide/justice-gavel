-- 00000000000002_recovered_tables.sql
--
-- Tables the application queries that the baseline schema does not create.
--
-- How this file was produced
-- ──────────────────────────
-- The baseline (00000000000000) creates 57 tables. A scan of every SQL string
-- literal in backend/src (routes, services, middleware — tests and CLI scripts
-- excluded) found 64 further tables referenced by live query paths and defined
-- only in the quarantined legacy migrations. Without them those routes fail at
-- runtime: firm/matter management, docket, check-ins, immigration trackers,
-- and the bondsman lead-purchase flow.
--
-- Each CREATE is lifted verbatim from the legacy migration that first defined
-- it, followed by every ALTER ... ADD COLUMN later files applied to it. Nothing
-- was invented. Statements are ordered so foreign keys resolve.
--
-- Verified: applies with 0 errors on PostgreSQL 16 against a database built
-- from 00000000000000 + 00000000000001.
--
--   psql "$DATABASE_URL" -f supabase/migrations/00000000000002_recovered_tables.sql
--
-- NOT INCLUDED — 6 bar-prep tables (bar_subjects, quiz_questions, quiz_sessions,
-- quiz_answers, spaced_repetition_state, study_streaks). They were written
-- against Supabase auth with UUID primary keys referencing auth.users, while
-- every other table in this app uses BIGSERIAL referencing public.users. The
-- two cannot be foreign-keyed together — that mismatch is what makes
-- 20260717000001_bar_prep_schema.sql fail. Reconciling it is a design decision,
-- not a mechanical fix. See RECOVERY_NOTES.md.
--
-- REVIEW BEFORE PRODUCTION. These definitions are recovered, not designed.
-- Check money column types against your intent, and note that the legacy RLS
-- file (20260714000001) failed with 365 errors and is not included — so these
-- tables have NO row-level security. The baseline tables do.

BEGIN;

-- Referenced by matters.firm_id and others; FK target only.
CREATE TABLE IF NOT EXISTS workspaces (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── case_events ───────────────────────────────────────────────
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

-- ── docket_entries ────────────────────────────────────────────
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
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS storage_path   TEXT;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS content_type   TEXT;

-- ── web_push_subscriptions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT,
  auth_key    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE web_push_subscriptions ADD COLUMN IF NOT EXISTS auth       TEXT;
ALTER TABLE web_push_subscriptions ADD COLUMN IF NOT EXISTS platform   TEXT;
ALTER TABLE web_push_subscriptions ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- ── case_messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_messages (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'user',
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'chat';

-- ── integration_external_ids ──────────────────────────────────
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

-- ── matters ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matters (
  id                 BIGSERIAL PRIMARY KEY,
  firm_id            BIGINT REFERENCES workspaces(id) ON DELETE CASCADE,
  client_name        TEXT    NOT NULL,
  client_email       TEXT,
  matter_number      TEXT,                    -- firm's internal reference
  title              TEXT    NOT NULL,
  matter_type        TEXT    DEFAULT 'criminal', -- criminal|civil|MDL|bankruptcy|constitutional|IP|antitrust
  status             TEXT    DEFAULT 'active',   -- active|closed|on_hold|settled|appealing
  state              TEXT,
  jurisdiction       TEXT,                    -- federal|state|international|multi-district
  charge             TEXT,
  bail_amount        BIGINT  DEFAULT 0,       -- in cents to avoid float issues
  bail_status        TEXT,                    -- set|denied|reduced|revoked|released
  capital_case       BOOLEAN DEFAULT FALSE,
  related_matter_id  BIGINT  REFERENCES matters(id),  -- MDL consolidation, linked cases
  co_defendant_count INTEGER DEFAULT 0,       -- J6: 1265, Enron: 29, etc.
  victim_count       INTEGER DEFAULT 0,       -- Madoff: 37000, Weinstein: 80, etc.
  court_date         TIMESTAMPTZ,
  next_court_date    TIMESTAMPTZ,
  hearing_time       TEXT,                    -- '09:00 AM CST' — specific time
  trial_start_date   TIMESTAMPTZ,
  trial_end_date     TIMESTAMPTZ,
  assigned_attorney_id BIGINT REFERENCES users(id),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── video_sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_sessions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT REFERENCES users(id) ON DELETE CASCADE,
  matter_id        BIGINT REFERENCES matters(id) ON DELETE SET NULL,
  attorney_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  daily_room_name  TEXT NOT NULL UNIQUE,
  daily_room_url   TEXT NOT NULL,
  topic            TEXT,
  scheduled_for    TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── aba_codes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aba_codes (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── ai_jobs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_jobs (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  type                           TEXT DEFAULT 'active',
  status                         TEXT DEFAULT 'active',
  input                          TEXT,
  output                         TEXT,
  completed_at                   TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── asylum_clocks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asylum_clocks (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  client_name                    TEXT,
  a_number                       INTEGER DEFAULT 0,
  clock_start                    TEXT,
  relief_type                    TEXT,
  country                        TEXT,
  detained                       TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── bop_exhaustion ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bop_exhaustion (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  client_name                    TEXT,
  bop_number                     INTEGER DEFAULT 0,
  facility                       TEXT,
  basis                          TEXT,
  qualifying_condition           TEXT,
  warden_request_date            TEXT,
  thirty_day_lapse_date          TEXT,
  status                         TEXT DEFAULT 'active',
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── calendar_push_events ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_push_events (
  id           BIGSERIAL PRIMARY KEY,
  connection_id                  BIGINT,
  docket_entry_id                BIGINT,
  external_uid                   TEXT,
  external_href                  TEXT,
  calendar_url                   TEXT,
  summary                        TEXT,
  dtstart                        TEXT,
  dtend                          TEXT,
  status                         TEXT DEFAULT 'active',
  sync_status                    TEXT,
  last_sync_at                   TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── case_assignments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_assignments (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE case_assignments
  ADD COLUMN IF NOT EXISTS accepted_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decline_reason        TEXT;

-- ── case_family_access ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_family_access (
  id           BIGSERIAL PRIMARY KEY,
  case_id                        BIGINT,
  user_id                        BIGINT,
  invited_by                     TEXT,
  role                           TEXT DEFAULT 'active',
  accepted                       BOOLEAN DEFAULT FALSE,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── checkin_enrollments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_enrollments (
  id           BIGSERIAL PRIMARY KEY,
  bondsman_id                    BIGINT,
  defendant_name                 TEXT,
  defendant_phone                TEXT,
  defendant_email                TEXT,
  case_number                    TEXT,
  court_date                     TEXT,
  check_in_freq                  TEXT,
  active                         BOOLEAN DEFAULT FALSE,
  monthly_fee_cents              BIGINT,
  stripe_sub_id                  BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS supervisor_note TEXT;
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS next_check_in_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS checkin_enrollments
  ADD COLUMN IF NOT EXISTS agency_id      TEXT,          -- pretrial services agency
  ADD COLUMN IF NOT EXISTS officer_id     TEXT,          -- supervising officer
  ADD COLUMN IF NOT EXISTS case_number    TEXT,
  ADD COLUMN IF NOT EXISTS court_date     DATE,
  ADD COLUMN IF NOT EXISTS conditions     JSONB,         -- court-ordered conditions
  ADD COLUMN IF NOT EXISTS enrolled_by    UUID,          -- who enrolled the defendant
  ADD COLUMN IF NOT EXISTS enrolled_at    TIMESTAMPTZ DEFAULT NOW();

-- ── contract_executions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_executions (
  id           BIGSERIAL PRIMARY KEY,
  contract_id                    BIGINT,
  user_id                        BIGINT,
  signer_name                    TEXT,
  signer_email                   TEXT,
  signed_at                      TIMESTAMPTZ,
  signature_method               TEXT,
  status                         TEXT DEFAULT 'active',
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── document_sync_map ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_sync_map (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── dpa_trackers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dpa_trackers (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  client_name                    TEXT,
  agency                         TEXT,
  investigation_type             TEXT,
  cooperation_level              TEXT,
  dpa_status                     TEXT,
  base_fine_cents                BIGINT,
  coop_discount_pct              TEXT,
  dpa_credit_pct                 TEXT,
  effective_fine_cents           BIGINT,
  wells_due                      TEXT,
  subpoena_due                   TEXT,
  dpa_sign_due                   TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── dual_sovereignty_flags ────────────────────────────────────
CREATE TABLE IF NOT EXISTS dual_sovereignty_flags (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  federal_nexus                  TEXT,
  state_case_status              TEXT,
  federal_investigation_known    TEXT,
  federal_agency                 TEXT,
  risk_level                     TEXT,
  petite_policy_applicable       TEXT,
  petite_policy_waiver_risk      TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── dv_firearm_surrender ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS dv_firearm_surrender (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  client_name                    TEXT,
  tro_tracker_id                 BIGINT,
  tro_issue_date                 TEXT,
  surrender_deadline             TEXT,
  surrender_to                   TEXT,
  firearms_count                 BIGINT,
  firearms_description           TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── ethics_wall_log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ethics_wall_log (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  screened_user_id               BIGINT,
  action                         TEXT,
  reason                         TEXT,
  set_by                         TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── family_connections ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_connections (
  id           BIGSERIAL PRIMARY KEY,
  arrest_id                      BIGINT,
  family_name                    TEXT,
  family_phone                   TEXT,
  family_email                   TEXT,
  status                         TEXT DEFAULT 'active',
  attorneys_sent                 TEXT,
  agents_sent                    TEXT,
  stripe_pi_id                   BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── firm_vertical_config ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_vertical_config (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  vertical                       TEXT DEFAULT 'active',
  bail_calc_enabled              TEXT,
  expunge_pipeline               TEXT,
  class_action_track             TEXT,
  sol_calendar                   TEXT,
  dpa_tracker                    TEXT,
  coop_credit_model              TEXT,
  tro_alerts                     TEXT,
  qdro_matching                  TEXT,
  asylum_clock                   TEXT,
  detention_alerts               TEXT,
  expert_matching                TEXT,
  damages_model                  TEXT,
  caseload_dashboard             TEXT,
  diversion_tracker              TEXT,
  aedpa_tracker                  TEXT,
  capital_flag                   TEXT,
  ucmj_taxonomy                  TEXT,
  clearance_workflow             TEXT,
  juvenile_expunge               TEXT,
  transfer_monitor               TEXT,
  updated_at                     TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── golden_gavel_log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golden_gavel_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  action                         TEXT,
  tier                           TEXT DEFAULT 'active',
  reason                         TEXT,
  criteria                       TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE golden_gavel_log ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE golden_gavel_log ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;
ALTER TABLE golden_gavel_log ADD COLUMN IF NOT EXISTS reference_id BIGINT;

-- ── hague_proceedings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hague_proceedings (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  child_name                     TEXT,
  child_dob                      TEXT,
  taking_parent                  TEXT,
  left_behind_parent             TEXT,
  removal_date                   TEXT,
  removal_country                TEXT,
  habitual_residence             TEXT,
  one_year_deadline              TEXT,
  within_one_year                INTEGER DEFAULT 0,
  settled_defense_risk           TEXT,
  grave_risk_defense             TEXT,
  child_objection                TEXT,
  human_rights_defense           TEXT,
  central_authority_contacted    TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── integration_connections ───────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_connections (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  user_id                        BIGINT,
  provider                       TEXT DEFAULT 'active',
  status                         TEXT DEFAULT 'active',
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── integration_sync_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_log (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  direction                      TEXT,
  entity_type                    TEXT DEFAULT 'active',
  entity_id                      BIGINT,
  external_id                    BIGINT,
  status                         TEXT DEFAULT 'active',
  records_sent                   TEXT,
  records_received               TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── lead_purchases ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_purchases (
  id           BIGSERIAL PRIMARY KEY,
  bondsman_id                    BIGINT,
  arrest_id                      BIGINT,
  bail_amount                    TEXT,
  lead_fee_cents                 BIGINT,
  status                         TEXT DEFAULT 'active',
  contact_revealed               TEXT,
  stripe_pi_id                   BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── matter_teams ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matter_teams (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  user_id                        BIGINT,
  role                           TEXT DEFAULT 'active',
  added_by                       TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── messages_fts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages_fts (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── mission_verification_requests ─────────────────────────────
CREATE TABLE IF NOT EXISTS mission_verification_requests (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  submitted_by                   TEXT,
  org_type                       TEXT,
  ein                            TEXT,
  website                        TEXT,
  documentation                  TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── motion_templates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS motion_templates (
  id           BIGSERIAL PRIMARY KEY,
  office_id                      BIGINT,
  motion_type                    TEXT DEFAULT 'active',
  title                          TEXT,
  content                        TEXT,
  notes                          TEXT,
  created_by                     TEXT,
  status                         TEXT DEFAULT 'active',
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── opt_outs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opt_outs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── outbound_messages ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbound_messages (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── past_due ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS past_due (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── payment_links ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_links (
  id           BIGSERIAL PRIMARY KEY,
  stripe_link_id                 BIGINT,
  stripe_link_url                TEXT,
  arrest_id                      BIGINT,
  recipient_phone                TEXT,
  recipient_type                 TEXT,
  recipient_id                   BIGINT,
  amount_cents                   BIGINT,
  status                         TEXT DEFAULT 'active',
  expires_at                     TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── plea_offers ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plea_offers (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  offered_date                   TEXT,
  expires_date                   TEXT,
  expires_time                   TEXT,
  charge_original                TEXT,
  charge_offered                 TEXT,
  sentence_rec                   TEXT,
  fine_cents                     BIGINT,
  probation_months               TEXT,
  prison_months_min              TEXT,
  prison_months_max              TEXT,
  plea_type                      TEXT,
  conditions                     TEXT,
  non_citizen                    TEXT,
  padilla_warning_given          TEXT,
  padilla_given_date             TEXT,
  padilla_consequences           TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── privilege_log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS privilege_log (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  matter_table                   TEXT,
  doc_number                     INTEGER DEFAULT 0,
  doc_date                       TEXT,
  doc_type                       TEXT,
  author                         TEXT,
  recipients                     TEXT,
  description                    TEXT,
  privilege_basis                TEXT,
  withheld                       TEXT,
  page_count                     BIGINT,
  ai_generated                   TEXT,
  created_by                     TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── refund_requests ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_requests (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  subscription_id                BIGINT,
  stripe_sub_id                  BIGINT,
  reason                         TEXT,
  additional_info                TEXT,
  days_since_charge              TEXT,
  auto_approve                   TEXT,
  status                         TEXT DEFAULT 'active',
  created_at                     TIMESTAMPTZ,
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── revenue_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_log (
  id           BIGSERIAL PRIMARY KEY,
  source                         TEXT DEFAULT 'active',
  recipient_type                 TEXT,
  arrest_id                      BIGINT,
  gross_cents                    BIGINT,
  stripe_fee_cents               BIGINT,
  net_cents                      BIGINT,
  stripe_link_id                 BIGINT,
  stripe_pi_id                   BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── role_permissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── scan_results ──────────────────────────────────────────────


-- ── sso_configurations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sso_configurations (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  provider                       TEXT DEFAULT 'active',
  entity_id                      BIGINT,
  sso_url                        TEXT,
  slo_url                        TEXT,
  certificate                    TEXT,
  attribute_email                TEXT,
  attribute_name                 TEXT,
  attribute_role                 TEXT,
  sp_entity_id                   BIGINT,
  sp_acs_url                     TEXT,
  force_sso                      TEXT,
  created_by                     TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── time_entries ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  matter_table                   TEXT,
  user_id                        BIGINT,
  entry_date                     TEXT,
  hours                          TEXT,
  rate_cents                     BIGINT,
  narrative                      TEXT,
  task_code                      TEXT,
  activity_code                  TEXT,
  billing_status                 TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS rate_cents INTEGER DEFAULT 25000;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS firm_id BIGINT;

-- ── tos_acceptance_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tos_acceptance_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  tos_version                    TEXT,
  accepted_at                    TIMESTAMPTZ,
  platform                       TEXT,
  ip_hash                        TEXT,
  device_id                      BIGINT,
  scroll_completed               TEXT,
  checkbox_tos                   TEXT,
  checkbox_no_advice             TEXT,
  user_agent                     TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── tro_trackers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tro_trackers (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  client_name                    TEXT,
  dv_flag                        TEXT,
  tro_filed                      TEXT,
  tro_hearing_due                TEXT,
  protective_order_due           TEXT,
  asset_tier                     TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── vertical_deadline_presets ─────────────────────────────────
CREATE TABLE IF NOT EXISTS vertical_deadline_presets (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── voluntary_departure ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS voluntary_departure (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  client_name                    TEXT,
  a_number                       INTEGER DEFAULT 0,
  order_date                     TEXT,
  departure_deadline             TEXT,
  departure_country              TEXT,
  bond_amount_cents              BIGINT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── vop_trackers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vop_trackers (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  original_matter_id             BIGINT,
  supervised_release_id          BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  client_name                    TEXT,
  violation_type                 TEXT,
  violation_date                 TEXT,
  violation_description          TEXT,
  detained_on_vop                TEXT,
  original_sentence_months       TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── webhook_subscriptions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  name                           TEXT,
  url                            TEXT,
  secret                         TEXT,
  events                         TEXT,
  active                         BOOLEAN DEFAULT FALSE,
  created_by                     TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- ── firm_members ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_members (
  id           BIGSERIAL PRIMARY KEY,
  firm_id      BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  firm_role    TEXT   NOT NULL DEFAULT 'member',
  invited_by   BIGINT,
  active       BOOLEAN DEFAULT TRUE,
  status       TEXT DEFAULT 'active',  -- text alias for active flag used in some routes
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── case_status_history ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_status_history (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL,
  user_id     BIGINT,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── checkin_records ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkin_records (
  id              BIGSERIAL PRIMARY KEY,
  enrollment_id   BIGINT NOT NULL,
  lat             NUMERIC(10,6),
  lng             NUMERIC(10,6),
  location_label  TEXT,
  selfie_url      TEXT,
  notes           TEXT,
  status          TEXT DEFAULT 'completed',
  device_info     TEXT,
  checked_in_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── firms ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firms (
  id               BIGSERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  owner_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vertical         TEXT,
  pricing_tier     TEXT DEFAULT 'starter',
  plan             TEXT DEFAULT 'trial',
  seat_limit       INTEGER DEFAULT 5,
  -- Discovery columns (also set by ALTER TABLE in 003)
  public_listing   BOOLEAN DEFAULT FALSE,
  accepting_clients BOOLEAN DEFAULT TRUE,
  free_consultation BOOLEAN DEFAULT FALSE,
  practice_areas   TEXT,
  website          TEXT,
  phone            TEXT,
  description      TEXT,
  referral_code    TEXT UNIQUE,
  city             TEXT,
  state            TEXT,
  -- Timestamps
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE firms ADD COLUMN IF NOT EXISTS public_listing      BOOLEAN DEFAULT FALSE;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS accepting_clients   BOOLEAN DEFAULT TRUE;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS free_consultation   BOOLEAN DEFAULT FALSE;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS practice_areas      TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS website             TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS phone               TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS description         TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS referral_code       TEXT UNIQUE DEFAULT UPPER(SUBSTRING(MD5(RANDOM()::TEXT), 1, 8));
ALTER TABLE firms ADD COLUMN IF NOT EXISTS city                TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS state               TEXT;

-- ── expungement_check_log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS expungement_check_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id     BIGINT REFERENCES cases(id) ON DELETE SET NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT DEFAULT 'screen_visit'  -- screen_visit | push_tapped | completed
);

-- ── ai_token_usage ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_token_usage (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  tier          TEXT DEFAULT 'free',
  model         TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      NUMERIC(10,6) DEFAULT 0,
  endpoint      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── bondsman_subscriptions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS bondsman_subscriptions (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier                 TEXT NOT NULL CHECK (tier IN ('starter','pro','market')),
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','past_due','cancelled','unpaid')),
  stripe_sub_id        TEXT,
  stripe_cus_id        TEXT,
  amount_cents         INTEGER NOT NULL,
  billing_period       TEXT DEFAULT 'monthly' CHECK (billing_period IN ('monthly','annual')),
  renews_at            TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── legal_content_versions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_content_versions (
  id               BIGSERIAL PRIMARY KEY,
  content_type     TEXT NOT NULL,   -- rag_static, expungement_rule, bar_prep_q, db_table
  content_key      TEXT NOT NULL,   -- miranda, TN, bail_schedules, etc.
  last_reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by      TEXT,            -- attorney name
  bar_number       TEXT,            -- bar number for verification
  bar_state        TEXT,
  notes            TEXT,
  review_count     INTEGER DEFAULT 1,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_type, content_key)
);

COMMIT;
