-- Add missing indexes on arrest_records table
-- Critical for bail lead marketplace performance
CREATE INDEX IF NOT EXISTS idx_arrest_records_state
  ON arrest_records (state);

CREATE INDEX IF NOT EXISTS idx_arrest_records_bail_amount
  ON arrest_records (bail_amount);

CREATE INDEX IF NOT EXISTS idx_arrest_records_county_state
  ON arrest_records (county, state);

CREATE INDEX IF NOT EXISTS idx_arrest_records_created_at
  ON arrest_records (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_records_name_search
  ON arrest_records (defendant_name text_pattern_ops);

-- Composite for the most common filter: state + bail range
CREATE INDEX IF NOT EXISTS idx_arrest_records_state_bail
  ON arrest_records (state, bail_amount)
  WHERE bail_amount > 0;
