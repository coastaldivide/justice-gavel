-- Migration 037: Firm Vertical Expansion
-- Adds: firm_vertical (practice-area taxonomy), firm_pricing_tier (mission pricing),
--       firm_deadlines (per-vertical deadline presets), firm_onboarding_flags,
--       firm_vulnerability_log (VAR-C tracking), matter_evidence_score (VAR-D tracking)

-- ── 1. Extend firms table with vertical + pricing tier ───────────────────────
ALTER TABLE firms ADD COLUMN IF NOT EXISTS vertical         TEXT DEFAULT 'general';
  -- criminal_defense | civil_rights | white_collar | family | immigration
  -- personal_injury  | public_defense | appellate | military | juvenile | general
ALTER TABLE firms ADD COLUMN IF NOT EXISTS pricing_tier     TEXT DEFAULT 'standard';
  -- standard | mission | government | enterprise
ALTER TABLE firms ADD COLUMN IF NOT EXISTS mission_verified INTEGER DEFAULT 0;
  -- 1 = nonprofit / gov verified — unlocks mission pricing
ALTER TABLE firms ADD COLUMN IF NOT EXISTS seat_limit       INTEGER DEFAULT 10;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS features_json    TEXT    DEFAULT '{}';
  -- JSON blob: {"asylum_clock":true, "dpa_tracker":true, ...}

-- ── 2. Firm vertical configs (one row per firm, stores vertical-specific settings) ──
CREATE TABLE IF NOT EXISTS firm_vertical_config (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id             INTEGER NOT NULL UNIQUE REFERENCES firms(id) ON DELETE CASCADE,
  vertical            TEXT    NOT NULL DEFAULT 'general',
  -- Criminal Defense
  bail_calc_enabled   INTEGER DEFAULT 0,
  expunge_pipeline    INTEGER DEFAULT 0,
  -- Civil Rights
  class_action_track  INTEGER DEFAULT 0,
  sol_calendar        INTEGER DEFAULT 0,
  -- White Collar
  dpa_tracker         INTEGER DEFAULT 0,
  coop_credit_model   INTEGER DEFAULT 0,
  -- Family
  tro_alerts          INTEGER DEFAULT 0,
  qdro_matching       INTEGER DEFAULT 0,
  -- Immigration
  asylum_clock        INTEGER DEFAULT 0,
  detention_alerts    INTEGER DEFAULT 0,
  -- Personal Injury
  expert_matching     INTEGER DEFAULT 0,
  damages_model       INTEGER DEFAULT 0,
  -- Public Defense
  caseload_dashboard  INTEGER DEFAULT 0,
  diversion_tracker   INTEGER DEFAULT 0,
  -- Appellate
  aedpa_tracker       INTEGER DEFAULT 0,
  capital_flag        INTEGER DEFAULT 0,
  -- Military
  ucmj_taxonomy       INTEGER DEFAULT 0,
  clearance_workflow  INTEGER DEFAULT 0,
  -- Juvenile
  juvenile_expunge    INTEGER DEFAULT 0,
  transfer_monitor    INTEGER DEFAULT 0,
  created_at          TEXT    DEFAULT (datetime('now')),
  updated_at          TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fvc_firm ON firm_vertical_config(firm_id);
CREATE INDEX IF NOT EXISTS idx_fvc_vert ON firm_vertical_config(vertical);

-- ── 3. Firm pricing tier configs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS firm_pricing_configs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tier_key        TEXT    NOT NULL UNIQUE,  -- standard|mission|government|enterprise
  display_name    TEXT    NOT NULL,
  monthly_cents   INTEGER NOT NULL,
  annual_cents    INTEGER NOT NULL,
  seat_limit      INTEGER DEFAULT 10,
  matter_limit    INTEGER DEFAULT 500,
  ai_calls_daily  INTEGER DEFAULT 100,
  description     TEXT,
  active          INTEGER DEFAULT 1,
  created_at      TEXT    DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO firm_pricing_configs
  (tier_key, display_name, monthly_cents, annual_cents, seat_limit, matter_limit, ai_calls_daily, description)
VALUES
  ('standard',    'Standard',           19900,  19900*10, 25,   2000, 200,  'Full platform for commercial law firms'),
  ('mission',     'Mission',             4900,   4900*10,  15,    999, 100, 'Nonprofit and public defender offices — verified 501(c)(3) or public institution required'),
  ('government',  'Government',          9900,   9900*10,  50,  9999, 300,  'Government agencies, public defender consortia, court-administered programs'),
  ('enterprise',  'Enterprise',         49900,  49900*10, 999, 99999, 999, 'Large firms and institutional deployments — custom seat limits available');

-- ── 4. Vertical deadline presets (lookup table for docket engine) ─────────────
CREATE TABLE IF NOT EXISTS vertical_deadline_presets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vertical      TEXT    NOT NULL,
  rule_key      TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  days          INTEGER NOT NULL,
  business_days INTEGER DEFAULT 0,  -- 1 = business days, 0 = calendar
  priority      TEXT    DEFAULT 'high',
  description   TEXT,
  UNIQUE(vertical, rule_key)
);

