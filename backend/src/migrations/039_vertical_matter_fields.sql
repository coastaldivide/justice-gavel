-- Migration 039: Vertical Matter Intelligence Fields + Expanded RBAC Roles
-- Adds per-vertical fields to matters, expands firm_member roles,
-- and adds matter_intelligence_cache for signal persistence.

-- ── Vertical-specific matter fields ──────────────────────────────────────────
ALTER TABLE matters ADD COLUMN IF NOT EXISTS damages_type       TEXT DEFAULT 'compensatory_only';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS class_certification_status TEXT DEFAULT 'individual';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS cooperation_level  TEXT DEFAULT 'unknown';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS dpa_status         TEXT DEFAULT 'evaluating';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS dv_flag            INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS asset_tier         TEXT DEFAULT 'under_100k';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS custody_type       TEXT DEFAULT 'joint_physical';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS support_formula    TEXT DEFAULT 'income_shares';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prenup_flag        INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS country_condition  TEXT DEFAULT 'stable';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS relief_type        TEXT DEFAULT 'asylum';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS detained           INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS years_us           INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS removal_type       TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS clock_days         INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS injury_severity    TEXT DEFAULT 'moderate';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS causation_type     TEXT DEFAULT 'disputed';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS plaintiff_fault_pct INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS economic_damages   INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS noneconomic_damages INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS punitive_damages   INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS policy_limit       INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prior_adjudications INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS client_age         INTEGER DEFAULT 18;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS case_track         TEXT DEFAULT 'delinquency';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS placement_type     TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS hab_track          TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS years_post_conviction INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prior_appeals      INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS is_capital         INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS court_type         TEXT DEFAULT 'general';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS branch             TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rank_e             INTEGER DEFAULT 5;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS service_years      INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prior_njp          INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS class_size         INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS matter_taxonomy    TEXT DEFAULT 'general';

-- ── Expanded RBAC roles in firm_members ───────────────────────────────────────
-- The existing firm_role column accepts TEXT — new roles are simply used
-- New roles added to the system (matching simulation):
-- managing_partner, senior_partner, lead_counsel, co_counsel, law_clerk,
-- expert_witness, lead_partner, senior_associate, compliance_analyst,
-- forensic_accountant, junior_associate, senior_family_attorney,
-- guardian_ad_litem, lead_attorney, interpreter, case_manager,
-- lead_trial_attorney, supervising_pd, staff_pd, law_student_intern,
-- mitigation_specialist, lead_appellate, senior_military_attorney,
-- military_associate, supervising_attorney, associate_juvenile

-- ── Matter intelligence cache (optional persistence) ─────────────────────────
CREATE TABLE IF NOT EXISTS matter_intelligence_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id   INTEGER NOT NULL UNIQUE REFERENCES matters(id) ON DELETE CASCADE,
  signals     TEXT    NOT NULL,  -- JSON blob of computeAllSignals output
  motions     TEXT,              -- JSON array
  diversion   TEXT,              -- JSON array
  escalation_level TEXT DEFAULT 'normal',
  computed_at TEXT    DEFAULT (datetime('now')),
  expires_at  TEXT    DEFAULT (datetime('now', '+24 hours'))
);
CREATE INDEX IF NOT EXISTS idx_mic_matter    ON matter_intelligence_cache(matter_id);
CREATE INDEX IF NOT EXISTS idx_mic_escal     ON matter_intelligence_cache(escalation_level);
CREATE INDEX IF NOT EXISTS idx_mic_expires   ON matter_intelligence_cache(expires_at);
