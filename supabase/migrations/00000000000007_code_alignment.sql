-- 00000000000007_code_alignment.sql
--
-- Aligns the schema with what the backend code (backend/src) actually reads and
-- writes. Built from a PREPARE-based audit: every SQL string in backend/src was
-- prepared against a database built from migrations 00-06, and every
-- "relation does not exist" / "column does not exist" was resolved here.
-- Column types come from the original SQLite migrations (backend/src/migrations)
-- or the legacy Supabase files where a definition existed, translated to the
-- conventions of the baseline:
--   * ids / foreign keys           BIGINT   (baseline ids are BIGSERIAL)
--   * 0/1 flags, counts            INTEGER  (code compares flags with = 1 / = 0)
--   * money in cents               BIGINT
--   * *_at timestamps              TIMESTAMPTZ (datetime('now') -> now())
--   * *_date / JSON blobs          TEXT     (code writes 'YYYY-MM-DD' / JSON.stringify)
-- Added columns are nullable (no NOT NULL) so older code paths that do not
-- supply them keep working.
--
-- Nothing here deletes or rewrites existing rows. In particular the verified
-- provider data in lawyers / bail_agents is untouched: only nullable columns
-- are added to those tables.
--
-- Idempotent: safe to run any number of times (IF NOT EXISTS everywhere,
-- constraints and type changes are guarded by catalog checks).

BEGIN;

SET client_min_messages = warning;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Fixes to existing columns that make current code fail
-- ════════════════════════════════════════════════════════════════════════════

-- integration_external_ids.provider was BIGINT but the code stores provider
-- names ('recap', 'clio', ...). BIGINT -> TEXT is lossless.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='integration_external_ids'
               AND column_name='provider' AND data_type <> 'text') THEN
    ALTER TABLE integration_external_ids ALTER COLUMN provider TYPE TEXT USING provider::text;
  END IF;
END $$;

-- NOT NULL columns that current INSERTs do not supply (the code writes the
-- newer column names instead). Relaxing NOT NULL changes no data.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('case_messages','content'),          -- code writes body
      ('case_messages','user_id'),          -- code writes sender_id
      ('attorney_profiles','lawyer_id'),    -- attorney sign-up creates the profile before any lawyers row
      ('reviews','provider_id'),            -- code writes entity_type/entity_id
      ('integration_external_ids','user_id'),   -- firm-level integrations write firm_id
      ('integration_external_ids','service')    -- code writes provider
    ) AS v(t, c)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=r.t AND column_name=r.c AND is_nullable='NO') THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', r.t, r.c);
    END IF;
  END LOOP;
END $$;

-- chat_sessions / research_sessions have TEXT primary keys with no default, but
-- the code inserts without an id (and research.js uses the returned id as a
-- number). Give them a sequence-backed default; existing ids are kept.
CREATE SEQUENCE IF NOT EXISTS chat_sessions_id_seq;
CREATE SEQUENCE IF NOT EXISTS research_sessions_id_seq;
ALTER TABLE chat_sessions     ALTER COLUMN id SET DEFAULT nextval('chat_sessions_id_seq')::text;
ALTER TABLE research_sessions ALTER COLUMN id SET DEFAULT nextval('research_sessions_id_seq')::text;

-- The Postgres adapter (backend/src/db/index.js) appends "RETURNING id" to every
-- INSERT run through db.run(). These two tables had composite keys and no id
-- column, so every INSERT into them failed. Add a surrogate id.
ALTER TABLE refresh_tokens             ADD COLUMN IF NOT EXISTS id BIGSERIAL;
ALTER TABLE user_disclaimer_acceptance ADD COLUMN IF NOT EXISTS id BIGSERIAL;

