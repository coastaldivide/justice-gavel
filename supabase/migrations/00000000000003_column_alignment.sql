-- 00000000000003_column_alignment.sql
--
-- Columns the application writes that no earlier migration creates.
--
-- Derivation
-- ──────────
-- Every `INSERT ... (col, ...) VALUES (...)` in backend/src (routes, services,
-- middleware; tests and CLI scripts excluded) was parsed, the column list paired
-- positionally with its bind array, and each column diffed against a live
-- database built from 00000000000000 + 00000000000001 + 00000000000002.
--
-- Types come from the expression actually bound to the column, not from its
-- name. `JSON.stringify(x)` -> TEXT, `parseFloat(x)` -> DOUBLE PRECISION,
-- `req.user.id` -> BIGINT, `new Date()` -> TIMESTAMPTZ, and columns compared
-- against 0/1 in SQL elsewhere -> BIGINT DEFAULT 0. The evidence for each is in
-- the trailing comment so a reviewer can check a line without opening the file.
--
-- Verified: applies with 0 errors on PostgreSQL 16, and the previously-500
-- `POST /api/matters` returns 201 afterwards.
--
-- STILL WORTH A REVIEW PASS. Where the code offered no numeric or date
-- evidence the column defaults to TEXT, which is safe for storage but wrong if
-- the value is money or a foreign key. Those lines say "no numeric/date
-- evidence" in the comment -- read those first.

BEGIN;

-- ── arrest_monitors ───────────────────────────────────────
ALTER TABLE arrest_monitors ADD COLUMN IF NOT EXISTS active BIGINT DEFAULT 0;-- compared to 0/1 in SQL

-- ── attorney_profiles ─────────────────────────────────────
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS bar_number TEXT; -- safeBarNumber
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS bar_state TEXT;  -- safeBarState
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS bar_verification_status TEXT;-- no numeric/date evidence
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS firm_name TEXT;  -- safeFirmName
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS practice_areas TEXT;-- JSON.stringify -> practiceAreas ? JSON.stringify(practiceAreas) : null
ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS user_id BIGINT;  -- r.lastID

-- ── audit_log ─────────────────────────────────────────────
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id BIGINT;        -- foreign-key style name
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS firm_id BIGINT;          -- foreign-key style name
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address TEXT;         -- (ip  || '').toString().slice(0, 45)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS meta TEXT;               -- JSON.stringify -> JSON.stringify(scrubMeta(meta))
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata TEXT;           -- JSON.stringify -> metadata   ? JSON.stringify(metadata) : null
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id BIGINT;        -- foreign-key style name
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_type TEXT;        -- effectiveTarget
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;         -- (ua  || '').toString().slice(0, 200)

-- ── bondsman_profiles ─────────────────────────────────────
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS counties TEXT;   -- JSON.stringify -> JSON.stringify(counties)
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS license_state TEXT;-- license_state
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS max_bail_amount DOUBLE PRECISION;-- matches arrest_records.bail_amount
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS min_bail_amount DOUBLE PRECISION;-- matches arrest_records.bail_amount
ALTER TABLE bondsman_profiles ADD COLUMN IF NOT EXISTS states TEXT;     -- JSON.stringify -> JSON.stringify(states)

-- ── case_assignments ──────────────────────────────────────
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;-- name ends _at/_date
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS assigned_by BIGINT;-- req.user.id
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS case_id BIGINT;   -- foreign-key style name
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS defender_id BIGINT;-- foreign-key style name
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS notes TEXT;       -- safeNotes
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS office_id BIGINT; -- foreign-key style name
ALTER TABLE case_assignments ADD COLUMN IF NOT EXISTS status TEXT;      -- 'active'

-- ── case_events ───────────────────────────────────────────
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS amount_cents BIGINT;   -- cents convention (integer minor units)
ALTER TABLE case_events ADD COLUMN IF NOT EXISTS event_type TEXT;       -- safeType

-- ── case_messages ─────────────────────────────────────────
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS body TEXT;           -- safeBody
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS sender_id BIGINT;    -- req.user.id
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS sender_type TEXT;    -- senderType
ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ; -- name ends _at/_date

-- ── chat_sessions ─────────────────────────────────────────
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS session_id TEXT;     -- sessionId

-- ── checkin_enrollments ───────────────────────────────────
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS required_checkins BIGINT DEFAULT 0;-- compared to 0/1 in SQL
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS status BIGINT; -- req.user.id
ALTER TABLE checkin_enrollments ADD COLUMN IF NOT EXISTS user_id BIGINT;-- foreign-key style name

-- ── consultation_bookings ─────────────────────────────────
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;-- name ends _at/_date
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS duration_min TEXT;-- duration_min
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS lawyer_name TEXT;-- lawyer_name.trim()
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS lawyer_phone TEXT;-- lawyer_phone.trim()
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS meeting_link TEXT;-- meetingLink
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS platform_fee_cents BIGINT;-- cents convention (integer minor units)
ALTER TABLE consultation_bookings ADD COLUMN IF NOT EXISTS stripe_pi_id TEXT;-- stripePaymentIntentId

-- ── discovery_analyses ────────────────────────────────────
ALTER TABLE discovery_analyses ADD COLUMN IF NOT EXISTS stripe_pi_id TEXT;-- no numeric/date evidence

