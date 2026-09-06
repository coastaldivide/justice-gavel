-- 00000000000000_baseline_schema.sql
--
-- CONSOLIDATED BASELINE. Apply this to a fresh database INSTEAD OF the 36
-- other files in this directory.
--
-- MEASURED, not assumed. Against a clean PostgreSQL 16 instance the existing
-- chain of 36 migrations produces:
--     4 apply cleanly, 32 fail
--     163 CREATE TABLE statements -> 49 tables
-- The first schema file already fails, so the chain has never worked.
--
-- This file is the schema the application actually runs against, exported
-- from the working database and translated to PostgreSQL types.
--
-- Translation notes:
--   * 84 columns named *_at / *_date / *expires were declared TEXT in SQLite,
--     which has no date type. PostgreSQL rejects `text >= date` outright, so
--     these are promoted to TIMESTAMPTZ. This is the single largest source of
--     SQLite->Postgres breakage in this schema.
--   * SQLite tolerates "double-quoted" string literals; PostgreSQL reads them
--     as identifiers. DEFAULT clauses converted to single quotes.
--   * Indexes referencing columns absent from their table are commented out
--     rather than deleted, so the discrepancy stays visible.
--   * Types are inferred from SQLite affinities, which are looser than
--     PostgreSQL's. REVIEW NUMERIC AND MONEY COLUMNS before production use.

CREATE TABLE IF NOT EXISTS arrest_monitors (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name TEXT, county TEXT, state TEXT,
    is_pro BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , notify_email BIGINT DEFAULT 0, notify_sms BIGINT DEFAULT 0, watch_name TEXT);
