# Schema gap report: backend code vs Supabase migrations

Owner of this file: the DB/schema agent. Last full re-check: see bottom.

## How the audit was done

1. Every SQL string literal in `backend/src/**/*.js` (excluding `__tests__`; `src/scripts` included, lower
   priority) was extracted with an AST parser (acorn): string, template-literal and `+` concatenations, and
   `${...}` interpolations were tried with several stand-ins.
2. Each statement was `PREPARE`d against a scratch copy of a database built from `supabase/migrations`.
   SQLite helpers (`datetime()`, `date()`, `strftime()`, `julianday()`, `IFNULL`, `group_concat`, ...) were
   shimmed in the scratch DB only, so analysis could get past them. Every "relation/column does not exist"
   was recorded, the object was added to the scratch DB, and the statement was prepared again until it
   passed or hit a non-schema error.
3. Additional passes: regex check of every INSERT column list / UPDATE SET list; per-route scan of the
   dynamic `UPDATE t SET ${updates.join(',')}` allowlists; every `ON CONFLICT (...)` target checked
   against a matching unique index; INSERTs checked for NOT NULL columns they don't supply; INSERTs
   checked for an `id` column (the pg adapter appends `RETURNING id` to every `db.run('INSERT ...')`).
4. Types come from the original SQLite migrations (`backend/src/migrations/*.sql`) or the legacy
   Supabase files when a definition existed, otherwise from how the code reads/writes the column.

Tooling (re-runnable): `(scratch tooling, not included)`
(`extract.mjs`, `check.py`, `rx.py`, `dyn2.py`, `onconf.py`, `verify.sh`).

## Result

New migrations:
- `supabase/migrations/00000000000007_code_alignment.sql`
- `supabase/migrations/00000000000008_enable_rls.sql`
- `00000000000005_bar_prep_questions.sql` was edited so each INSERT is
  `INSERT ... SELECT FROM (VALUES ...) WHERE NOT EXISTS (same subject_id + stem)`. First run still loads
  548 rows; a re-run adds 0 (it used to double to 1096).

After 07: **0 missing tables / 0 missing columns** for runtime code (`routes/`, `services/`,
`middleware/`, `utils/`, `server.js`). The only items left are false positives from dynamic table names
(`FROM ${table}`), already covered by hand (see "Dynamic tables" below), and scripts-only items (see
"Not done").

Counts (fresh build of 00-06 compared with 00-08):
- 12 new tables: account_inactivity_log, alerts, content_refresh_log, contracts, crisis_resources,
  docket_archive, expungement_rules, firm_retention_policy, invoices, legal_holds, matter_versions, messages
- 7 views: arrests, providers, user_bar_performance, subject_accuracy_breakdown, bar_prep_questions,
  ai_daily_costs, ai_user_monthly_spend
- 845 columns added in total, 707 of them to 113 existing tables. Full list at the end.
- 70 column type corrections on existing tables. Each one checks that every existing value converts
  first, and is skipped with a WARNING if not. List below.
- 10 unique indexes for `ON CONFLICT` targets (created only if no duplicates exist), 7 FKs on the new
  tables, about 20 indexes.
- RLS enabled on 187 of 187 public tables, with no policies and no FORCE.

## Decisions the backend team needs to know about

