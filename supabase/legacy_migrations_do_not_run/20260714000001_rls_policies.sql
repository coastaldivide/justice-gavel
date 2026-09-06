-- ============================================================
-- Migration: 20260714000001_rls_policies.sql
-- RLS Policies for all 136 tables
-- 
-- Architecture:
--   - All access goes through Express backend using service_role key
--   - anon key has NO direct table access (backend is the only client)
--   - authenticated JWT users can only access their own data
--   - Policies are belt-and-suspenders: the backend enforces ownership
--     in SQL WHERE clauses, RLS is a second layer
--
-- Policy convention:
--   SELECT: user sees rows where user_id = auth.uid()
--   INSERT: user can insert with user_id = auth.uid()
--   UPDATE: user can update only their own rows
--   DELETE: user can delete only their own rows
-- ============================================================

-- Enable RLS on tables missing it
ALTER TABLE IF EXISTS cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS arrest_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bondsman_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS case_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bail_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bail_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS checkin_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS checkin_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS firm_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS firm_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pi_leads ENABLE ROW LEVEL SECURITY;

-- ===========================================================
-- USER-OWNED TABLES (user_id = auth.uid())
-- ===========================================================

-- cases
DROP POLICY IF EXISTS "cases_select_own" ON cases;
DROP POLICY IF EXISTS "cases_insert_own" ON cases;
DROP POLICY IF EXISTS "cases_update_own" ON cases;
DROP POLICY IF EXISTS "cases_delete_own" ON cases;
CREATE POLICY "cases_select_own" ON cases FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "cases_insert_own" ON cases FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "cases_update_own" ON cases FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "cases_delete_own" ON cases FOR DELETE USING (user_id = auth.uid());

-- case_events
DROP POLICY IF EXISTS "case_events_select_own" ON case_events;
DROP POLICY IF EXISTS "case_events_insert_own" ON case_events;
DROP POLICY IF EXISTS "case_events_update_own" ON case_events;
DROP POLICY IF EXISTS "case_events_delete_own" ON case_events;
CREATE POLICY "case_events_select_own" ON case_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "case_events_insert_own" ON case_events FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "case_events_update_own" ON case_events FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "case_events_delete_own" ON case_events FOR DELETE USING (user_id = auth.uid());

-- checkins
DROP POLICY IF EXISTS "checkins_select_own" ON checkins;
DROP POLICY IF EXISTS "checkins_insert_own" ON checkins;
DROP POLICY IF EXISTS "checkins_update_own" ON checkins;
DROP POLICY IF EXISTS "checkins_delete_own" ON checkins;
CREATE POLICY "checkins_select_own" ON checkins FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "checkins_insert_own" ON checkins FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "checkins_update_own" ON checkins FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "checkins_delete_own" ON checkins FOR DELETE USING (user_id = auth.uid());

-- family_contacts
DROP POLICY IF EXISTS "family_contacts_select_own" ON family_contacts;
DROP POLICY IF EXISTS "family_contacts_insert_own" ON family_contacts;
DROP POLICY IF EXISTS "family_contacts_update_own" ON family_contacts;
DROP POLICY IF EXISTS "family_contacts_delete_own" ON family_contacts;
CREATE POLICY "family_contacts_select_own" ON family_contacts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "family_contacts_insert_own" ON family_contacts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "family_contacts_update_own" ON family_contacts FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "family_contacts_delete_own" ON family_contacts FOR DELETE USING (user_id = auth.uid());

-- scheduled_pushes
DROP POLICY IF EXISTS "scheduled_pushes_select_own" ON scheduled_pushes;
DROP POLICY IF EXISTS "scheduled_pushes_insert_own" ON scheduled_pushes;
DROP POLICY IF EXISTS "scheduled_pushes_update_own" ON scheduled_pushes;
DROP POLICY IF EXISTS "scheduled_pushes_delete_own" ON scheduled_pushes;
CREATE POLICY "scheduled_pushes_select_own" ON scheduled_pushes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "scheduled_pushes_insert_own" ON scheduled_pushes FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "scheduled_pushes_update_own" ON scheduled_pushes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "scheduled_pushes_delete_own" ON scheduled_pushes FOR DELETE USING (user_id = auth.uid());

-- push_tokens
DROP POLICY IF EXISTS "push_tokens_select_own" ON push_tokens;
DROP POLICY IF EXISTS "push_tokens_insert_own" ON push_tokens;
DROP POLICY IF EXISTS "push_tokens_update_own" ON push_tokens;
DROP POLICY IF EXISTS "push_tokens_delete_own" ON push_tokens;
CREATE POLICY "push_tokens_select_own" ON push_tokens FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "push_tokens_insert_own" ON push_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_tokens_update_own" ON push_tokens FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "push_tokens_delete_own" ON push_tokens FOR DELETE USING (user_id = auth.uid());

-- saved_lawyers
DROP POLICY IF EXISTS "saved_lawyers_select_own" ON saved_lawyers;
DROP POLICY IF EXISTS "saved_lawyers_insert_own" ON saved_lawyers;
DROP POLICY IF EXISTS "saved_lawyers_update_own" ON saved_lawyers;
DROP POLICY IF EXISTS "saved_lawyers_delete_own" ON saved_lawyers;
CREATE POLICY "saved_lawyers_select_own" ON saved_lawyers FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "saved_lawyers_insert_own" ON saved_lawyers FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_lawyers_update_own" ON saved_lawyers FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "saved_lawyers_delete_own" ON saved_lawyers FOR DELETE USING (user_id = auth.uid());

-- consultations
DROP POLICY IF EXISTS "consultations_select_own" ON consultations;
DROP POLICY IF EXISTS "consultations_insert_own" ON consultations;
DROP POLICY IF EXISTS "consultations_update_own" ON consultations;
DROP POLICY IF EXISTS "consultations_delete_own" ON consultations;
CREATE POLICY "consultations_select_own" ON consultations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "consultations_insert_own" ON consultations FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "consultations_update_own" ON consultations FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "consultations_delete_own" ON consultations FOR DELETE USING (user_id = auth.uid());

-- reviews_app
DROP POLICY IF EXISTS "reviews_app_select_own" ON reviews_app;
DROP POLICY IF EXISTS "reviews_app_insert_own" ON reviews_app;
DROP POLICY IF EXISTS "reviews_app_update_own" ON reviews_app;
DROP POLICY IF EXISTS "reviews_app_delete_own" ON reviews_app;
CREATE POLICY "reviews_app_select_own" ON reviews_app FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "reviews_app_insert_own" ON reviews_app FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "reviews_app_update_own" ON reviews_app FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "reviews_app_delete_own" ON reviews_app FOR DELETE USING (user_id = auth.uid());

-- chat_sessions
DROP POLICY IF EXISTS "chat_sessions_select_own" ON chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_insert_own" ON chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_update_own" ON chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_delete_own" ON chat_sessions;
CREATE POLICY "chat_sessions_select_own" ON chat_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "chat_sessions_insert_own" ON chat_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "chat_sessions_update_own" ON chat_sessions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "chat_sessions_delete_own" ON chat_sessions FOR DELETE USING (user_id = auth.uid());

-- research_sessions
DROP POLICY IF EXISTS "research_sessions_select_own" ON research_sessions;
DROP POLICY IF EXISTS "research_sessions_insert_own" ON research_sessions;
DROP POLICY IF EXISTS "research_sessions_update_own" ON research_sessions;
DROP POLICY IF EXISTS "research_sessions_delete_own" ON research_sessions;
CREATE POLICY "research_sessions_select_own" ON research_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "research_sessions_insert_own" ON research_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "research_sessions_update_own" ON research_sessions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "research_sessions_delete_own" ON research_sessions FOR DELETE USING (user_id = auth.uid());

-- motions
DROP POLICY IF EXISTS "motions_select_own" ON motions;
DROP POLICY IF EXISTS "motions_insert_own" ON motions;
DROP POLICY IF EXISTS "motions_update_own" ON motions;
DROP POLICY IF EXISTS "motions_delete_own" ON motions;
CREATE POLICY "motions_select_own" ON motions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "motions_insert_own" ON motions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "motions_update_own" ON motions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "motions_delete_own" ON motions FOR DELETE USING (user_id = auth.uid());

