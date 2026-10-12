-- 00000000000018_remove_placeholder_bail_agents.sql
--
-- Owner decision (2026-10-12): remove three placeholder bail-agent rows left
-- over from early test data. They have no source, use the 555 placeholder
-- exchange, and were wrongly marked verified=1:
--   1 Fast Freedom Bail (Nashville TN)  615-555-1001
--   2 Nashville Bail Co (Nashville TN)  615-555-1002
--   3 ATL Bail Bonds    (Atlanta GA)    404-555-2001
--
-- Each row is matched on name + phone + empty source together (never id
-- alone). References are cleared only where the referencing row is clearly
-- about a bail agent (typed columns), or is an orphan (an untyped provider_id
-- that matches no lawyer either). Idempotent.

DO $$
DECLARE
  junk_ids BIGINT[];
  n        BIGINT;
BEGIN
  SELECT COALESCE(array_agg(b.id), '{}') INTO junk_ids
    FROM bail_agents b
    JOIN (VALUES
      ('Fast Freedom Bail', '615-555-1001'),
      ('Nashville Bail Co', '615-555-1002'),
      ('ATL Bail Bonds',    '404-555-2001')
    ) AS p(name, phone)
      ON b.name = p.name AND b.phone = p.phone
   WHERE COALESCE(b.source, '') = '' AND COALESCE(b.source_id, '') = '';

  IF array_length(junk_ids, 1) IS NULL THEN
    RAISE NOTICE '[018] placeholder bail-agent rows already removed — nothing to do';
    RETURN;
  END IF;

  -- Typed references to bail agents.
  IF to_regclass('public.reviews') IS NOT NULL THEN
    DELETE FROM reviews
     WHERE provider_id = ANY(junk_ids)
       AND (entity_type IN ('bail_agent', 'bail', 'bondsman')
            OR (entity_type IS NULL AND NOT EXISTS (SELECT 1 FROM lawyers l WHERE l.id = reviews.provider_id)));
  END IF;
  IF to_regclass('public.reviews_app') IS NOT NULL THEN
    DELETE FROM reviews_app
     WHERE provider_id = ANY(junk_ids)
       AND (entity_type IN ('bail_agent', 'bail', 'bondsman')
            OR (entity_type IS NULL AND NOT EXISTS (SELECT 1 FROM lawyers l WHERE l.id = reviews_app.provider_id)));
  END IF;
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    DELETE FROM subscriptions WHERE provider_type = 'bail_agent' AND provider_id = ANY(junk_ids);
  END IF;
  IF to_regclass('public.saved_lawyers') IS NOT NULL THEN
    DELETE FROM saved_lawyers
     WHERE provider_id = ANY(junk_ids)
       AND NOT EXISTS (SELECT 1 FROM lawyers l WHERE l.id = saved_lawyers.provider_id);
  END IF;
  IF to_regclass('public.provider_update_proposals') IS NOT NULL THEN
    DELETE FROM provider_update_proposals WHERE table_name = 'bail_agents' AND record_id = ANY(junk_ids);
  END IF;

  DELETE FROM bail_agents WHERE id = ANY(junk_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[018] removed % placeholder bail-agent row(s)', n;
END $$;