### Name conflicts: what the code uses vs what the DB has
| Code uses | DB has | What 07 does | Backend choice |
|---|---|---|---|
| `arrests` (alerts.js: SELECT/UPDATE id, full_name, booking_date, charges, suppressed*, disposition*) | `arrest_records` (name) | Adds suppressed, suppressed_at, suppressed_reason, disposition, disposition_date, disposition_court, disposition_added_at, updated_at to **arrest_records**. **`arrests` is an auto-updatable VIEW** over arrest_records with `name AS full_name`, so `UPDATE arrests SET ...` writes through. | Keep as is, or switch alerts.js to `arrest_records`/`name`. Other arrest queries should filter `suppressed = 0` (or `IS DISTINCT FROM 1`) if takedowns are to be honoured. |
| `providers p ON p.user_id = u.id WHERE p.id = <lawyer_id>` (consultations.js:462) | `lawyers` | `providers` = read-only VIEW over lawyers. New nullable `lawyers.user_id` (NULL on all 2055 real rows; nothing is written to the real rows). | `lawyers.user_id` stays NULL until an attorney claims a listing, so the callback push lookup finds no one. That matches the current behaviour. |
| `password_resets.used` (auth.js inserts `false`) | `used_at` | Adds `used BOOLEAN DEFAULT false`. `used_at` is kept. | Choose one. Note that auth.js inserts `used=false` but nothing reads it. |
| `bail_schedules.bail_min_cents / bail_max_cents / notes` (ragRetrieval.js) | bail_min / bail_max (dollars) / bail_note | **Generated (read-only) columns**: `bail_min*100`, `bail_max*100`, `bail_note` | Read-only. Don't write these names. |
| `dui_laws.first_offense_fine_cents / first_offense_jail_days / license_suspension_days / felony_threshold_priors` | first_fine_max (dollars) / first_jail_max / first_license_days / felony_threshold | Generated columns (`first_fine_max*100`, etc.) | Read-only. |
| `drug_penalties.drug_type / min_sentence_months / max_sentence_months / min_fine_cents` | drug_schedule / min_days / max_days / min_fine | Generated columns (`days/30`, `fine*100`) | Read-only. |
| `statute_of_limitations.offense_type` | crime_type | Generated column | Read-only. |
| `matter_parties.party_name / party_type` (conflicts.js, rbac.js) | name / role | Generated columns. firm_id and case_id are added as normal columns. | Read-only. Nothing in code writes matter_parties. |
| `firm_trials.trial_end_at`, `active = true` (firms.js trial-status) | the insert path writes trial_end / status | Generated: `trial_end_at = trial_end`, `active = (status = 'active')` BOOLEAN | Read-only. |
| `bar_prep_questions` (contentStaleness.js) | `quiz_questions` | Adds `quiz_questions.source_date` and `quiz_questions.reviewed_by`. `bar_prep_questions` is a VIEW over quiz_questions. | |
| `ai_daily_costs`, `ai_user_monthly_spend` (admin/aiCosts.js) | were empty TABLES nothing wrote to | Replaced by the legacy VIEWs over ai_usage_log (dropped only if empty). Adds ai_usage_log.job_id, route, status, queued_at, duration_ms, completed_at, subscription_tier. | aiQueue/aiCosts now work. |
| `user_bar_performance`, `subject_accuracy_breakdown` | missing | VIEWs (legacy definitions). subject_accuracy_breakdown also has subject_code, which barPrepAnalytics.js reads. | |
| `chat_sessions` used as a message log (`INSERT (session_id, role, content, user_id)`) | id TEXT PK with no default | id gets a default from a sequence (`nextval()::text`) | |
| `research_sessions` insert without id; `r.lastID` used as the session id | id TEXT PK with no default | Same sequence default, so `lastID` is numeric | |
| `refresh_tokens`, `user_disclaimer_acceptance`: adapter appends `RETURNING id` | composite PK, no id | Adds `id BIGSERIAL` (PK unchanged) | |
| `case_messages` insert writes body/sender_id | content / user_id were NOT NULL | NOT NULL dropped on content and user_id | |
| `attorney_profiles` insert at sign-up has no lawyer_id | lawyer_id NOT NULL | NOT NULL dropped | |
| `reviews` insert writes entity_type/entity_id | provider_id NOT NULL | NOT NULL dropped | |
| `integration_external_ids` (recap.js) writes provider='recap', firm_id | provider BIGINT; user_id and service NOT NULL | provider changed to TEXT; NOT NULL dropped; unique (firm_id, provider, entity_type, internal_id) added | |
| `outbound_messages` `INSERT ... VALUES (13 x ?)` with no column list **and no params array** (outbound_bot.js:~91) | table only had id, created_at | Adds the 008_outbound_bot.sql columns plus a unique idempotency_key | **Backend bug**: this needs an explicit column list and the params array. Positional VALUES can't match (id comes first). |

### Flag / boolean policy
- New 0/1 flags are INTEGER (DEFAULT 0/1), matching the baseline. Exceptions are columns the code only
  ever writes as SQL `true`/`false`: `user_subscriptions.dispute_flag`, `password_resets.used` (BOOLEAN).
- Existing BOOLEAN columns that the code writes as 0/1 were converted to INTEGER: firm_members.active,
  case_family_access.accepted, checkin_enrollments.active, webhook_subscriptions.active, cle_courses.active,
  cases.expungement_notified, bondsman_subscriptions.cancel_at_period_end.
- **Compatibility operators** `=` and `<>` for (integer|bigint, boolean) and (boolean, integer|bigint) were added
  (functions `public.jg_*`). `fm.active = true` and `fm.active = 1` both work, as does
  `quiz_questions.is_active = 1`. They only cover comparisons. **Assignments still need the column's
  type**: `SET active = 1` on INTEGER columns, `SET is_active = true` on BOOLEAN columns.
