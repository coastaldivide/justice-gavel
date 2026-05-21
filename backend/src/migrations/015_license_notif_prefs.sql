-- 015_license_notif_prefs.sql
-- Bondsman license fields on bail_agents
-- Notification preference columns on users

-- Add license fields to bail_agents (provider directory)
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS license_number TEXT DEFAULT NULL;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS license_state  TEXT DEFAULT NULL;
ALTER TABLE bail_agents ADD COLUMN IF NOT EXISTS license_verified INTEGER DEFAULT 0;

-- Add license fields to bondsman_profiles (B2B accounts)  
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS license_state TEXT DEFAULT NULL;

-- Notification preferences per user (granular control)
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_court_reminders  INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_legal_tips        INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_arrest_alerts     INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_marketing         INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_checkin_reminders INTEGER DEFAULT 1;
