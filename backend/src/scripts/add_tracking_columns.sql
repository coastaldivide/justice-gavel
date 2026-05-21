-- Justice Gavel: Add source tracking columns to all legal data tables
-- Run once after deployment:
--   sqlite3 demo.db < add_tracking_columns.sql

ALTER TABLE dui_laws                ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE dui_laws                ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE dui_laws                ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE drug_penalties          ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE drug_penalties          ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE drug_penalties          ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE bail_schedules          ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE bail_schedules          ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE bail_schedules          ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE statute_of_limitations  ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE statute_of_limitations  ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE statute_of_limitations  ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE victim_compensation     ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE victim_compensation     ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE victim_compensation     ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE state_bar_complaints    ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE state_bar_complaints    ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE state_bar_complaints    ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE specialty_courts        ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE specialty_courts        ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE courthouses             ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE courthouses             ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE law_school_clinics      ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE law_school_clinics      ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE law_school_clinics      ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE federal_courts          ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE federal_courts          ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE federal_courts          ADD COLUMN IF NOT EXISTS source_url   TEXT;

ALTER TABLE probation_offices       ADD COLUMN IF NOT EXISTS updated_at   TEXT;
ALTER TABLE probation_offices       ADD COLUMN IF NOT EXISTS verified_by  TEXT;
ALTER TABLE probation_offices       ADD COLUMN IF NOT EXISTS source_url   TEXT;