- JS booleans passed as **parameters** into INTEGER columns fail (`'true'` is not an integer). Use
  `x ? 1 : 0`.
- Remaining BOOLEAN columns: account_deletion_log.data_purged, acquisition_leads.converted,
  bar_prep_progress.daily_goal_met, bar_subjects.is_active, cases.capital_case,
  civil_attorney_profiles.contingency_fee/free_consultation, firm_onboarding.completed,
  firm_trials.converted, firms.accepting_clients/free_consultation/public_listing,
  lawyer_profiles.verified_badge, matters.capital_case, quiz_answers.is_correct,
  quiz_question_flags.resolved, quiz_questions.is_active/is_retired_mbe, study_streaks.streak_frozen, firm_trials.active.

### Date columns
Columns that the code compares with `CURRENT_DATE` are now `DATE`. 12 existing columns were converted:
case_events.event_date, consultation_bookings.date_slot, plea_offers.expires_date/offered_date,
voluntary_departure.departure_deadline/order_date, dv_firearm_surrender.surrender_deadline/tro_issue_date,
bop_exhaustion.thirty_day_lapse_date/warden_request_date, hague_proceedings.one_year_deadline/removal_date.
New DATE columns: contracts.expiry/renewal/execution_date, eviction_trackers deadline and date columns,
matter_events.event_date, time_entries.date, invoices.due_date/paid_date. Other `*_date` columns stay TEXT
(baseline convention). Compare them as `col::date`. `users.lock_until` and `users.last_seen` are now TIMESTAMPTZ.

### Strongly recommended in `backend/src/db/index.js` (backend scope)
node-pg returns BIGINT (int8, including every `COUNT(*)` and every id) and NUMERIC as **strings**, and DATE as
a JS Date at local midnight. This breaks code like `(count?.n || 0) + 1` (time.js generateInvoiceNumber
gives "01"+1 = "011"), `row.flag === 1`, and `if (row.flag)` (where '0' is truthy).
```js
import pg from 'pg';
pg.types.setTypeParser(20,   v => v === null ? null : Number(v));  // int8 / COUNT(*)
pg.types.setTypeParser(1700, v => v === null ? null : Number(v));  // numeric
pg.types.setTypeParser(1082, v => v);                              // date stays 'YYYY-MM-DD'
```

## RLS (migration 08)
- `ENABLE ROW LEVEL SECURITY` on every table in public (187 of 187). No policies, no FORCE.
- The backend (`postgres` owner role via DATABASE_URL; Supabase `service_role` has BYPASSRLS) is unaffected.
  This was tested on a simulated Supabase role set: anon and authenticated see 0 rows and are denied
  writes, while service_role and the owner see all rows.
- Views are switched to `security_invoker = true` (PG15+), and grants on views to anon/authenticated are
  revoked when those roles exist. Without this, the views would leak the underlying tables to anon.
  The Supabase-role statements are guarded, so 08 also runs on plain Postgres.