INSERT OR IGNORE INTO vertical_deadline_presets
  (vertical, rule_key, label, days, business_days, priority, description)
VALUES
  -- Criminal Defense
  ('criminal_defense','bail',         'Bail Hearing',         1,  0, 'critical', 'First appearance / bail hearing'),
  ('criminal_defense','arraignment',  'Arraignment',          3,  1, 'critical', 'Formal reading of charges'),
  ('criminal_defense','prelim',       'Preliminary Hearing',  14, 0, 'high',     'Probable cause determination'),
  ('criminal_defense','speedy',       'Speedy Trial Deadline',70, 0, 'high',     '70-day Speedy Trial Act window'),
  ('criminal_defense','indictment',   'Grand Jury Indictment',30, 0, 'high',     'Federal indictment deadline'),
  ('criminal_defense','appeal_fed',   'Federal Appeal',       14, 0, 'normal',   'Notice of appeal — federal conviction'),
  ('criminal_defense','appeal_state', 'State Appeal',         30, 0, 'normal',   'Notice of appeal — state conviction'),
  -- Civil Rights
  ('civil_rights','answer',       'Answer Due',           21,  0, 'critical', 'FRCP Rule 12 — answer to complaint'),
  ('civil_rights','initial_disc', 'Initial Disclosures',  35,  0, 'high',     'FRCP 26(a)(1) initial disclosures'),
  ('civil_rights','class_motion', 'Class Cert Motion',    90,  0, 'critical', 'Motion for class certification'),
  ('civil_rights','discovery',    'Discovery Close',      120, 0, 'high',     'Close of fact discovery'),
  ('civil_rights','appeal',       'Appeal Deadline',      30,  0, 'normal',   'Notice of appeal — civil'),
  ('civil_rights','sol',          'SOL Expiration',       730, 0, 'critical', '2-year § 1983 statute of limitations'),
  -- White Collar
  ('white_collar','wells',        'Wells Notice Response',30, 0, 'critical', 'SEC Wells Notice response window'),
  ('white_collar','subpoena',     'Subpoena Compliance',  21, 1, 'critical', 'DOJ grand jury subpoena compliance'),
  ('white_collar','target_ltr',   'Target Letter Response',30,0, 'high',     'Response to DOJ target letter'),
  ('white_collar','exam_resp',    'SEC Exam Response',    30, 0, 'high',     'SEC examination document response'),
  -- Family Law
  ('family','tro',          'TRO Hearing',          3,   1, 'critical', 'Emergency TRO — domestic violence'),
  ('family','answer',       'Answer Due',           30,  0, 'high',     'Response to petition'),
  ('family','discovery',    'Discovery Deadline',   120, 0, 'high',     'Family law discovery close'),
  ('family','trial_set',    'Trial Setting',        180, 0, 'normal',   'Trial setting conference'),
  -- Immigration
  ('immigration','bia_appeal',  'BIA Appeal',       30, 0, 'critical', 'Board of Immigration Appeals — 30-day deadline'),
  ('immigration','master_cal',  'Master Calendar',  90, 0, 'high',     'Master calendar hearing (typical)'),
  ('immigration','circuit',     'Circuit Petition', 30, 0, 'normal',   'Circuit court petition for review — after BIA'),
  -- Personal Injury
  ('personal_injury','answer',   'Answer Due',       30,  0, 'critical', 'Defendant answer — PI'),
  ('personal_injury','expert',   'Expert Disclosure',120, 0, 'high',     'Expert witness disclosure deadline'),
  ('personal_injury','discovery','Discovery Close',  150, 0, 'high',     'Fact discovery close'),
  ('personal_injury','sol_2yr',  'SOL 2-Year',       730, 0, 'critical', '2-year PI statute of limitations'),
  ('personal_injury','sol_3yr',  'SOL 3-Year (Med Mal)',1095,0,'critical','3-year medical malpractice SOL'),
  -- Public Defense
  ('public_defense','bail',       'Bail Hearing',         1,  0, 'critical', 'First appearance'),
  ('public_defense','arraignment','Arraignment',          3,  1, 'critical', 'Arraignment hearing'),
  ('public_defense','suppression','Suppression Motion',   14, 1, 'high',     'Motion to suppress deadline'),
  ('public_defense','prelim',     'Preliminary Hearing',  14, 0, 'high',     'Preliminary examination'),
  ('public_defense','speedy',     'Speedy Trial',         70, 0, 'normal',   '70-day speedy trial window'),
  -- Appellate
  ('appellate','direct_fed',  'Direct Appeal (Fed)',  14,  0, 'critical', 'Federal conviction — notice of appeal'),
  ('appellate','direct_state','Direct Appeal (State)',30,  0, 'critical', 'State conviction — notice of appeal'),
  ('appellate','cert',        'Cert Petition',        90,  0, 'high',     'SCOTUS certiorari petition'),
  ('appellate','aedpa',       'AEDPA Deadline',       365, 0, 'critical', '28 U.S.C. § 2254/2255 — 1-year AEDPA bar'),
  -- Military
  ('military','art32',       'Article 32 Hearing',   5,   1, 'critical', 'Preliminary hearing under Article 32 UCMJ'),
  ('military','arraignment', 'Court-Martial Arraign',8,   1, 'critical', 'Court-martial arraignment'),
  ('military','discovery',   'Military Discovery',   30,  0, 'high',     'Discovery in court-martial proceedings'),
  ('military','speedy',      'Military Speedy Trial',120, 0, 'normal',   'RCM 707 speedy trial — 120 days'),
  -- Juvenile
  ('juvenile','detention',   'Detention Hearing',    1,   1, 'critical', 'Juvenile detention hearing — 1 business day'),
  ('juvenile','jurisdiction','Jurisdiction Hearing', 15,  1, 'critical', 'Jurisdictional / adjudication hearing'),
  ('juvenile','review',      'Disposition Review',   180, 0, 'high',     'Periodic case review hearing'),
  ('juvenile','perm_plan',   'Permanency Plan',      365, 0, 'normal',   'Annual permanency planning hearing');

