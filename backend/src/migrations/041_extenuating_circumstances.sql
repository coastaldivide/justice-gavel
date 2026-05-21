-- Migration 041: Extenuating Circumstances Expansion
-- ─────────────────────────────────────────────────────────────────────────────
-- Addresses 25 gaps identified in the legal reality audit.
-- Every table here corresponds to a real thing that happens to real people
-- in real courts that the app was not previously accounting for.
--
-- TIER 1 — IMMEDIATE (life-changing if missed):
--   plea_offers               — offer expiry tracking (DA offers expire in 48-72h)
--   voluntary_departure       — immigration deadline (1-day miss = 10-year bar)
--   supervised_release        — federal release conditions tracking
--   vop_trackers              — probation/parole violation compound alerts
--   dv_firearm_surrender      — DV TRO firearm compliance (federal crime to miss)
--
-- TIER 2 — SHORT-TERM (affects majority of criminal cases):
--   padilla_warnings          — Padilla v. Kentucky IAC-prevention documentation
--   codefendant_links         — link related matters, track cooperation dynamics
--   bop_exhaustion            — compassionate release § 3582(c) BOP process
--   collateral_consequences   — conviction consequences by state/offense
--   ability_to_pay            — Bearden v. Georgia ability-to-pay documentation
--
-- TIER 3 — MEDIUM-TERM:
--   hague_proceedings         — international child abduction 1-year deadline
--   material_support_screening— asylum eligibility screening
--   elder_abuse_matters       — elder exploitation vertical fields
--   dual_sovereignty_flags    — state + federal parallel prosecution risk
--   eviction_trackers         — eviction answer deadline tracking
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- TIER 1
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── plea_offers ─────────────────────────────────────────────────────────────
-- Tracks DA/government plea offers, expiry, and final disposition.
-- DA offers routinely expire in 48-72 hours — the single most common
-- cause of preventable case outcomes in criminal defense.
-- Padilla warning documentation lives here: non_citizen_padilla_given.

