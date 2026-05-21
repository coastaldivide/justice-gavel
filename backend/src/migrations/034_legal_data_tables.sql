-- Legal data tables: bail schedules, DUI laws, drug penalties,
-- statute of limitations, federal courts, victim compensation,
-- law school clinics, state bar complaints
CREATE TABLE IF NOT EXISTS bail_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL, charge TEXT NOT NULL,
    charge_type TEXT NOT NULL, severity TEXT, bail_min INTEGER, bail_max INTEGER,
    bail_note TEXT, source TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS dui_laws (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL UNIQUE,
    bac_limit REAL DEFAULT 0.08, bac_limit_cdl REAL, bac_limit_under21 REAL,
    first_jail_min INTEGER, first_jail_max INTEGER,
    first_fine_min INTEGER, first_fine_max INTEGER, first_license_days INTEGER,
    second_jail_min INTEGER, second_fine_min INTEGER, second_license_days INTEGER,
    felony_threshold INTEGER, implied_consent INTEGER, alr_days INTEGER,
    dmv_hearing_deadline INTEGER, ignition_interlock TEXT, notes TEXT, source TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS drug_penalties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL,
    drug_schedule TEXT NOT NULL, offense_type TEXT NOT NULL,
    amount_threshold TEXT, charge_level TEXT NOT NULL,
    min_days INTEGER, max_days INTEGER, min_fine INTEGER, max_fine INTEGER,
    notes TEXT, source TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS statute_of_limitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL,
    crime_type TEXT NOT NULL, years REAL, notes TEXT, source TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS federal_courts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, district TEXT NOT NULL,
    state TEXT NOT NULL, city TEXT NOT NULL, name TEXT NOT NULL,
    address TEXT NOT NULL, phone TEXT, hours TEXT, lat REAL, lng REAL,
    url TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS victim_compensation (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL UNIQUE,
    program_name TEXT NOT NULL, phone TEXT, url TEXT, address TEXT,
    max_award INTEGER, covers TEXT, deadline_days INTEGER, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS law_school_clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT, school TEXT NOT NULL,
    city TEXT NOT NULL, state TEXT NOT NULL, clinic_name TEXT NOT NULL,
    phone TEXT, url TEXT, address TEXT, focus TEXT, free INTEGER DEFAULT 1,
    notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS state_bar_complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL UNIQUE,
    bar_name TEXT NOT NULL, phone TEXT, url TEXT, address TEXT,
    online_form TEXT, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS probation_offices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL, city TEXT,
    office_name TEXT NOT NULL, address TEXT, phone TEXT, hours TEXT,
    url TEXT, type TEXT DEFAULT "probation", notes TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bail_state ON bail_schedules(state);
CREATE INDEX IF NOT EXISTS idx_drug_state ON drug_penalties(state);
CREATE INDEX IF NOT EXISTS idx_sol_state ON statute_of_limitations(state);
CREATE INDEX IF NOT EXISTS idx_fed_state ON federal_courts(state);
CREATE INDEX IF NOT EXISTS idx_clinic_state ON law_school_clinics(state);
CREATE INDEX IF NOT EXISTS idx_prob_state ON probation_offices(state);