CREATE INDEX IF NOT EXISTS idx_vdp_vertical ON vertical_deadline_presets(vertical);

-- ── 5. Asylum clock tracker (per-client, per-firm) ───────────────────────────
CREATE TABLE IF NOT EXISTS asylum_clocks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id       INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id     INTEGER REFERENCES matters(id) ON DELETE CASCADE,
  client_name   TEXT    NOT NULL,
  a_number      TEXT,  -- Alien Registration Number (masked on display)
  clock_start   TEXT    NOT NULL,  -- ISO date: date asylum application filed
  clock_paused  INTEGER DEFAULT 0,
  paused_days   INTEGER DEFAULT 0,
  relief_type   TEXT    DEFAULT 'asylum',
  country       TEXT,
  detained      INTEGER DEFAULT 0,
  notes         TEXT,
  created_at    TEXT    DEFAULT (datetime('now')),
  updated_at    TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ac_firm   ON asylum_clocks(firm_id);
CREATE INDEX IF NOT EXISTS idx_ac_matter ON asylum_clocks(matter_id);

-- ── 6. DPA / Cooperation tracker (white-collar) ──────────────────────────────
CREATE TABLE IF NOT EXISTS dpa_trackers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id         INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id       INTEGER REFERENCES matters(id) ON DELETE CASCADE,
  client_name     TEXT    NOT NULL,
  agency          TEXT,  -- DOJ | SEC | FinCEN | HHS-OIG | etc.
  investigation_type TEXT,
  cooperation_level TEXT DEFAULT 'unknown',
    -- full_cooperation | limited_cooperation | no_cooperation | proffer_agreement | unknown
  dpa_status      TEXT DEFAULT 'evaluating',
    -- evaluating | viable | negotiating | signed | declined | npa_signed
  base_fine_cents INTEGER DEFAULT 0,
  coop_discount_pct REAL DEFAULT 0,
  dpa_credit_pct  REAL  DEFAULT 0,
  effective_fine_cents INTEGER DEFAULT 0,
  wells_due       TEXT,
  subpoena_due    TEXT,
  dpa_sign_due    TEXT,
  notes           TEXT,
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dpa_firm   ON dpa_trackers(firm_id);
CREATE INDEX IF NOT EXISTS idx_dpa_matter ON dpa_trackers(matter_id);
CREATE INDEX IF NOT EXISTS idx_dpa_status ON dpa_trackers(dpa_status);