-- discovery_analyses
DROP POLICY IF EXISTS "discovery_analyses_select_own" ON discovery_analyses;
DROP POLICY IF EXISTS "discovery_analyses_insert_own" ON discovery_analyses;
DROP POLICY IF EXISTS "discovery_analyses_update_own" ON discovery_analyses;
DROP POLICY IF EXISTS "discovery_analyses_delete_own" ON discovery_analyses;
CREATE POLICY "discovery_analyses_select_own" ON discovery_analyses FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "discovery_analyses_insert_own" ON discovery_analyses FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "discovery_analyses_update_own" ON discovery_analyses FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "discovery_analyses_delete_own" ON discovery_analyses FOR DELETE USING (user_id = auth.uid());

-- user_subscriptions
DROP POLICY IF EXISTS "user_subscriptions_select_own" ON user_subscriptions;
DROP POLICY IF EXISTS "user_subscriptions_insert_own" ON user_subscriptions;
DROP POLICY IF EXISTS "user_subscriptions_update_own" ON user_subscriptions;
DROP POLICY IF EXISTS "user_subscriptions_delete_own" ON user_subscriptions;
CREATE POLICY "user_subscriptions_select_own" ON user_subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_subscriptions_insert_own" ON user_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_subscriptions_update_own" ON user_subscriptions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "user_subscriptions_delete_own" ON user_subscriptions FOR DELETE USING (user_id = auth.uid());

-- arrest_monitors
DROP POLICY IF EXISTS "arrest_monitors_select_own" ON arrest_monitors;
DROP POLICY IF EXISTS "arrest_monitors_insert_own" ON arrest_monitors;
DROP POLICY IF EXISTS "arrest_monitors_update_own" ON arrest_monitors;
DROP POLICY IF EXISTS "arrest_monitors_delete_own" ON arrest_monitors;
CREATE POLICY "arrest_monitors_select_own" ON arrest_monitors FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "arrest_monitors_insert_own" ON arrest_monitors FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "arrest_monitors_update_own" ON arrest_monitors FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "arrest_monitors_delete_own" ON arrest_monitors FOR DELETE USING (user_id = auth.uid());

-- bondsman_profiles
DROP POLICY IF EXISTS "bondsman_profiles_select_own" ON bondsman_profiles;
DROP POLICY IF EXISTS "bondsman_profiles_insert_own" ON bondsman_profiles;
DROP POLICY IF EXISTS "bondsman_profiles_update_own" ON bondsman_profiles;
DROP POLICY IF EXISTS "bondsman_profiles_delete_own" ON bondsman_profiles;
CREATE POLICY "bondsman_profiles_select_own" ON bondsman_profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "bondsman_profiles_insert_own" ON bondsman_profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "bondsman_profiles_update_own" ON bondsman_profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "bondsman_profiles_delete_own" ON bondsman_profiles FOR DELETE USING (user_id = auth.uid());

-- golden_gavel
DROP POLICY IF EXISTS "golden_gavel_select_own" ON golden_gavel;
DROP POLICY IF EXISTS "golden_gavel_insert_own" ON golden_gavel;
DROP POLICY IF EXISTS "golden_gavel_update_own" ON golden_gavel;
DROP POLICY IF EXISTS "golden_gavel_delete_own" ON golden_gavel;
CREATE POLICY "golden_gavel_select_own" ON golden_gavel FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "golden_gavel_insert_own" ON golden_gavel FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "golden_gavel_update_own" ON golden_gavel FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "golden_gavel_delete_own" ON golden_gavel FOR DELETE USING (user_id = auth.uid());

-- offline_cases
DROP POLICY IF EXISTS "offline_cases_select_own" ON offline_cases;
DROP POLICY IF EXISTS "offline_cases_insert_own" ON offline_cases;
DROP POLICY IF EXISTS "offline_cases_update_own" ON offline_cases;
DROP POLICY IF EXISTS "offline_cases_delete_own" ON offline_cases;
CREATE POLICY "offline_cases_select_own" ON offline_cases FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "offline_cases_insert_own" ON offline_cases FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "offline_cases_update_own" ON offline_cases FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "offline_cases_delete_own" ON offline_cases FOR DELETE USING (user_id = auth.uid());

-- expungement_referrals
DROP POLICY IF EXISTS "expungement_referrals_select_own" ON expungement_referrals;
DROP POLICY IF EXISTS "expungement_referrals_insert_own" ON expungement_referrals;
DROP POLICY IF EXISTS "expungement_referrals_update_own" ON expungement_referrals;
DROP POLICY IF EXISTS "expungement_referrals_delete_own" ON expungement_referrals;
CREATE POLICY "expungement_referrals_select_own" ON expungement_referrals FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "expungement_referrals_insert_own" ON expungement_referrals FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "expungement_referrals_update_own" ON expungement_referrals FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "expungement_referrals_delete_own" ON expungement_referrals FOR DELETE USING (user_id = auth.uid());

-- hague_intakes
DROP POLICY IF EXISTS "hague_intakes_select_own" ON hague_intakes;
DROP POLICY IF EXISTS "hague_intakes_insert_own" ON hague_intakes;
DROP POLICY IF EXISTS "hague_intakes_update_own" ON hague_intakes;
DROP POLICY IF EXISTS "hague_intakes_delete_own" ON hague_intakes;
CREATE POLICY "hague_intakes_select_own" ON hague_intakes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "hague_intakes_insert_own" ON hague_intakes FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "hague_intakes_update_own" ON hague_intakes FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "hague_intakes_delete_own" ON hague_intakes FOR DELETE USING (user_id = auth.uid());

-- web_push_subscriptions
DROP POLICY IF EXISTS "web_push_subscriptions_select_own" ON web_push_subscriptions;
DROP POLICY IF EXISTS "web_push_subscriptions_insert_own" ON web_push_subscriptions;
DROP POLICY IF EXISTS "web_push_subscriptions_update_own" ON web_push_subscriptions;
DROP POLICY IF EXISTS "web_push_subscriptions_delete_own" ON web_push_subscriptions;
CREATE POLICY "web_push_subscriptions_select_own" ON web_push_subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "web_push_subscriptions_insert_own" ON web_push_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "web_push_subscriptions_update_own" ON web_push_subscriptions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "web_push_subscriptions_delete_own" ON web_push_subscriptions FOR DELETE USING (user_id = auth.uid());

-- case_messages
DROP POLICY IF EXISTS "case_messages_select_own" ON case_messages;
DROP POLICY IF EXISTS "case_messages_insert_own" ON case_messages;
DROP POLICY IF EXISTS "case_messages_update_own" ON case_messages;
DROP POLICY IF EXISTS "case_messages_delete_own" ON case_messages;
CREATE POLICY "case_messages_select_own" ON case_messages FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "case_messages_insert_own" ON case_messages FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "case_messages_update_own" ON case_messages FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "case_messages_delete_own" ON case_messages FOR DELETE USING (user_id = auth.uid());

-- integration_external_ids
DROP POLICY IF EXISTS "integration_external_ids_select_own" ON integration_external_ids;
DROP POLICY IF EXISTS "integration_external_ids_insert_own" ON integration_external_ids;
DROP POLICY IF EXISTS "integration_external_ids_update_own" ON integration_external_ids;
DROP POLICY IF EXISTS "integration_external_ids_delete_own" ON integration_external_ids;
CREATE POLICY "integration_external_ids_select_own" ON integration_external_ids FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "integration_external_ids_insert_own" ON integration_external_ids FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "integration_external_ids_update_own" ON integration_external_ids FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "integration_external_ids_delete_own" ON integration_external_ids FOR DELETE USING (user_id = auth.uid());

-- workspace_members
DROP POLICY IF EXISTS "workspace_members_select_own" ON workspace_members;
DROP POLICY IF EXISTS "workspace_members_insert_own" ON workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_own" ON workspace_members;
DROP POLICY IF EXISTS "workspace_members_delete_own" ON workspace_members;
CREATE POLICY "workspace_members_select_own" ON workspace_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "workspace_members_insert_own" ON workspace_members FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "workspace_members_update_own" ON workspace_members FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "workspace_members_delete_own" ON workspace_members FOR DELETE USING (user_id = auth.uid());

-- password_resets
DROP POLICY IF EXISTS "password_resets_select_own" ON password_resets;
DROP POLICY IF EXISTS "password_resets_insert_own" ON password_resets;
DROP POLICY IF EXISTS "password_resets_update_own" ON password_resets;
DROP POLICY IF EXISTS "password_resets_delete_own" ON password_resets;
CREATE POLICY "password_resets_select_own" ON password_resets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "password_resets_insert_own" ON password_resets FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "password_resets_update_own" ON password_resets FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "password_resets_delete_own" ON password_resets FOR DELETE USING (user_id = auth.uid());

