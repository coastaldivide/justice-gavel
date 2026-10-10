# Backend → schema: missing / mismatched objects

Owner of the fix: whoever maintains `supabase/migrations/`. The backend never
creates tables at runtime (all runtime `CREATE TABLE` calls were removed).

## Status (2026-10-10)

With migrations **00–08** applied (including `00000000000007_code_alignment.sql`
and `00000000000008_enable_rls.sql`, which appeared in the working tree during
this session):

| check | result |
|---|---|
| route sweep, 183 parameter-free GETs, logged-in user | 0 DB errors |
| write probe, 91 POST/PUT/PATCH/DELETE endpoints the app calls | 0 DB errors after code fixes |
| `PREPARE` of every static SQL string in `backend/src` (1,085 statements) | 0 failures (the only failure is `SELECT last_insert_rowid()` in the SQLite dev fallback) |
| smoke test (`backend/scripts/smoke-test.mjs`) | 25/25 |

So nothing the backend reads or writes is missing once 07 is applied.
`jg_be` itself now has 07 applied too (someone applied it during the session).

## Missing before migration 07 (jg_be with 00–06 only), first route sweep

These all 500'd and are all resolved by 07 (listed for traceability):

- tables/views: `contracts`, `alerts`, `user_bar_performance`, `subject_accuracy_breakdown`
  (also referenced by code: `messages`, `invoices`, `legal_holds`, `matter_versions`,
  `docket_archive`, `crisis_resources`, `expungement_rules`, `content_refresh_log`,
  `account_inactivity_log`, `firm_retention_policy`, `bar_prep_questions`, `providers`)
- `firms.mission_verified` (src/middleware/rbac.js firm context — hit by ~18 routes)
- `firm_pricing_configs.tier_key, display_name, seat_limit, …` (src/routes/firm_acquisition.js:122, firm_verticals.js:193)
- `vertical_deadline_presets.rule_key, label, days, business_days, …` (src/routes/firm_verticals.js)
- `video_sessions.room_name, room_url, matter_id, ended_at` (src/routes/video.js)
- `matter_teams.active` (src/routes/matters.js)
- `firm_trials.trial_end_at` (src/routes/firms.js:483)
- `case_family_access.invited_at` (src/routes/cases.js family list)
- `lawyers.user_id` (src/routes/attorney/profile.js availability)
- `civil_attorney_profiles.user_id` (src/routes/pi_leads.js profile)
- `verified_badge_subscriptions.stripe_customer_id, current_period_start, cancel_at_period_end` (src/routes/billing/bondsman.js:194/257/280)
- `subscriptions.current_period_start, cancel_at_period_end` (src/routes/billing/subscriptions.js:103, consumer.js:89)
- `saved_lawyers.saved_at, gavel_level, golden_gavel, bar_verified, jtb_verified` (src/routes/saved.js)
- `contract_reviews.risk_level, contract_id, filename` (src/routes/contracts/review.js, draft.js)
- `bar_prep_progress.questions_answered_total, correct_total, streak_days` (src/routes/barPrep.js leaderboard)
- `bondsman_profiles.name, phone, …` (src/routes/billing/bondsman.js:48)
- `motion_history.motion_type, case_fields, draft, filing_status, filed_at, paid_cents` (src/routes/motions/history.js:46/65)
- `golden_gavel_hall.display_name, tier, state, people_helped, featured, gavel_level` (src/routes/golden_gavel.js)
- `aba_codes.code, type, label, category` (src/routes/time.js)
- `alert_log.category, message, lat, lng, contact_count, sent_at` (src/routes/alerts.js)
- `family_connections.amount_cents` (src/routes/billing/consumer.js:104)
- `users.updated_at, tos_platform, tos_ip_hash` (src/routes/auth.js accept-tos)
- `cases.share_expires_at` (src/routes/cases.js PUT /:id)

## Still worth fixing in the schema (constraint / type mismatches, not missing objects)

1. `tos_acceptance_log.device_id` is BIGINT but the code writes `String(device_id)`
   (src/routes/auth.js:600). The app sends `null` today; any non-numeric id → 22P02. Suggest TEXT.
2. `firm_onboarding` has UNIQUE(`firm_id`) but the code stores one row per
   (`firm_id`, `checklist_key`) with `ON CONFLICT DO NOTHING`
   (src/routes/firm_acquisition.js:267, :454) → only the first checklist item is ever kept.
   Suggest UNIQUE(firm_id, checklist_key) instead.
3. `firm_members` has no UNIQUE(`firm_id`, `user_id`); the `ON CONFLICT DO NOTHING`
   inserts (src/routes/firms.js:74/243/397, firm_acquisition.js:243, sso.js:335) cannot de-duplicate.
4. `user_badges` is unique on (`user_id`, `badge_type`) but the code inserts `badge_key`
   (src/services/barPrepGavel.js:114) → badges can be awarded repeatedly. Suggest UNIQUE(user_id, badge_key).
5. `opt_outs` has no UNIQUE(`phone`) / UNIQUE(`email`) (src/services/outbound_bot.js:552,
   src/routes/webhooks/bot_admin.js:192) → duplicate opt-out rows (harmless, but intended to dedupe).
6. `arrest_records` has no natural key, so ingest's `ON CONFLICT DO NOTHING`
   (src/services/arrest_ingest.js:132) cannot dedupe re-imports. e.g. UNIQUE(source, case_number).
7. `case_assignments(case_id)`, `document_sync_map(connection_id, matter_id)`,
   `hague_intakes(case_id, user_id)`: the code now does update-then-insert (was SQLite
   `INSERT OR REPLACE`); a unique constraint would make these race-free and allow `ON CONFLICT … DO UPDATE`.
