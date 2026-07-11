-- =============================================================================
-- Migration 004: All missing tables — generated from route code analysis
-- These tables are referenced in production routes but had no migration.
-- Schema inferred from INSERT statements, CREATE TABLE in SQLite fallbacks,
-- and column names in SELECT statements.
-- =============================================================================

-- ── aba_codes (used in: time.js) ──
CREATE TABLE IF NOT EXISTS aba_codes (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE aba_codes ENABLE ROW LEVEL SECURITY;

-- ── ability_to_pay (used in: firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS ability_to_pay (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  client_name                    TEXT,
  assessment_date                TEXT,
  fines_total_cents              BIGINT,
  restitution_total_cents        BIGINT,
  fees_total_cents               BIGINT,
  monthly_payment_required       TEXT,
  monthly_income_cents           BIGINT,
  monthly_expenses_cents         BIGINT,
  employed                       TEXT,
  employment_barriers            TEXT,
  dependents_count               BIGINT,
  receives_public_benefits       TEXT,
  assets_value_cents             BIGINT,
  can_pay_full                   TEXT,
  can_pay_partial                TEXT,
  genuinely_unable               TEXT,
  bearden_motion_filed           TEXT,
  bearden_motion_date            TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ability_to_pay ENABLE ROW LEVEL SECURITY;

-- ── acquisition_leads (used in: firm_acquisition.js) ──
CREATE TABLE IF NOT EXISTS acquisition_leads (
  id           BIGSERIAL PRIMARY KEY,
  email                          TEXT,
  firm_name                      TEXT,
  vertical                       TEXT DEFAULT 'active',
  org_size                       TEXT,
  message                        TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE acquisition_leads ENABLE ROW LEVEL SECURITY;

-- ── ai_jobs (used in: auth.js, discovery.js) ──
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

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

-- ── arrest_records (used in: arrests.js, billing/bondsman.js) ──
CREATE TABLE IF NOT EXISTS arrest_records (
id                 BIGSERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      booking_date       TEXT,
      charges            TEXT,
      bail_amount        REAL,
      court_date         TEXT,
      attorney_of_record TEXT,
      has_attorney       INTEGER DEFAULT 0,
      case_number        TEXT,
      jail_location      TEXT,
      county             TEXT,
      state              TEXT,
      source             TEXT,
      alert_sent         INTEGER DEFAULT 0,
      created_at         TEXT DEFAULT (datetime('now'
);
ALTER TABLE arrest_records ENABLE ROW LEVEL SECURITY;

-- ── asylum_clocks (used in: firm_verticals.js) ──
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

ALTER TABLE asylum_clocks ENABLE ROW LEVEL SECURITY;

-- ── attorney_profiles (used in: billing/pi_leads.js) ──
CREATE TABLE IF NOT EXISTS attorney_profiles (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE attorney_profiles ENABLE ROW LEVEL SECURITY;

-- ── bail_schedules (used in: bail.js) ──
CREATE TABLE IF NOT EXISTS bail_schedules (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE bail_schedules ENABLE ROW LEVEL SECURITY;

-- ── bop_exhaustion (used in: firm_verticals.js) ──
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

ALTER TABLE bop_exhaustion ENABLE ROW LEVEL SECURITY;

-- ── bot_runs (used in: webhooks/bot_admin.js) ──
CREATE TABLE IF NOT EXISTS bot_runs (
  id           BIGSERIAL PRIMARY KEY,
  run_type                       TEXT,
  arrests_found                  TEXT,
  messages_sent                  TEXT,
  leads_sold                     TEXT,
  revenue_cents                  BIGINT,
  errors                         TEXT,
  completed_at                   TIMESTAMPTZ,
  duration_ms                    BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bot_runs ENABLE ROW LEVEL SECURITY;

-- ── calendar_push_events (used in: docket.js, integrations/caldav.js) ──
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

ALTER TABLE calendar_push_events ENABLE ROW LEVEL SECURITY;

-- ── case_assignments (used in: attorney/cases.js, attorney/profile.js) ──
CREATE TABLE IF NOT EXISTS case_assignments (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE case_assignments ENABLE ROW LEVEL SECURITY;

-- ── case_family_access (used in: cases.js) ──
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

ALTER TABLE case_family_access ENABLE ROW LEVEL SECURITY;

-- ── cases_fts (used in: search.js) ──
CREATE TABLE IF NOT EXISTS cases_fts (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cases_fts ENABLE ROW LEVEL SECURITY;

-- ── checkin_enrollments (used in: checkins.js) ──
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

ALTER TABLE checkin_enrollments ENABLE ROW LEVEL SECURITY;

-- ── civil_lead_purchases (used in: pi_leads.js) ──
CREATE TABLE IF NOT EXISTS civil_lead_purchases (
  id           BIGSERIAL PRIMARY KEY,
  attorney_id                    BIGINT,
  lead_id                        BIGINT,
  lead_fee_cents                 BIGINT,
  status                         TEXT DEFAULT 'active',
  stripe_pi_id                   BIGINT,
  contact_revealed               TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE civil_lead_purchases ENABLE ROW LEVEL SECURITY;

-- ── civil_leads (used in: pi_leads.js) ──
CREATE TABLE IF NOT EXISTS civil_leads (
  id           BIGSERIAL PRIMARY KEY,
  lead_type                      TEXT,
  submitter_user_id              BIGINT,
  city                           TEXT,
  state                          TEXT,
  county                         TEXT,
  incident_type                  TEXT,
  incident_summary               TEXT,
  incident_date                  TEXT,
  injury_severity                TEXT,
  contact_name                   TEXT,
  contact_phone                  TEXT,
  contact_email                  TEXT,
  lead_fee_cents                 BIGINT,
  status                         TEXT DEFAULT 'active',
  expires_at                     TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE civil_leads ENABLE ROW LEVEL SECURITY;

-- ── cle_completions (used in: attorney/cle.js, attorney/profile.js) ──
CREATE TABLE IF NOT EXISTS cle_completions (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  course_id                      BIGINT,
  bar_number                     TEXT,
  credit_hours                   TEXT,
  certificate_id                 BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cle_completions ENABLE ROW LEVEL SECURITY;

-- ── cle_courses (used in: attorney/cle.js) ──
CREATE TABLE IF NOT EXISTS cle_courses (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE cle_courses ENABLE ROW LEVEL SECURITY;

-- ── codefendant_links (used in: firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS codefendant_links (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  created_by                     TEXT,
  matter_id_a                    TEXT,
  matter_id_b                    TEXT,
  codefendant_name_b             TEXT,
  codefendant_attorney_b         TEXT,
  link_type                      TEXT,
  indictment_number              INTEGER DEFAULT 0,
  jda_active                     TEXT,
  jda_date                       TEXT,
  jda_terms                      TEXT,
  codef_cooperation              TEXT,
  codef_cooperation_updated      TEXT,
  bruton_issue                   TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE codefendant_links ENABLE ROW LEVEL SECURITY;

-- ── collateral_consequences (used in: firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS collateral_consequences (
  id           BIGSERIAL PRIMARY KEY,
  ${cols.join('                  TEXT,
  '                              TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE collateral_consequences ENABLE ROW LEVEL SECURITY;

-- ── conflict_waivers (used in: conflicts.js) ──
CREATE TABLE IF NOT EXISTS conflict_waivers (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  matter_id                      BIGINT,
  conflicting_matter_id          BIGINT,
  adverse_party                  TEXT,
  client_party                   TEXT,
  conflict_type                  TEXT,
  waiver_text                    TEXT,
  authorized_by                  TEXT,
  client_consent                 TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conflict_waivers ENABLE ROW LEVEL SECURITY;

-- ── consultation_bookings (used in: consultations.js, golden_gavel.js) ──
CREATE TABLE IF NOT EXISTS consultation_bookings (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  lawyer_id                      BIGINT,
  lawyer_name                    TEXT,
  lawyer_phone                   TEXT,
  date_slot                      TEXT,
  time_slot                      TEXT,
  duration_min                   TEXT,
  platform_fee_cents             BIGINT,
  notes                          TEXT,
  status                         TEXT DEFAULT 'active',
  stripe_pi_id                   BIGINT,
  meeting_link                   TEXT,
  confirmed_at                   TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE consultation_bookings ENABLE ROW LEVEL SECURITY;

-- ── contract_executions (used in: contracts/draft.js, contracts/execution.js) ──
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

ALTER TABLE contract_executions ENABLE ROW LEVEL SECURITY;

-- ── contract_redlines (used in: contracts/draft.js, contracts/review.js) ──
CREATE TABLE IF NOT EXISTS contract_redlines (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  contract_id                    BIGINT,
  filename_original              TEXT,
  filename_revised               TEXT,
  changes                        TEXT,
  summary                        TEXT,
  risk_delta                     TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contract_redlines ENABLE ROW LEVEL SECURITY;

-- ── contract_reviews (used in: contracts/draft.js, contracts/execution.js) ──
CREATE TABLE IF NOT EXISTS contract_reviews (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  contract_id                    BIGINT,
  filename                       TEXT,
  risk_level                     TEXT,
  summary                        TEXT,
  red_flags                      TEXT,
  missing_clauses                TEXT,
  recommendations                TEXT,
  favorable_terms                TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contract_reviews ENABLE ROW LEVEL SECURITY;

-- ── courthouses (used in: courthouses.js) ──
CREATE TABLE IF NOT EXISTS courthouses (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE courthouses ENABLE ROW LEVEL SECURITY;

-- ── document_sync_map (used in: integrations/dms.js) ──
CREATE TABLE IF NOT EXISTS document_sync_map (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE document_sync_map ENABLE ROW LEVEL SECURITY;

-- ── dpa_trackers (used in: firm_verticals.js) ──
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

ALTER TABLE dpa_trackers ENABLE ROW LEVEL SECURITY;

-- ── dual_sovereignty_flags (used in: firm_verticals.js) ──
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

ALTER TABLE dual_sovereignty_flags ENABLE ROW LEVEL SECURITY;

-- ── dv_firearm_surrender (used in: firm_verticals.js) ──
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

ALTER TABLE dv_firearm_surrender ENABLE ROW LEVEL SECURITY;

-- ── ethics_wall_log (used in: conflicts.js) ──
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

ALTER TABLE ethics_wall_log ENABLE ROW LEVEL SECURITY;

-- ── eviction_trackers (used in: firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS eviction_trackers (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  created_by                     TEXT,
  client_name                    TEXT,
  landlord_name                  TEXT,
  property_address               TEXT,
  state                          TEXT,
  notice_type                    TEXT,
  notice_date                    TEXT,
  notice_period_days             TEXT,
  summons_served_date            TEXT,
  answer_deadline                TEXT,
  hearing_date                   TEXT,
  right_to_cure_deadline         TEXT,
  rent_owed_cents                BIGINT,
  rent_paid_cents                BIGINT,
  emergency_stay_filed           TEXT,
  hardship_protection_claimed    TEXT,
  defenses                       TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE eviction_trackers ENABLE ROW LEVEL SECURITY;

-- ── family_connections (used in: billing/connections.js, billing/consumer.js) ──
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

ALTER TABLE family_connections ENABLE ROW LEVEL SECURITY;

-- ── firm_invites (used in: firms.js) ──
CREATE TABLE IF NOT EXISTS firm_invites (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  email                          TEXT,
  role                           TEXT DEFAULT 'active',
  invited_by                     TEXT,
  token                          TEXT,
  expires_at                     TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE firm_invites ENABLE ROW LEVEL SECURITY;

-- ── firm_onboarding (used in: firm_acquisition.js) ──
CREATE TABLE IF NOT EXISTS firm_onboarding (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE firm_onboarding ENABLE ROW LEVEL SECURITY;

-- ── firm_pricing_configs (used in: firm_acquisition.js, firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS firm_pricing_configs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE firm_pricing_configs ENABLE ROW LEVEL SECURITY;

-- ── firm_trials (used in: firm_acquisition.js) ──
CREATE TABLE IF NOT EXISTS firm_trials (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  user_id                        BIGINT,
  vertical                       TEXT DEFAULT 'active',
  org_type                       TEXT,
  trial_start                    TEXT,
  trial_end                      TEXT,
  status                         TEXT DEFAULT 'active',
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE firm_trials ENABLE ROW LEVEL SECURITY;

-- ── firm_upgrade_requests (used in: firm_acquisition.js) ──
CREATE TABLE IF NOT EXISTS firm_upgrade_requests (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  requested_by                   TEXT,
  current_tier                   TEXT,
  target_tier                    TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE firm_upgrade_requests ENABLE ROW LEVEL SECURITY;

-- ── firm_vertical_config (used in: firm_verticals.js, matter_intelligence.js) ──
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

ALTER TABLE firm_vertical_config ENABLE ROW LEVEL SECURITY;

-- ── forum_posts (used in: forum.js) ──
CREATE TABLE IF NOT EXISTS forum_posts (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  category                       TEXT DEFAULT 'active',
  title                          TEXT,
  body                           TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;

-- ── golden_gavel_hall (used in: golden_gavel.js) ──
CREATE TABLE IF NOT EXISTS golden_gavel_hall (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE golden_gavel_hall ENABLE ROW LEVEL SECURITY;

-- ── golden_gavel_log (used in: golden_gavel.js) ──
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

ALTER TABLE golden_gavel_log ENABLE ROW LEVEL SECURITY;

-- ── hague_proceedings (used in: firm_verticals.js) ──
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

ALTER TABLE hague_proceedings ENABLE ROW LEVEL SECURITY;

-- ── integration_connections (used in: docket.js, integrations/caldav.js) ──
CREATE TABLE IF NOT EXISTS integration_connections (
  id           BIGSERIAL PRIMARY KEY,
  firm_id                        BIGINT,
  user_id                        BIGINT,
  provider                       TEXT DEFAULT 'active',
  status                         TEXT DEFAULT 'active',
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

-- ── integration_sync_log (used in: integrations/index.js, integrations/recap.js) ──
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

ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;

-- ── lead_purchases (used in: golden_gavel.js, billing/bondsman.js) ──
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

ALTER TABLE lead_purchases ENABLE ROW LEVEL SECURITY;

-- ── lessons_fts (used in: search.js) ──
CREATE TABLE IF NOT EXISTS lessons_fts (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE lessons_fts ENABLE ROW LEVEL SECURITY;

-- ── material_support_screening (used in: firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS material_support_screening (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  screened_by                    TEXT,
  client_name                    TEXT,
  screening_date                 TEXT,
  provided_money                 TEXT,
  provided_food                  TEXT,
  provided_shelter               TEXT,
  provided_transportation        TEXT,
  provided_communications        TEXT,
  provided_weapons               TEXT,
  provided_other                 TEXT,
  under_duress                   TEXT,
  duress_description             TEXT,
  organization_type              TEXT,
  organization_name              TEXT,
  bar_potentially_applicable     TEXT,
  duress_exception_available     TEXT,
  de_minimis_argument_available  TEXT,
  exemption_sought               TEXT,
  referred_to_specialist         TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE material_support_screening ENABLE ROW LEVEL SECURITY;

-- ── matter_events (used in: matters.js) ──
CREATE TABLE IF NOT EXISTS matter_events (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  user_id                        BIGINT,
  event_type                     TEXT DEFAULT 'active',
  title                          TEXT,
  description                    TEXT,
  event_date                     TEXT,
  amount_cents                   BIGINT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE matter_events ENABLE ROW LEVEL SECURITY;

-- ── matter_parties (used in: conflicts.js) ──
CREATE TABLE IF NOT EXISTS matter_parties (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE matter_parties ENABLE ROW LEVEL SECURITY;

-- ── matter_team_members (used in: conflicts.js) ──
CREATE TABLE IF NOT EXISTS matter_team_members (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE matter_team_members ENABLE ROW LEVEL SECURITY;

-- ── matter_teams (used in: audit.js, conflicts.js) ──
CREATE TABLE IF NOT EXISTS matter_teams (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  user_id                        BIGINT,
  role                           TEXT DEFAULT 'active',
  added_by                       TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE matter_teams ENABLE ROW LEVEL SECURITY;

-- ── messages_fts (used in: search.js) ──
CREATE TABLE IF NOT EXISTS messages_fts (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE messages_fts ENABLE ROW LEVEL SECURITY;

-- ── mission_verification_requests (used in: firm_verticals.js) ──
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

ALTER TABLE mission_verification_requests ENABLE ROW LEVEL SECURITY;

-- ── motion_history (used in: motions/export.js, motions/generate.js) ──
CREATE TABLE IF NOT EXISTS motion_history (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  case_id                        BIGINT,
  motion_type                    TEXT DEFAULT 'active',
  content                        TEXT,
  status                         TEXT DEFAULT 'active',
  jurisdiction                   TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE motion_history ENABLE ROW LEVEL SECURITY;

-- ── motion_templates (used in: attorney/templates.js) ──
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

ALTER TABLE motion_templates ENABLE ROW LEVEL SECURITY;

-- ── office_members (used in: attorney/cases.js, attorney/templates.js) ──
CREATE TABLE IF NOT EXISTS office_members (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE office_members ENABLE ROW LEVEL SECURITY;

-- ── opt_outs (used in: webhooks/bot_admin.js) ──
CREATE TABLE IF NOT EXISTS opt_outs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;

-- ── outbound_messages (used in: webhooks/bot_admin.js) ──
CREATE TABLE IF NOT EXISTS outbound_messages (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;

-- ── padilla_warnings (used in: firm_verticals.js) ──
CREATE TABLE IF NOT EXISTS padilla_warnings (
  id           BIGSERIAL PRIMARY KEY,
  matter_id                      BIGINT,
  firm_id                        BIGINT,
  given_by                       TEXT,
  client_name                    TEXT,
  a_number                       INTEGER DEFAULT 0,
  immigration_status             TEXT,
  warning_date                   TEXT,
  warning_method                 TEXT,
  interpreter_used               TEXT,
  interpreter_language           TEXT,
  explained_deportation          TEXT,
  explained_inadmissibility      TEXT,
  explained_lpr_loss             TEXT,
  explained_bar_to_relief        TEXT,
  explained_daca_impact          TEXT,
  explained_family_separation    TEXT,
  explained_naturalization_bar   TEXT,
  charge_is_aggravated_felony    TEXT,
  charge_is_crime_of_moral_turp  TEXT,
  charge_is_deportable           TEXT,
  client_acknowledged            TEXT,
  client_signature_obtained      TEXT,
  client_requested_time_to_consult TEXT,
  immigration_attorney_consulted TEXT,
  referred_to_immigration        TEXT,
  notes                          TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE padilla_warnings ENABLE ROW LEVEL SECURITY;

-- ── past_due (used in: billing/webhooks.js) ──
CREATE TABLE IF NOT EXISTS past_due (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE past_due ENABLE ROW LEVEL SECURITY;

-- ── payment_links (used in: webhooks/bot_admin.js) ──
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

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;

-- ── plea_offers (used in: firm_verticals.js) ──
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

ALTER TABLE plea_offers ENABLE ROW LEVEL SECURITY;

-- ── privilege_log (used in: privilege.js) ──
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

ALTER TABLE privilege_log ENABLE ROW LEVEL SECURITY;

-- ── recovery_agents (used in: recovery_agents.js) ──
CREATE TABLE IF NOT EXISTS recovery_agents (
  id           BIGSERIAL PRIMARY KEY,
  source_id                      BIGINT,
  name                           TEXT,
  city                           TEXT,
  state                          TEXT,
  phone                          TEXT,
  address                        TEXT,
  lat                            NUMERIC(12,4),
  lng                            NUMERIC(12,4),
  website                        TEXT,
  rating                         TEXT,
  reviews                        TEXT,
  hours                          TEXT,
  available_24_7                 TEXT,
  source                         TEXT DEFAULT 'active',
  active                         BOOLEAN DEFAULT FALSE,
  created_at                     TIMESTAMPTZ,
  updated_at                     TIMESTAMPTZ
);

ALTER TABLE recovery_agents ENABLE ROW LEVEL SECURITY;

-- ── refund_requests (used in: billing/subscriptions.js) ──
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

ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

-- ── revenue_log (used in: billing/connections.js, webhooks/bot_admin.js) ──
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

ALTER TABLE revenue_log ENABLE ROW LEVEL SECURITY;

-- ── role_permissions (used in: conflicts.js) ──
CREATE TABLE IF NOT EXISTS role_permissions (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- ── routehelpers (used in: admin.js) ──
CREATE TABLE IF NOT EXISTS routehelpers (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE routehelpers ENABLE ROW LEVEL SECURITY;

-- ── scan_results (used in: admin.js) ──
CREATE TABLE IF NOT EXISTS scan_results (
id BIGSERIAL PRIMARY KEY, scan_id TEXT, started_at TEXT,
      completed_at TEXT, elapsed_ms INTEGER, overall TEXT,
      summary_json TEXT, findings_json TEXT, created_at TEXT DEFAULT (datetime('now'
);
ALTER TABLE scan_results ENABLE ROW LEVEL SECURITY;

-- ── soc2_controls (used in: conflicts.js) ──
CREATE TABLE IF NOT EXISTS soc2_controls (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE soc2_controls ENABLE ROW LEVEL SECURITY;

-- ── sso_configurations (used in: conflicts.js, sso.js) ──
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

ALTER TABLE sso_configurations ENABLE ROW LEVEL SECURITY;

-- ── time_entries (used in: time.js, integrations/practice-mgmt.js) ──
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

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- ── tos_acceptance_log (used in: auth.js) ──
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

ALTER TABLE tos_acceptance_log ENABLE ROW LEVEL SECURITY;

-- ── translation_messages (used in: translate.js) ──
CREATE TABLE IF NOT EXISTS translation_messages (
  id           BIGSERIAL PRIMARY KEY,
  session_code                   TEXT,
  side                           TEXT,
  original                       TEXT,
  translated                     TEXT,
  src_lang                       TEXT,
  tgt_lang                       TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE translation_messages ENABLE ROW LEVEL SECURITY;

-- ── translation_sessions (used in: translate.js) ──
CREATE TABLE IF NOT EXISTS translation_sessions (
  id           BIGSERIAL PRIMARY KEY,
  code                           TEXT,
  defender_id                    BIGINT,
  lang_a                         TEXT,
  lang_b                         TEXT,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE translation_sessions ENABLE ROW LEVEL SECURITY;

-- ── tro_trackers (used in: firm_verticals.js) ──
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

ALTER TABLE tro_trackers ENABLE ROW LEVEL SECURITY;

-- ── verified_badge_subscriptions (used in: billing/bondsman.js) ──
CREATE TABLE IF NOT EXISTS verified_badge_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  user_id                        BIGINT,
  status                         TEXT DEFAULT 'active',
  stripe_sub_id                  BIGINT,
  stripe_cus_id                  BIGINT,
  amount_cents                   BIGINT,
  renews_at                      TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE verified_badge_subscriptions ENABLE ROW LEVEL SECURITY;

-- ── vertical_deadline_presets (used in: firm_verticals.js, matters.js) ──
CREATE TABLE IF NOT EXISTS vertical_deadline_presets (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vertical_deadline_presets ENABLE ROW LEVEL SECURITY;

-- ── voluntary_departure (used in: firm_verticals.js) ──
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

ALTER TABLE voluntary_departure ENABLE ROW LEVEL SECURITY;

-- ── vop_trackers (used in: firm_verticals.js) ──
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

ALTER TABLE vop_trackers ENABLE ROW LEVEL SECURITY;

-- ── webhook_deliveries (used in: webhooks/outbound.js) ──
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           BIGSERIAL PRIMARY KEY,
  subscription_id                BIGINT,
  event_type                     TEXT DEFAULT 'active',
  payload                        TEXT,
  response_status                TEXT,
  response_body                  TEXT,
  delivery_ms                    BIGINT,
  success                        BOOLEAN DEFAULT FALSE,
  created_at                     TIMESTAMPTZ DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- ── webhook_subscriptions (used in: webhooks/outbound.js) ──
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

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;

-- ── Column additions for column-mismatch fixes ────────────────────────────────
-- arrest_monitors: route uses watch_name and active, schema has name only
ALTER TABLE arrest_monitors ADD COLUMN IF NOT EXISTS watch_name TEXT;
ALTER TABLE arrest_monitors ADD COLUMN IF NOT EXISTS active     BOOLEAN DEFAULT TRUE;
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 30;
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS firm_name      TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS practice_type  TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS license_state  TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS counties       JSONB;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS max_lead_fee   BIGINT DEFAULT 0;
ALTER TABLE research_sessions ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE web_push_subscriptions ADD COLUMN IF NOT EXISTS auth       TEXT;
ALTER TABLE web_push_subscriptions ADD COLUMN IF NOT EXISTS platform   TEXT;
ALTER TABLE web_push_subscriptions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS role       TEXT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS content    TEXT;

-- ── Additional column fixes from Pass 5 scan ─────────────────────────────────

-- bondsman_profiles: route inserts geographic/business fields
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS license_state   TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS counties        JSONB;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS states          JSONB;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS min_bail_amount BIGINT DEFAULT 0;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS max_bail_amount BIGINT;

-- pi_leads: route inserts full case details
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS user_id       BIGINT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS incident_date TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS severity      TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS lat           NUMERIC(10,6);
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS lng           NUMERIC(10,6);
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS contact_name  TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'pending';

-- collateral_consequences: dynamic INSERT uses cols.join — needs dynamic schema
-- The route builds INSERT dynamically from validated field set
-- Add the most common columns referenced in the route
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS firm_id       BIGINT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS matter_id     BIGINT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS consequence   TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS category      TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS jurisdiction  TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS notes         TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'active';

-- ── 5 remaining missing tables found in v8.6.3 scan ──────────────────────────

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_firm_members_unique ON firm_members(firm_id, user_id);
CREATE INDEX        IF NOT EXISTS idx_firm_members_user   ON firm_members(user_id) WHERE active=true;
CREATE INDEX        IF NOT EXISTS idx_firm_members_firm   ON firm_members(firm_id) WHERE active=true;
ALTER TABLE firm_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS lesson_progress (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  lesson_id    BIGINT NOT NULL,
  completed    BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_progress_unique ON lesson_progress(user_id, lesson_id);
CREATE INDEX        IF NOT EXISTS idx_lesson_progress_user   ON lesson_progress(user_id);
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS provider_update_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_id   BIGINT NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  source      TEXT,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pul_table_record ON provider_update_log(table_name, record_id);
ALTER TABLE provider_update_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS case_status_history (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL,
  user_id     BIGINT,
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_csh_case ON case_status_history(case_id, changed_at DESC);
ALTER TABLE case_status_history ENABLE ROW LEVEL SECURITY;

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
CREATE INDEX IF NOT EXISTS idx_checkin_records_enrollment ON checkin_records(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_checkin_records_time       ON checkin_records(checked_in_at DESC);
ALTER TABLE checkin_records ENABLE ROW LEVEL SECURITY;