-- callback_requests
DROP POLICY IF EXISTS "callback_requests_select_own" ON callback_requests;
DROP POLICY IF EXISTS "callback_requests_insert_own" ON callback_requests;
DROP POLICY IF EXISTS "callback_requests_update_own" ON callback_requests;
DROP POLICY IF EXISTS "callback_requests_delete_own" ON callback_requests;
CREATE POLICY "callback_requests_select_own" ON callback_requests FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "callback_requests_insert_own" ON callback_requests FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "callback_requests_update_own" ON callback_requests FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "callback_requests_delete_own" ON callback_requests FOR DELETE USING (user_id = auth.uid());

-- civil_attorney_profiles
DROP POLICY IF EXISTS "civil_attorney_profiles_select_own" ON civil_attorney_profiles;
DROP POLICY IF EXISTS "civil_attorney_profiles_insert_own" ON civil_attorney_profiles;
DROP POLICY IF EXISTS "civil_attorney_profiles_update_own" ON civil_attorney_profiles;
DROP POLICY IF EXISTS "civil_attorney_profiles_delete_own" ON civil_attorney_profiles;
CREATE POLICY "civil_attorney_profiles_select_own" ON civil_attorney_profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "civil_attorney_profiles_insert_own" ON civil_attorney_profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "civil_attorney_profiles_update_own" ON civil_attorney_profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "civil_attorney_profiles_delete_own" ON civil_attorney_profiles FOR DELETE USING (user_id = auth.uid());

-- payment_history
DROP POLICY IF EXISTS "payment_history_select_own" ON payment_history;
DROP POLICY IF EXISTS "payment_history_insert_own" ON payment_history;
DROP POLICY IF EXISTS "payment_history_update_own" ON payment_history;
DROP POLICY IF EXISTS "payment_history_delete_own" ON payment_history;
CREATE POLICY "payment_history_select_own" ON payment_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "payment_history_insert_own" ON payment_history FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "payment_history_update_own" ON payment_history FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "payment_history_delete_own" ON payment_history FOR DELETE USING (user_id = auth.uid());

-- refresh_tokens
DROP POLICY IF EXISTS "refresh_tokens_select_own" ON refresh_tokens;
DROP POLICY IF EXISTS "refresh_tokens_insert_own" ON refresh_tokens;
DROP POLICY IF EXISTS "refresh_tokens_update_own" ON refresh_tokens;
DROP POLICY IF EXISTS "refresh_tokens_delete_own" ON refresh_tokens;
CREATE POLICY "refresh_tokens_select_own" ON refresh_tokens FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "refresh_tokens_insert_own" ON refresh_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "refresh_tokens_update_own" ON refresh_tokens FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "refresh_tokens_delete_own" ON refresh_tokens FOR DELETE USING (user_id = auth.uid());

-- research_queries
DROP POLICY IF EXISTS "research_queries_select_own" ON research_queries;
DROP POLICY IF EXISTS "research_queries_insert_own" ON research_queries;
DROP POLICY IF EXISTS "research_queries_update_own" ON research_queries;
DROP POLICY IF EXISTS "research_queries_delete_own" ON research_queries;
CREATE POLICY "research_queries_select_own" ON research_queries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "research_queries_insert_own" ON research_queries FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "research_queries_update_own" ON research_queries FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "research_queries_delete_own" ON research_queries FOR DELETE USING (user_id = auth.uid());

-- video_sessions
DROP POLICY IF EXISTS "video_sessions_select_own" ON video_sessions;
DROP POLICY IF EXISTS "video_sessions_insert_own" ON video_sessions;
DROP POLICY IF EXISTS "video_sessions_update_own" ON video_sessions;
DROP POLICY IF EXISTS "video_sessions_delete_own" ON video_sessions;
CREATE POLICY "video_sessions_select_own" ON video_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "video_sessions_insert_own" ON video_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "video_sessions_update_own" ON video_sessions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "video_sessions_delete_own" ON video_sessions FOR DELETE USING (user_id = auth.uid());

-- ai_jobs
DROP POLICY IF EXISTS "ai_jobs_select_own" ON ai_jobs;
DROP POLICY IF EXISTS "ai_jobs_insert_own" ON ai_jobs;
DROP POLICY IF EXISTS "ai_jobs_update_own" ON ai_jobs;
DROP POLICY IF EXISTS "ai_jobs_delete_own" ON ai_jobs;
CREATE POLICY "ai_jobs_select_own" ON ai_jobs FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "ai_jobs_insert_own" ON ai_jobs FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_jobs_update_own" ON ai_jobs FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "ai_jobs_delete_own" ON ai_jobs FOR DELETE USING (user_id = auth.uid());

-- case_family_access
DROP POLICY IF EXISTS "case_family_access_select_own" ON case_family_access;
DROP POLICY IF EXISTS "case_family_access_insert_own" ON case_family_access;
DROP POLICY IF EXISTS "case_family_access_update_own" ON case_family_access;
DROP POLICY IF EXISTS "case_family_access_delete_own" ON case_family_access;
CREATE POLICY "case_family_access_select_own" ON case_family_access FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "case_family_access_insert_own" ON case_family_access FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "case_family_access_update_own" ON case_family_access FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "case_family_access_delete_own" ON case_family_access FOR DELETE USING (user_id = auth.uid());

-- cle_completions
DROP POLICY IF EXISTS "cle_completions_select_own" ON cle_completions;
DROP POLICY IF EXISTS "cle_completions_insert_own" ON cle_completions;
DROP POLICY IF EXISTS "cle_completions_update_own" ON cle_completions;
DROP POLICY IF EXISTS "cle_completions_delete_own" ON cle_completions;
CREATE POLICY "cle_completions_select_own" ON cle_completions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "cle_completions_insert_own" ON cle_completions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "cle_completions_update_own" ON cle_completions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "cle_completions_delete_own" ON cle_completions FOR DELETE USING (user_id = auth.uid());

-- consultation_bookings
DROP POLICY IF EXISTS "consultation_bookings_select_own" ON consultation_bookings;
DROP POLICY IF EXISTS "consultation_bookings_insert_own" ON consultation_bookings;
DROP POLICY IF EXISTS "consultation_bookings_update_own" ON consultation_bookings;
DROP POLICY IF EXISTS "consultation_bookings_delete_own" ON consultation_bookings;
CREATE POLICY "consultation_bookings_select_own" ON consultation_bookings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "consultation_bookings_insert_own" ON consultation_bookings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "consultation_bookings_update_own" ON consultation_bookings FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "consultation_bookings_delete_own" ON consultation_bookings FOR DELETE USING (user_id = auth.uid());

-- contract_executions
DROP POLICY IF EXISTS "contract_executions_select_own" ON contract_executions;
DROP POLICY IF EXISTS "contract_executions_insert_own" ON contract_executions;
DROP POLICY IF EXISTS "contract_executions_update_own" ON contract_executions;
DROP POLICY IF EXISTS "contract_executions_delete_own" ON contract_executions;
CREATE POLICY "contract_executions_select_own" ON contract_executions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "contract_executions_insert_own" ON contract_executions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "contract_executions_update_own" ON contract_executions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "contract_executions_delete_own" ON contract_executions FOR DELETE USING (user_id = auth.uid());

-- contract_redlines
DROP POLICY IF EXISTS "contract_redlines_select_own" ON contract_redlines;
DROP POLICY IF EXISTS "contract_redlines_insert_own" ON contract_redlines;
DROP POLICY IF EXISTS "contract_redlines_update_own" ON contract_redlines;
DROP POLICY IF EXISTS "contract_redlines_delete_own" ON contract_redlines;
CREATE POLICY "contract_redlines_select_own" ON contract_redlines FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "contract_redlines_insert_own" ON contract_redlines FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "contract_redlines_update_own" ON contract_redlines FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "contract_redlines_delete_own" ON contract_redlines FOR DELETE USING (user_id = auth.uid());

-- contract_reviews
DROP POLICY IF EXISTS "contract_reviews_select_own" ON contract_reviews;
DROP POLICY IF EXISTS "contract_reviews_insert_own" ON contract_reviews;
DROP POLICY IF EXISTS "contract_reviews_update_own" ON contract_reviews;
DROP POLICY IF EXISTS "contract_reviews_delete_own" ON contract_reviews;
CREATE POLICY "contract_reviews_select_own" ON contract_reviews FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "contract_reviews_insert_own" ON contract_reviews FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "contract_reviews_update_own" ON contract_reviews FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "contract_reviews_delete_own" ON contract_reviews FOR DELETE USING (user_id = auth.uid());