- Any table created later must get `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in its own migration.
  08 ends with a check that fails if any public table lacks RLS.

## Dynamic tables (covered by hand in 07 section 3)
- admin.js generic CRUD on lawyers/bail_agents: active, verified, last_verified_at, updated_at
  (adds `bail_agents.last_verified_at`)
- firm_verticals.js `/:firmId/:trackerId/resolve` on plea_offers, voluntary_departure, vop_trackers,
  bop_exhaustion, padilla_warnings: status, resolution_notes, updated_at, firm_id
- contentRefresh.js getContentAge() on expungement_rules, rights_cards, crisis_resources, lessons:
  content_verified_at, law_effective_date, needs_review (+ stale_since, needs_verification)
- contentStaleness.js / scan_content_freshness.js: last_reviewed_at on bail_schedules, dui_laws,
  drug_penalties, statute_of_limitations
- All `UPDATE <t> SET ${updates}` allowlists in firm_verticals.js, barPrep.js, etc. were checked per route,
  and every column now exists.

## Remaining SQL errors the schema can't fix (backend code)
These come up in the PREPARE pass against the final schema (file:line from the latest re-check):
- `COLLATE NOCASE`, which is SQLite only. Use `LOWER(a) = LOWER(b)` or `ILIKE`: match.js:69, match.js:324, cases.js:475
- `MAX(0, x)` used as a scalar is SQLite only. Use `GREATEST(0, x)`: billing/connections.js:191, billing/connections.js:249
- Ambiguous column in `ON CONFLICT DO UPDATE SET points = points + 5`. Qualify it as `rewards.points`:
  feedback.js:36, lessons.js:313. Same for `legal_content_versions.review_count` (contentStaleness.js:155)
- GROUP BY is missing non-aggregated columns: matter_intelligence.js:999, attorney/cases.js:165, time.js:356
- `SELECT DISTINCT ... ORDER BY` uses an expression that isn't in the select list: scheduler.js:217
- retention.js:416 references the alias `matters_count` where Postgres doesn't allow it (HAVING/WHERE)
- FTS queries `FROM cases_fts / messages_fts / lessons_fts WHERE ... c.user_id` don't join the alias
  tables: search.js:52, :70, :104; providers.js:322 (`l.` alias missing)
- questionBank.js:87: ambiguous `id`
- Syntax errors: firms.js:510 (missing comma before COUNT), checkins.js:236 (`lat = null` in the
  column list), video.js:106 (`INSERT INTO video_sessions INSERT INTO ...`), consultations.js:203
  (stray text before ORDER BY), billing/subscriptions.js:234 (`UPDATE ... ORDER BY ... LIMIT` isn't
  allowed in PG), attorney/templates.js:77 (`!==` and `char(10)` inside SQL), middleware/audit.js:82 and
  lessons.js:272 (statement ends with a dangling WHERE or a trailing comma)
- outbound_bot.js logMessage: INSERT without a column list and without params (see the table above)

## Data-format mismatches (reported only; the seeded data was not changed)
- **Federal / all-state rows**: bail_schedules uses `state = 'ALL'` (75 rows) and drug_penalties uses
  `state = 'FED'`. ragRetrieval.js queries `state = 'federal'`, which matches no rows. legaldata.js
  (`IN ('ALL','FED')`) and bail.js (`'ALL'`) are correct.
- All other reference tables (courthouses, federal_courts, probation_offices, law_school_clinics,
  state_bar_complaints, victim_compensation, specialty_courts, dui_laws, statute_of_limitations,
  recovery_agents, lawyers, bail_agents) use 2-letter upper-case state codes, which matches the code
  (`UPPER(state) = ?`, `.toUpperCase().slice(0,2)`). `resources` has 19 rows with a NULL or blank state.
  ragRetrieval defaults to `'TN'` and expects a 2-letter `cases.state`. If the app stores full state names
  in cases.state, those lookups miss.
- statute_of_limitations: the ragRetrieval comment says "102 records have years=NULL". The data actually
  has 0 NULL and 108 rows with `years = -1`, which means no limitation (murder etc.). The `years > 0`
  filter therefore silently drops "no limitation" answers.
- bail_schedules.bail_min/bail_max are whole dollars, and ragRetrieval expected cents. The generated
  *_cents columns multiply by 100.
- dui_laws.first_jail_min mixes units (AK = 72, which looks like hours, not days). first_offense_jail_days
  maps to first_jail_max.
- drug_penalties.max_days = 0 is used for "no max" (e.g. FED trafficking), so max_sentence_months = 0.
- courthouses.court_type is 'Criminal' (capitalised). No code filters on it today.

## Not done (with reasons)
- `attorneys` table and `bail_agents.license`, plus the unique index on `bail_agents.source_id`: only
  `src/scripts/_db.js` (the scraper upsert) uses them. Creating them would either fork provider data into a
  second table or let a scraper overwrite the verified lawyers/bail_agents rows. Left alone on purpose.
- `sqlite_master`: only used by SQLite maintenance scripts.
- Tests (`__tests__`) were not audited.

## backend_missing_schema.md
Checked at the start, during the work, and before finishing. The file did not exist at any of those checks.

## Appendix A: type corrections on existing columns (70)
- arrest_monitors.notify_email: bigint -> text
- asylum_clocks.a_number: integer -> text
- asylum_clocks.detained: text -> integer
- bondsman_subscriptions.cancel_at_period_end: boolean -> integer
- bop_exhaustion.bop_number: integer -> text
- bop_exhaustion.created_by: text -> bigint
- bop_exhaustion.thirty_day_lapse_date: text -> date
- bop_exhaustion.warden_request_date: text -> date
- case_events.event_date: text -> date
- case_family_access.accepted: boolean -> integer
- case_family_access.invited_by: text -> bigint
- cases.expungement_notified: boolean -> integer
- checkin_enrollments.active: boolean -> integer
- checkin_enrollments.enrolled_by: uuid -> bigint
- checkin_enrollments.status: bigint -> text
- checkin_enrollments.stripe_sub_id: bigint -> text
- cle_courses.active: boolean -> integer
- consultation_bookings.date_slot: text -> date
- dpa_trackers.coop_discount_pct: text -> double precision
- dpa_trackers.dpa_credit_pct: text -> double precision
- dual_sovereignty_flags.created_by: text -> bigint
- dv_firearm_surrender.created_by: text -> bigint
- dv_firearm_surrender.surrender_deadline: text -> date
- dv_firearm_surrender.tro_issue_date: text -> date
- ethics_wall_log.set_by: text -> bigint
- family_connections.stripe_pi_id: bigint -> text
- feedback.user_id: text -> bigint
- firm_members.active: boolean -> integer
- forum_posts.upvotes: text -> integer
- hague_proceedings.central_authority_contacted: text -> integer
- hague_proceedings.child_objection: text -> integer
- hague_proceedings.created_by: text -> bigint
- hague_proceedings.grave_risk_defense: text -> integer
- hague_proceedings.human_rights_defense: text -> integer
- hague_proceedings.one_year_deadline: text -> date
- hague_proceedings.removal_date: text -> date
- hague_proceedings.settled_defense_risk: text -> integer
- integration_external_ids.provider: bigint -> text
- lead_purchases.stripe_pi_id: bigint -> text
- matter_teams.added_by: text -> bigint
- mission_verification_requests.submitted_by: text -> bigint
- motion_templates.created_by: text -> bigint
- payment_links.stripe_link_id: bigint -> text
- plea_offers.created_by: text -> bigint
- plea_offers.expires_date: text -> date
- plea_offers.non_citizen: text -> integer
- plea_offers.offered_date: text -> date
- plea_offers.padilla_warning_given: text -> integer
- plea_offers.probation_months: text -> integer
- privilege_log.ai_generated: text -> integer
- privilege_log.created_by: text -> bigint
- privilege_log.withheld: text -> integer
- refund_requests.stripe_sub_id: bigint -> text
- revenue_log.stripe_link_id: bigint -> text
- revenue_log.stripe_pi_id: bigint -> text
- sso_configurations.created_by: text -> bigint
- time_entries.hours: text -> double precision
- tro_trackers.dv_flag: text -> integer
- tro_trackers.tro_filed: text -> integer
- users.last_seen: text -> timestamp with time zone
- users.lock_until: text -> timestamp with time zone
- voluntary_departure.a_number: integer -> text
- voluntary_departure.created_by: text -> bigint
- voluntary_departure.departure_deadline: text -> date
- voluntary_departure.order_date: text -> date
- vop_trackers.created_by: text -> bigint
- vop_trackers.detained_on_vop: text -> integer
- vop_trackers.original_sentence_months: text -> integer
- webhook_subscriptions.active: boolean -> integer
- webhook_subscriptions.created_by: text -> bigint

## Appendix B: columns added, by table (845)
- **aba_codes** (4): category, code, label, type
- **ability_to_pay** (26): alternative_ordered, assessment_date, assets_value_cents, bearden_motion_date, bearden_motion_filed, can_pay_full, can_pay_partial, client_name, court_finding, created_at, created_by, dependents_count, employed, employment_barriers, fees_total_cents, fines_total_cents, firm_id, genuinely_unable, matter_id, monthly_expenses_cents, monthly_income_cents, monthly_payment_required, notes, receives_public_benefits, restitution_total_cents, updated_at
- **account_deletion_log** (1): region
- **account_inactivity_log** (11): alert_sent_at, alert_type, cases_count, created_at, days_inactive, firm_id, id, last_seen_at, logged_at, matters_count, user_id
- **acquisition_leads** (6): firm_name, message, org_size, status, updated_at, vertical
- **ai_jobs** (2): error, started_at
- **ai_usage_log** (7): completed_at, duration_ms, job_id, queued_at, route, status, subscription_tier
- **alert_log** (5): category, contact_count, lat, lng, message
- **alerts** (9): contact, created_at, id, lat, lng, message, method, status, user_name
- **arrest_records** (8): disposition, disposition_added_at, disposition_court, disposition_date, suppressed, suppressed_at, suppressed_reason, updated_at
- **arrest_takedown_log** (4): arrest_id, requested_at, requested_by, status
- **asylum_clocks** (3): clock_paused, paused_at, paused_days
- **attorney_profiles** (6): outcome_count, outcome_score, payment_method_id, platform_rating, platform_review_count, stripe_cus_id
- **bail_agents** (2): last_verified_at, license_type
- **bail_schedules** (4): bail_max_cents, bail_min_cents, last_reviewed_at, notes
- **bar_prep_progress** (5): correct_total, notifications_enabled, questions_answered_total, streak_days, updated_at
- **bondsman_profiles** (13): active, bio, city, email, languages, leads_accepted, leads_received, name, photo_url, service_radius_km, tier, years_experience, zip_code
- **bop_exhaustion** (12): age_at_offense, court_decision, court_filing_eligible, court_motion_date, court_motion_filed, facility_email, percent_served, rehabilitation_record, resolution_notes, total_time_served_months, warden_response, warden_response_date
- **bot_runs** (11): arrests_found, completed_at, duration_ms, errors, leads_sold, messages_sent, opt_outs, replies_no, replies_yes, revenue_cents, run_type
- **calendar_push_events** (4): entry_id, matter_id, push_status, pushed_at
- **callback_requests** (1): duration_min
- **case_assignments** (1): user_id
- **case_family_access** (1): invited_at
- **case_messages** (2): deleted_at, read_at
- **cases** (11): archived_at, case_type, close_outcome, close_reason, closed_at, closed_reason, legal_hold, outcome_notes, outcome_recorded_at, outcome_recorded_by, share_expires_at
- **chat_messages** (1): user_id
- **checkin_records** (6): check_in_type, location_lat, location_lng, photo_uri, user_id, verified
- **civil_attorney_profiles** (22): accepts_contingency, active, bar_number, bio, city, contact_email, contact_name, contact_phone, counties, county, fee_structure, firm_name, leads_accepted, leads_received, license_state, max_lead_fee, payment_method_id, practice_type, state, stripe_cus_id, user_id, website
- **cle_completions** (5): bar_number, certificate_id, credit_hours, score, user_id
- **cle_courses** (6): category, content, credit_hours, description, difficulty, duration_min
- **client_assignments** (2): attorney_id, user_id
- **codefendant_links** (20): bruton_issue, bruton_notes, codef_cooperation, codef_cooperation_updated, codefendant_attorney_b, codefendant_name_b, created_by, firm_id, indictment_number, jda_active, jda_date, jda_terms, joint_trial_set, link_type, matter_id_a, matter_id_b, notes, separate_trial_set, severance_motion_filed, updated_at
- **collateral_consequences** (36): child_custody_impact, created_by, deportable_offense, drivers_license_suspended, employment_background_check_flag, federal_student_loans_affected, firearm_prohibition, firearm_prohibition_duration, firm_id, foster_care_adoption_bar, government_employment_bar, housing_note, inadmissibility_trigger, internet_restrictions, jury_duty_disqualified, license_suspension_months, mandatory_deportation, matter_id, military_service_bar, naturalization_bar, notes, pell_grant_affected, professional_license_at_risk, professional_license_type, public_housing_disqualified, registration_duration, residence_restrictions, section_8_disqualified, security_clearance_revoked, sex_offender_registration, snap_affected, social_security_affected, tanf_affected, updated_at, voting_rights_lost, voting_rights_restoration_path
- **conflict_index** (4): added_at, party_name_norm, party_name_orig, party_role
- **conflict_waivers** (6): adverse_party, authorized_by, client_consent, client_party, conflict_type, conflicting_matter_id
- **consultation_bookings** (3): cancelled_at, refund_id, reminder_sent
- **content_refresh_log** (10): category, created_at, errors, id, items_checked, items_stale, notes, results, run_at, warnings
- **contract_redlines** (5): changes, filename_original, filename_revised, risk_delta, summary
- **contract_reviews** (9): contract_id, favorable_terms, filename, missing_clauses, paid_cents, recommendations, red_flags, risk_level, summary
- **contracts** (16): contract_type, created_at, draft, execution_date, expiry_date, fields, id, paid_cents, party_a, party_b, renewal_date, status, title, updated_at, user_id, value_cents
- **crisis_resources** (8): content_verified_at, created_at, id, last_verified, law_effective_date, name, needs_review, needs_verification
- **docket_archive** (15): archived_at, assigned_to, completed_at, created_at, due_date, due_time, entry_type, firm_id, id, matter_id, notes, original_created_at, priority, status, title
- **docket_entries** (4): completed, completed_at, docket_number, reminded_at
- **document_sync_map** (6): doc_count, external_doc_id, last_synced_at, provider, sync_status, synced_at
- **dpa_trackers** (1): status
- **drug_penalties** (5): drug_type, last_reviewed_at, max_sentence_months, min_fine_cents, min_sentence_months
- **dui_laws** (5): felony_threshold_priors, first_offense_fine_cents, first_offense_jail_days, last_reviewed_at, license_suspension_days
- **dv_firearm_surrender** (7): complied_date, contempt_filed, federal_referral_risk, receipt_obtained, receipt_reference, status, surrender_deadline_time
- **eviction_trackers** (23): answer_deadline, client_name, created_by, cure_exercised, defenses, emergency_stay_filed, firm_id, hardship_protection_claimed, hearing_date, landlord_name, matter_id, notice_date, notice_period_days, notice_type, property_address, rent_owed_cents, rent_paid_cents, right_to_cure_deadline, state, stay_duration_days, stay_granted, summons_served_date, updated_at
- **expungement_rules** (7): content_verified_at, created_at, id, law_effective_date, needs_review, stale_since, state
- **family_connections** (1): amount_cents
- **firm_invites** (2): accepted, invited_by
- **firm_members** (1): role
- **firm_onboarding** (2): checklist_key, completed_at
- **firm_pricing_configs** (10): active, ai_calls_daily, annual_cents, created_at, description, display_name, matter_limit, monthly_cents, seat_limit, tier_key
- **firm_retention_policy** (12): cases_retain_days, created_at, docket_archive_days, firm_id, grace_period_days, honor_legal_holds, id, matters_retain_days, messages_retain_days, purge_warning_days, updated_at, updated_by
- **firm_trials** (11): active, converted_at, created_at, org_type, plan, status, trial_end, trial_end_at, trial_start, user_id, vertical
- **firm_upgrade_requests** (6): current_tier, notes, requested_by, reviewed_at, reviewed_by, target_tier
- **firms** (7): data_export_requested_at, features_json, invite_code, mission_verified, slug, subscription_grace_until, subscription_status
- **golden_gavel_hall** (7): display_name, featured, gavel_level, opted_in_at, people_helped, state, tier
- **hague_intakes** (8): abduction_date, case_id, child_age, country_code, country_of_removal, notes, submitted_at, submitted_by
- **hague_proceedings** (4): petition_country, petition_date, petition_filed, status
- **integration_connections** (5): config_json, external_id, last_error, last_sync_at, scope
- **integration_sync_log** (3): error, records_synced, sync_type
- **invoices** (22): amount_cents, billing_period_end, billing_period_start, client_email, client_name, created_at, created_by, due_date, firm_id, id, invoice_number, matter_id, matter_table, notes, paid_date, pdf_generated, status, subtotal_cents, tax_cents, tax_rate, total_cents, updated_at
- **lawyer_profiles** (10): bar_number, bar_state, calendly_uri, email, full_name, is_active, is_verified, last_verified_at, license_status, verification_source
- **lawyers** (5): bar_verified_since, jtb_verified_since, pending_verification, seed_data, user_id
- **lead_purchases** (1): bondsman_user_id
- **legal_holds** (11): active, applied_at, applied_by, created_at, firm_id, hold_type, id, reason, released_at, released_by, target_id
- **lessons** (3): content_verified_at, law_effective_date, needs_review
- **material_support_screening** (23): bar_finding, bar_potentially_applicable, client_name, created_at, de_minimis_argument_available, duress_description, duress_exception_available, exemption_sought, firm_id, matter_id, notes, organization_name, organization_type, provided_communications, provided_food, provided_money, provided_other, provided_shelter, provided_transportation, provided_weapons, referred_to_specialist, screening_date, under_duress
- **matter_events** (4): amount_cents, description, event_date, title
- **matter_parties** (4): case_id, firm_id, party_name, party_type
- **matter_team_members** (7): added_by, can_edit, can_message, can_view_docs, case_id, ethics_wall, matter_role
- **matter_teams** (2): active, added_at
- **matter_versions** (9): change_type, changed_at, changed_by, changed_via, created_at, field_changes, firm_id, id, matter_id
- **matters** (57): actual_value, archived_at, asset_tier, bop_request_date, branch, case_track, causation_type, class_certification_status, class_size, client_age, clock_days, closed_date, closed_reason, cooperation_level, country_condition, court_type, custody_type, damages_type, detained, dpa_status, dual_sovereignty_risk, dv_flag, economic_damages, evidence_bucket, evidence_score, hab_track, injury_severity, is_capital, legal_hold, lethality_score, matter_taxonomy, non_citizen, noneconomic_damages, on_supervision_since, placement_type, plaintiff_fault_pct, plea_expires_date, plea_offer_pending, policy_limit, prenup_flag, prior_adjudications, prior_appeals, prior_njp, punitive_damages, rank_e, relief_type, removal_type, service_years, supervised_release, support_formula, time_pressure, user_id, vertical, vol_departure_date, vulnerability_level, years_post_conviction, years_us
- **messages** (8): case_id, content, created_at, id, lang, recipient_id, sender_id, sender_role
- **mission_verification_requests** (1): status
- **motion_history** (10): case_fields, case_id, content, draft, filed_at, filing_status, jurisdiction, motion_type, paid_cents, status
- **motion_templates** (2): approved_at, approved_by
- **office_members** (3): active, joined_at, office_name
- **opt_outs** (1): opted_out_at
- **outbound_messages** (14): arrest_id, body, channel, error_msg, idempotency_key, message_type, recipient_email, recipient_id, recipient_phone, recipient_type, sendgrid_id, sent_at, sms_sid, status
- **padilla_warnings** (29): a_number, charge_is_aggravated_felony, charge_is_crime_of_moral_turp, charge_is_deportable, client_acknowledged, client_name, client_requested_time_to_consult, client_signature_obtained, explained_bar_to_relief, explained_daca_impact, explained_deportation, explained_family_separation, explained_inadmissibility, explained_lpr_loss, explained_naturalization_bar, firm_id, given_by, immigration_attorney_consulted, immigration_status, interpreter_language, interpreter_used, matter_id, notes, referred_to_immigration, resolution_notes, status, updated_at, warning_date, warning_method
- **password_resets** (1): used
- **payment_history** (1): product
- **payment_links** (3): fee_cents, paid_at, stripe_pi_id
- **pi_leads** (3): bondsman_id, notes, updated_at
- **plea_offers** (6): client_initiated_rejection, decision_date, offered_by, rejection_notes, resolution_notes, status
- **privilege_log** (1): reviewed_by
- **provider_update_log** (4): changed_at, record_id, source, table_name
- **push_tokens** (1): created_at
- **quiz_answers** (2): selected_answer, time_spent_ms
- **quiz_question_flags** (2): note, status
- **quiz_questions** (3): reviewed_by, rule, source_date
- **quiz_sessions** (6): category, mode, question_count, started_at, subject_id, total_answered
- **refresh_tokens** (1): id
- **refund_requests** (1): stripe_refund_id
- **revenue_log** (1): recorded_at
- **reviews_app** (1): provider_id
- **rights_cards** (4): content_verified_at, law_effective_date, needs_review, stale_since
- **role_permissions** (3): action, firm_role, resource
- **saved_lawyers** (3): gavel_level, golden_gavel, saved_at
- **scan_results** (7): completed_at, elapsed_ms, findings_json, overall, scan_id, started_at, summary_json
- **soc2_controls** (3): category, description, updated_at
- **spaced_repetition_state** (1): updated_at
- **sso_configurations** (1): active
- **statute_of_limitations** (2): last_reviewed_at, offense_type
- **subscriptions** (5): cancel_at_period_end, consumer_tier, current_period_start, provider_id, stripe_status
- **time_entries** (6): aba_code, date, description, duration_minutes, invoice_id, minutes
- **translation_messages** (7): lang, original, session_code, side, src_lang, tgt_lang, translated
- **translation_sessions** (5): code, defender_id, lang_a, lang_b, last_active
- **tro_trackers** (3): status, tro_granted, tro_served
- **user_badges** (4): awarded_at, badge_key, emoji, label
- **user_disclaimer_acceptance** (1): id
- **user_subscriptions** (2): dispute_flag, stripe_customer_id
- **users** (18): advisor_expires_at, avg_response_hrs, bar_rejection_reason, bar_reverify_needed, bar_submitted_at, bar_verified_at, bar_verified_by, compliance_flags, firm_id, full_name, golden_gavel_revoked_at, last_login_at, license_verified, referral_credit_cents, subscription_status, tos_ip_hash, tos_platform, updated_at
- **verified_badge_subscriptions** (7): cancel_at_period_end, cancelled_at, current_period_start, renews_at, started_at, stripe_cus_id, stripe_customer_id
- **vertical_deadline_presets** (7): business_days, days, description, label, priority, rule_key, vertical
- **video_sessions** (2): room_name, room_url
- **voluntary_departure** (6): cat_eligible, departed_date, departure_proof, resolution_notes, status, withholding_eligible
- **vop_trackers** (7): compound_emergency, outcome, resolution_notes, status, vop_hearing_date, vop_hearing_deadline, vop_petition_date
- **webhook_deliveries** (6): attempted_at, delivery_ms, response_body, response_status, subscription_id, success
- **webhook_subscriptions** (2): failure_count, last_triggered_at

---
Last full re-check: re-extracted backend/src SQL, PREPARE pass, regex/dynamic/ON CONFLICT passes, against migrations 00-08 on jg_db_test (2026-10-10 08:47).
