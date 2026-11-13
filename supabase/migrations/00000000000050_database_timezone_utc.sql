-- 00000000000050_database_timezone_utc.sql
-- Sandbox review 2026-11-12, bug 4: dates, day buckets and Case Pass end times
-- assume UTC. The backend also runs SET TIME ZONE 'UTC' on every connection
-- (src/db/index.js); this sets the database default too, for psql sessions,
-- scripts and anything else that connects. Idempotent. A role without the right
-- to ALTER DATABASE (some hosted plans) gets a NOTICE and the migration goes on.
DO $$
BEGIN
  IF current_setting('TimeZone') IS DISTINCT FROM 'UTC'
     OR NOT EXISTS (
       SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = current_database() AND s.setrole = 0
          AND 'TimeZone=UTC' = ANY (s.setconfig)) THEN
    EXECUTE format('ALTER DATABASE %I SET "TimeZone" = %L', current_database(), 'UTC');
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set the database time zone to UTC (insufficient privilege); the backend sets it per connection.';
END
$$;