-- forum_posts
DROP POLICY IF EXISTS "forum_posts_select_own" ON forum_posts;
DROP POLICY IF EXISTS "forum_posts_insert_own" ON forum_posts;
DROP POLICY IF EXISTS "forum_posts_update_own" ON forum_posts;
DROP POLICY IF EXISTS "forum_posts_delete_own" ON forum_posts;
CREATE POLICY "forum_posts_select_own" ON forum_posts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "forum_posts_insert_own" ON forum_posts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "forum_posts_update_own" ON forum_posts FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "forum_posts_delete_own" ON forum_posts FOR DELETE USING (user_id = auth.uid());

-- golden_gavel_log
DROP POLICY IF EXISTS "golden_gavel_log_select_own" ON golden_gavel_log;
DROP POLICY IF EXISTS "golden_gavel_log_insert_own" ON golden_gavel_log;
DROP POLICY IF EXISTS "golden_gavel_log_update_own" ON golden_gavel_log;
DROP POLICY IF EXISTS "golden_gavel_log_delete_own" ON golden_gavel_log;
CREATE POLICY "golden_gavel_log_select_own" ON golden_gavel_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "golden_gavel_log_insert_own" ON golden_gavel_log FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "golden_gavel_log_update_own" ON golden_gavel_log FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "golden_gavel_log_delete_own" ON golden_gavel_log FOR DELETE USING (user_id = auth.uid());

-- matter_events
DROP POLICY IF EXISTS "matter_events_select_own" ON matter_events;
DROP POLICY IF EXISTS "matter_events_insert_own" ON matter_events;
DROP POLICY IF EXISTS "matter_events_update_own" ON matter_events;
DROP POLICY IF EXISTS "matter_events_delete_own" ON matter_events;
CREATE POLICY "matter_events_select_own" ON matter_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "matter_events_insert_own" ON matter_events FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "matter_events_update_own" ON matter_events FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "matter_events_delete_own" ON matter_events FOR DELETE USING (user_id = auth.uid());

-- matter_teams
DROP POLICY IF EXISTS "matter_teams_select_own" ON matter_teams;
DROP POLICY IF EXISTS "matter_teams_insert_own" ON matter_teams;
DROP POLICY IF EXISTS "matter_teams_update_own" ON matter_teams;
DROP POLICY IF EXISTS "matter_teams_delete_own" ON matter_teams;
CREATE POLICY "matter_teams_select_own" ON matter_teams FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "matter_teams_insert_own" ON matter_teams FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "matter_teams_update_own" ON matter_teams FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "matter_teams_delete_own" ON matter_teams FOR DELETE USING (user_id = auth.uid());

-- motion_history
DROP POLICY IF EXISTS "motion_history_select_own" ON motion_history;
DROP POLICY IF EXISTS "motion_history_insert_own" ON motion_history;
DROP POLICY IF EXISTS "motion_history_update_own" ON motion_history;
DROP POLICY IF EXISTS "motion_history_delete_own" ON motion_history;
CREATE POLICY "motion_history_select_own" ON motion_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "motion_history_insert_own" ON motion_history FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "motion_history_update_own" ON motion_history FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "motion_history_delete_own" ON motion_history FOR DELETE USING (user_id = auth.uid());

-- motion_templates
DROP POLICY IF EXISTS "motion_templates_select_own" ON motion_templates;
DROP POLICY IF EXISTS "motion_templates_insert_own" ON motion_templates;
DROP POLICY IF EXISTS "motion_templates_update_own" ON motion_templates;
DROP POLICY IF EXISTS "motion_templates_delete_own" ON motion_templates;
CREATE POLICY "motion_templates_select_own" ON motion_templates FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "motion_templates_insert_own" ON motion_templates FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "motion_templates_update_own" ON motion_templates FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "motion_templates_delete_own" ON motion_templates FOR DELETE USING (created_by = auth.uid());

-- refund_requests
DROP POLICY IF EXISTS "refund_requests_select_own" ON refund_requests;
DROP POLICY IF EXISTS "refund_requests_insert_own" ON refund_requests;
DROP POLICY IF EXISTS "refund_requests_update_own" ON refund_requests;
DROP POLICY IF EXISTS "refund_requests_delete_own" ON refund_requests;
CREATE POLICY "refund_requests_select_own" ON refund_requests FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "refund_requests_insert_own" ON refund_requests FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "refund_requests_update_own" ON refund_requests FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "refund_requests_delete_own" ON refund_requests FOR DELETE USING (user_id = auth.uid());

-- tos_acceptance_log
DROP POLICY IF EXISTS "tos_acceptance_log_select_own" ON tos_acceptance_log;
DROP POLICY IF EXISTS "tos_acceptance_log_insert_own" ON tos_acceptance_log;
DROP POLICY IF EXISTS "tos_acceptance_log_update_own" ON tos_acceptance_log;
DROP POLICY IF EXISTS "tos_acceptance_log_delete_own" ON tos_acceptance_log;
CREATE POLICY "tos_acceptance_log_select_own" ON tos_acceptance_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "tos_acceptance_log_insert_own" ON tos_acceptance_log FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "tos_acceptance_log_update_own" ON tos_acceptance_log FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "tos_acceptance_log_delete_own" ON tos_acceptance_log FOR DELETE USING (user_id = auth.uid());

-- verified_badge_subscriptions
DROP POLICY IF EXISTS "verified_badge_subscriptions_select_own" ON verified_badge_subscriptions;
DROP POLICY IF EXISTS "verified_badge_subscriptions_insert_own" ON verified_badge_subscriptions;
DROP POLICY IF EXISTS "verified_badge_subscriptions_update_own" ON verified_badge_subscriptions;
DROP POLICY IF EXISTS "verified_badge_subscriptions_delete_own" ON verified_badge_subscriptions;
CREATE POLICY "verified_badge_subscriptions_select_own" ON verified_badge_subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "verified_badge_subscriptions_insert_own" ON verified_badge_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "verified_badge_subscriptions_update_own" ON verified_badge_subscriptions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "verified_badge_subscriptions_delete_own" ON verified_badge_subscriptions FOR DELETE USING (user_id = auth.uid());

-- lesson_progress
DROP POLICY IF EXISTS "lesson_progress_select_own" ON lesson_progress;
DROP POLICY IF EXISTS "lesson_progress_insert_own" ON lesson_progress;
DROP POLICY IF EXISTS "lesson_progress_update_own" ON lesson_progress;
DROP POLICY IF EXISTS "lesson_progress_delete_own" ON lesson_progress;
CREATE POLICY "lesson_progress_select_own" ON lesson_progress FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "lesson_progress_insert_own" ON lesson_progress FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "lesson_progress_update_own" ON lesson_progress FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "lesson_progress_delete_own" ON lesson_progress FOR DELETE USING (user_id = auth.uid());

-- case_status_history
DROP POLICY IF EXISTS "case_status_history_select_own" ON case_status_history;
DROP POLICY IF EXISTS "case_status_history_insert_own" ON case_status_history;
DROP POLICY IF EXISTS "case_status_history_update_own" ON case_status_history;
DROP POLICY IF EXISTS "case_status_history_delete_own" ON case_status_history;
CREATE POLICY "case_status_history_select_own" ON case_status_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "case_status_history_insert_own" ON case_status_history FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "case_status_history_update_own" ON case_status_history FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "case_status_history_delete_own" ON case_status_history FOR DELETE USING (user_id = auth.uid());

-- checkin_records
DROP POLICY IF EXISTS "checkin_records_select_own" ON checkin_records;
DROP POLICY IF EXISTS "checkin_records_insert_own" ON checkin_records;
DROP POLICY IF EXISTS "checkin_records_update_own" ON checkin_records;
DROP POLICY IF EXISTS "checkin_records_delete_own" ON checkin_records;
CREATE POLICY "checkin_records_select_own" ON checkin_records FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "checkin_records_insert_own" ON checkin_records FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "checkin_records_update_own" ON checkin_records FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "checkin_records_delete_own" ON checkin_records FOR DELETE USING (user_id = auth.uid());

