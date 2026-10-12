-- 00000000000016_remove_junk_lawyers.sql
--
-- Owner decision (2026-10-12): remove two lawyer rows that an earlier
-- state-bar scrape created from page headings, not attorneys:
--   * "A Colorado Bar Association membership connects you to knowled…" (Denver, CO)
--   * "Layer" (Anchorage, AK)
--
-- Rows are matched by source_id AND name (never by id alone), so this cannot
-- touch any other provider, whatever ids a given database assigned.
-- A suppression list stops the data-refresh scrapers from re-adding them.
-- Idempotent: safe to run any number of times.

CREATE TABLE IF NOT EXISTS provider_suppressions (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT        NOT NULL,
  source_id   TEXT        NOT NULL,
  name        TEXT,
  reason      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (table_name, source_id)
);
ALTER TABLE provider_suppressions ENABLE ROW LEVEL SECURITY;

INSERT INTO provider_suppressions (table_name, source_id, name, reason) VALUES
  ('lawyers', 'bar_CO_a_colorado_bar_association_mem',
   'A Colorado Bar Association membership connects you to knowled',
   'Scraped page heading, not an attorney (owner removal 2026-10-12)'),
  ('lawyers', 'bar_AK_layer', 'Layer',
   'Scraped page heading, not an attorney (owner removal 2026-10-12)')
ON CONFLICT (table_name, source_id) DO NOTHING;

DO $$
DECLARE
  junk_ids BIGINT[];
  t        RECORD;
  n        BIGINT;
BEGIN
  SELECT COALESCE(array_agg(l.id), '{}') INTO junk_ids
    FROM lawyers l
   WHERE (l.source_id = 'bar_CO_a_colorado_bar_association_mem'
          AND l.name ILIKE 'A Colorado Bar Association membership%')
      OR (l.source_id = 'bar_AK_layer' AND l.name = 'Layer');

  IF array_length(junk_ids, 1) IS NULL THEN
    RAISE NOTICE '[016] junk lawyer rows already removed — nothing to do';
    RETURN;
  END IF;

  -- Rows in other tables that point at these lawyers by a lawyer_id column
  -- (most have no FK). lawyer_profiles cascades on its own.
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'lawyer_id'
       AND tb.table_type = 'BASE TABLE'
       AND c.data_type IN ('bigint', 'integer', 'smallint', 'numeric')
  LOOP
    EXECUTE format('DELETE FROM %I WHERE lawyer_id = ANY($1)', t.table_name) USING junk_ids;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[016] removed % row(s) from %', n, t.table_name; END IF;
  END LOOP;

  -- Pending/old review-queue entries for these rows (table from migration 015).
  IF to_regclass('public.provider_update_proposals') IS NOT NULL THEN
    DELETE FROM provider_update_proposals
     WHERE table_name = 'lawyers' AND record_id = ANY(junk_ids);
  END IF;

  DELETE FROM lawyers WHERE id = ANY(junk_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[016] removed % junk lawyer row(s)', n;
END $$;
