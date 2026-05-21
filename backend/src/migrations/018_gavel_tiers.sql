-- 018_gavel_tiers.sql
-- Bronze and Silver Gavel tiers
--
-- Adds a gavel_level column to users:
--   0 = none
--   1 = Bronze
--   2 = Silver
--   3 = Golden  (existing golden_gavel=1 maps to level 3)
--
-- golden_gavel column is kept for backward compatibility.
-- gavel_level is the authoritative field going forward.

ALTER TABLE users ADD COLUMN IF NOT EXISTS gavel_level          INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gavel_level_awarded_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gavel_bronze_at       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gavel_silver_at       TEXT;

-- Back-fill gavel_level from existing golden_gavel flag
UPDATE users SET gavel_level = 3, gavel_level_awarded_at = golden_gavel_awarded_at
  WHERE golden_gavel = 1 AND gavel_level = 0;

-- Add gavel_level to hall of justice for display
ALTER TABLE golden_gavel_hall ADD COLUMN IF NOT EXISTS gavel_level INTEGER DEFAULT 3;