-- alert_log
DROP POLICY IF EXISTS "alert_log_select_own" ON alert_log;
DROP POLICY IF EXISTS "alert_log_insert_own" ON alert_log;
DROP POLICY IF EXISTS "alert_log_update_own" ON alert_log;
DROP POLICY IF EXISTS "alert_log_delete_own" ON alert_log;
CREATE POLICY "alert_log_select_own" ON alert_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "alert_log_insert_own" ON alert_log FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "alert_log_update_own" ON alert_log FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "alert_log_delete_own" ON alert_log FOR DELETE USING (user_id = auth.uid());

-- firm_trials
DROP POLICY IF EXISTS "firm_trials_select_own" ON firm_trials;
DROP POLICY IF EXISTS "firm_trials_insert_own" ON firm_trials;
DROP POLICY IF EXISTS "firm_trials_update_own" ON firm_trials;
DROP POLICY IF EXISTS "firm_trials_delete_own" ON firm_trials;
CREATE POLICY "firm_trials_select_own" ON firm_trials FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "firm_trials_insert_own" ON firm_trials FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "firm_trials_update_own" ON firm_trials FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "firm_trials_delete_own" ON firm_trials FOR DELETE USING (user_id = auth.uid());

-- integration_connections
DROP POLICY IF EXISTS "integration_connections_select_own" ON integration_connections;
DROP POLICY IF EXISTS "integration_connections_insert_own" ON integration_connections;
DROP POLICY IF EXISTS "integration_connections_update_own" ON integration_connections;
DROP POLICY IF EXISTS "integration_connections_delete_own" ON integration_connections;
CREATE POLICY "integration_connections_select_own" ON integration_connections FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "integration_connections_insert_own" ON integration_connections FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "integration_connections_update_own" ON integration_connections FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "integration_connections_delete_own" ON integration_connections FOR DELETE USING (user_id = auth.uid());

-- time_entries
DROP POLICY IF EXISTS "time_entries_select_own" ON time_entries;
DROP POLICY IF EXISTS "time_entries_insert_own" ON time_entries;
DROP POLICY IF EXISTS "time_entries_update_own" ON time_entries;
DROP POLICY IF EXISTS "time_entries_delete_own" ON time_entries;
CREATE POLICY "time_entries_select_own" ON time_entries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "time_entries_insert_own" ON time_entries FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "time_entries_update_own" ON time_entries FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "time_entries_delete_own" ON time_entries FOR DELETE USING (user_id = auth.uid());

-- firm_members
DROP POLICY IF EXISTS "firm_members_select_own" ON firm_members;
DROP POLICY IF EXISTS "firm_members_insert_own" ON firm_members;
DROP POLICY IF EXISTS "firm_members_update_own" ON firm_members;
DROP POLICY IF EXISTS "firm_members_delete_own" ON firm_members;
CREATE POLICY "firm_members_select_own" ON firm_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "firm_members_insert_own" ON firm_members FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "firm_members_update_own" ON firm_members FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "firm_members_delete_own" ON firm_members FOR DELETE USING (user_id = auth.uid());

-- ===========================================================
-- FIRM-OWNED TABLES (firm_id membership check)
-- ===========================================================