CREATE TABLE IF NOT EXISTS plea_offers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  -- Offer details
  offered_by            TEXT    NOT NULL DEFAULT 'prosecution', -- 'prosecution'|'court'
  offered_date          TEXT    NOT NULL,                       -- YYYY-MM-DD
  expires_date          TEXT,                                   -- YYYY-MM-DD (null=no expiry set)
  expires_time          TEXT,                                   -- HH:MM optional
  charge_original       TEXT,                                   -- original charge(s)
  charge_offered        TEXT,                                   -- reduced charge offered
  sentence_rec          TEXT,                                   -- recommended sentence
  fine_cents            INTEGER DEFAULT 0,
  probation_months      INTEGER DEFAULT 0,
  prison_months_min     INTEGER DEFAULT 0,
  prison_months_max     INTEGER DEFAULT 0,
  conditions            TEXT,                                   -- additional conditions (JSON or text)

  -- Plea type — each has different legal consequences
  plea_type             TEXT    NOT NULL DEFAULT 'guilty',
  -- 'guilty'       — standard guilty plea; admits all elements
  -- 'nolo'         — nolo contendere; no civil admission; available in ~20 states
  -- 'alford'       — maintains innocence; accepts conviction; North Carolina v. Alford (1970)
  -- 'best_interest'— court-approved; client admits factual basis only
  -- 'deferred'     — deferred prosecution; charges dismissed after conditions met

  -- Immigration consequences (Padilla v. Kentucky, 559 U.S. 356 (2010))
  -- Attorneys MUST advise non-citizen clients of deportation consequences before plea.
  -- This field documents that the Padilla warning was given — critical IAC prevention.
  non_citizen           INTEGER DEFAULT 0,                      -- 1 if client is non-citizen
  padilla_warning_given INTEGER DEFAULT 0,                      -- 1 if Padilla warning documented
  padilla_given_date    TEXT    DEFAULT NULL,
  padilla_consequences  TEXT    DEFAULT NULL,                   -- summary of immigration consequences explained

  -- Offer status
  status                TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'   — offer open, decision not made
  -- 'accepted'  — client accepted
  -- 'rejected'  — client rejected (document client's knowing rejection)
  -- 'expired'   — offer lapsed without decision
  -- 'withdrawn' — prosecution withdrew offer
  -- 'countered' — defense submitted counter-offer

  decision_date         TEXT    DEFAULT NULL,
  client_initiated_rejection INTEGER DEFAULT 0,  -- 1 = client rejected against attorney advice (document)
  rejection_notes       TEXT    DEFAULT NULL,    -- client's stated reason for rejection (IAC protection)

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_po_matter  ON plea_offers(matter_id, status);
CREATE INDEX IF NOT EXISTS idx_po_firm    ON plea_offers(firm_id, status, expires_date);
CREATE INDEX IF NOT EXISTS idx_po_expiry  ON plea_offers(expires_date, status) WHERE status='pending';

-- ─── voluntary_departure ─────────────────────────────────────────────────────
-- Tracks voluntary departure grants from immigration judges.
-- Missing the deadline by one day: automatic 10-year bar + bond forfeiture.
-- This is separate from the asylum clock — different relief, different stakes.

CREATE TABLE IF NOT EXISTS voluntary_departure (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  a_number              TEXT    DEFAULT NULL,          -- Alien Registration Number

  -- Order details
  order_date            TEXT    NOT NULL,              -- date IJ granted vol. departure
  departure_deadline    TEXT    NOT NULL,              -- YYYY-MM-DD — the critical date
  -- WARNING: This date is absolute. No extensions in most circumstances.
  -- 8 U.S.C. § 1229c(b)(2): voluntary departure order cannot be extended by BIA appeal.

  departure_country     TEXT    NOT NULL,              -- country of departure
  bond_amount_cents     INTEGER DEFAULT 0,             -- bond required for vol. departure

  -- Status
  status                TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'   — order issued, client has not departed
  -- 'departed'  — client departed by deadline (document with proof)
  -- 'missed'    — client did not depart — 10-YEAR BAR NOW ACTIVE
  -- 'extended'  — court extended (rare; document court order)
  -- 'withdrawn' — client withdrew vol. departure in favor of other relief

  departed_date         TEXT    DEFAULT NULL,          -- actual departure date if known
  departure_proof       TEXT    DEFAULT NULL,          -- e.g. ticket confirmation, I-94 record

  -- Alternative relief if vol. departure is missed
  -- Missing triggers immediate withholding/CAT evaluation necessity
  withholding_eligible  INTEGER DEFAULT NULL,          -- 1=may qualify, 0=unlikely, null=not evaluated
  cat_eligible          INTEGER DEFAULT NULL,          -- Convention Against Torture

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vd_matter   ON voluntary_departure(matter_id);
CREATE INDEX IF NOT EXISTS idx_vd_firm     ON voluntary_departure(firm_id, status, departure_deadline);
CREATE INDEX IF NOT EXISTS idx_vd_deadline ON voluntary_departure(departure_deadline, status) WHERE status='pending';

-- ─── supervised_release_conditions ───────────────────────────────────────────
-- Tracks federal supervised release and state probation conditions.
-- Violations can revoke release and return client to prison.

CREATE TABLE IF NOT EXISTS supervised_release (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  release_type          TEXT    NOT NULL DEFAULT 'supervised_release',
  -- 'supervised_release' — federal (post-incarceration)
  -- 'probation'          — state or federal (in lieu of incarceration)
  -- 'parole'             — state (conditional early release)
  -- 'pretrial'           — pretrial release conditions

  start_date            TEXT    NOT NULL,
  end_date              TEXT,                                   -- null = lifetime (sex offenses, etc.)
  supervising_officer   TEXT,
  supervision_office    TEXT,
  reporting_schedule    TEXT,                                   -- 'monthly'|'weekly'|'daily'|'as_directed'

  -- Standard conditions (flags)
  cond_no_travel_outside_district  INTEGER DEFAULT 0,
  cond_no_new_arrests              INTEGER DEFAULT 1,           -- always true
  cond_drug_testing                INTEGER DEFAULT 0,
  cond_no_weapons                  INTEGER DEFAULT 0,
  cond_no_contact_victims          INTEGER DEFAULT 0,
  cond_no_contact_codefendants     INTEGER DEFAULT 0,
  cond_employment_required         INTEGER DEFAULT 0,
  cond_sex_offender_registration   INTEGER DEFAULT 0,
  cond_gps_monitoring              INTEGER DEFAULT 0,
  cond_financial_disclosure        INTEGER DEFAULT 0,           -- white-collar: common condition

  -- Special conditions (free text — each matter is different)
  special_conditions    TEXT,                                   -- additional judge-ordered conditions

  -- Financial conditions
  restitution_total_cents     INTEGER DEFAULT 0,
  restitution_monthly_cents   INTEGER DEFAULT 0,
  fine_total_cents            INTEGER DEFAULT 0,
  fine_monthly_cents          INTEGER DEFAULT 0,

  -- Violation tracking
  vop_filed             INTEGER DEFAULT 0,                      -- 1 = VOP petition filed
  vop_date              TEXT    DEFAULT NULL,
  vop_allegation        TEXT    DEFAULT NULL,
  vop_status            TEXT    DEFAULT NULL,
  -- 'pending'|'admitted'|'denied'|'dismissed'|'revoked'|'modified'

  status                TEXT    NOT NULL DEFAULT 'active',
  -- 'active'|'completed'|'revoked'|'transferred'

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sr_matter ON supervised_release(matter_id);
CREATE INDEX IF NOT EXISTS idx_sr_firm   ON supervised_release(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_sr_vop    ON supervised_release(vop_filed, vop_date) WHERE vop_filed=1;

-- ─── vop_trackers ────────────────────────────────────────────────────────────
-- Probation/parole violation petitions — compound emergency tracker.
-- A VOP hearing has lower evidentiary standards than a criminal trial:
-- preponderance standard, hearsay admissible, no jury.
-- A new arrest while on supervision creates TWO simultaneous cases.

CREATE TABLE IF NOT EXISTS vop_trackers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,                                -- the NEW matter (new arrest)
  original_matter_id    INTEGER,                               -- the SUPERVISED RELEASE matter
  supervised_release_id INTEGER,                               -- FK to supervised_release
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  violation_type        TEXT    NOT NULL DEFAULT 'new_arrest',
  -- 'new_arrest'        — new criminal charge while on supervision
  -- 'failed_drug_test'  — positive drug screen
  -- 'missed_reporting'  — failed to report to officer
  -- 'travel_violation'  — left jurisdiction without permission
  -- 'employment'        — failed employment condition
  -- 'contact_violation' — contacted victim/codefendant
  -- 'financial'         — missed payment/restitution
  -- 'weapons'           — weapons found/possessed
  -- 'absconded'         — whereabouts unknown

  violation_date        TEXT    NOT NULL,
  violation_description TEXT,

  -- VOP proceedings
  vop_petition_date     TEXT    DEFAULT NULL,
  vop_hearing_date      TEXT    DEFAULT NULL,
  -- Typical VOP hearing: 72 hours to 14 days after arrest/petition (varies by jurisdiction)
  vop_hearing_deadline  TEXT    DEFAULT NULL,                  -- calculated from jurisdiction
  detained_on_vop       INTEGER DEFAULT 0,                     -- 1 = held without bond pending VOP

  -- VOP is a compound emergency — two cases sharing one client
  compound_emergency    INTEGER DEFAULT 1,                     -- always 1 for new_arrest type
  original_sentence_months INTEGER DEFAULT 0,                  -- exposure if revoked

  status                TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'|'hearing_set'|'admitted'|'denied'|'revoked'|'modified'|'dismissed'

  outcome               TEXT    DEFAULT NULL,
  -- 'revoked_full'    — full remaining sentence imposed
  -- 'revoked_partial' — partial revocation
  -- 'modified'        — conditions changed, release continues
  -- 'reinstated'      — released back to supervision
  -- 'dismissed'       — VOP dismissed

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vop_matter   ON vop_trackers(matter_id);
CREATE INDEX IF NOT EXISTS idx_vop_orig     ON vop_trackers(original_matter_id);
CREATE INDEX IF NOT EXISTS idx_vop_firm     ON vop_trackers(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_vop_hearing  ON vop_trackers(vop_hearing_date, status) WHERE status='hearing_set';

-- ─── dv_firearm_surrender ────────────────────────────────────────────────────
-- Domestic violence TRO firearm surrender compliance.
-- Federal law (18 U.S.C. § 922(g)(8), upheld Rahimi 2024): unlawful to possess
-- firearm while subject to qualifying DV protective order.
-- Most TROs require surrender within 24-72 hours.
-- Non-compliance = federal felony + contempt + potential new criminal charge.

CREATE TABLE IF NOT EXISTS dv_firearm_surrender (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  tro_tracker_id        INTEGER DEFAULT NULL,                  -- FK to tro_trackers if exists
  tro_issue_date        TEXT    NOT NULL,

  -- Surrender details
  surrender_deadline    TEXT    NOT NULL,                      -- YYYY-MM-DD (TRO usually sets 24-72h)
  surrender_deadline_time TEXT  DEFAULT NULL,                  -- HH:MM if specified
  -- surrender_to: local law enforcement or licensed FFL dealer
  surrender_to          TEXT    DEFAULT 'law_enforcement',
  -- 'law_enforcement'|'ffl_dealer'|'court_designated'

  firearms_count        INTEGER DEFAULT NULL,                  -- number of weapons to surrender
  firearms_description  TEXT    DEFAULT NULL,                  -- make/model/serial if known

  -- Compliance
  status                TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'     — deadline not yet reached
  -- 'complied'    — firearms surrendered, receipt obtained
  -- 'partial'     — some surrendered, some outstanding
  -- 'noncompliant'— deadline passed, no surrender — FEDERAL CRIME RISK
  -- 'exempt'      — court found no qualifying firearms (documented)

  complied_date         TEXT    DEFAULT NULL,
  receipt_obtained      INTEGER DEFAULT 0,                     -- 1 = surrender receipt from LEO
  receipt_reference     TEXT    DEFAULT NULL,

  -- If non-compliant — additional exposure
  contempt_filed        INTEGER DEFAULT 0,
  federal_referral_risk INTEGER DEFAULT 0,                     -- 1 = referred to federal for 922(g)(8)

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dfs_matter  ON dv_firearm_surrender(matter_id);
CREATE INDEX IF NOT EXISTS idx_dfs_firm    ON dv_firearm_surrender(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_dfs_deadline ON dv_firearm_surrender(surrender_deadline, status) WHERE status='pending';

-- ══════════════════════════════════════════════════════════════════════════════
-- TIER 2
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── padilla_warnings ────────────────────────────────────────────────────────
-- Padilla v. Kentucky (2010): defense attorneys must advise non-citizen clients
-- of deportation consequences before a guilty plea.
-- Failure to give the warning = IAC + potential plea withdrawal.
-- This table is the proof that the warning was given.

CREATE TABLE IF NOT EXISTS padilla_warnings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  given_by              INTEGER NOT NULL,                      -- attorney user_id

  client_name           TEXT    NOT NULL,
  a_number              TEXT    DEFAULT NULL,
  immigration_status    TEXT    DEFAULT NULL,                  -- 'lpr'|'visa'|'undocumented'|'daca'|'tps'|'asylee'|'other'

  -- Warning details
  warning_date          TEXT    NOT NULL,
  warning_method        TEXT    NOT NULL DEFAULT 'in_person',
  -- 'in_person'|'written'|'interpreter_present'|'video_call'

  interpreter_used      INTEGER DEFAULT 0,
  interpreter_language  TEXT    DEFAULT NULL,

  -- Consequences explained (check all that were discussed)
  explained_deportation         INTEGER DEFAULT 0,
  explained_inadmissibility     INTEGER DEFAULT 0,
  explained_lpr_loss            INTEGER DEFAULT 0,
  explained_bar_to_relief       INTEGER DEFAULT 0,
  explained_daca_impact         INTEGER DEFAULT 0,
  explained_family_separation   INTEGER DEFAULT 0,
  explained_naturalization_bar  INTEGER DEFAULT 0,

  -- Specific charge consequences
  charge_is_aggravated_felony   INTEGER DEFAULT 0,             -- mandatory deportation
  charge_is_crime_of_moral_turp INTEGER DEFAULT 0,             -- 2-year bar
  charge_is_deportable          INTEGER DEFAULT 1,

  -- Client acknowledgment
  client_acknowledged           INTEGER DEFAULT 0,
  client_signature_obtained     INTEGER DEFAULT 0,
  client_requested_time_to_consult INTEGER DEFAULT 0,          -- client wanted to consult immigration attorney

  -- Recommendation
  immigration_attorney_consulted INTEGER DEFAULT 0,
  referred_to_immigration       INTEGER DEFAULT 0,

  notes                         TEXT,
  created_at                    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pw_matter ON padilla_warnings(matter_id);
CREATE INDEX IF NOT EXISTS idx_pw_firm   ON padilla_warnings(firm_id, warning_date DESC);

-- ─── codefendant_links ────────────────────────────────────────────────────────
-- Links matters involving co-defendants in the same prosecution.
-- One co-defendant cooperating changes exposure for all others.
-- Also tracks Bruton issues and joint defense agreements.

CREATE TABLE IF NOT EXISTS codefendant_links (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  -- Both matter IDs belong to the same firm (or matter_id_b can be NULL for external)
  matter_id_a           INTEGER NOT NULL,                      -- this firm's client
  matter_id_b           INTEGER DEFAULT NULL,                  -- co-defendant matter (same firm, different client)
  codefendant_name_b    TEXT    DEFAULT NULL,                  -- co-defendant name if external
  codefendant_attorney_b TEXT   DEFAULT NULL,                  -- co-defendant's attorney (for JDA)

  -- Relationship
  link_type             TEXT    NOT NULL DEFAULT 'codefendant',
  -- 'codefendant'       — charged together in same indictment
  -- 'related_case'      — same transaction, separately charged
  -- 'jda'               — joint defense agreement in effect

  indictment_number     TEXT    DEFAULT NULL,                  -- shared indictment reference

  -- Joint Defense Agreement (creates privilege across attorneys)
  jda_active            INTEGER DEFAULT 0,
  jda_date              TEXT    DEFAULT NULL,
  jda_terms             TEXT    DEFAULT NULL,                  -- summary of JDA terms

  -- Co-defendant cooperation status (affects strategy for matter_id_a)
  codef_cooperation     TEXT    DEFAULT 'unknown',
  -- 'unknown'       — not yet determined
  -- 'cooperating'   — co-defendant has flipped — HIGH RISK for matter_id_a
  -- 'not_cooperating' — co-defendant is not cooperating
  -- 'pled_guilty'   — co-defendant pled, cooperation unknown
  -- 'acquitted'     — co-defendant acquitted

  codef_cooperation_updated TEXT DEFAULT NULL,

  -- Bruton issue (co-defendant's confession at joint trial raises Confrontation Clause issues)
  bruton_issue          INTEGER DEFAULT 0,                     -- 1 = Bruton concern identified
  bruton_notes          TEXT    DEFAULT NULL,
  severance_motion_filed INTEGER DEFAULT 0,

  -- Trial
  joint_trial_set       INTEGER DEFAULT 0,
  separate_trial_set    INTEGER DEFAULT 0,

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cdl_matter_a ON codefendant_links(matter_id_a);
CREATE INDEX IF NOT EXISTS idx_cdl_matter_b ON codefendant_links(matter_id_b) WHERE matter_id_b IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdl_firm     ON codefendant_links(firm_id);
CREATE INDEX IF NOT EXISTS idx_cdl_coop     ON codefendant_links(codef_cooperation) WHERE codef_cooperation='cooperating';

-- ─── bop_exhaustion ──────────────────────────────────────────────────────────
-- Bureau of Prisons administrative exhaustion for § 3582(c)(1)(A) motions.
-- Federal law requires 30-day BOP request before filing in federal court.
-- This motion = dying at home vs. dying in prison for terminally ill clients.

CREATE TABLE IF NOT EXISTS bop_exhaustion (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  bop_number            TEXT    DEFAULT NULL,                  -- Federal Bureau of Prisons register number
  facility              TEXT    DEFAULT NULL,                  -- current BOP facility
  facility_email        TEXT    DEFAULT NULL,

  -- § 3582(c)(1)(A) basis
  basis                 TEXT    NOT NULL DEFAULT 'medical',
  -- 'medical'           — terminal illness, serious medical condition
  -- 'age_and_medical'   — 70+ with 10+ years served and medical condition
  -- 'caregiver'         — sole caregiver for minor/incapacitated family member
  -- 'other'             — other extraordinary and compelling reason
  -- 'ussc_2023'         — 2023 USSC guideline amendment — expanded categories

  qualifying_condition  TEXT    DEFAULT NULL,                  -- summary of condition(s)

  -- Step 1: Request to warden (required before court)
  warden_request_date   TEXT    DEFAULT NULL,
  warden_response_date  TEXT    DEFAULT NULL,
  warden_response       TEXT    DEFAULT 'pending',
  -- 'pending'|'approved'|'denied'|'no_response'

  -- § 3582(c)(1)(A)(i): if warden denies or 30 days pass → can file with court
  thirty_day_lapse_date TEXT    DEFAULT NULL,                  -- warden_request_date + 30 days
  court_filing_eligible INTEGER DEFAULT 0,                     -- 1 when 30 days have passed

  -- Step 2: Court filing
  court_motion_filed    INTEGER DEFAULT 0,
  court_motion_date     TEXT    DEFAULT NULL,
  court_decision        TEXT    DEFAULT NULL,
  -- 'pending'|'granted'|'denied'|'appeal_filed'

  -- USSC Guideline factors (U.S.S.G. § 1B1.13 — updated Nov 2023)
  -- These factors determine whether the court finds "extraordinary and compelling"
  rehabilitation_record TEXT    DEFAULT NULL,                  -- USSC 2023: relevant but not sole basis
  age_at_offense        INTEGER DEFAULT NULL,
  total_time_served_months INTEGER DEFAULT 0,
  percent_served        REAL    DEFAULT 0,

  status                TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'|'warden_submitted'|'30_day_lapsed'|'court_filed'|'granted'|'denied'|'appeal'

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bop_matter ON bop_exhaustion(matter_id);
CREATE INDEX IF NOT EXISTS idx_bop_firm   ON bop_exhaustion(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_bop_lapse  ON bop_exhaustion(thirty_day_lapse_date, status) WHERE status='warden_submitted';

-- ─── collateral_consequences ─────────────────────────────────────────────────
-- Documents the collateral consequences of a conviction by category.
-- "The hidden sentence" — not part of the court order but changes a life.

CREATE TABLE IF NOT EXISTS collateral_consequences (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  -- Employment
  professional_license_at_risk      INTEGER DEFAULT 0,
  professional_license_type         TEXT    DEFAULT NULL,
  employment_background_check_flag  INTEGER DEFAULT 0,

  -- Housing
  public_housing_disqualified       INTEGER DEFAULT 0,
  section_8_disqualified            INTEGER DEFAULT 0,
  housing_note                      TEXT    DEFAULT NULL,

  -- Education / Financial Aid
  federal_student_loans_affected    INTEGER DEFAULT 0,
  pell_grant_affected               INTEGER DEFAULT 0,

  -- Civil Rights
  voting_rights_lost                INTEGER DEFAULT 0,
  voting_rights_restoration_path    TEXT    DEFAULT NULL,
  jury_duty_disqualified            INTEGER DEFAULT 0,
  firearm_prohibition               INTEGER DEFAULT 0,        -- federal 922(g)(1)
  firearm_prohibition_duration      TEXT    DEFAULT 'lifetime',

  -- Immigration
  deportable_offense                INTEGER DEFAULT 0,
  inadmissibility_trigger           INTEGER DEFAULT 0,
  mandatory_deportation             INTEGER DEFAULT 0,       -- aggravated felony
  naturalization_bar                INTEGER DEFAULT 0,

  -- Sex Offender
  sex_offender_registration         INTEGER DEFAULT 0,
  registration_duration             TEXT    DEFAULT NULL,    -- 'lifetime'|'25yr'|'10yr'
  residence_restrictions            INTEGER DEFAULT 0,
  internet_restrictions             INTEGER DEFAULT 0,

  -- Public Benefits
  snap_affected                     INTEGER DEFAULT 0,
  tanf_affected                     INTEGER DEFAULT 0,
  social_security_affected          INTEGER DEFAULT 0,

  -- Parental Rights
  child_custody_impact              INTEGER DEFAULT 0,
  foster_care_adoption_bar          INTEGER DEFAULT 0,

  -- Military / Government
  military_service_bar              INTEGER DEFAULT 0,
  government_employment_bar         INTEGER DEFAULT 0,
  security_clearance_revoked        INTEGER DEFAULT 0,

  -- Driver's License
  drivers_license_suspended         INTEGER DEFAULT 0,
  license_suspension_months         INTEGER DEFAULT 0,

  -- Notes
  state                             TEXT    DEFAULT NULL,     -- state where consequences apply
  notes                             TEXT,
  created_at                        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cc_matter ON collateral_consequences(matter_id);
CREATE INDEX IF NOT EXISTS idx_cc_firm   ON collateral_consequences(firm_id);

-- ─── ability_to_pay ───────────────────────────────────────────────────────────
-- Bearden v. Georgia (1983): courts cannot revoke probation for failure to pay
-- fines/restitution when the defendant is genuinely unable to pay.
-- Documents financial circumstances — critical for Bearden hearings.

CREATE TABLE IF NOT EXISTS ability_to_pay (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  assessment_date       TEXT    NOT NULL,

  -- Obligations
  fines_total_cents           INTEGER DEFAULT 0,
  restitution_total_cents     INTEGER DEFAULT 0,
  fees_total_cents            INTEGER DEFAULT 0,
  monthly_payment_required    INTEGER DEFAULT 0,

  -- Financial circumstances
  monthly_income_cents        INTEGER DEFAULT 0,
  monthly_expenses_cents      INTEGER DEFAULT 0,
  employed                    INTEGER DEFAULT 0,
  employment_barriers         TEXT    DEFAULT NULL,           -- disabilities, criminal record barriers
  dependents_count            INTEGER DEFAULT 0,
  receives_public_benefits     INTEGER DEFAULT 0,
  assets_value_cents           INTEGER DEFAULT 0,

  -- Ability assessment
  can_pay_full                INTEGER DEFAULT 0,
  can_pay_partial             INTEGER DEFAULT 0,
  genuinely_unable            INTEGER DEFAULT 0,             -- triggers Bearden protection

  -- Court filings
  bearden_motion_filed        INTEGER DEFAULT 0,
  bearden_motion_date         TEXT    DEFAULT NULL,
  court_finding               TEXT    DEFAULT NULL,
  -- 'able_to_pay'|'unable_to_pay'|'partial_ability'

  alternative_ordered         TEXT    DEFAULT NULL,
  -- 'community_service'|'payment_plan'|'waived'|'incarceration' (prohibited if unable)

  notes                       TEXT,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_atp_matter ON ability_to_pay(matter_id);
CREATE INDEX IF NOT EXISTS idx_atp_firm   ON ability_to_pay(firm_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- TIER 3
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── hague_proceedings ────────────────────────────────────────────────────────
-- International child abduction / parental kidnapping.
-- Hague Convention: 1-year deadline for return petitions.
-- After 1 year + settled child: presumption against return.

CREATE TABLE IF NOT EXISTS hague_proceedings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  child_name            TEXT    NOT NULL,
  child_dob             TEXT    DEFAULT NULL,
  taking_parent         TEXT    DEFAULT NULL,                -- parent who removed child
  left_behind_parent    TEXT    DEFAULT NULL,                -- parent seeking return

  removal_date          TEXT    NOT NULL,                    -- date child was removed/retained
  removal_country       TEXT    NOT NULL,                    -- country child was taken to
  habitual_residence    TEXT    NOT NULL,                    -- country of habitual residence (where return to)

  -- The 1-year deadline (Article 12, Hague Convention)
  -- After 1 year: court can deny return if child is "settled" in new country
  one_year_deadline     TEXT,                               -- removal_date + 365 days (calculated)
  within_one_year       INTEGER DEFAULT 1,                   -- 1 = still within 1-year window
  settled_defense_risk  INTEGER DEFAULT 0,                   -- 1 = past 1 year, settling defense possible

  -- Petition status
  petition_filed        INTEGER DEFAULT 0,
  petition_date         TEXT    DEFAULT NULL,
  petition_country      TEXT    DEFAULT NULL,                -- country where petition filed
  central_authority_contacted INTEGER DEFAULT 0,

  -- Defenses to return (Article 13 Hague)
  grave_risk_defense    INTEGER DEFAULT 0,                   -- child would face grave risk of harm
  child_objection       INTEGER DEFAULT 0,                   -- mature child objects to return
  human_rights_defense  INTEGER DEFAULT 0,                   -- return would violate human rights

  status                TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'|'petition_filed'|'return_ordered'|'return_denied'|'child_returned'|'settled'

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hp_matter   ON hague_proceedings(matter_id);
CREATE INDEX IF NOT EXISTS idx_hp_firm     ON hague_proceedings(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_hp_deadline ON hague_proceedings(one_year_deadline, within_one_year);

-- ─── material_support_screening ───────────────────────────────────────────────
-- 8 U.S.C. § 1182(a)(3)(B): material support bar to asylum.
-- Applied even to victims who gave support under duress.
-- Must be screened at asylum intake — no signal without this table.

CREATE TABLE IF NOT EXISTS material_support_screening (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  screened_by           INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,
  screening_date        TEXT    NOT NULL,

  -- Support provided (check all that apply)
  provided_money        INTEGER DEFAULT 0,
  provided_food         INTEGER DEFAULT 0,
  provided_shelter      INTEGER DEFAULT 0,
  provided_transportation INTEGER DEFAULT 0,
  provided_communications INTEGER DEFAULT 0,
  provided_weapons      INTEGER DEFAULT 0,
  provided_other        TEXT    DEFAULT NULL,

  -- Circumstances
  under_duress          INTEGER DEFAULT 0,                   -- provided under coercion/threat
  duress_description    TEXT    DEFAULT NULL,
  organization_type     TEXT    DEFAULT NULL,
  -- 'cartel'|'insurgent'|'government'|'militia'|'other'
  organization_name     TEXT    DEFAULT NULL,

  -- Bar analysis
  bar_potentially_applicable INTEGER DEFAULT 0,             -- 1 = may be barred
  duress_exception_available  INTEGER DEFAULT 0,            -- limited duress exception exists
  de_minimis_argument_available INTEGER DEFAULT 0,          -- small amount / minor role
  exemption_sought      INTEGER DEFAULT 0,                  -- DHS exemption applied for

  -- Outcome
  referred_to_specialist INTEGER DEFAULT 0,                 -- referred to national security specialist
  bar_finding           TEXT    DEFAULT NULL,
  -- 'no_bar'|'bar_applies'|'bar_waived'|'under_review'

  notes                 TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mss_matter ON material_support_screening(matter_id);
CREATE INDEX IF NOT EXISTS idx_mss_firm   ON material_support_screening(firm_id);

-- ─── dual_sovereignty_flags ───────────────────────────────────────────────────
-- State + federal parallel prosecution risk.
-- Double jeopardy does not bar successive state+federal prosecution (Petite Policy).
-- A state acquittal or conviction does NOT end federal exposure.

CREATE TABLE IF NOT EXISTS dual_sovereignty_flags (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER NOT NULL,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  -- Risk assessment
  federal_nexus         TEXT    DEFAULT NULL,                -- why federal jurisdiction exists
  -- 'interstate_commerce'|'federal_land'|'federal_employee'|'bank'|'mail'|'wire'|'drug'|'immigration'|'firearms'

  state_case_status     TEXT    DEFAULT 'pending',
  -- 'pending'|'acquitted'|'convicted'|'dismissed'|'no_charge'

  federal_investigation_known INTEGER DEFAULT 0,            -- 1 = aware of parallel federal investigation
  federal_agency        TEXT    DEFAULT NULL,               -- FBI|DEA|ATF|IRS|DHS|HSI|ICE|DOJ

  -- Petite Policy (DOJ internal policy against successive prosecution after state proceeding)
  -- Note: Petite Policy is NOT legally enforceable — it's internal DOJ policy only
  petite_policy_applicable INTEGER DEFAULT 0,               -- requires prior state conviction/acquittal
  petite_policy_waiver_risk INTEGER DEFAULT 0,              -- 1 = substantial interest justifying exception

  -- Risk level
  risk_level            TEXT    DEFAULT 'unknown',
  -- 'low'|'moderate'|'high'|'critical'

  notes                 TEXT,
  flagged_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dsf_matter ON dual_sovereignty_flags(matter_id);
CREATE INDEX IF NOT EXISTS idx_dsf_firm   ON dual_sovereignty_flags(firm_id, risk_level);

-- ─── eviction_trackers ────────────────────────────────────────────────────────
-- Eviction cases have some of the shortest legal deadlines (5-30 days).
-- Missing an answer deadline usually means default judgment = immediate eviction.

CREATE TABLE IF NOT EXISTS eviction_trackers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id             INTEGER,
  firm_id               INTEGER NOT NULL,
  created_by            INTEGER NOT NULL,

  client_name           TEXT    NOT NULL,                    -- tenant (defendant)
  landlord_name         TEXT    DEFAULT NULL,
  property_address      TEXT    DEFAULT NULL,
  state                 TEXT    NOT NULL,

  -- Notice
  notice_type           TEXT    DEFAULT NULL,
  -- 'pay_or_quit'|'cure_or_quit'|'unconditional_quit'|'no_fault'
  notice_date           TEXT    DEFAULT NULL,
  notice_period_days    INTEGER DEFAULT NULL,                -- 3|5|7|14|30 depending on state+type

  -- Court
  summons_served_date   TEXT    DEFAULT NULL,
  answer_deadline       TEXT    DEFAULT NULL,                -- CRITICAL — calculated from summons
  -- Answer deadline: typically 5-30 days from summons (state-specific)
  hearing_date          TEXT    DEFAULT NULL,

  -- Right to cure period
  right_to_cure_deadline TEXT   DEFAULT NULL,                -- pay rent to cure within X days
  rent_owed_cents        INTEGER DEFAULT 0,
  rent_paid_cents        INTEGER DEFAULT 0,
  cure_exercised         INTEGER DEFAULT 0,

  -- Emergency relief
  emergency_stay_filed   INTEGER DEFAULT 0,
  stay_granted           INTEGER DEFAULT 0,
  stay_duration_days     INTEGER DEFAULT NULL,

  -- COVID/hardship protections (state-specific, may still apply)
  hardship_protection_claimed INTEGER DEFAULT 0,

  -- Defenses
  defenses               TEXT    DEFAULT NULL,
  -- 'habitability'|'retaliation'|'discrimination'|'procedural'|'payment'|'unauthorized_lockout'

  status                 TEXT    NOT NULL DEFAULT 'pending',
  -- 'pending'|'answer_filed'|'hearing_set'|'judgment_landlord'|'judgment_tenant'|'dismissed'|'settled'

  notes                  TEXT,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ev_matter   ON eviction_trackers(matter_id);
CREATE INDEX IF NOT EXISTS idx_ev_firm     ON eviction_trackers(firm_id, status);
CREATE INDEX IF NOT EXISTS idx_ev_answer   ON eviction_trackers(answer_deadline, status) WHERE status='pending';

-- ─── Matter fields for new signals ────────────────────────────────────────────
-- Add new fields to matters table to support signal computation

ALTER TABLE matters ADD COLUMN IF NOT EXISTS supervised_release  INTEGER DEFAULT 0;
  -- 1 = client is on supervised release/probation at time of this matter

ALTER TABLE matters ADD COLUMN IF NOT EXISTS on_supervision_since TEXT DEFAULT NULL;
  -- ISO date — used for compound VOP signal

ALTER TABLE matters ADD COLUMN IF NOT EXISTS dual_sovereignty_risk INTEGER DEFAULT 0;
  -- 1 = federal parallel prosecution risk identified

ALTER TABLE matters ADD COLUMN IF NOT EXISTS plea_offer_pending  INTEGER DEFAULT 0;
  -- 1 = active plea offer awaiting response

ALTER TABLE matters ADD COLUMN IF NOT EXISTS plea_expires_date   TEXT DEFAULT NULL;
  -- Date by which plea offer expires — drives CRITICAL signal

ALTER TABLE matters ADD COLUMN IF NOT EXISTS vol_departure_date  TEXT DEFAULT NULL;
  -- Voluntary departure deadline for immigration matters

ALTER TABLE matters ADD COLUMN IF NOT EXISTS bop_request_date    TEXT DEFAULT NULL;
  -- Date BOP compassionate release request submitted

ALTER TABLE matters ADD COLUMN IF NOT EXISTS non_citizen         INTEGER DEFAULT 0;
  -- 1 = non-citizen client — triggers Padilla warning workflow

ALTER TABLE matters ADD COLUMN IF NOT EXISTS lethality_score     INTEGER DEFAULT NULL;
  -- 0-10 lethality assessment score (DV matters)
  -- Based on Campbell Danger Assessment factors; 0=low, 1-3=variable, 4-7=dangerous, 8+=extreme danger

-- ─── Performance indexes for new fields ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_matters_plea_expiry ON matters(plea_expires_date, plea_offer_pending)
  WHERE plea_offer_pending=1;
CREATE INDEX IF NOT EXISTS idx_matters_vol_dep ON matters(vol_departure_date)
  WHERE vol_departure_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_supervision ON matters(supervised_release)
  WHERE supervised_release=1;
