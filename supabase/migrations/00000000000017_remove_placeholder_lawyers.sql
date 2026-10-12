-- 00000000000017_remove_placeholder_lawyers.sql
--
-- Owner decision (2026-10-12): remove seven placeholder lawyer rows left over
-- from early test data. They have no source, and their phone numbers use the
-- 555 placeholder exchange (555-01xx is reserved for fiction), so "call"
-- reaches nobody:
--   1 James Thompson (Nashville TN)   615-555-0101
--   2 Maria Rodriguez (Nashville TN)  615-555-0102
--   3 David Kim (Nashville TN)        615-555-0103
--   4 Sarah Williams (Atlanta GA)     404-555-0201
--   5 Robert Johnson (Atlanta GA)     404-555-0202
--   6 Lisa Chen (Los Angeles CA)      310-555-0301
--   7 Michael Brown (Chicago IL)      312-555-0401
--
-- Each row is matched on name + phone + empty source together (never id
-- alone), so no real provider can be hit. Rows in other tables that point at
-- them by lawyer_id are cleared first. Idempotent.

DO $$
DECLARE
  junk_ids BIGINT[];
  t        RECORD;
  n        BIGINT;
BEGIN
  SELECT COALESCE(array_agg(l.id), '{}') INTO junk_ids
    FROM lawyers l
    JOIN (VALUES
      ('James Thompson',  '615-555-0101'),
      ('Maria Rodriguez', '615-555-0102'),
      ('David Kim',       '615-555-0103'),
      ('Sarah Williams',  '404-555-0201'),
      ('Robert Johnson',  '404-555-0202'),
      ('Lisa Chen',       '310-555-0301'),
      ('Michael Brown',   '312-555-0401')
    ) AS p(name, phone)
      ON l.name = p.name AND l.phone = p.phone
   WHERE COALESCE(l.source, '') = '' AND COALESCE(l.source_id, '') = '';

  IF array_length(junk_ids, 1) IS NULL THEN
    RAISE NOTICE '[017] placeholder lawyer rows already removed — nothing to do';
    RETURN;
  END IF;

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
    IF n > 0 THEN RAISE NOTICE '[017] removed % row(s) from %', n, t.table_name; END IF;
  END LOOP;

  IF to_regclass('public.provider_update_proposals') IS NOT NULL THEN
    DELETE FROM provider_update_proposals
     WHERE table_name = 'lawyers' AND record_id = ANY(junk_ids);
  END IF;

  DELETE FROM lawyers WHERE id = ANY(junk_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[017] removed % placeholder lawyer row(s)', n;
END $$;