CREATE TABLE IF NOT EXISTS arrest_records (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  booking_date TIMESTAMPTZ,
  charges      TEXT,
  bail_amount  DOUBLE PRECISION,
  court_date TIMESTAMPTZ,
  attorney_of_record TEXT,
  has_attorney BIGINT DEFAULT 0,
  case_number  TEXT,
  jail_location TEXT,
  county       TEXT,
  state        TEXT,
  source       TEXT,
  alert_sent   BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT (NOW())
, city TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS attorney_alerts (
  id             BIGSERIAL PRIMARY KEY,
  recipient_id   BIGINT,
  recipient_type TEXT,
  subject        TEXT,
  body           TEXT,
  count          BIGINT DEFAULT 0,
  sent_at TIMESTAMPTZ DEFAULT (NOW())
);
CREATE TABLE IF NOT EXISTS attorney_profiles (id BIGSERIAL PRIMARY KEY, lawyer_id BIGINT NOT NULL UNIQUE, availability_schedule TEXT, bio TEXT, hourly_rate BIGINT, accepts_consultations BIGINT DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT, action TEXT,
    resource_type TEXT, resource_id TEXT,
    details TEXT, ip TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , detail TEXT, entity_type TEXT);
CREATE TABLE IF NOT EXISTS bail_agents (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    address TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    rate_pct DOUBLE PRECISION DEFAULT 10,
    rating DOUBLE PRECISION DEFAULT 4.0,
    verified BIGINT DEFAULT 0,
    available_now BIGINT DEFAULT 1,
    payment_plan BIGINT DEFAULT 0,
    distance_km DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS bail_schedules (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL, charge TEXT NOT NULL,
    charge_type TEXT NOT NULL, severity TEXT, bail_min BIGINT, bail_max BIGINT,
    bail_note TEXT, source TEXT DEFAULT 'public_court_data', created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS bondsman_profiles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    company_name TEXT, license_number TEXT,
    phone TEXT, address TEXT, state TEXT,
    verified BIGINT DEFAULT 0,
    stripe_cus_id TEXT, payment_method_id TEXT, credit_cents BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , badge_expires_at TIMESTAMPTZ, verified_badge BIGINT DEFAULT 0);
CREATE TABLE IF NOT EXISTS cases (id BIGSERIAL PRIMARY KEY,user_id BIGINT,title TEXT,status TEXT,next_court_date TIMESTAMPTZ,notes TEXT,created_at TIMESTAMPTZ DEFAULT (NOW()), state TEXT, charge TEXT, court_date TIMESTAMPTZ, attorney_id BIGINT, bail_amount BIGINT, charge_description TEXT, invited_at TIMESTAMPTZ, outcome TEXT, role TEXT, updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id BIGINT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW()),
    updated_at TIMESTAMPTZ DEFAULT (NOW())
  , content TEXT, role TEXT);
CREATE TABLE IF NOT EXISTS checkins (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    lat DOUBLE PRECISION, lng DOUBLE PRECISION, location_label TEXT,
    notes TEXT, streak BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , device_info TEXT, late_minutes DOUBLE PRECISION, location_lat DOUBLE PRECISION, location_lng DOUBLE PRECISION, method TEXT, verified BIGINT DEFAULT 0);
CREATE TABLE IF NOT EXISTS civil_lead_purchases (
  id               BIGSERIAL PRIMARY KEY,
  attorney_id      BIGINT NOT NULL,
  lead_id          BIGINT NOT NULL,
  lead_fee_cents   BIGINT,
  status           TEXT DEFAULT 'charged',
  stripe_pi_id     TEXT,
  contact_revealed BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT (NOW())
);
CREATE TABLE IF NOT EXISTS civil_leads (
  id               BIGSERIAL PRIMARY KEY,
  lead_type        TEXT NOT NULL,           -- 'personal_injury' | 'civil_rights' | 'employment' | 'ice_detention'
  -- Submitter info (anonymous until purchased)
  submitter_user_id BIGINT,
  city             TEXT,
  state            TEXT,
  county           TEXT,
  -- Incident summary (shown to attorney before purchase)
  incident_type    TEXT,                    -- 'car accident' | 'slip fall' | 'police brutality' | 'wrongful arrest' etc
  incident_summary TEXT,                    -- 1–3 sentences, no PII
  incident_date TIMESTAMPTZ,
  injury_severity  TEXT,                    -- 'minor' | 'moderate' | 'serious' | 'catastrophic'
  -- Contact (hidden until purchased)
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_email    TEXT,
  -- Lead fee
  lead_fee_cents   BIGINT DEFAULT 15000,   -- $150 default
  -- Status
  status           TEXT DEFAULT 'open',     -- 'open' | 'purchased' | 'expired'
  created_at TIMESTAMPTZ DEFAULT (NOW()),
  expires_at TIMESTAMPTZ                     -- leads expire after 30 days
);
CREATE TABLE IF NOT EXISTS consultation_bookings (id BIGSERIAL PRIMARY KEY, user_id BIGINT, lawyer_id BIGINT NOT NULL, date_slot TEXT, time_slot TEXT, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS consultations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    lawyer_id BIGINT, duration_min BIGINT,
    fee_cents BIGINT, date_slot TEXT, time_slot TEXT,
    notes TEXT, status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , scheduled_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS courthouses (
    id          BIGSERIAL PRIMARY KEY,
    city        TEXT NOT NULL,
    state       TEXT NOT NULL,
    name        TEXT NOT NULL,
    address     TEXT NOT NULL,
    phone       TEXT,
    hours       TEXT DEFAULT 'Mon-Fri 8:30am-4:30pm',
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    court_type  TEXT DEFAULT 'Criminal',
    county      TEXT,
    url         TEXT,
    notes       TEXT,
    verified    BIGINT DEFAULT 1,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
, verified_by TEXT, source_url TEXT, zip_code TEXT);
CREATE TABLE IF NOT EXISTS discovery_analyses (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    filename TEXT, file_type TEXT,
    summary TEXT, issues TEXT, risk_score BIGINT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , case_id BIGINT, doc_type TEXT, inconsistencies TEXT, key_facts TEXT, page_count BIGINT, paid_cents BIGINT, questions TEXT);
CREATE TABLE IF NOT EXISTS drug_penalties (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL,
    drug_schedule TEXT NOT NULL, offense_type TEXT NOT NULL,
    amount_threshold TEXT, charge_level TEXT NOT NULL,
    min_days BIGINT, max_days BIGINT, min_fine BIGINT, max_fine BIGINT,
    notes TEXT, source TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS dui_laws (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL UNIQUE,
    bac_limit DOUBLE PRECISION DEFAULT 0.08, bac_limit_cdl DOUBLE PRECISION DEFAULT 0.04,
    bac_limit_under21 DOUBLE PRECISION DEFAULT 0.02,
    first_jail_min BIGINT DEFAULT 0, first_jail_max BIGINT DEFAULT 30,
    first_fine_min BIGINT, first_fine_max BIGINT, first_license_days BIGINT,
    second_jail_min BIGINT, second_fine_min BIGINT, second_license_days BIGINT,
    felony_threshold BIGINT DEFAULT 3, implied_consent BIGINT DEFAULT 1,
    alr_days BIGINT, dmv_hearing_deadline BIGINT,
    ignition_interlock TEXT, notes TEXT, source TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS expungement_referrals (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT, case_id BIGINT,
    state TEXT, partner TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS family_contacts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name TEXT, phone TEXT, email TEXT,
    relationship TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS federal_courts (
    id BIGSERIAL PRIMARY KEY, district TEXT NOT NULL,
    state TEXT NOT NULL, city TEXT NOT NULL, name TEXT NOT NULL,
    address TEXT NOT NULL, phone TEXT, hours TEXT, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
    url TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS forum_posts (id BIGSERIAL PRIMARY KEY,user_handle TEXT,title TEXT,body TEXT,created_at TIMESTAMPTZ DEFAULT (NOW()), category TEXT, upvotes TEXT, state TEXT, views BIGINT DEFAULT 0, is_ai BIGINT DEFAULT 0, is_pinned BIGINT DEFAULT 0);
CREATE TABLE IF NOT EXISTS forum_replies (id BIGSERIAL PRIMARY KEY,post_id BIGINT,user_handle TEXT,body TEXT,created_at TIMESTAMPTZ DEFAULT (NOW()), upvotes BIGINT DEFAULT 0);
CREATE TABLE IF NOT EXISTS funnel_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  event       TEXT NOT NULL,
  step        TEXT,
  metadata    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS golden_gavel (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    points BIGINT DEFAULT 0,
    streak BIGINT DEFAULT 0,
    opted_in BIGINT DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS law_school_clinics (
    id BIGSERIAL PRIMARY KEY, school TEXT NOT NULL,
    city TEXT NOT NULL, state TEXT NOT NULL, clinic_name TEXT NOT NULL,
    phone TEXT, url TEXT, address TEXT, focus TEXT, free BIGINT DEFAULT 1,
    notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS lawyers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    firm TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    specialties TEXT DEFAULT '["Criminal Defense"]',
    rating DOUBLE PRECISION DEFAULT 4.5,
    review_count BIGINT DEFAULT 0,
    bar_number TEXT,
    bar_verified BIGINT DEFAULT 0,
    free_consult BIGINT DEFAULT 0,
    languages TEXT DEFAULT '["English"]',
    bio TEXT,
    photo_url TEXT,
    website TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS lesson_progress (id BIGSERIAL PRIMARY KEY,user_id BIGINT,lesson_id BIGINT,completed BIGINT DEFAULT 0,completed_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS lessons (id BIGSERIAL PRIMARY KEY,title TEXT,category TEXT,content TEXT,points BIGINT DEFAULT 10, created_at TIMESTAMPTZ, body TEXT, difficulty TEXT DEFAULT 'beginner', duration_min BIGINT DEFAULT 5);
CREATE TABLE IF NOT EXISTS motions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    motion_type TEXT, title TEXT, draft TEXT,
    fields TEXT, status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , case_id BIGINT, type TEXT);
CREATE TABLE IF NOT EXISTS offline_cases (
    id TEXT PRIMARY KEY,
    user_id BIGINT,
    data TEXT,
    synced BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS pi_leads (
    id BIGSERIAL PRIMARY KEY,
    case_type TEXT, city TEXT, state TEXT,
    description TEXT, status TEXT DEFAULT 'open',
    accepted_by BIGINT, accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , attorney_id BIGINT, bail_amount BIGINT, bar_number TEXT, charge_type TEXT, contacted_at TIMESTAMPTZ, counties TEXT, county TEXT, defendant_name TEXT, fee_charged BIGINT, firm_name TEXT, leads_accepted BIGINT, license_state TEXT, max_lead_fee BIGINT, practice_type TEXT);
CREATE TABLE IF NOT EXISTS probation_offices (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL, city TEXT,
    office_name TEXT NOT NULL, address TEXT, phone TEXT, hours TEXT,
    url TEXT, type TEXT DEFAULT 'probation', notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS push_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    token TEXT NOT NULL,
    platform TEXT,
    updated_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS referrals (id BIGSERIAL PRIMARY KEY,code TEXT UNIQUE,owner_user_id BIGINT,credits BIGINT DEFAULT 0,created_at TIMESTAMPTZ DEFAULT (NOW()));
CREATE TABLE IF NOT EXISTS refresh_tokens (
  user_id     BIGINT NOT NULL,
  token_hash  TEXT    NOT NULL,
  expires_at TIMESTAMPTZ,
  used        BIGINT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, token_hash)
);
CREATE TABLE IF NOT EXISTS research_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT, content TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS research_sessions (
    id TEXT PRIMARY KEY,
    user_id BIGINT,
    topic TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , title TEXT, updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS resources (id BIGSERIAL PRIMARY KEY,title TEXT,category TEXT,body TEXT, state TEXT, city TEXT, phone TEXT, url TEXT, address TEXT, hours TEXT, free BIGINT DEFAULT 1, income_limit TEXT, languages TEXT DEFAULT '["English"]', priority BIGINT DEFAULT 5, type TEXT DEFAULT 'resource', verified BIGINT DEFAULT 0, name TEXT, description TEXT, website TEXT, email TEXT, eligibility TEXT, updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS reviews (
  id BIGSERIAL PRIMARY KEY,
  provider_id BIGINT NOT NULL,
  user_id     BIGINT,
  rating      BIGINT NOT NULL,
  comment     TEXT,
  anonymous   BIGINT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reviews_app (
    id          BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   BIGINT NOT NULL,
    user_id     BIGINT,
    rating      BIGINT NOT NULL CHECK(rating BETWEEN 1 AND 5),
    body        TEXT,
    verified    BIGINT DEFAULT 0,
    helpful     BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT (NOW())
, comment TEXT);
CREATE TABLE IF NOT EXISTS rewards (id BIGSERIAL PRIMARY KEY,user_id BIGINT UNIQUE,points BIGINT DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT (NOW()));
CREATE TABLE IF NOT EXISTS saved_lawyers (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    provider_id BIGINT, name TEXT,
    phone TEXT, address TEXT, specialties TEXT,
    rating DOUBLE PRECISION, notes TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  , availability TEXT, bar_verified BIGINT DEFAULT 0, jtb_verified BIGINT DEFAULT 0, lawyer_id BIGINT);
CREATE TABLE IF NOT EXISTS scheduled_pushes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    push_token TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data TEXT,
    deliver_at TIMESTAMPTZ NOT NULL,
    notification_type TEXT DEFAULT 'reminder',
    case_id BIGINT,
    channelId TEXT DEFAULT 'default',
    expo_ticket_id TEXT,
    status TEXT DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    error TEXT,
    max_retries BIGINT DEFAULT 3,
    retry_count BIGINT DEFAULT 0,
    priority TEXT DEFAULT 'normal',
    delivered BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS specialty_courts (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    court_type  TEXT NOT NULL,
    city        TEXT NOT NULL,
    state       TEXT NOT NULL,
    county      TEXT,
    address     TEXT,
    phone       TEXT,
    url         TEXT,
    judge       TEXT,
    eligibility TEXT,
    notes       TEXT,
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    verified    BIGINT DEFAULT 1,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS state_bar_complaints (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL UNIQUE,
    bar_name TEXT NOT NULL, phone TEXT, url TEXT, address TEXT,
    online_form TEXT, notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS statute_of_limitations (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL,
    crime_type TEXT NOT NULL, years DOUBLE PRECISION, notes TEXT, source TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS stripe_event_log (
         id BIGSERIAL PRIMARY KEY,
         stripe_event_id TEXT UNIQUE NOT NULL,
         event_type TEXT,
         processed_at TIMESTAMPTZ DEFAULT NOW());
-- version holds a dotted string ('2026-01-01.1'), not a number. SQLite's
-- INTEGER affinity accepted it; the naive INTEGER->BIGINT mapping did not.
CREATE TABLE IF NOT EXISTS user_disclaimer_acceptance (
         user_id     BIGINT NOT NULL,
         version     TEXT NOT NULL,
         accepted_at TIMESTAMPTZ DEFAULT NOW(),
         ip_address  TEXT,
         PRIMARY KEY (user_id, version));
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    tier TEXT DEFAULT 'free',
    stripe_cus_id TEXT, stripe_sub_id TEXT,
    status TEXT DEFAULT 'active',
    current_period_end TEXT,
    created_at TIMESTAMPTZ DEFAULT (NOW())
  );
CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,name TEXT,is_premium BIGINT DEFAULT 0,created_at TIMESTAMPTZ DEFAULT (NOW()), display_name TEXT DEFAULT NULL, login_identifier TEXT DEFAULT NULL, golden_gavel_awarded_at TIMESTAMPTZ, golden_gavel_tier      TEXT DEFAULT '', bar_verified           BIGINT DEFAULT 0, phone TEXT, role TEXT DEFAULT 'user', credit_cents BIGINT DEFAULT 0, push_token TEXT, avatar_url TEXT, stripe_cus_id TEXT, refresh_token_hash TEXT, last_seen TEXT, account_status TEXT DEFAULT 'active', failed_login_attempts BIGINT DEFAULT 0, lock_until TEXT, notif_court_reminders BIGINT DEFAULT 1, notif_legal_tips BIGINT DEFAULT 1, notif_arrest_alerts BIGINT DEFAULT 1, notif_motion_updates BIGINT DEFAULT 1, notif_checkin_reminders BIGINT DEFAULT 1, notif_expungement BIGINT DEFAULT 1, gavel_level BIGINT DEFAULT 0, gavel_level_awarded_at TIMESTAMPTZ, gavel_bronze_at TIMESTAMPTZ, gavel_silver_at TIMESTAMPTZ, gavel_gold_at TIMESTAMPTZ, gavel_platinum_at TIMESTAMPTZ, golden_gavel BIGINT DEFAULT 0, bar_number TEXT, bar_state TEXT, firm_name TEXT, whatsapp_number TEXT, firm_role TEXT, gavel_points BIGINT, hall_opt_in BIGINT DEFAULT 0, identifier TEXT, is_admin BIGINT DEFAULT 0, is_defender BIGINT DEFAULT 0, jtb_verified BIGINT DEFAULT 0, lang TEXT, notif_marketing BIGINT DEFAULT 0, notifs_enabled BIGINT DEFAULT 0, office_id BIGINT, pending_bar_verification BIGINT DEFAULT 0, subscription TEXT, subscription_tier TEXT, tos_accepted_at TIMESTAMPTZ, tos_version_accepted TEXT, type TEXT, user_type TEXT);
CREATE TABLE IF NOT EXISTS victim_compensation (
    id BIGSERIAL PRIMARY KEY, state TEXT NOT NULL UNIQUE,
    program_name TEXT NOT NULL, phone TEXT, url TEXT, address TEXT,
    max_award BIGINT, covers TEXT, deadline_days BIGINT, notes TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, verified_by TEXT, source_url TEXT);
CREATE TABLE IF NOT EXISTS recovery_agents (
  id              BIGSERIAL PRIMARY KEY,
  source_id       TEXT    UNIQUE,
  name            TEXT    NOT NULL,
  city            TEXT    NOT NULL,
  state           TEXT    NOT NULL,
  phone           TEXT,
  address         TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  website         TEXT,
  email           TEXT,
  license_number  TEXT,
  license_required BIGINT DEFAULT 0,
  armed_certified  BIGINT DEFAULT 0,
  rating          DOUBLE PRECISION    DEFAULT 0,
  reviews         BIGINT DEFAULT 0,
  bio             TEXT,
  photo_url       TEXT,
  source          TEXT    DEFAULT 'google',
  active          BIGINT DEFAULT 1,
  available_24_7  BIGINT DEFAULT 1,
  hours           TEXT,
  law_note        TEXT,
  created_at TIMESTAMPTZ    DEFAULT (NOW()),
  updated_at TIMESTAMPTZ    DEFAULT (NOW())
);
CREATE INDEX IF NOT EXISTS idx_aa_recipient ON attorney_alerts(recipient_id, recipient_type);
CREATE INDEX IF NOT EXISTS idx_aa_sent      ON attorney_alerts(sent_at);
CREATE INDEX IF NOT EXISTS idx_bail_sched_charge ON bail_schedules(charge_type, state);
CREATE INDEX IF NOT EXISTS idx_bail_sched_state ON bail_schedules(state, charge_type);
CREATE INDEX IF NOT EXISTS idx_bookings_lawyer_status ON consultation_bookings(lawyer_id, status, date_slot DESC);
CREATE INDEX IF NOT EXISTS idx_cases_next_court_date ON cases(next_court_date);
CREATE INDEX IF NOT EXISTS idx_cases_status          ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_user_court
  ON cases(user_id, next_court_date ASC);
CREATE INDEX IF NOT EXISTS idx_cases_user_status        ON cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_cl_state  ON civil_leads(state, city);
CREATE INDEX IF NOT EXISTS idx_cl_type   ON civil_leads(lead_type, status);
CREATE INDEX IF NOT EXISTS idx_clinic_state ON law_school_clinics(state);
CREATE INDEX IF NOT EXISTS idx_clp_atty  ON civil_lead_purchases(attorney_id);
CREATE INDEX IF NOT EXISTS idx_courthouse_city ON courthouses(city, state);
CREATE INDEX IF NOT EXISTS idx_courthouses_city_state ON courthouses(city, state);
CREATE INDEX IF NOT EXISTS idx_courts_state ON courthouses(state, court_type);
CREATE INDEX IF NOT EXISTS idx_drug_state ON drug_penalties(state, offense_type);
CREATE INDEX IF NOT EXISTS idx_drug_state_offense ON drug_penalties(state, offense_type);
CREATE INDEX IF NOT EXISTS idx_dui_state ON dui_laws(state);
CREATE INDEX IF NOT EXISTS idx_fed_state ON federal_courts(state);
CREATE INDEX IF NOT EXISTS idx_forum_category ON forum_posts(category);
CREATE INDEX IF NOT EXISTS idx_funnel_user_event ON funnel_events(user_id, event);
CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);
CREATE INDEX IF NOT EXISTS idx_prob_state ON probation_offices(state);
CREATE INDEX IF NOT EXISTS idx_referrals_owner       ON referrals(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_resources_cat_state ON resources(category, state);
CREATE INDEX IF NOT EXISTS idx_reviews_app_entity ON reviews_app(entity_type,entity_id);
CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_sc_state ON specialty_courts(state,court_type);
CREATE INDEX IF NOT EXISTS idx_sol_state ON statute_of_limitations(state);
CREATE INDEX IF NOT EXISTS idx_sol_state_crime ON statute_of_limitations(state, crime_type);
CREATE INDEX IF NOT EXISTS idx_specialty_state ON specialty_courts(state, court_type);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login_identifier);
CREATE INDEX IF NOT EXISTS idx_vc_state ON victim_compensation(state);
CREATE INDEX IF NOT EXISTS idx_aa_recipient ON attorney_alerts(recipient_id, recipient_type);
CREATE INDEX IF NOT EXISTS idx_aa_sent      ON attorney_alerts(sent_at);
-- SKIPPED: references column(s) absent from bail_agents: available_24_7
-- CREATE INDEX IF NOT EXISTS idx_bail_247 ON bail_agents(available_24_7) WHERE active=1;
-- SKIPPED: references column(s) absent from bail_agents: active
-- CREATE INDEX IF NOT EXISTS idx_bail_city ON bail_agents(city, active);
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_city_state ON bail_agents(city, state) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_lat_lng ON bail_agents(lat, lng) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_phone ON bail_agents(phone) WHERE active=1 AND phone IS NOT NULL;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_rating ON bail_agents(rating DESC) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_rating_new ON bail_agents(rating DESC) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_state ON bail_agents(state) WHERE active=1;
-- SKIPPED: references column(s) absent from bail_agents: active
-- CREATE INDEX IF NOT EXISTS idx_bail_state_active ON bail_agents(state, active);
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_state_rating ON bail_agents(state, rating DESC) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_bail_verified ON bail_agents(verified) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_cases_next_court_date ON cases(next_court_date);
CREATE INDEX IF NOT EXISTS idx_cases_status          ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_user_court
  ON cases(user_id, next_court_date ASC);
CREATE INDEX IF NOT EXISTS idx_cases_user_status        ON cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_cl_state  ON civil_leads(state, city);
CREATE INDEX IF NOT EXISTS idx_cl_type   ON civil_leads(lead_type, status);
CREATE INDEX IF NOT EXISTS idx_clp_atty  ON civil_lead_purchases(attorney_id);
-- SKIPPED: references column(s) absent from lawyers: availability
-- CREATE INDEX IF NOT EXISTS idx_lawyers_availability ON lawyers(availability) WHERE active=1;
-- SKIPPED: references column(s) absent from lawyers: active
-- CREATE INDEX IF NOT EXISTS idx_lawyers_city ON lawyers(city, active, rating DESC);
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_lawyers_city_state ON lawyers(city, state) WHERE active=1;
-- SKIPPED: references column(s) absent from lawyers: free_consultation
-- CREATE INDEX IF NOT EXISTS idx_lawyers_free_consult ON lawyers(free_consultation) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_lawyers_lat_lng ON lawyers(lat, lng) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_lawyers_phone ON lawyers(phone) WHERE active=1 AND source!='seed';
-- SKIPPED: references column(s) absent from lawyers: sort_priority
-- CREATE INDEX IF NOT EXISTS idx_lawyers_priority ON lawyers(sort_priority DESC, rating DESC) WHERE active=1;
-- SKIPPED (column "active" does not exist):
-- CREATE INDEX IF NOT EXISTS idx_lawyers_rating ON lawyers(rating DESC) WHERE active=1;
-- SKIPPED: references column(s) absent from lawyers: availability
-- CREATE INDEX IF NOT EXISTS idx_lawyers_state ON lawyers(state, city, availability, rating DESC) WHERE active=1;
-- SKIPPED: references column(s) absent from lawyers: active, source
-- CREATE INDEX IF NOT EXISTS idx_lawyers_state_active ON lawyers(state, active, source);
-- SKIPPED: references column(s) absent from lawyers: sort_priority
-- CREATE INDEX IF NOT EXISTS idx_lawyers_state_priority ON lawyers(state, sort_priority DESC) WHERE active=1;
-- SKIPPED: references column(s) absent from lawyers: data_verified
-- CREATE INDEX IF NOT EXISTS idx_lawyers_verified ON lawyers(data_verified, state) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_ra_armed ON recovery_agents(armed_certified) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_ra_city_state ON recovery_agents(city, state) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_ra_phone ON recovery_agents(phone) WHERE active=1 AND phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ra_rating ON recovery_agents(rating DESC) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_ra_state ON recovery_agents(state) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_ra_state_active ON recovery_agents(state, active);
CREATE INDEX IF NOT EXISTS idx_referrals_owner       ON referrals(owner_user_id);
-- SKIPPED: references column(s) absent from reviews_app: provider_id
-- CREATE INDEX IF NOT EXISTS idx_reviews_app_provider ON reviews_app(provider_id);
-- SKIPPED: references column(s) absent from reviews: entity_id, entity_type
-- CREATE INDEX IF NOT EXISTS idx_reviews_entity ON reviews(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login_identifier);

-- ── Tables and columns the running application requires ──────────────────────
-- Found by running the backend suites against PostgreSQL. Each of these was
-- absent, and each failure was swallowed by db.run()'s catch, so the write
-- silently did nothing rather than erroring.

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id     TEXT,
  plan                   TEXT,
  status                 TEXT DEFAULT 'inactive',
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS stripe_event_log (
  id              BIGSERIAL PRIMARY KEY,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type      TEXT,
  processed_at    TIMESTAMPTZ DEFAULT NOW()
);

-- services/funnelTracking.js writes `stage` and `occurred_at`; the table had
-- neither. `event` is written only on some paths, so it cannot be NOT NULL.
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS stage       TEXT;
ALTER TABLE funnel_events ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE funnel_events ALTER COLUMN event DROP NOT NULL;

-- ── Directory schema reconciliation ──────────────────────────────────────
-- lawyers and bail_agents exist in BOTH SQLite files with different shapes.
-- demo.db has a 21-column stub; data/providers.sqlite has the real directory
-- (2,048 lawyers, 1,262 bail agents) with 42+ columns. The baseline was
-- generated from demo.db first, so it took the stub. These add the columns
-- the real directory needs -- without them the seed load fails on
-- 'column "source_id" does not exist' and only the 7 stub rows land.
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS hours TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS reviews BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS bar_state TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS verified BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS jtb_verified BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS golden_gavel BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS gavel_level BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS pro_bono BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS sliding_scale BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS free_consultation BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS years_experience BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS source_id2 TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS accepting_leads BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS availability TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS avg_response_hrs DOUBLE PRECISION;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS weekly_availability TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS availability_note TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS active BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS data_source_ids TEXT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS data_verified BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS sort_priority BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS hourly_rate BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS available_24h BIGINT;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS avg_rating DOUBLE PRECISION;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS license_number TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS bond_rate DOUBLE PRECISION;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS payment_plans BIGINT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS hours TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS active BIGINT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS available_24_7 BIGINT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS fee_percent DOUBLE PRECISION;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS reviews BIGINT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS languages TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS specialties TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS bar_number TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS bar_verified BIGINT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS pro_bono BIGINT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS doi_verified BIGINT;

-- ── Columns routes/cases.js writes but the table lacked ──────────────────────
-- POST /api/cases INSERTs these five. Without them the statement failed,
-- db.run() swallowed the error and returned changes:0, and the route still
-- answered 201 Created with id=0. Creating a case appeared to succeed and
-- wrote nothing -- a defendant's case file silently discarded.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS bail_amount_cents  BIGINT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS related_case_id    BIGINT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS capital_case       BOOLEAN DEFAULT FALSE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS co_defendant_count INTEGER DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS bail_status        TEXT;

-- ── Soft delete on cases ─────────────────────────────────────────────────────
-- routes/cases.js filters every read with `deleted_at IS NULL`, but the column
-- did not exist. The SELECT errored, db.all() swallowed it and returned [], so
-- GET /api/cases answered 200 with an empty list while the rows sat in the
-- table. A defendant would create a case, see it vanish, and get no error.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cases_user_active ON cases(user_id) WHERE deleted_at IS NULL;

-- routes/cases.js selects these in CASE_SAFE_COLS on every read.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS expungement_notified BOOLEAN DEFAULT FALSE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS share_token          TEXT;

-- ── feedback ─────────────────────────────────────────────────────────────────
-- routes/feedback.js writes to this table from two handlers (a rating/comment
-- form and a bug report). The table existed in no migration and in neither
-- SQLite file, so every submission failed. Before db.run() was made to throw,
-- the route answered 200 and the feedback went nowhere.
CREATE TABLE IF NOT EXISTS feedback (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT,
  rating      INTEGER,
  comment     TEXT,
  screen      TEXT,
  issue       TEXT,
  contact     TEXT,
  device_info TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