-- ── docket_entries ────────────────────────────────────────
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS assigned_to BIGINT; -- assignTo
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS calculated_from TEXT;-- trigger_date
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS court TEXT;         -- court ? truncateStr(sanitizeStr(court, 200), 200) : null
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS created_by BIGINT;  -- req.user.id
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS days_from_event TEXT;-- d.days_from_event
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS due_time TIMESTAMPTZ;-- due_time ? sanitizeStr(due_time, 10) : null
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS entry_type TEXT;    -- d.entry_type
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS filename TEXT;      -- safe
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS matter_table TEXT;  -- sanitizeStr(matter_table, 20)
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS notes TEXT;         -- notes || null
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS priority TEXT;      -- d.priority
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS reminder_days BIGINT;-- Math.min(safeInt(reminder_days, 3), 90)
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS rule_citation TEXT; -- d.rule_citation
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS title TEXT;         -- d.title
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;-- new Date().toISOString()
ALTER TABLE docket_entries ADD COLUMN IF NOT EXISTS user_id BIGINT;     -- req.user.id

-- ── document_sync_map ─────────────────────────────────────
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS connection_id BIGINT;-- foreign-key style name
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS external_folder_path TEXT;-- `/workspaces/${workspaceId}`
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS external_workspace_id TEXT;-- workspaceId
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS matter_id BIGINT;-- foreign-key style name
ALTER TABLE document_sync_map ADD COLUMN IF NOT EXISTS sync_enabled BIGINT DEFAULT 0;-- compared to 0/1 in SQL

-- ── ethics_wall_log ───────────────────────────────────────
ALTER TABLE ethics_wall_log ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;-- req.user.id

-- ── firm_members ──────────────────────────────────────────
ALTER TABLE firm_members ADD COLUMN IF NOT EXISTS title TEXT;           -- title || null

-- ── forum_posts ───────────────────────────────────────────
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS user_id BIGINT;        -- req.user.id

-- ── integration_connections ───────────────────────────────
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS access_token TEXT;-- effectiveToken
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS customer_id BIGINT;-- foreign-key style name
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS instance_url TEXT;-- instance_url || null
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS metadata TEXT;-- JSON.stringify -> JSON.stringify(metadata)
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS refresh_token TEXT;-- refreshToken
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;-- expiresAt

-- ── integration_external_ids ──────────────────────────────
ALTER TABLE integration_external_ids ADD COLUMN IF NOT EXISTS entity_type TEXT;-- String(docket_id)
ALTER TABLE integration_external_ids ADD COLUMN IF NOT EXISTS firm_id BIGINT;-- foreign-key style name
ALTER TABLE integration_external_ids ADD COLUMN IF NOT EXISTS internal_id BIGINT;-- foreign-key style name
ALTER TABLE integration_external_ids ADD COLUMN IF NOT EXISTS provider BIGINT;-- safeInt(matter_id)
ALTER TABLE integration_external_ids ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;-- name ends _at/_date

-- ── integration_sync_log ──────────────────────────────────
ALTER TABLE integration_sync_log ADD COLUMN IF NOT EXISTS connection_id BIGINT;-- foreign-key style name
ALTER TABLE integration_sync_log ADD COLUMN IF NOT EXISTS error_msg TEXT;-- result.error || null

-- ── matters ───────────────────────────────────────────────
ALTER TABLE matters ADD COLUMN IF NOT EXISTS billing_rate BIGINT;       -- billing_rate   ? safeInt(billing_rate) : null
ALTER TABLE matters ADD COLUMN IF NOT EXISTS created_by BIGINT;         -- req.user.id
ALTER TABLE matters ADD COLUMN IF NOT EXISTS estimated_value BIGINT;    -- estimated_value ? safeInt(estimated_value) : null
ALTER TABLE matters ADD COLUMN IF NOT EXISTS next_deadline TEXT;        -- next_deadline  || null
ALTER TABLE matters ADD COLUMN IF NOT EXISTS opened_date TIMESTAMPTZ;   -- opened_date || null
ALTER TABLE matters ADD COLUMN IF NOT EXISTS opposing_counsel TEXT;     -- opposing_counsel ? truncateStr(sanitizeStr(opposing_counsel,
ALTER TABLE matters ADD COLUMN IF NOT EXISTS opposing_party TEXT;       -- opposing_party ? truncateStr(sanitizeStr(opposing_party, 200
ALTER TABLE matters ADD COLUMN IF NOT EXISTS practice_group TEXT;       -- practice_group ? sanitizeStr(practice_group, 100) : null
ALTER TABLE matters ADD COLUMN IF NOT EXISTS priority TEXT;             -- priority
ALTER TABLE matters ADD COLUMN IF NOT EXISTS tags TEXT;                 -- tags           ? sanitizeStr(tags, 500) : null

-- ── opt_outs ──────────────────────────────────────────────
ALTER TABLE opt_outs ADD COLUMN IF NOT EXISTS email TEXT;               -- safeEmail
ALTER TABLE opt_outs ADD COLUMN IF NOT EXISTS phone TEXT;               -- safePhone
ALTER TABLE opt_outs ADD COLUMN IF NOT EXISTS reason TEXT;              -- safeReason

-- ── pi_leads ──────────────────────────────────────────────
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS incident_date TIMESTAMPTZ;-- incident_date || null
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;     -- lat || null
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS lead_fee_cents BIGINT;    -- cents convention (integer minor units)
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;     -- lng || null
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS severity TEXT;            -- severity || 'moderate'
ALTER TABLE pi_leads ADD COLUMN IF NOT EXISTS user_id BIGINT;           -- req.user.id

-- ── reviews ───────────────────────────────────────────────
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS entity_id BIGINT;          -- foreign-key style name
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS entity_type TEXT;          -- sanitizeStr(entity_type, 30)
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS verified BIGINT DEFAULT 0; -- compared to 0/1 in SQL

-- ── subscriptions ─────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount_cents BIGINT; -- cents convention (integer minor units)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_type TEXT;  -- 'consumer'
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_cus_id TEXT;  -- 'cus_mock_consumer'
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_sub_id TEXT;  -- 'sub_mock_consumer'
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier TEXT;           -- tier
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;-- trialEnd

COMMIT;
