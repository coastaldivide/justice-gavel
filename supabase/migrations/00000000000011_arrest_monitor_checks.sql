-- ── Arrest monitors: nightly check bookkeeping ──────────────────────────────
-- The app's Arrest Monitor screen shows "Last checked" and a "Match found"
-- badge per monitor. Until step 6 these columns did not exist and no job ever
-- matched monitors against arrest_records; services/arrest_alerts.js now
-- checks every active monitor during the nightly alert run and records the
-- outcome here. Idempotent.

ALTER TABLE arrest_monitors ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ;
-- 'found' | 'none' — result of the most recent nightly check
ALTER TABLE arrest_monitors ADD COLUMN IF NOT EXISTS last_result TEXT;

CREATE INDEX IF NOT EXISTS idx_arrest_monitors_active ON arrest_monitors (active);
CREATE INDEX IF NOT EXISTS idx_arrest_monitors_user ON arrest_monitors (user_id);