-- ── 7. TRO tracker (family law / DV) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tro_trackers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id         INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id       INTEGER REFERENCES matters(id) ON DELETE CASCADE,
  client_name     TEXT    NOT NULL,
  dv_flag         INTEGER DEFAULT 0,
  tro_filed       TEXT,   -- ISO date
  tro_hearing_due TEXT,   -- ISO date (3 business days)
  tro_granted     INTEGER DEFAULT 0,
  tro_served      INTEGER DEFAULT 0,
  protective_order_due TEXT,
  asset_tier      TEXT    DEFAULT 'under_100k',
  notes           TEXT,
  created_at      TEXT    DEFAULT (datetime('now')),
  updated_at      TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tro_firm   ON tro_trackers(firm_id);
CREATE INDEX IF NOT EXISTS idx_tro_matter ON tro_trackers(matter_id);

-- ── 8. Matter evidence + vulnerability scoring (VAR-C, VAR-D) ───────────────
ALTER TABLE matters ADD COLUMN IF NOT EXISTS vulnerability_level TEXT DEFAULT 'moderate';
  -- low | moderate | high | crisis
ALTER TABLE matters ADD COLUMN IF NOT EXISTS evidence_score     INTEGER DEFAULT 50;
  -- 0-100 → weak <25 / contested 25-49 / moderate 50-74 / strong 75+
ALTER TABLE matters ADD COLUMN IF NOT EXISTS evidence_bucket    TEXT DEFAULT 'moderate';
  -- computed: weak | contested | moderate | strong
ALTER TABLE matters ADD COLUMN IF NOT EXISTS vertical           TEXT DEFAULT 'general';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS time_pressure      TEXT DEFAULT 'standard';
  -- emergency | standard | relaxed

-- ── 9. Mission verification requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_verification_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id         INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  submitted_by    INTEGER NOT NULL REFERENCES users(id),
  org_type        TEXT    NOT NULL,  -- nonprofit | public_defender | government | legal_aid
  ein             TEXT,              -- EIN / tax ID
  website         TEXT,
  documentation   TEXT,              -- URL to supporting docs
  status          TEXT    DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by     INTEGER REFERENCES users(id),
  reviewed_at     TEXT,
  notes           TEXT,
  created_at      TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mvr_firm   ON mission_verification_requests(firm_id);
CREATE INDEX IF NOT EXISTS idx_mvr_status ON mission_verification_requests(status);