-- docket_entries
DROP POLICY IF EXISTS "docket_entries_select_firm" ON docket_entries;
DROP POLICY IF EXISTS "docket_entries_insert_firm" ON docket_entries;
DROP POLICY IF EXISTS "docket_entries_update_firm" ON docket_entries;
DROP POLICY IF EXISTS "docket_entries_delete_firm" ON docket_entries;
CREATE POLICY "docket_entries_select_firm" ON docket_entries FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "docket_entries_insert_firm" ON docket_entries FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "docket_entries_update_firm" ON docket_entries FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "docket_entries_delete_firm" ON docket_entries FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- matters
DROP POLICY IF EXISTS "matters_select_firm" ON matters;
DROP POLICY IF EXISTS "matters_insert_firm" ON matters;
DROP POLICY IF EXISTS "matters_update_firm" ON matters;
DROP POLICY IF EXISTS "matters_delete_firm" ON matters;
CREATE POLICY "matters_select_firm" ON matters FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "matters_insert_firm" ON matters FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "matters_update_firm" ON matters FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "matters_delete_firm" ON matters FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- conflict_index
DROP POLICY IF EXISTS "conflict_index_select_firm" ON conflict_index;
DROP POLICY IF EXISTS "conflict_index_insert_firm" ON conflict_index;
DROP POLICY IF EXISTS "conflict_index_update_firm" ON conflict_index;
DROP POLICY IF EXISTS "conflict_index_delete_firm" ON conflict_index;
CREATE POLICY "conflict_index_select_firm" ON conflict_index FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "conflict_index_insert_firm" ON conflict_index FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "conflict_index_update_firm" ON conflict_index FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "conflict_index_delete_firm" ON conflict_index FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- ability_to_pay
DROP POLICY IF EXISTS "ability_to_pay_select_firm" ON ability_to_pay;
DROP POLICY IF EXISTS "ability_to_pay_insert_firm" ON ability_to_pay;
DROP POLICY IF EXISTS "ability_to_pay_update_firm" ON ability_to_pay;
DROP POLICY IF EXISTS "ability_to_pay_delete_firm" ON ability_to_pay;
CREATE POLICY "ability_to_pay_select_firm" ON ability_to_pay FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ability_to_pay_insert_firm" ON ability_to_pay FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ability_to_pay_update_firm" ON ability_to_pay FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ability_to_pay_delete_firm" ON ability_to_pay FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- asylum_clocks
DROP POLICY IF EXISTS "asylum_clocks_select_firm" ON asylum_clocks;
DROP POLICY IF EXISTS "asylum_clocks_insert_firm" ON asylum_clocks;
DROP POLICY IF EXISTS "asylum_clocks_update_firm" ON asylum_clocks;
DROP POLICY IF EXISTS "asylum_clocks_delete_firm" ON asylum_clocks;
CREATE POLICY "asylum_clocks_select_firm" ON asylum_clocks FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "asylum_clocks_insert_firm" ON asylum_clocks FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "asylum_clocks_update_firm" ON asylum_clocks FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "asylum_clocks_delete_firm" ON asylum_clocks FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- bop_exhaustion
DROP POLICY IF EXISTS "bop_exhaustion_select_firm" ON bop_exhaustion;
DROP POLICY IF EXISTS "bop_exhaustion_insert_firm" ON bop_exhaustion;
DROP POLICY IF EXISTS "bop_exhaustion_update_firm" ON bop_exhaustion;
DROP POLICY IF EXISTS "bop_exhaustion_delete_firm" ON bop_exhaustion;
CREATE POLICY "bop_exhaustion_select_firm" ON bop_exhaustion FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "bop_exhaustion_insert_firm" ON bop_exhaustion FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "bop_exhaustion_update_firm" ON bop_exhaustion FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "bop_exhaustion_delete_firm" ON bop_exhaustion FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- codefendant_links
DROP POLICY IF EXISTS "codefendant_links_select_firm" ON codefendant_links;
DROP POLICY IF EXISTS "codefendant_links_insert_firm" ON codefendant_links;
DROP POLICY IF EXISTS "codefendant_links_update_firm" ON codefendant_links;
DROP POLICY IF EXISTS "codefendant_links_delete_firm" ON codefendant_links;
CREATE POLICY "codefendant_links_select_firm" ON codefendant_links FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "codefendant_links_insert_firm" ON codefendant_links FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "codefendant_links_update_firm" ON codefendant_links FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "codefendant_links_delete_firm" ON codefendant_links FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- conflict_waivers
DROP POLICY IF EXISTS "conflict_waivers_select_firm" ON conflict_waivers;
DROP POLICY IF EXISTS "conflict_waivers_insert_firm" ON conflict_waivers;
DROP POLICY IF EXISTS "conflict_waivers_update_firm" ON conflict_waivers;
DROP POLICY IF EXISTS "conflict_waivers_delete_firm" ON conflict_waivers;
CREATE POLICY "conflict_waivers_select_firm" ON conflict_waivers FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "conflict_waivers_insert_firm" ON conflict_waivers FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "conflict_waivers_update_firm" ON conflict_waivers FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "conflict_waivers_delete_firm" ON conflict_waivers FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- dpa_trackers
DROP POLICY IF EXISTS "dpa_trackers_select_firm" ON dpa_trackers;
DROP POLICY IF EXISTS "dpa_trackers_insert_firm" ON dpa_trackers;
DROP POLICY IF EXISTS "dpa_trackers_update_firm" ON dpa_trackers;
DROP POLICY IF EXISTS "dpa_trackers_delete_firm" ON dpa_trackers;
CREATE POLICY "dpa_trackers_select_firm" ON dpa_trackers FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dpa_trackers_insert_firm" ON dpa_trackers FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dpa_trackers_update_firm" ON dpa_trackers FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dpa_trackers_delete_firm" ON dpa_trackers FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- dual_sovereignty_flags
DROP POLICY IF EXISTS "dual_sovereignty_flags_select_firm" ON dual_sovereignty_flags;
DROP POLICY IF EXISTS "dual_sovereignty_flags_insert_firm" ON dual_sovereignty_flags;
DROP POLICY IF EXISTS "dual_sovereignty_flags_update_firm" ON dual_sovereignty_flags;
DROP POLICY IF EXISTS "dual_sovereignty_flags_delete_firm" ON dual_sovereignty_flags;
CREATE POLICY "dual_sovereignty_flags_select_firm" ON dual_sovereignty_flags FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dual_sovereignty_flags_insert_firm" ON dual_sovereignty_flags FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dual_sovereignty_flags_update_firm" ON dual_sovereignty_flags FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dual_sovereignty_flags_delete_firm" ON dual_sovereignty_flags FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- dv_firearm_surrender
DROP POLICY IF EXISTS "dv_firearm_surrender_select_firm" ON dv_firearm_surrender;
DROP POLICY IF EXISTS "dv_firearm_surrender_insert_firm" ON dv_firearm_surrender;
DROP POLICY IF EXISTS "dv_firearm_surrender_update_firm" ON dv_firearm_surrender;
DROP POLICY IF EXISTS "dv_firearm_surrender_delete_firm" ON dv_firearm_surrender;
CREATE POLICY "dv_firearm_surrender_select_firm" ON dv_firearm_surrender FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dv_firearm_surrender_insert_firm" ON dv_firearm_surrender FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dv_firearm_surrender_update_firm" ON dv_firearm_surrender FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "dv_firearm_surrender_delete_firm" ON dv_firearm_surrender FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- ethics_wall_log
DROP POLICY IF EXISTS "ethics_wall_log_select_firm" ON ethics_wall_log;
DROP POLICY IF EXISTS "ethics_wall_log_insert_firm" ON ethics_wall_log;
DROP POLICY IF EXISTS "ethics_wall_log_update_firm" ON ethics_wall_log;
DROP POLICY IF EXISTS "ethics_wall_log_delete_firm" ON ethics_wall_log;
CREATE POLICY "ethics_wall_log_select_firm" ON ethics_wall_log FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ethics_wall_log_insert_firm" ON ethics_wall_log FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ethics_wall_log_update_firm" ON ethics_wall_log FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ethics_wall_log_delete_firm" ON ethics_wall_log FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- eviction_trackers
DROP POLICY IF EXISTS "eviction_trackers_select_firm" ON eviction_trackers;
DROP POLICY IF EXISTS "eviction_trackers_insert_firm" ON eviction_trackers;
DROP POLICY IF EXISTS "eviction_trackers_update_firm" ON eviction_trackers;
DROP POLICY IF EXISTS "eviction_trackers_delete_firm" ON eviction_trackers;
CREATE POLICY "eviction_trackers_select_firm" ON eviction_trackers FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "eviction_trackers_insert_firm" ON eviction_trackers FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "eviction_trackers_update_firm" ON eviction_trackers FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "eviction_trackers_delete_firm" ON eviction_trackers FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- firm_invites
DROP POLICY IF EXISTS "firm_invites_select_firm" ON firm_invites;
DROP POLICY IF EXISTS "firm_invites_insert_firm" ON firm_invites;
DROP POLICY IF EXISTS "firm_invites_update_firm" ON firm_invites;
DROP POLICY IF EXISTS "firm_invites_delete_firm" ON firm_invites;
CREATE POLICY "firm_invites_select_firm" ON firm_invites FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_invites_insert_firm" ON firm_invites FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_invites_update_firm" ON firm_invites FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_invites_delete_firm" ON firm_invites FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- firm_upgrade_requests
DROP POLICY IF EXISTS "firm_upgrade_requests_select_firm" ON firm_upgrade_requests;
DROP POLICY IF EXISTS "firm_upgrade_requests_insert_firm" ON firm_upgrade_requests;
DROP POLICY IF EXISTS "firm_upgrade_requests_update_firm" ON firm_upgrade_requests;
DROP POLICY IF EXISTS "firm_upgrade_requests_delete_firm" ON firm_upgrade_requests;
CREATE POLICY "firm_upgrade_requests_select_firm" ON firm_upgrade_requests FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_upgrade_requests_insert_firm" ON firm_upgrade_requests FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_upgrade_requests_update_firm" ON firm_upgrade_requests FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_upgrade_requests_delete_firm" ON firm_upgrade_requests FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- firm_vertical_config
DROP POLICY IF EXISTS "firm_vertical_config_select_firm" ON firm_vertical_config;
DROP POLICY IF EXISTS "firm_vertical_config_insert_firm" ON firm_vertical_config;
DROP POLICY IF EXISTS "firm_vertical_config_update_firm" ON firm_vertical_config;
DROP POLICY IF EXISTS "firm_vertical_config_delete_firm" ON firm_vertical_config;
CREATE POLICY "firm_vertical_config_select_firm" ON firm_vertical_config FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_vertical_config_insert_firm" ON firm_vertical_config FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_vertical_config_update_firm" ON firm_vertical_config FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "firm_vertical_config_delete_firm" ON firm_vertical_config FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- hague_proceedings
DROP POLICY IF EXISTS "hague_proceedings_select_firm" ON hague_proceedings;
DROP POLICY IF EXISTS "hague_proceedings_insert_firm" ON hague_proceedings;
DROP POLICY IF EXISTS "hague_proceedings_update_firm" ON hague_proceedings;
DROP POLICY IF EXISTS "hague_proceedings_delete_firm" ON hague_proceedings;
CREATE POLICY "hague_proceedings_select_firm" ON hague_proceedings FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "hague_proceedings_insert_firm" ON hague_proceedings FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "hague_proceedings_update_firm" ON hague_proceedings FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "hague_proceedings_delete_firm" ON hague_proceedings FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- integration_sync_log
DROP POLICY IF EXISTS "integration_sync_log_select_firm" ON integration_sync_log;
DROP POLICY IF EXISTS "integration_sync_log_insert_firm" ON integration_sync_log;
DROP POLICY IF EXISTS "integration_sync_log_update_firm" ON integration_sync_log;
DROP POLICY IF EXISTS "integration_sync_log_delete_firm" ON integration_sync_log;
CREATE POLICY "integration_sync_log_select_firm" ON integration_sync_log FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "integration_sync_log_insert_firm" ON integration_sync_log FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "integration_sync_log_update_firm" ON integration_sync_log FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "integration_sync_log_delete_firm" ON integration_sync_log FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- material_support_screening
DROP POLICY IF EXISTS "material_support_screening_select_firm" ON material_support_screening;
DROP POLICY IF EXISTS "material_support_screening_insert_firm" ON material_support_screening;
DROP POLICY IF EXISTS "material_support_screening_update_firm" ON material_support_screening;
DROP POLICY IF EXISTS "material_support_screening_delete_firm" ON material_support_screening;
CREATE POLICY "material_support_screening_select_firm" ON material_support_screening FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "material_support_screening_insert_firm" ON material_support_screening FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "material_support_screening_update_firm" ON material_support_screening FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "material_support_screening_delete_firm" ON material_support_screening FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- mission_verification_requests
DROP POLICY IF EXISTS "mission_verification_requests_select_firm" ON mission_verification_requests;
DROP POLICY IF EXISTS "mission_verification_requests_insert_firm" ON mission_verification_requests;
DROP POLICY IF EXISTS "mission_verification_requests_update_firm" ON mission_verification_requests;
DROP POLICY IF EXISTS "mission_verification_requests_delete_firm" ON mission_verification_requests;
CREATE POLICY "mission_verification_requests_select_firm" ON mission_verification_requests FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "mission_verification_requests_insert_firm" ON mission_verification_requests FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "mission_verification_requests_update_firm" ON mission_verification_requests FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "mission_verification_requests_delete_firm" ON mission_verification_requests FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- padilla_warnings
DROP POLICY IF EXISTS "padilla_warnings_select_firm" ON padilla_warnings;
DROP POLICY IF EXISTS "padilla_warnings_insert_firm" ON padilla_warnings;
DROP POLICY IF EXISTS "padilla_warnings_update_firm" ON padilla_warnings;
DROP POLICY IF EXISTS "padilla_warnings_delete_firm" ON padilla_warnings;
CREATE POLICY "padilla_warnings_select_firm" ON padilla_warnings FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "padilla_warnings_insert_firm" ON padilla_warnings FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "padilla_warnings_update_firm" ON padilla_warnings FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "padilla_warnings_delete_firm" ON padilla_warnings FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- plea_offers
DROP POLICY IF EXISTS "plea_offers_select_firm" ON plea_offers;
DROP POLICY IF EXISTS "plea_offers_insert_firm" ON plea_offers;
DROP POLICY IF EXISTS "plea_offers_update_firm" ON plea_offers;
DROP POLICY IF EXISTS "plea_offers_delete_firm" ON plea_offers;
CREATE POLICY "plea_offers_select_firm" ON plea_offers FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "plea_offers_insert_firm" ON plea_offers FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "plea_offers_update_firm" ON plea_offers FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "plea_offers_delete_firm" ON plea_offers FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- privilege_log
DROP POLICY IF EXISTS "privilege_log_select_firm" ON privilege_log;
DROP POLICY IF EXISTS "privilege_log_insert_firm" ON privilege_log;
DROP POLICY IF EXISTS "privilege_log_update_firm" ON privilege_log;
DROP POLICY IF EXISTS "privilege_log_delete_firm" ON privilege_log;
CREATE POLICY "privilege_log_select_firm" ON privilege_log FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "privilege_log_insert_firm" ON privilege_log FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "privilege_log_update_firm" ON privilege_log FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "privilege_log_delete_firm" ON privilege_log FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- sso_configurations
DROP POLICY IF EXISTS "sso_configurations_select_firm" ON sso_configurations;
DROP POLICY IF EXISTS "sso_configurations_insert_firm" ON sso_configurations;
DROP POLICY IF EXISTS "sso_configurations_update_firm" ON sso_configurations;
DROP POLICY IF EXISTS "sso_configurations_delete_firm" ON sso_configurations;
CREATE POLICY "sso_configurations_select_firm" ON sso_configurations FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "sso_configurations_insert_firm" ON sso_configurations FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "sso_configurations_update_firm" ON sso_configurations FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "sso_configurations_delete_firm" ON sso_configurations FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- tro_trackers
DROP POLICY IF EXISTS "tro_trackers_select_firm" ON tro_trackers;
DROP POLICY IF EXISTS "tro_trackers_insert_firm" ON tro_trackers;
DROP POLICY IF EXISTS "tro_trackers_update_firm" ON tro_trackers;
DROP POLICY IF EXISTS "tro_trackers_delete_firm" ON tro_trackers;
CREATE POLICY "tro_trackers_select_firm" ON tro_trackers FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tro_trackers_insert_firm" ON tro_trackers FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tro_trackers_update_firm" ON tro_trackers FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tro_trackers_delete_firm" ON tro_trackers FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- voluntary_departure
DROP POLICY IF EXISTS "voluntary_departure_select_firm" ON voluntary_departure;
DROP POLICY IF EXISTS "voluntary_departure_insert_firm" ON voluntary_departure;
DROP POLICY IF EXISTS "voluntary_departure_update_firm" ON voluntary_departure;
DROP POLICY IF EXISTS "voluntary_departure_delete_firm" ON voluntary_departure;
CREATE POLICY "voluntary_departure_select_firm" ON voluntary_departure FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "voluntary_departure_insert_firm" ON voluntary_departure FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "voluntary_departure_update_firm" ON voluntary_departure FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "voluntary_departure_delete_firm" ON voluntary_departure FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- vop_trackers
DROP POLICY IF EXISTS "vop_trackers_select_firm" ON vop_trackers;
DROP POLICY IF EXISTS "vop_trackers_insert_firm" ON vop_trackers;
DROP POLICY IF EXISTS "vop_trackers_update_firm" ON vop_trackers;
DROP POLICY IF EXISTS "vop_trackers_delete_firm" ON vop_trackers;
CREATE POLICY "vop_trackers_select_firm" ON vop_trackers FOR SELECT
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "vop_trackers_insert_firm" ON vop_trackers FOR INSERT
  WITH CHECK (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "vop_trackers_update_firm" ON vop_trackers FOR UPDATE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));
