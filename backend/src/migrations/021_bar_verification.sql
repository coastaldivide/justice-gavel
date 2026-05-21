-- 021_bar_verification.sql
-- Adds bar verification tracking to the lawyers provider table
-- bar_verified:       attorney has submitted bar number and it was verified
-- bar_verified_since: when verification was confirmed
-- jtb_verified:       manually verified by Justice Gavel team (higher trust)
-- jtb_verified_since: when JTB team verified

ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS bar_verified       INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS bar_verified_since TEXT    DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS jtb_verified       INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS jtb_verified_since TEXT    DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_lawyers_bar_verified ON lawyers(bar_verified);
CREATE INDEX IF NOT EXISTS idx_lawyers_jtb_verified ON lawyers(jtb_verified);