-- Column types that do not match how the code reads/writes them. Each change is
-- applied only if the column still has a different type AND every existing value
-- converts cleanly (checked first); otherwise it is skipped with a WARNING, so
-- this can never fail or lose data on a populated database.
DO $$
DECLARE
  r record; cur_type text; cur_default text; expr text; ok boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- user references joined to users.id (BIGINT) but created as TEXT
      ('bop_exhaustion','created_by','bigint'),
      ('case_family_access','invited_by','bigint'),
      ('conflict_waivers','authorized_by','bigint'),
      ('dual_sovereignty_flags','created_by','bigint'),
      ('dv_firearm_surrender','created_by','bigint'),
      ('ethics_wall_log','set_by','bigint'),
      ('feedback','user_id','bigint'),
      ('hague_proceedings','created_by','bigint'),
      ('matter_teams','added_by','bigint'),
      ('mission_verification_requests','submitted_by','bigint'),
      ('motion_templates','created_by','bigint'),
      ('plea_offers','created_by','bigint'),
      ('privilege_log','created_by','bigint'),
      ('sso_configurations','created_by','bigint'),
      ('voluntary_departure','created_by','bigint'),
      ('vop_trackers','created_by','bigint'),
      ('webhook_subscriptions','created_by','bigint'),
      ('checkin_enrollments','enrolled_by','bigint'),        -- was uuid; code writes req.user.id
      -- 0/1 flags and counts the code compares with = 1 / does arithmetic on
      ('asylum_clocks','detained','integer'),
      ('hague_proceedings','within_one_year','integer'),
      ('hague_proceedings','settled_defense_risk','integer'),
      ('hague_proceedings','grave_risk_defense','integer'),
      ('hague_proceedings','child_objection','integer'),
      ('hague_proceedings','human_rights_defense','integer'),
      ('hague_proceedings','central_authority_contacted','integer'),
      ('plea_offers','non_citizen','integer'),
      ('plea_offers','padilla_warning_given','integer'),
      ('plea_offers','probation_months','integer'),
      ('privilege_log','ai_generated','integer'),
      ('privilege_log','withheld','integer'),
      ('tro_trackers','dv_flag','integer'),
      ('tro_trackers','tro_filed','integer'),
      ('vop_trackers','detained_on_vop','integer'),
      ('vop_trackers','original_sentence_months','integer'),
      ('forum_posts','upvotes','integer'),
      ('time_entries','hours','double precision'),
      ('dpa_trackers','coop_discount_pct','double precision'),
      ('dpa_trackers','dpa_credit_pct','double precision'),
      -- BOOLEAN flags the code writes as 0/1 (SET active=0, VALUES (...,1), accepted=0 ...)
      ('firm_members','active','integer'),
      ('case_family_access','accepted','integer'),
      ('checkin_enrollments','active','integer'),
      ('webhook_subscriptions','active','integer'),
      ('cle_courses','active','integer'),
      ('cases','expungement_notified','integer'),
      ('bondsman_subscriptions','cancel_at_period_end','integer'),
      -- identifiers / statuses created as numbers that the code stores as strings
      ('checkin_enrollments','status','text'),             -- code writes 'active'
      ('checkin_enrollments','stripe_sub_id','text'),
      ('family_connections','stripe_pi_id','text'),
      ('lead_purchases','stripe_pi_id','text'),
      ('payment_links','stripe_link_id','text'),
      ('refund_requests','stripe_sub_id','text'),
      ('revenue_log','stripe_link_id','text'),
      ('revenue_log','stripe_pi_id','text'),
      ('arrest_monitors','notify_email','text'),
      ('asylum_clocks','a_number','text'),                 -- A-numbers are 'A123456789'
      ('voluntary_departure','a_number','text'),
      ('bop_exhaustion','bop_number','text'),              -- BOP register no. '12345-678'
      -- timestamps stored as TEXT but compared with NOW()
      ('users','lock_until','timestamptz'),
      ('users','last_seen','timestamptz'),
      -- calendar dates stored as TEXT but compared with CURRENT_DATE (+ INTERVAL)
      -- by the scheduler / health scan / booking code
      ('case_events','event_date','date'),
      ('consultation_bookings','date_slot','date'),
      ('voluntary_departure','departure_deadline','date'),
      ('voluntary_departure','order_date','date'),
      ('plea_offers','expires_date','date'),
      ('plea_offers','offered_date','date'),
      ('dv_firearm_surrender','surrender_deadline','date'),
      ('dv_firearm_surrender','tro_issue_date','date'),
      ('bop_exhaustion','thirty_day_lapse_date','date'),
      ('bop_exhaustion','warden_request_date','date'),
      ('hague_proceedings','one_year_deadline','date'),
      ('hague_proceedings','removal_date','date')
    ) AS v(t, c, newtype)
  LOOP
    SELECT format_type(a.atttypid, a.atttypmod), pg_get_expr(d.adbin, d.adrelid)
      INTO cur_type, cur_default
      FROM pg_attribute a
      JOIN pg_class cl ON cl.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND cl.relname = r.t AND a.attname = r.c AND NOT a.attisdropped
       AND cl.relkind = 'r';
    CONTINUE WHEN cur_type IS NULL OR cur_type = r.newtype;

    expr := CASE
      WHEN cur_type = 'boolean' THEN format('%I::int', r.c)
      WHEN cur_type = 'text'    THEN format('NULLIF(btrim(%I), '''')::%s', r.c, r.newtype)
      WHEN cur_type = 'uuid' AND r.newtype <> 'text' THEN format('NULL::%s', r.newtype)
      ELSE format('%I::%s', r.c, r.newtype) END;

    -- verify every existing value converts (uuid -> bigint only if all NULL)
    BEGIN
      IF cur_type = 'uuid' AND r.newtype <> 'text' THEN
        EXECUTE format('SELECT NOT EXISTS (SELECT 1 FROM %I WHERE %I IS NOT NULL)', r.t, r.c) INTO ok;
      ELSE
        EXECUTE format('SELECT count(%s) >= 0 FROM %I', expr, r.t) INTO ok;
      END IF;
    EXCEPTION WHEN others THEN ok := false;
    END;
    IF NOT ok THEN
      RAISE WARNING 'type change skipped: %.% (% -> %): existing values do not convert', r.t, r.c, cur_type, r.newtype;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', r.t, r.c);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s USING %s', r.t, r.c, r.newtype, expr);
    IF cur_default IS NOT NULL THEN
      cur_default := CASE lower(cur_default) WHEN 'true' THEN '1' WHEN 'false' THEN '0' ELSE cur_default END;
      BEGIN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', r.t, r.c, cur_default);
      EXCEPTION WHEN others THEN
        RAISE WARNING 'default % not restored on %.%', cur_default, r.t, r.c;
      END;
    END IF;
  END LOOP;
END $$;

-- matters.assigned_attorney_id -> users had no ON DELETE action, so deleting an
-- attorney's account (DELETE /api/auth/account) failed while any matter was
-- still assigned to them. Unassign instead.
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
   WHERE con.contype = 'f' AND con.conrelid = 'public.matters'::regclass
     AND con.confrelid = 'public.users'::regclass AND con.confdeltype = 'a'
     AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.matters'::regclass AND attname = 'assigned_attorney_id')];
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE matters DROP CONSTRAINT %I', cname);
    ALTER TABLE matters ADD CONSTRAINT matters_assigned_attorney_id_fkey
      FOREIGN KEY (assigned_attorney_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Compatibility operators: integer/bigint 0/1 flags compared with TRUE/FALSE
-- and boolean flags compared with 1/0. The code base mixes both styles (e.g.
-- "fm.active = 1" and "fm.active = true" on the same column); these operators
-- make both comparisons valid. They only add behaviour for type pairs that
-- previously raised "operator does not exist"; no existing comparison changes.
CREATE OR REPLACE FUNCTION public.jg_int4_eq_bool(integer, boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT ($1 <> 0) = $2 $f$;
CREATE OR REPLACE FUNCTION public.jg_int8_eq_bool(bigint, boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT ($1 <> 0) = $2 $f$;
CREATE OR REPLACE FUNCTION public.jg_bool_eq_int4(boolean, integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT $1 = ($2 <> 0) $f$;
CREATE OR REPLACE FUNCTION public.jg_bool_eq_int8(boolean, bigint) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT $1 = ($2 <> 0) $f$;
CREATE OR REPLACE FUNCTION public.jg_int4_ne_bool(integer, boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT ($1 <> 0) <> $2 $f$;
CREATE OR REPLACE FUNCTION public.jg_int8_ne_bool(bigint, boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT ($1 <> 0) <> $2 $f$;
CREATE OR REPLACE FUNCTION public.jg_bool_ne_int4(boolean, integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT $1 <> ($2 <> 0) $f$;
CREATE OR REPLACE FUNCTION public.jg_bool_ne_int8(boolean, bigint) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$ SELECT $1 <> ($2 <> 0) $f$;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('=',  'integer', 'boolean', 'jg_int4_eq_bool', '=',  '<>'),
      ('=',  'bigint',  'boolean', 'jg_int8_eq_bool', '=',  '<>'),
      ('=',  'boolean', 'integer', 'jg_bool_eq_int4', '=',  '<>'),
      ('=',  'boolean', 'bigint',  'jg_bool_eq_int8', '=',  '<>'),
      ('<>', 'integer', 'boolean', 'jg_int4_ne_bool', '<>', '='),
      ('<>', 'bigint',  'boolean', 'jg_int8_ne_bool', '<>', '='),
      ('<>', 'boolean', 'integer', 'jg_bool_ne_int4', '<>', '='),
      ('<>', 'boolean', 'bigint',  'jg_bool_ne_int8', '<>', '=')
    ) AS v(op, l, rt, fn, com, neg)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_operator o
                   WHERE o.oprname = r.op AND o.oprleft = r.l::regtype AND o.oprright = r.rt::regtype) THEN
      EXECUTE format('CREATE OPERATOR public.%s (LEFTARG = %s, RIGHTARG = %s, FUNCTION = public.%I, COMMUTATOR = OPERATOR(public.%s), NEGATOR = OPERATOR(public.%s))',
                     r.op, r.l, r.rt, r.fn, r.com, r.neg);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Missing tables and columns (generated from the audit; see
--    /home/claude/work/notes/schema_gap.md for the call sites)
-- ════════════════════════════════════════════════════════════════════════════

-- new tables
CREATE TABLE IF NOT EXISTS alerts (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS contracts (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS messages (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS invoices (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS expungement_rules (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS crisis_resources (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS content_refresh_log (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS legal_holds (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS matter_versions (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS docket_archive (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS account_inactivity_log (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS firm_retention_policy (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
-- aba_codes
ALTER TABLE aba_codes ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE aba_codes ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE aba_codes ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE aba_codes ADD COLUMN IF NOT EXISTS category TEXT;
-- ability_to_pay
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS assessment_date TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS fines_total_cents BIGINT DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS restitution_total_cents BIGINT DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS fees_total_cents BIGINT DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS monthly_payment_required INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS monthly_income_cents BIGINT DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS monthly_expenses_cents BIGINT DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS employed INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS employment_barriers TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS dependents_count INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS receives_public_benefits INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS assets_value_cents BIGINT DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS can_pay_full INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS can_pay_partial INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS genuinely_unable INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS bearden_motion_filed INTEGER DEFAULT 0;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS bearden_motion_date TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS alternative_ordered TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS court_finding TEXT;
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE ability_to_pay ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
-- account_deletion_log
ALTER TABLE account_deletion_log ADD COLUMN IF NOT EXISTS region TEXT;
-- account_inactivity_log
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS alert_type TEXT DEFAULT '90_day';
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS days_inactive INTEGER;
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS matters_count INTEGER DEFAULT 0;
ALTER TABLE account_inactivity_log ADD COLUMN IF NOT EXISTS cases_count INTEGER DEFAULT 0;
-- acquisition_leads
ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS firm_name TEXT;
ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT 'general';
ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS org_size INTEGER DEFAULT 0;
ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';
-- ai_jobs
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
-- ai_usage_log
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS route TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- alert_log
ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'emergency';
ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS contact_count INTEGER DEFAULT 0;
-- alerts
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS message TEXT;
-- arrest_records
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- arrest_takedown_log
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS arrest_id BIGINT;
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS requested_by BIGINT;
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE arrest_takedown_log ADD COLUMN IF NOT EXISTS status TEXT;
-- asylum_clocks
ALTER TABLE asylum_clocks ADD COLUMN IF NOT EXISTS paused_days INTEGER DEFAULT 0;
ALTER TABLE asylum_clocks ADD COLUMN IF NOT EXISTS clock_paused INTEGER DEFAULT 0;
ALTER TABLE asylum_clocks ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
-- attorney_profiles
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS outcome_score DOUBLE PRECISION;
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS outcome_count INTEGER DEFAULT 0;
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS stripe_cus_id TEXT;
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS payment_method_id TEXT;
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS platform_rating DOUBLE PRECISION;
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS platform_review_count INTEGER DEFAULT 0;
-- bail_agents
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS license_type TEXT;
-- bar_prep_progress
ALTER TABLE bar_prep_progress ADD COLUMN IF NOT EXISTS questions_answered_total INTEGER DEFAULT 0;
ALTER TABLE bar_prep_progress ADD COLUMN IF NOT EXISTS correct_total INTEGER DEFAULT 0;
ALTER TABLE bar_prep_progress ADD COLUMN IF NOT EXISTS streak_days INTEGER DEFAULT 0;
ALTER TABLE bar_prep_progress ADD COLUMN IF NOT EXISTS notifications_enabled INTEGER DEFAULT 1;
ALTER TABLE bar_prep_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- bondsman_profiles
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS years_experience INTEGER;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS service_radius_km INTEGER;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS languages TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS leads_accepted INTEGER DEFAULT 0;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS leads_received INTEGER DEFAULT 0;
-- bop_exhaustion
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS court_motion_filed INTEGER DEFAULT 0;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS court_decision TEXT;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS court_motion_date TEXT;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS warden_response TEXT DEFAULT 'pending';
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS warden_response_date TEXT;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS facility_email TEXT;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS court_filing_eligible INTEGER DEFAULT 0;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS rehabilitation_record TEXT;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS age_at_offense INTEGER;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS total_time_served_months INTEGER DEFAULT 0;
ALTER TABLE bop_exhaustion ADD COLUMN IF NOT EXISTS percent_served DOUBLE PRECISION DEFAULT 0;
-- bot_runs
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS run_type TEXT;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS arrests_found INTEGER DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS messages_sent INTEGER DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS leads_sold INTEGER DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS revenue_cents BIGINT DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS errors TEXT DEFAULT '[]';
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS replies_yes INTEGER DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS replies_no INTEGER DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS opt_outs INTEGER DEFAULT 0;
-- calendar_push_events
ALTER TABLE calendar_push_events ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE calendar_push_events ADD COLUMN IF NOT EXISTS entry_id BIGINT;
ALTER TABLE calendar_push_events ADD COLUMN IF NOT EXISTS push_status TEXT;
ALTER TABLE calendar_push_events ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
-- callback_requests
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS duration_min INTEGER DEFAULT 30;
-- case_assignments
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS user_id BIGINT;
-- case_family_access
ALTER TABLE case_family_access ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ DEFAULT now();
-- case_messages
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS outcome_notes TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS outcome_recorded_by BIGINT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS close_outcome TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_type TEXT DEFAULT 'criminal';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legal_hold INTEGER DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS closed_reason TEXT;
-- chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id BIGINT;
-- checkin_records
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS check_in_type TEXT;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS verified INTEGER DEFAULT 0;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS photo_uri TEXT;
ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS user_id BIGINT;
-- civil_attorney_profiles
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS stripe_cus_id TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS payment_method_id TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS leads_accepted INTEGER DEFAULT 0;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS firm_name TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS practice_type TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS bar_number TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS license_state TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS counties TEXT DEFAULT '[]';
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS max_lead_fee INTEGER DEFAULT 50000;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS fee_structure TEXT;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS accepts_contingency INTEGER DEFAULT 0;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE civil_attorney_profiles ADD COLUMN IF NOT EXISTS leads_received INTEGER DEFAULT 0;
-- cle_completions
ALTER TABLE cle_completions ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE cle_completions ADD COLUMN IF NOT EXISTS credit_hours DOUBLE PRECISION;
ALTER TABLE cle_completions ADD COLUMN IF NOT EXISTS certificate_id TEXT;
ALTER TABLE cle_completions ADD COLUMN IF NOT EXISTS bar_number TEXT;
ALTER TABLE cle_completions ADD COLUMN IF NOT EXISTS score INTEGER;
-- cle_courses
ALTER TABLE cle_courses ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE cle_courses ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE cle_courses ADD COLUMN IF NOT EXISTS credit_hours DOUBLE PRECISION DEFAULT 1.0;
ALTER TABLE cle_courses ADD COLUMN IF NOT EXISTS duration_min INTEGER;
ALTER TABLE cle_courses ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'intermediate';
ALTER TABLE cle_courses ADD COLUMN IF NOT EXISTS content TEXT;
-- client_assignments
ALTER TABLE client_assignments ADD COLUMN IF NOT EXISTS attorney_id BIGINT;
ALTER TABLE client_assignments ADD COLUMN IF NOT EXISTS user_id BIGINT;
-- codefendant_links
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS matter_id_a BIGINT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS matter_id_b BIGINT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS codefendant_name_b TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS codefendant_attorney_b TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS link_type TEXT DEFAULT 'codefendant';
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS indictment_number TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS jda_active INTEGER DEFAULT 0;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS jda_date TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS jda_terms TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS codef_cooperation TEXT DEFAULT 'unknown';
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS codef_cooperation_updated TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS bruton_issue INTEGER DEFAULT 0;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS bruton_notes TEXT;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS severance_motion_filed INTEGER DEFAULT 0;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS joint_trial_set INTEGER DEFAULT 0;
ALTER TABLE codefendant_links ADD COLUMN IF NOT EXISTS separate_trial_set INTEGER DEFAULT 0;
-- collateral_consequences
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS professional_license_at_risk INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS employment_background_check_flag INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS public_housing_disqualified INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS section_8_disqualified INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS federal_student_loans_affected INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS pell_grant_affected INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS voting_rights_lost INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS jury_duty_disqualified INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS firearm_prohibition INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS deportable_offense INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS inadmissibility_trigger INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS mandatory_deportation INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS naturalization_bar INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS sex_offender_registration INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS residence_restrictions INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS internet_restrictions INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS snap_affected INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS tanf_affected INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS social_security_affected INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS child_custody_impact INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS foster_care_adoption_bar INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS military_service_bar INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS government_employment_bar INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS security_clearance_revoked INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS drivers_license_suspended INTEGER DEFAULT 0;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS professional_license_type TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS housing_note TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS voting_rights_restoration_path TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS firearm_prohibition_duration TEXT DEFAULT 'lifetime';
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS registration_duration TEXT;
ALTER TABLE collateral_consequences ADD COLUMN IF NOT EXISTS license_suspension_months INTEGER DEFAULT 0;
-- conflict_index
ALTER TABLE conflict_index ADD COLUMN IF NOT EXISTS party_name_orig TEXT;
ALTER TABLE conflict_index ADD COLUMN IF NOT EXISTS party_name_norm TEXT;
ALTER TABLE conflict_index ADD COLUMN IF NOT EXISTS party_role TEXT DEFAULT 'client';
ALTER TABLE conflict_index ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;
-- conflict_waivers
ALTER TABLE conflict_waivers ADD COLUMN IF NOT EXISTS conflicting_matter_id BIGINT;
ALTER TABLE conflict_waivers ADD COLUMN IF NOT EXISTS adverse_party TEXT;
ALTER TABLE conflict_waivers ADD COLUMN IF NOT EXISTS client_party TEXT;
ALTER TABLE conflict_waivers ADD COLUMN IF NOT EXISTS conflict_type TEXT;
ALTER TABLE conflict_waivers ADD COLUMN IF NOT EXISTS authorized_by BIGINT;
ALTER TABLE conflict_waivers ADD COLUMN IF NOT EXISTS client_consent INTEGER DEFAULT 0;
-- consultation_bookings
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS refund_id TEXT;
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS reminder_sent TIMESTAMPTZ;
-- content_refresh_log
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS results TEXT;
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS warnings TEXT;
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS errors TEXT;
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS items_checked INTEGER;
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS items_stale INTEGER;
ALTER TABLE content_refresh_log ADD COLUMN IF NOT EXISTS notes TEXT;
-- contract_redlines
ALTER TABLE contract_redlines ADD COLUMN IF NOT EXISTS filename_original TEXT;
ALTER TABLE contract_redlines ADD COLUMN IF NOT EXISTS filename_revised TEXT;
ALTER TABLE contract_redlines ADD COLUMN IF NOT EXISTS changes TEXT;
ALTER TABLE contract_redlines ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE contract_redlines ADD COLUMN IF NOT EXISTS risk_delta TEXT;
-- contract_reviews
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS contract_id BIGINT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS red_flags TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS missing_clauses TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS recommendations TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS favorable_terms TEXT;
ALTER TABLE contract_reviews ADD COLUMN IF NOT EXISTS paid_cents BIGINT DEFAULT 0;
-- contracts
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS party_a TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS party_b TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS fields TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS draft TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS execution_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewal_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS value_cents BIGINT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS paid_cents BIGINT DEFAULT 0;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- crisis_resources
ALTER TABLE crisis_resources ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE crisis_resources ADD COLUMN IF NOT EXISTS last_verified TIMESTAMPTZ;
ALTER TABLE crisis_resources ADD COLUMN IF NOT EXISTS needs_verification INTEGER DEFAULT 0;
-- docket_archive
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS entry_type TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS due_date TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS due_time TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS assigned_to BIGINT;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS original_created_at TIMESTAMPTZ;
ALTER TABLE docket_archive ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT now();
-- docket_entries
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS docket_number TEXT;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS completed INTEGER DEFAULT 0;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
-- document_sync_map
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS external_doc_id TEXT;
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS sync_status TEXT;
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS doc_count INTEGER DEFAULT 0;
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
-- dpa_trackers
ALTER TABLE dpa_trackers ADD COLUMN IF NOT EXISTS status TEXT;
-- dv_firearm_surrender
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS complied_date TEXT;
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS contempt_filed INTEGER DEFAULT 0;
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS receipt_obtained INTEGER DEFAULT 0;
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS receipt_reference TEXT;
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS surrender_deadline_time TEXT;
ALTER TABLE dv_firearm_surrender ADD COLUMN IF NOT EXISTS federal_referral_risk INTEGER DEFAULT 0;
-- eviction_trackers
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS landlord_name TEXT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS property_address TEXT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS notice_type TEXT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS notice_date DATE;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS notice_period_days INTEGER;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS summons_served_date DATE;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS answer_deadline DATE;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS hearing_date DATE;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS right_to_cure_deadline DATE;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS rent_owed_cents BIGINT DEFAULT 0;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS rent_paid_cents BIGINT DEFAULT 0;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS emergency_stay_filed INTEGER DEFAULT 0;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS hardship_protection_claimed INTEGER DEFAULT 0;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS defenses TEXT;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS cure_exercised INTEGER DEFAULT 0;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS stay_duration_days INTEGER;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS stay_granted INTEGER DEFAULT 0;
ALTER TABLE eviction_trackers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- expungement_rules
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS content_verified_at TIMESTAMPTZ;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS law_effective_date TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS stale_since TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS needs_review INTEGER DEFAULT 0;
-- family_connections
ALTER TABLE family_connections ADD COLUMN IF NOT EXISTS amount_cents BIGINT DEFAULT 2900;
-- firm_invites
ALTER TABLE firm_invites ADD COLUMN IF NOT EXISTS invited_by BIGINT;
ALTER TABLE firm_invites ADD COLUMN IF NOT EXISTS accepted INTEGER DEFAULT 0;
-- firm_members
ALTER TABLE firm_members ADD COLUMN IF NOT EXISTS role TEXT;
-- firm_onboarding
ALTER TABLE firm_onboarding ADD COLUMN IF NOT EXISTS checklist_key TEXT;
ALTER TABLE firm_onboarding ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT now();
-- firm_pricing_configs
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS tier_key TEXT;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS monthly_cents INTEGER;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS annual_cents INTEGER;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS seat_limit INTEGER DEFAULT 10;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS matter_limit INTEGER DEFAULT 500;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS ai_calls_daily INTEGER DEFAULT 100;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE firm_pricing_configs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
-- firm_retention_policy
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS matters_retain_days INTEGER;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS cases_retain_days INTEGER;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS messages_retain_days INTEGER;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS docket_archive_days INTEGER DEFAULT 90;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 30;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS purge_warning_days INTEGER DEFAULT 30;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS honor_legal_holds INTEGER DEFAULT 1;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS updated_by BIGINT;
ALTER TABLE firm_retention_policy ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- firm_trials
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT 'general';
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS org_type TEXT;
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ DEFAULT now();
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ;
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
-- firm_upgrade_requests
ALTER TABLE firm_upgrade_requests ADD COLUMN IF NOT EXISTS requested_by BIGINT;
ALTER TABLE firm_upgrade_requests ADD COLUMN IF NOT EXISTS current_tier TEXT;
ALTER TABLE firm_upgrade_requests ADD COLUMN IF NOT EXISTS target_tier TEXT;
ALTER TABLE firm_upgrade_requests ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE firm_upgrade_requests ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;
ALTER TABLE firm_upgrade_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- firms
ALTER TABLE firms ADD COLUMN IF NOT EXISTS mission_verified INTEGER DEFAULT 0;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS subscription_grace_until TIMESTAMPTZ;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active';
ALTER TABLE firms ADD COLUMN IF NOT EXISTS features_json TEXT DEFAULT '{}';
ALTER TABLE firms ADD COLUMN IF NOT EXISTS data_export_requested_at TIMESTAMPTZ;
-- golden_gavel_hall
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '';
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS people_helped INTEGER DEFAULT 0;
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS gavel_level INTEGER DEFAULT 3;
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS opted_in_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS featured INTEGER DEFAULT 0;
-- hague_intakes
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS case_id TEXT;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS child_age INTEGER;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS abduction_date TEXT;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS submitted_by BIGINT;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS country_of_removal TEXT;
ALTER TABLE hague_intakes ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
-- hague_proceedings
ALTER TABLE hague_proceedings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE hague_proceedings ADD COLUMN IF NOT EXISTS petition_country TEXT;
ALTER TABLE hague_proceedings ADD COLUMN IF NOT EXISTS petition_date TEXT;
ALTER TABLE hague_proceedings ADD COLUMN IF NOT EXISTS petition_filed INTEGER DEFAULT 0;
-- integration_connections
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS config_json TEXT;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
-- integration_sync_log
ALTER TABLE integration_sync_log ADD COLUMN IF NOT EXISTS sync_type TEXT;
ALTER TABLE integration_sync_log ADD COLUMN IF NOT EXISTS records_synced INTEGER DEFAULT 0;
ALTER TABLE integration_sync_log ADD COLUMN IF NOT EXISTS error TEXT;
-- invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS matter_table TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_start TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_period_end TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate DOUBLE PRECISION DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_cents BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_generated INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- lawyer_profiles
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS bar_number TEXT;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS bar_state TEXT;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS license_status TEXT DEFAULT 'unverified';
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS calendly_uri TEXT;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS verification_source TEXT;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS is_verified INTEGER DEFAULT 0;
ALTER TABLE lawyer_profiles ADD COLUMN IF NOT EXISTS is_active INTEGER DEFAULT 1;
-- lawyers
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS pending_verification INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS seed_data INTEGER;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS bar_verified_since TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS jtb_verified_since TEXT;
-- lead_purchases
ALTER TABLE lead_purchases ADD COLUMN IF NOT EXISTS bondsman_user_id BIGINT;
-- legal_holds
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS hold_type TEXT;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS target_id BIGINT;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS applied_by BIGINT;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS released_by BIGINT;
ALTER TABLE legal_holds ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
-- material_support_screening
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS screening_date TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_money INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_food INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_shelter INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_transportation INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_communications INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_weapons INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS provided_other TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS under_duress INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS duress_description TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS organization_type TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS organization_name TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS bar_potentially_applicable INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS duress_exception_available INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS de_minimis_argument_available INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS exemption_sought INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS referred_to_specialist INTEGER DEFAULT 0;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS bar_finding TEXT;
ALTER TABLE material_support_screening ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
-- matter_events
ALTER TABLE matter_events ADD COLUMN IF NOT EXISTS event_date DATE;
ALTER TABLE matter_events ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE matter_events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE matter_events ADD COLUMN IF NOT EXISTS amount_cents BIGINT;
-- matter_parties
ALTER TABLE matter_parties ADD COLUMN IF NOT EXISTS case_id BIGINT;
ALTER TABLE matter_parties ADD COLUMN IF NOT EXISTS firm_id BIGINT;
-- matter_team_members
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS matter_role TEXT;
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS can_edit INTEGER DEFAULT 1;
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS can_message INTEGER DEFAULT 1;
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS can_view_docs INTEGER DEFAULT 1;
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS ethics_wall INTEGER DEFAULT 0;
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS case_id BIGINT;
ALTER TABLE matter_team_members ADD COLUMN IF NOT EXISTS added_by BIGINT;
-- matter_teams
ALTER TABLE matter_teams ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE matter_teams ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;
-- matter_versions
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS changed_by BIGINT;
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS change_type TEXT DEFAULT 'update';
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS field_changes TEXT;
ALTER TABLE matter_versions ADD COLUMN IF NOT EXISTS changed_via TEXT DEFAULT 'api';
-- matters
ALTER TABLE matters ADD COLUMN IF NOT EXISTS vertical TEXT DEFAULT 'general';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS evidence_score INTEGER DEFAULT 50;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS vulnerability_level TEXT DEFAULT 'moderate';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS time_pressure TEXT DEFAULT 'standard';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS matter_taxonomy TEXT DEFAULT 'general';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prior_adjudications INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prior_appeals INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS years_post_conviction INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS hab_track TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS is_capital INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS cooperation_level TEXT DEFAULT 'unknown';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS dpa_status TEXT DEFAULT 'evaluating';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS damages_type TEXT DEFAULT 'compensatory_only';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS class_certification_status TEXT DEFAULT 'individual';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS asset_tier TEXT DEFAULT 'under_100k';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS dv_flag INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS clock_days INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS detained INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS country_condition TEXT DEFAULT 'stable';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS years_us INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS injury_severity TEXT DEFAULT 'moderate';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS causation_type TEXT DEFAULT 'disputed';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS plaintiff_fault_pct INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS economic_damages BIGINT DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS noneconomic_damages BIGINT DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS punitive_damages BIGINT DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS policy_limit BIGINT DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS service_years INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rank_e INTEGER DEFAULT 5;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS court_type TEXT DEFAULT 'general';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prior_njp INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS client_age INTEGER DEFAULT 18;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS case_track TEXT DEFAULT 'delinquency';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS relief_type TEXT DEFAULT 'asylum';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS evidence_bucket TEXT DEFAULT 'moderate';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS plea_offer_pending INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS plea_expires_date TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS non_citizen INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS vol_departure_date TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS supervised_release INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS bop_request_date TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS dual_sovereignty_risk INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS custody_type TEXT DEFAULT 'joint_physical';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS support_formula TEXT DEFAULT 'income_shares';
ALTER TABLE matters ADD COLUMN IF NOT EXISTS prenup_flag INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS removal_type TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS placement_type TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS class_size INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS on_supervision_since TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS lethality_score INTEGER;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS actual_value BIGINT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS closed_date TEXT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS legal_hold INTEGER DEFAULT 0;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS closed_reason TEXT;
-- messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS case_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_role TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS lang TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT;
-- mission_verification_requests
ALTER TABLE mission_verification_requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
-- motion_history
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS case_id BIGINT;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS motion_type TEXT DEFAULT 'active';
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS jurisdiction TEXT;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS paid_cents BIGINT DEFAULT 0;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS draft TEXT;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS case_fields TEXT;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS filing_status TEXT;
ALTER TABLE motion_history ADD COLUMN IF NOT EXISTS filed_at TIMESTAMPTZ;
-- motion_templates
ALTER TABLE motion_templates ADD COLUMN IF NOT EXISTS approved_by BIGINT;
ALTER TABLE motion_templates ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- office_members
ALTER TABLE office_members ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
ALTER TABLE office_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE office_members ADD COLUMN IF NOT EXISTS office_name TEXT;
-- opt_outs
ALTER TABLE opt_outs ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ DEFAULT now();
-- outbound_messages
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
-- padilla_warnings
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS given_by BIGINT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS matter_id BIGINT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS a_number TEXT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS immigration_status TEXT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS warning_date TEXT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS warning_method TEXT DEFAULT 'in_person';
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS interpreter_used INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS interpreter_language TEXT;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_deportation INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_inadmissibility INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_lpr_loss INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_bar_to_relief INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_daca_impact INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_family_separation INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS explained_naturalization_bar INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS charge_is_aggravated_felony INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS charge_is_crime_of_moral_turp INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS charge_is_deportable INTEGER DEFAULT 1;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS client_acknowledged INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS client_signature_obtained INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS client_requested_time_to_consult INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS immigration_attorney_consulted INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS referred_to_immigration INTEGER DEFAULT 0;
ALTER TABLE padilla_warnings ADD COLUMN IF NOT EXISTS notes TEXT;
-- password_resets
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS used BOOLEAN DEFAULT false;
-- payment_history
ALTER TABLE payment_history ADD COLUMN IF NOT EXISTS product TEXT;
-- payment_links
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS stripe_pi_id TEXT;
ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS fee_cents BIGINT;
-- pi_leads
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS bondsman_id BIGINT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- plea_offers
ALTER TABLE plea_offers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE plea_offers ADD COLUMN IF NOT EXISTS client_initiated_rejection INTEGER DEFAULT 0;
ALTER TABLE plea_offers ADD COLUMN IF NOT EXISTS decision_date TEXT;
ALTER TABLE plea_offers ADD COLUMN IF NOT EXISTS rejection_notes TEXT;
ALTER TABLE plea_offers ADD COLUMN IF NOT EXISTS offered_by TEXT DEFAULT 'prosecution';
-- privilege_log
ALTER TABLE privilege_log ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;
-- provider_update_log
ALTER TABLE provider_update_log ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE provider_update_log ADD COLUMN IF NOT EXISTS record_id BIGINT;
ALTER TABLE provider_update_log ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE provider_update_log ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ DEFAULT now();
-- push_tokens
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
-- quiz_answers
ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS selected_answer TEXT;
ALTER TABLE quiz_answers ADD COLUMN IF NOT EXISTS time_spent_ms INTEGER;
-- quiz_question_flags
ALTER TABLE quiz_question_flags ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE quiz_question_flags ADD COLUMN IF NOT EXISTS status TEXT;
-- quiz_questions
ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS rule TEXT;
-- quiz_sessions
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS subject_id TEXT;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'practice';
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS question_count INTEGER;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS total_answered INTEGER DEFAULT 0;
-- refund_requests
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT;
-- revenue_log
ALTER TABLE revenue_log ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT now();
-- reviews_app
ALTER TABLE reviews_app ADD COLUMN IF NOT EXISTS provider_id BIGINT;
-- rights_cards
ALTER TABLE rights_cards ADD COLUMN IF NOT EXISTS content_verified_at TIMESTAMPTZ;
-- role_permissions
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS firm_role TEXT;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS resource TEXT;
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS action TEXT;
-- saved_lawyers
ALTER TABLE saved_lawyers ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE saved_lawyers ADD COLUMN IF NOT EXISTS gavel_level INTEGER DEFAULT 0;
ALTER TABLE saved_lawyers ADD COLUMN IF NOT EXISTS golden_gavel INTEGER DEFAULT 0;
-- scan_results
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS scan_id TEXT;
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS overall TEXT;
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS summary_json TEXT;
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS findings_json TEXT;
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS elapsed_ms INTEGER;
-- soc2_controls
ALTER TABLE soc2_controls ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE soc2_controls ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE soc2_controls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- spaced_repetition_state
ALTER TABLE spaced_repetition_state ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- sso_configurations
ALTER TABLE sso_configurations ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1;
-- subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_status TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_id BIGINT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS consumer_tier TEXT;
-- time_entries
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS aba_code TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS minutes INTEGER;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS invoice_id BIGINT;
-- translation_messages
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS session_code TEXT;
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS original TEXT;
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS translated TEXT;
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS src_lang TEXT;
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS tgt_lang TEXT;
ALTER TABLE translation_messages ADD COLUMN IF NOT EXISTS lang TEXT;
-- translation_sessions
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS defender_id BIGINT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS lang_a TEXT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS lang_b TEXT;
ALTER TABLE translation_sessions ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT now();
-- tro_trackers
ALTER TABLE tro_trackers ADD COLUMN IF NOT EXISTS tro_granted INTEGER DEFAULT 0;
ALTER TABLE tro_trackers ADD COLUMN IF NOT EXISTS tro_served INTEGER DEFAULT 0;
ALTER TABLE tro_trackers ADD COLUMN IF NOT EXISTS status TEXT;
-- user_badges
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS badge_key TEXT;
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS emoji TEXT;
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ DEFAULT now();
-- user_subscriptions
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS dispute_flag BOOLEAN DEFAULT false;
-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_submitted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_verified_by BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_rejection_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_platform TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_ip_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS advisor_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firm_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS golden_gavel_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_response_hrs DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_reverify_needed INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_credit_cents BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS compliance_flags INTEGER DEFAULT 0;
-- verified_badge_subscriptions
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS current_period_start TEXT;
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end INTEGER DEFAULT 0;
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS stripe_cus_id TEXT DEFAULT '';
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS renews_at TIMESTAMPTZ;
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE verified_badge_subscriptions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();
-- vertical_deadline_presets
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS rule_key TEXT;
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS days INTEGER;
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS business_days INTEGER DEFAULT 0;
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'high';
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vertical_deadline_presets ADD COLUMN IF NOT EXISTS vertical TEXT;
-- video_sessions
ALTER TABLE video_sessions ADD COLUMN IF NOT EXISTS room_name TEXT;
ALTER TABLE video_sessions ADD COLUMN IF NOT EXISTS room_url TEXT;
-- voluntary_departure
ALTER TABLE voluntary_departure ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE voluntary_departure ADD COLUMN IF NOT EXISTS cat_eligible INTEGER;
ALTER TABLE voluntary_departure ADD COLUMN IF NOT EXISTS departed_date TEXT;
ALTER TABLE voluntary_departure ADD COLUMN IF NOT EXISTS departure_proof TEXT;
ALTER TABLE voluntary_departure ADD COLUMN IF NOT EXISTS withholding_eligible INTEGER;
-- vop_trackers
ALTER TABLE vop_trackers ADD COLUMN IF NOT EXISTS vop_hearing_date TEXT;
ALTER TABLE vop_trackers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE vop_trackers ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE vop_trackers ADD COLUMN IF NOT EXISTS vop_hearing_deadline TEXT;
ALTER TABLE vop_trackers ADD COLUMN IF NOT EXISTS vop_petition_date TEXT;
ALTER TABLE vop_trackers ADD COLUMN IF NOT EXISTS compound_emergency INTEGER DEFAULT 1;
-- webhook_deliveries
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS subscription_id BIGINT;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS response_status INTEGER;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS response_body TEXT;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS delivery_ms INTEGER;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS success INTEGER DEFAULT 0;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMPTZ;
-- webhook_subscriptions
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. Columns used through dynamic table names (not visible to the audit's
--    static pass; found by reading the call sites)
-- ════════════════════════════════════════════════════════════════════════════

-- routes/admin.js generic provider CRUD (lawyers, bail_agents): active,
-- verified, last_verified_at, updated_at. lawyers already has them all.
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- routes/firm_verticals.js PATCH /:firmId/:trackerId/resolve updates
-- status, resolution_notes, updated_at on these five tracker tables.
ALTER TABLE plea_offers         ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE voluntary_departure ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE vop_trackers        ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE bop_exhaustion      ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE padilla_warnings    ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE padilla_warnings    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE padilla_warnings    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- routes/firms.js trial-status reads firm_trials.trial_end_at / active; the
-- insert path (firm_acquisition.js) writes trial_end / status. Derive them.
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS trial_end_at TIMESTAMPTZ GENERATED ALWAYS AS (trial_end) STORED;
ALTER TABLE firm_trials ADD COLUMN IF NOT EXISTS active BOOLEAN GENERATED ALWAYS AS (COALESCE(status, 'active') = 'active') STORED;

-- conflicts.js / rbac.js read matter_parties.party_name / party_type; the table
-- stores name / role.
ALTER TABLE matter_parties ADD COLUMN IF NOT EXISTS party_name TEXT GENERATED ALWAYS AS (name) STORED;
ALTER TABLE matter_parties ADD COLUMN IF NOT EXISTS party_type TEXT GENERATED ALWAYS AS (role) STORED;

-- services/contentRefresh.js getContentAge() + staleness flags on
-- expungement_rules / rights_cards / crisis_resources / lessons.
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS law_effective_date TEXT;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS needs_review INTEGER DEFAULT 0;
ALTER TABLE expungement_rules ADD COLUMN IF NOT EXISTS stale_since TIMESTAMPTZ;
ALTER TABLE rights_cards      ADD COLUMN IF NOT EXISTS law_effective_date TEXT;
ALTER TABLE rights_cards      ADD COLUMN IF NOT EXISTS needs_review INTEGER DEFAULT 0;
ALTER TABLE rights_cards      ADD COLUMN IF NOT EXISTS stale_since TIMESTAMPTZ;
ALTER TABLE crisis_resources  ADD COLUMN IF NOT EXISTS content_verified_at TIMESTAMPTZ;
ALTER TABLE crisis_resources  ADD COLUMN IF NOT EXISTS law_effective_date TEXT;
ALTER TABLE crisis_resources  ADD COLUMN IF NOT EXISTS needs_review INTEGER DEFAULT 0;
ALTER TABLE crisis_resources  ADD COLUMN IF NOT EXISTS needs_verification INTEGER DEFAULT 0;
ALTER TABLE lessons           ADD COLUMN IF NOT EXISTS content_verified_at TIMESTAMPTZ;
ALTER TABLE lessons           ADD COLUMN IF NOT EXISTS law_effective_date TEXT;
ALTER TABLE lessons           ADD COLUMN IF NOT EXISTS needs_review INTEGER DEFAULT 0;

-- services/contentStaleness.js + scripts/scan_content_freshness.js:
-- last_reviewed_at on the four statutory reference tables (NULL = never reviewed).
ALTER TABLE bail_schedules         ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;
ALTER TABLE dui_laws               ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;
ALTER TABLE drug_penalties         ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;
ALTER TABLE statute_of_limitations ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ;

-- services/outbound_bot.js logs into outbound_messages (originally defined in
-- backend/src/migrations/008_outbound_bot.sql); the table only had id/created_at.
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS recipient_type  TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS recipient_id    BIGINT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS recipient_email TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS channel         TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS arrest_id       BIGINT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS message_type    TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS body            TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'sent';
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS sms_sid         TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS sendgrid_id     TEXT;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS error_msg       TEXT;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Read-only alias columns on statutory reference tables
--    services/ragRetrieval.js reads names that differ from the seeded columns.
--    Generated columns expose the seeded values under the names the code uses,
--    without changing or duplicating the seeded data.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE bail_schedules ADD COLUMN IF NOT EXISTS bail_min_cents BIGINT GENERATED ALWAYS AS (bail_min * 100) STORED;
ALTER TABLE bail_schedules ADD COLUMN IF NOT EXISTS bail_max_cents BIGINT GENERATED ALWAYS AS (bail_max * 100) STORED;
ALTER TABLE bail_schedules ADD COLUMN IF NOT EXISTS notes TEXT GENERATED ALWAYS AS (bail_note) STORED;
ALTER TABLE dui_laws ADD COLUMN IF NOT EXISTS first_offense_fine_cents BIGINT GENERATED ALWAYS AS (first_fine_max * 100) STORED;
ALTER TABLE dui_laws ADD COLUMN IF NOT EXISTS first_offense_jail_days  BIGINT GENERATED ALWAYS AS (first_jail_max) STORED;
ALTER TABLE dui_laws ADD COLUMN IF NOT EXISTS license_suspension_days  BIGINT GENERATED ALWAYS AS (first_license_days) STORED;
ALTER TABLE dui_laws ADD COLUMN IF NOT EXISTS felony_threshold_priors  BIGINT GENERATED ALWAYS AS (felony_threshold) STORED;
ALTER TABLE drug_penalties ADD COLUMN IF NOT EXISTS drug_type TEXT GENERATED ALWAYS AS (drug_schedule) STORED;
ALTER TABLE drug_penalties ADD COLUMN IF NOT EXISTS min_sentence_months BIGINT GENERATED ALWAYS AS (min_days / 30) STORED;
ALTER TABLE drug_penalties ADD COLUMN IF NOT EXISTS max_sentence_months BIGINT GENERATED ALWAYS AS (max_days / 30) STORED;
ALTER TABLE drug_penalties ADD COLUMN IF NOT EXISTS min_fine_cents BIGINT GENERATED ALWAYS AS (min_fine * 100) STORED;
ALTER TABLE statute_of_limitations ADD COLUMN IF NOT EXISTS offense_type TEXT GENERATED ALWAYS AS (crime_type) STORED;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Views for names the code reads that map onto existing tables
-- ════════════════════════════════════════════════════════════════════════════

-- routes/alerts.js reads/updates "arrests" (id, full_name, booking_date,
-- charges, suppressed*, disposition*). The data lives in arrest_records.
-- The extra columns go on arrest_records; "arrests" is a simple (auto-updatable)
-- view so UPDATE arrests ... writes through to arrest_records.
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS suppressed           INTEGER DEFAULT 0;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS suppressed_at        TIMESTAMPTZ;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS suppressed_reason    TEXT;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS disposition          TEXT;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS disposition_date     TEXT;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS disposition_court    TEXT;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS disposition_added_at TIMESTAMPTZ;
ALTER TABLE arrest_records ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname='arrests' AND c.relkind='r') THEN
    RAISE NOTICE 'arrests exists as a table; view not created';
  ELSE
    CREATE OR REPLACE VIEW arrests AS
      SELECT id, name AS full_name, name, booking_date, charges, bail_amount, court_date,
             attorney_of_record, has_attorney, case_number, jail_location, county, state,
             city, source, status, alert_sent, created_at, updated_at,
             suppressed, suppressed_at, suppressed_reason,
             disposition, disposition_date, disposition_court, disposition_added_at
        FROM arrest_records;
  END IF;
END $$;

-- routes/consultations.js joins "providers p ON p.user_id = u.id WHERE p.id = <lawyer_id>".
-- lawyer_id values are lawyers.id, so providers is a read-only view over lawyers.
-- lawyers.user_id (added above, NULL for every existing row) links a lawyer
-- listing to a platform account once an attorney claims it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='providers' AND c.relkind='r') THEN
    CREATE OR REPLACE VIEW providers AS
      SELECT id, user_id, 'lawyer'::text AS type, name, phone, email, address, city, state,
             lat, lng, website, bar_number, bar_state, verified, active
        FROM lawyers;
  END IF;
END $$;

-- Bar prep analytics views (definitions from legacy 20260717000001_bar_prep_schema.sql;
-- subject_accuracy_breakdown also exposes subject_code, which barPrepAnalytics.js reads).
CREATE OR REPLACE VIEW user_bar_performance AS
SELECT
  qa.user_id,
  qq.subject_id,
  bs.code                                              AS subject_code,
  bs.title                                             AS subject_title,
  COUNT(*)::int                                        AS total_answered,
  SUM(qa.is_correct::int)::int                         AS total_correct,
  ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1)::float8 AS accuracy_pct,
  AVG(qa.time_spent_secs)::float8                      AS avg_time_secs,
  MAX(qa.answered_at)                                  AS last_answered
FROM quiz_answers qa
JOIN quiz_questions qq ON qq.id = qa.question_id
JOIN bar_subjects   bs ON bs.id = qq.subject_id
GROUP BY qa.user_id, qq.subject_id, bs.code, bs.title;

CREATE OR REPLACE VIEW subject_accuracy_breakdown AS
SELECT
  qa.user_id,
  qq.category,
  qq.subject_id,
  bs.code                                                AS subject_code,
  COUNT(*)::int                                          AS answered,
  SUM(qa.is_correct::int)::int                           AS correct,
  ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1)::float8 AS accuracy_pct,
  CASE
    WHEN ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1) < 60 THEN 'weak'
    WHEN ROUND(100.0 * SUM(qa.is_correct::int) / COUNT(*), 1) < 75 THEN 'developing'
    ELSE 'strong'
  END                                                    AS mastery_level
FROM quiz_answers qa
JOIN quiz_questions qq ON qq.id = qa.question_id
JOIN bar_subjects   bs ON bs.id = qq.subject_id
WHERE qa.answered_at > NOW() - INTERVAL '60 days'
GROUP BY qa.user_id, qq.category, qq.subject_id, bs.code
HAVING COUNT(*) >= 3;

-- services/contentStaleness.js scans "bar_prep_questions" (source_date, reviewed_by).
-- The question bank is quiz_questions; add the review-tracking columns there and
-- expose it under the name the scanner uses.
ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS source_date TIMESTAMPTZ;
ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
CREATE OR REPLACE VIEW bar_prep_questions AS
  SELECT id, subject_id, category, difficulty, stem, correct_answer, rule_tested,
         case_citation, is_active, source_date, reviewed_by, created_at, updated_at
    FROM quiz_questions;

ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS subscription_tier TEXT;

-- AI cost dashboard views (routes/admin/aiCosts.js; definitions from legacy
-- 20260716000003_ai_usage_log.sql). The baseline created these two names as
-- empty TABLES that nothing writes to; they are replaced by the views only when
-- they are empty, so no data can be lost.
DO $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_daily_costs','ai_user_monthly_spend'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
               WHERE ns.nspname='public' AND c.relname=t AND c.relkind='r') THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n = 0 THEN
        EXECUTE format('DROP TABLE %I', t);
      ELSE
        RAISE NOTICE 'table % has % rows; left in place, view not created', t, n;
      END IF;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
                 WHERE ns.nspname='public' AND c.relname='ai_daily_costs' AND c.relkind='r') THEN
    CREATE OR REPLACE VIEW ai_daily_costs AS
    SELECT
      date_trunc('day', queued_at)                     AS day,
      route,
      COUNT(*)::int                                    AS calls,
      SUM(input_tokens)                                AS total_input_tokens,
      SUM(output_tokens)                               AS total_output_tokens,
      SUM(cost_usd)                                    AS total_cost_usd,
      AVG(cost_usd)                                    AS avg_cost_per_call,
      AVG(duration_ms)::float8                         AS avg_duration_ms,
      (COUNT(*) FILTER (WHERE status = 'failed'))::int AS failed_calls
    FROM ai_usage_log
    WHERE queued_at > NOW() - INTERVAL '90 days'
    GROUP BY 1, 2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
                 WHERE ns.nspname='public' AND c.relname='ai_user_monthly_spend' AND c.relkind='r') THEN
    CREATE OR REPLACE VIEW ai_user_monthly_spend AS
    SELECT
      user_id,
      date_trunc('month', queued_at)   AS month,
      COUNT(*)::int                    AS total_calls,
      SUM(cost_usd)                    AS total_cost_usd,
      MAX(subscription_tier)           AS subscription_tier
    FROM ai_usage_log
    WHERE user_id IS NOT NULL
    GROUP BY 1, 2;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Unique constraints required by ON CONFLICT targets in the code
--    (created only when existing data has no duplicates, so this never fails)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record; dup boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- (index name, table, column list)
      ('uq_integration_external_ids_entity', 'integration_external_ids', 'firm_id, provider, entity_type, internal_id'),
      ('uq_outbound_messages_idempotency', 'outbound_messages', 'idempotency_key'),
      ('uq_firm_retention_policy_firm', 'firm_retention_policy', 'firm_id'),
      ('uq_quiz_question_flags_question_user', 'quiz_question_flags', 'question_id, user_id'),
      ('uq_firm_vertical_config_firm', 'firm_vertical_config', 'firm_id'),
      ('uq_firm_invites_firm_email', 'firm_invites', 'firm_id, email'),
      ('uq_matter_teams_matter_user', 'matter_teams', 'matter_id, user_id'),
      ('uq_civil_attorney_profiles_user', 'civil_attorney_profiles', 'user_id'),
      ('uq_reviews_provider_user', 'reviews', 'provider_id, user_id'),
      ('uq_web_push_subscriptions_user_endpoint', 'web_push_subscriptions', 'user_id, endpoint')
    ) AS v(idx, t, cols)
  LOOP
    IF to_regclass('public.' || r.idx) IS NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I GROUP BY %s HAVING count(*) > 1)', r.t, r.cols) INTO dup;
      IF dup THEN
        RAISE WARNING 'not creating unique index % on %(%): duplicate rows exist', r.idx, r.t, r.cols;
      ELSE
        EXECUTE format('CREATE UNIQUE INDEX %I ON %I (%s)', r.idx, r.t, r.cols);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Foreign keys for the new tables (owner rows cascade with the user)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('contracts',              'user_id',      'users', 'CASCADE'),
      ('messages',               'sender_id',    'users', 'CASCADE'),
      ('messages',               'recipient_id', 'users', 'CASCADE'),
      ('account_inactivity_log', 'user_id',      'users', 'CASCADE'),
      ('invoices',               'created_by',   'users', 'SET NULL'),
      ('legal_holds',            'released_by',  'users', 'SET NULL'),
      ('firm_retention_policy',  'firm_id',      'firms', 'CASCADE')
    ) AS v(t, c, ref, act)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.t || '_' || r.c || '_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s NOT VALID',
                     r.t, r.t || '_' || r.c || '_fkey', r.c, r.ref, r.act);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Indexes for the new tables / hot lookup columns used by the code
-- ════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_contracts_user            ON contracts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_expiry          ON contracts (expiry_date);
CREATE INDEX IF NOT EXISTS idx_invoices_firm             ON invoices (firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_matter           ON invoices (matter_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender           ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient        ON messages (recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_case             ON messages (case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_legal_holds_target        ON legal_holds (hold_type, target_id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_legal_holds_firm          ON legal_holds (firm_id);
CREATE INDEX IF NOT EXISTS idx_matter_versions_matter    ON matter_versions (matter_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_docket_archive_matter     ON docket_archive (matter_id);
CREATE INDEX IF NOT EXISTS idx_account_inactivity_user   ON account_inactivity_log (user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_queued           ON ai_usage_log (queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_job              ON ai_usage_log (job_id);
CREATE INDEX IF NOT EXISTS idx_arrest_records_suppressed ON arrest_records (suppressed) WHERE suppressed = 1;
CREATE INDEX IF NOT EXISTS idx_lawyers_user              ON lawyers (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_firm                ON users (firm_id) WHERE firm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matters_vertical          ON matters (firm_id, vertical);
CREATE INDEX IF NOT EXISTS idx_outbound_messages_idem    ON outbound_messages (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_translation_messages_code ON translation_messages (session_code, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub    ON webhook_deliveries (subscription_id, attempted_at DESC);

RESET client_min_messages;

COMMIT;
