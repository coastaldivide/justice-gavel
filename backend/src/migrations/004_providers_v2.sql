-- ============================================================
-- 004_providers_v2.sql
-- Adds full contact + enrichment columns to lawyers and bail_agents
-- Adds provider_update_log for full audit trail
-- Safe to run repeatedly (uses ADD COLUMN IF NOT EXISTS pattern via triggers)
-- ============================================================

-- lawyers enrichment columns
ALTER TABLE lawyers ADD COLUMN specialties    TEXT    DEFAULT '[]';
ALTER TABLE lawyers ADD COLUMN languages      TEXT    DEFAULT '["English"]';
ALTER TABLE lawyers ADD COLUMN bio            TEXT    DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN email          TEXT    DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN hours          TEXT    DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN sliding_scale  INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN free_consultation INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN years_experience  INTEGER DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN active         INTEGER DEFAULT 1;
ALTER TABLE lawyers ADD COLUMN last_verified_at  TEXT DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN data_source_ids   TEXT DEFAULT '{}';
ALTER TABLE lawyers ADD COLUMN updated_at     TEXT DEFAULT (datetime('now'));
ALTER TABLE lawyers ADD COLUMN created_at     TEXT DEFAULT (datetime('now'));

-- bail_agents enrichment columns
ALTER TABLE bail_agents ADD COLUMN email          TEXT    DEFAULT NULL;
ALTER TABLE bail_agents ADD COLUMN hours          TEXT    DEFAULT NULL;
ALTER TABLE bail_agents ADD COLUMN active         INTEGER DEFAULT 1;
ALTER TABLE bail_agents ADD COLUMN last_verified_at  TEXT DEFAULT NULL;
ALTER TABLE bail_agents ADD COLUMN data_source_ids   TEXT DEFAULT '{}';
ALTER TABLE bail_agents ADD COLUMN updated_at     TEXT DEFAULT (datetime('now'));
ALTER TABLE bail_agents ADD COLUMN created_at     TEXT DEFAULT (datetime('now'));

-- Audit log: every field update to a provider record
CREATE TABLE IF NOT EXISTS provider_update_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  record_id   INTEGER NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  source      TEXT NOT NULL,   -- 'google', 'yelp', 'manual', 'seed', 'admin'
  changed_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pul_record  ON provider_update_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_pul_changed ON provider_update_log(changed_at);

-- Index for geo queries
CREATE INDEX IF NOT EXISTS idx_lawyers_city    ON lawyers(city);
CREATE INDEX IF NOT EXISTS idx_lawyers_active  ON lawyers(active);
CREATE INDEX IF NOT EXISTS idx_lawyers_latng   ON lawyers(lat, lng);
CREATE INDEX IF NOT EXISTS idx_bail_city       ON bail_agents(city);
CREATE INDEX IF NOT EXISTS idx_bail_latng      ON bail_agents(lat, lng);