CREATE POLICY "vop_trackers_delete_firm" ON vop_trackers FOR DELETE
  USING (firm_id IN (SELECT firm_id FROM firm_memberships WHERE user_id = auth.uid()));

-- ===========================================================
-- PUBLIC READ-ONLY TABLES (legal reference data)
-- ===========================================================

-- arrest_records
DROP POLICY IF EXISTS "arrest_records_select_all" ON arrest_records;
CREATE POLICY "arrest_records_select_all" ON arrest_records FOR SELECT USING (true);

-- ===========================================================
-- SYSTEM/ADMIN ONLY TABLES (no direct client access)
-- ===========================================================

-- users — service_role only, no client policies
DROP POLICY IF EXISTS "users_no_access" ON users;
CREATE POLICY "users_no_access" ON users FOR ALL USING (false);

-- lawyers — service_role only, no client policies
DROP POLICY IF EXISTS "lawyers_no_access" ON lawyers;
CREATE POLICY "lawyers_no_access" ON lawyers FOR ALL USING (false);

-- bail_agents — service_role only, no client policies
DROP POLICY IF EXISTS "bail_agents_no_access" ON bail_agents;
CREATE POLICY "bail_agents_no_access" ON bail_agents FOR ALL USING (false);

-- chat_messages — service_role only, no client policies
DROP POLICY IF EXISTS "chat_messages_no_access" ON chat_messages;
CREATE POLICY "chat_messages_no_access" ON chat_messages FOR ALL USING (false);

-- research_messages — service_role only, no client policies
DROP POLICY IF EXISTS "research_messages_no_access" ON research_messages;
CREATE POLICY "research_messages_no_access" ON research_messages FOR ALL USING (false);

-- pi_leads — service_role only, no client policies
DROP POLICY IF EXISTS "pi_leads_no_access" ON pi_leads;
CREATE POLICY "pi_leads_no_access" ON pi_leads FOR ALL USING (false);

-- audit_log — service_role only, no client policies
DROP POLICY IF EXISTS "audit_log_no_access" ON audit_log;
CREATE POLICY "audit_log_no_access" ON audit_log FOR ALL USING (false);

-- workspaces — service_role only, no client policies
DROP POLICY IF EXISTS "workspaces_no_access" ON workspaces;
CREATE POLICY "workspaces_no_access" ON workspaces FOR ALL USING (false);

-- legal_documents — service_role only, no client policies
DROP POLICY IF EXISTS "legal_documents_no_access" ON legal_documents;
CREATE POLICY "legal_documents_no_access" ON legal_documents FOR ALL USING (false);

-- stripe_event_log — service_role only, no client policies
DROP POLICY IF EXISTS "stripe_event_log_no_access" ON stripe_event_log;
CREATE POLICY "stripe_event_log_no_access" ON stripe_event_log FOR ALL USING (false);

-- in — service_role only, no client policies
DROP POLICY IF EXISTS "in_no_access" ON in;
CREATE POLICY "in_no_access" ON in FOR ALL USING (false);

-- aba_codes — service_role only, no client policies
DROP POLICY IF EXISTS "aba_codes_no_access" ON aba_codes;
CREATE POLICY "aba_codes_no_access" ON aba_codes FOR ALL USING (false);

-- acquisition_leads — service_role only, no client policies
DROP POLICY IF EXISTS "acquisition_leads_no_access" ON acquisition_leads;
CREATE POLICY "acquisition_leads_no_access" ON acquisition_leads FOR ALL USING (false);

-- attorney_profiles — service_role only, no client policies
DROP POLICY IF EXISTS "attorney_profiles_no_access" ON attorney_profiles;
CREATE POLICY "attorney_profiles_no_access" ON attorney_profiles FOR ALL USING (false);

-- bail_schedules — service_role only, no client policies
DROP POLICY IF EXISTS "bail_schedules_no_access" ON bail_schedules;
CREATE POLICY "bail_schedules_no_access" ON bail_schedules FOR ALL USING (false);

-- bot_runs — service_role only, no client policies
DROP POLICY IF EXISTS "bot_runs_no_access" ON bot_runs;
CREATE POLICY "bot_runs_no_access" ON bot_runs FOR ALL USING (false);

-- calendar_push_events — service_role only, no client policies
DROP POLICY IF EXISTS "calendar_push_events_no_access" ON calendar_push_events;
CREATE POLICY "calendar_push_events_no_access" ON calendar_push_events FOR ALL USING (false);

