-- ══════════════════════════════════════════════════════════════════════════════
-- Justice Gavel — Enable Row Level Security on ALL tables
-- Applied: June 4, 2026 — Confirmed PROTECTED in Supabase Security Advisor
--
-- Backend uses service_role key which BYPASSES RLS automatically.
-- All client requests go through Express API → never direct DB access.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.users                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bail_agents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.research_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.research_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.consultations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reviews_app                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pi_leads                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.motions                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cases                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.refresh_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subscriptions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_log                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.attorneys                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.firms                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.firm_members               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.checkins                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.push_tokens                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_disclaimer_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jobs                       ENABLE ROW LEVEL SECURITY;

-- Catch-all: lock down any table not listed above
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND NOT rowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    RAISE NOTICE 'RLS enabled: %', tbl;
  END LOOP;
END;
$$;

-- Verify — every table should show PROTECTED
SELECT tablename,
       CASE WHEN rowsecurity THEN 'PROTECTED' ELSE 'EXPOSED' END AS status
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