-- case_assignments — service_role only, no client policies
DROP POLICY IF EXISTS "case_assignments_no_access" ON case_assignments;
CREATE POLICY "case_assignments_no_access" ON case_assignments FOR ALL USING (false);

-- cases_fts — service_role only, no client policies
DROP POLICY IF EXISTS "cases_fts_no_access" ON cases_fts;
CREATE POLICY "cases_fts_no_access" ON cases_fts FOR ALL USING (false);

-- checkin_enrollments — service_role only, no client policies
DROP POLICY IF EXISTS "checkin_enrollments_no_access" ON checkin_enrollments;
CREATE POLICY "checkin_enrollments_no_access" ON checkin_enrollments FOR ALL USING (false);

-- civil_lead_purchases — service_role only, no client policies
DROP POLICY IF EXISTS "civil_lead_purchases_no_access" ON civil_lead_purchases;
CREATE POLICY "civil_lead_purchases_no_access" ON civil_lead_purchases FOR ALL USING (false);

-- civil_leads — service_role only, no client policies
DROP POLICY IF EXISTS "civil_leads_no_access" ON civil_leads;
CREATE POLICY "civil_leads_no_access" ON civil_leads FOR ALL USING (false);

-- cle_courses — service_role only, no client policies
DROP POLICY IF EXISTS "cle_courses_no_access" ON cle_courses;
CREATE POLICY "cle_courses_no_access" ON cle_courses FOR ALL USING (false);

-- collateral_consequences — service_role only, no client policies
DROP POLICY IF EXISTS "collateral_consequences_no_access" ON collateral_consequences;
CREATE POLICY "collateral_consequences_no_access" ON collateral_consequences FOR ALL USING (false);

-- courthouses — service_role only, no client policies
DROP POLICY IF EXISTS "courthouses_no_access" ON courthouses;
CREATE POLICY "courthouses_no_access" ON courthouses FOR ALL USING (false);

-- document_sync_map — service_role only, no client policies
DROP POLICY IF EXISTS "document_sync_map_no_access" ON document_sync_map;
CREATE POLICY "document_sync_map_no_access" ON document_sync_map FOR ALL USING (false);

-- family_connections — service_role only, no client policies
DROP POLICY IF EXISTS "family_connections_no_access" ON family_connections;
CREATE POLICY "family_connections_no_access" ON family_connections FOR ALL USING (false);

-- firm_onboarding — service_role only, no client policies
DROP POLICY IF EXISTS "firm_onboarding_no_access" ON firm_onboarding;
CREATE POLICY "firm_onboarding_no_access" ON firm_onboarding FOR ALL USING (false);

-- firm_pricing_configs — service_role only, no client policies
DROP POLICY IF EXISTS "firm_pricing_configs_no_access" ON firm_pricing_configs;
CREATE POLICY "firm_pricing_configs_no_access" ON firm_pricing_configs FOR ALL USING (false);

-- golden_gavel_hall — service_role only, no client policies
DROP POLICY IF EXISTS "golden_gavel_hall_no_access" ON golden_gavel_hall;
CREATE POLICY "golden_gavel_hall_no_access" ON golden_gavel_hall FOR ALL USING (false);

-- lead_purchases — service_role only, no client policies
DROP POLICY IF EXISTS "lead_purchases_no_access" ON lead_purchases;
CREATE POLICY "lead_purchases_no_access" ON lead_purchases FOR ALL USING (false);

-- lessons_fts — service_role only, no client policies
DROP POLICY IF EXISTS "lessons_fts_no_access" ON lessons_fts;
CREATE POLICY "lessons_fts_no_access" ON lessons_fts FOR ALL USING (false);

-- matter_parties — service_role only, no client policies
DROP POLICY IF EXISTS "matter_parties_no_access" ON matter_parties;
CREATE POLICY "matter_parties_no_access" ON matter_parties FOR ALL USING (false);

-- matter_team_members — service_role only, no client policies
DROP POLICY IF EXISTS "matter_team_members_no_access" ON matter_team_members;
CREATE POLICY "matter_team_members_no_access" ON matter_team_members FOR ALL USING (false);

-- messages_fts — service_role only, no client policies
DROP POLICY IF EXISTS "messages_fts_no_access" ON messages_fts;
CREATE POLICY "messages_fts_no_access" ON messages_fts FOR ALL USING (false);

-- office_members — service_role only, no client policies
DROP POLICY IF EXISTS "office_members_no_access" ON office_members;
CREATE POLICY "office_members_no_access" ON office_members FOR ALL USING (false);

-- opt_outs — service_role only, no client policies
DROP POLICY IF EXISTS "opt_outs_no_access" ON opt_outs;
CREATE POLICY "opt_outs_no_access" ON opt_outs FOR ALL USING (false);

-- outbound_messages — service_role only, no client policies
DROP POLICY IF EXISTS "outbound_messages_no_access" ON outbound_messages;
CREATE POLICY "outbound_messages_no_access" ON outbound_messages FOR ALL USING (false);

-- past_due — service_role only, no client policies
DROP POLICY IF EXISTS "past_due_no_access" ON past_due;
CREATE POLICY "past_due_no_access" ON past_due FOR ALL USING (false);

-- payment_links — service_role only, no client policies
DROP POLICY IF EXISTS "payment_links_no_access" ON payment_links;
CREATE POLICY "payment_links_no_access" ON payment_links FOR ALL USING (false);

-- recovery_agents — service_role only, no client policies
DROP POLICY IF EXISTS "recovery_agents_no_access" ON recovery_agents;
CREATE POLICY "recovery_agents_no_access" ON recovery_agents FOR ALL USING (false);

-- revenue_log — service_role only, no client policies
DROP POLICY IF EXISTS "revenue_log_no_access" ON revenue_log;
CREATE POLICY "revenue_log_no_access" ON revenue_log FOR ALL USING (false);

-- role_permissions — service_role only, no client policies
DROP POLICY IF EXISTS "role_permissions_no_access" ON role_permissions;
CREATE POLICY "role_permissions_no_access" ON role_permissions FOR ALL USING (false);

-- routehelpers — service_role only, no client policies
DROP POLICY IF EXISTS "routehelpers_no_access" ON routehelpers;
CREATE POLICY "routehelpers_no_access" ON routehelpers FOR ALL USING (false);

-- scan_results — service_role only, no client policies
DROP POLICY IF EXISTS "scan_results_no_access" ON scan_results;
CREATE POLICY "scan_results_no_access" ON scan_results FOR ALL USING (false);

-- soc2_controls — service_role only, no client policies
DROP POLICY IF EXISTS "soc2_controls_no_access" ON soc2_controls;
CREATE POLICY "soc2_controls_no_access" ON soc2_controls FOR ALL USING (false);

-- translation_messages — service_role only, no client policies
DROP POLICY IF EXISTS "translation_messages_no_access" ON translation_messages;
CREATE POLICY "translation_messages_no_access" ON translation_messages FOR ALL USING (false);

-- translation_sessions — service_role only, no client policies
DROP POLICY IF EXISTS "translation_sessions_no_access" ON translation_sessions;
CREATE POLICY "translation_sessions_no_access" ON translation_sessions FOR ALL USING (false);

-- vertical_deadline_presets — service_role only, no client policies
DROP POLICY IF EXISTS "vertical_deadline_presets_no_access" ON vertical_deadline_presets;
CREATE POLICY "vertical_deadline_presets_no_access" ON vertical_deadline_presets FOR ALL USING (false);

-- webhook_deliveries — service_role only, no client policies
DROP POLICY IF EXISTS "webhook_deliveries_no_access" ON webhook_deliveries;
CREATE POLICY "webhook_deliveries_no_access" ON webhook_deliveries FOR ALL USING (false);

-- webhook_subscriptions — service_role only, no client policies
DROP POLICY IF EXISTS "webhook_subscriptions_no_access" ON webhook_subscriptions;
CREATE POLICY "webhook_subscriptions_no_access" ON webhook_subscriptions FOR ALL USING (false);

-- provider_update_log — service_role only, no client policies
DROP POLICY IF EXISTS "provider_update_log_no_access" ON provider_update_log;
CREATE POLICY "provider_update_log_no_access" ON provider_update_log FOR ALL USING (false);

-- firms — service_role only, no client policies
DROP POLICY IF EXISTS "firms_no_access" ON firms;
CREATE POLICY "firms_no_access" ON firms FOR ALL USING (false);

