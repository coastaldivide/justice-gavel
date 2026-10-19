# Justice Gavel — Incident Runbook

**App version:** 8.7.60 (all packages aligned; `/health` reports it) |
**On-call contact:** engineering@justicegavel.app

---

## QUICK REFERENCE

| Service | URL | Dashboard |
|---------|-----|-----------|
| Production API | https://api.justicegavel.app | Railway |
| Health check | https://api.justicegavel.app/health | 200 = DB round-trip OK, 503 = degraded |
| Metrics | https://api.justicegavel.app/metrics | JSON (or `?format=prometheus`) — memory, AI queue, pg pool |
| Sentry errors | https://sentry.io | Sentry dashboard |
| Database | Supabase / Railway Postgres | provider dashboard |
| Uptime | BetterUptime (see UPTIME_MONITORING.md) | BetterUptime dashboard |

Environment variables: **RAILWAY_ENV_SETUP.md** is the single reference —
this document no longer duplicates the list.

---

## INCIDENT SEVERITY LEVELS

| Level | Response time | Examples |
|-------|--------------|---------|
| SEV-1 CRITICAL | 15 min | DB down, auth broken, all users locked out |
| SEV-2 HIGH | 1 hour | AI chat down, payments failing, 50%+ error rate |
| SEV-3 MEDIUM | 4 hours | Single feature broken, elevated error rate |
| SEV-4 LOW | 24 hours | UI glitch, non-critical slow query |

---

## RUNBOOK: SEV-1 — Database Down

**Symptoms:** `/health` returns 503 with `{"db": "error"}`, all API calls fail

1. Check provider status: https://status.supabase.com (or Railway status)
2. Check Railway logs: `railway logs` (from a directory linked to the API service)
3. Verify `DATABASE_URL` env var is set: `railway variables`
4. If provider issue: wait for resolution, post a status update
5. If Railway issue: redeploy from last stable commit
6. Post-recovery: `node scripts/check-env.js` and `node scripts/smoke-test.mjs https://api.justicegavel.app`

Note: `/health` caches its DB probe for `HEALTH_CACHE_MS` (default 5 s), so
recovery shows up within one cache window.

**Recovery test:** `curl -s https://api.justicegavel.app/health | jq .db`

---

## RUNBOOK: SEV-2 — Anthropic AI Down

**Symptoms:** `/chat`, `/motions`, `/research` endpoints return 503
`ai_unavailable` or time out; `/metrics` queue `failed` climbing

1. Check `/health` → `features.ai` — `false` means the key is missing/unset,
   which is configuration, not an outage
2. Check Anthropic status: https://status.anthropic.com
3. AI calls have a per-job timeout (`AI_JOB_TIMEOUT_MS`, default 45 s); queued
   jobs drain on restart (`AI_DRAIN_TIMEOUT_MS`)
4. If stuck: restart the Railway service (SIGTERM → graceful shutdown drains
   the AI queue before exit)

**User communication:** AI features temporarily unavailable. Non-AI features
(bail calculator, rights cards, attorney search) remain fully operational.

### AI spend cap reached (`daily_budget_reached`)

Every model call is metered into `ai_usage_log` (route, user, tokens, cost).
When today's spend (UTC) reaches `AI_DAILY_BUDGET_USD` (default $50) AI routes
answer `503 {error:'ai_unavailable', reason:'daily_budget_reached'}` until
00:00 UTC; you get one SEV-2 alert at `AI_BUDGET_ALERT_PCT` (80 %) and one
SEV-1 at 100 %.

1. Who spent it: `GET /api/admin/ai-costs` (admin + X-Admin-Key) or
   `SELECT route, user_id, count(*), sum(cost_usd) FROM ai_usage_log
    WHERE queued_at >= date_trunc('day', now() at time zone 'utc') GROUP BY 1,2 ORDER BY 4 DESC LIMIT 20;`
2. Abuse (one user / one route dominating): suspend the account
   (`users.account_status='suspended'`) — per-user limits are 60 AI calls/hour.
3. Legitimate growth: raise `AI_DAILY_BUDGET_USD` in Railway → takes effect on
   the next request (no restart needed for a raise; the value is read live).
4. Also keep a hard monthly limit in the Anthropic console as the last backstop.

---

## RUNBOOK: SEV-2 — Stripe Payment Failures

**Symptoms:** Subscription attempts failing, `invoice.payment_failed` webhooks firing

0. First check `/health` → `features.payments`. `false` = Stripe keys not
   configured — billing deliberately returns `503 payments_unavailable`
   (expected state until keys are set; not an incident)
1. Check Stripe status: https://status.stripe.com
2. Check webhook signature: `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard
3. Check the endpoint is receiving: Stripe Dashboard → Developers → Webhooks
   (endpoint is `POST /webhooks/stripe`, raw-body, signature-verified)
4. Test: `stripe trigger invoice.payment_failed` (Stripe CLI)
5. Check `past_due` users: `SELECT count(*) FROM users WHERE subscription_status='past_due'`

**Note:** `past_due` users retain access during the grace period (subscription
state machine handles this automatically).

---

## RUNBOOK: SEV-1 — JWT Secret Compromised

1. **IMMEDIATELY** rotate `JWT_SECRET` in Railway env vars
2. **IMMEDIATELY** rotate `JWT_REFRESH_SECRET`
3. Run: `DELETE FROM refresh_tokens;` (invalidates all sessions)
4. All users must re-login (expected — communicate it)
5. Check audit_log for unusual access:
   `SELECT * FROM audit_log WHERE action='user.login' ORDER BY created_at DESC LIMIT 100`

Also note: secrets that were ever committed (an old revision of
`backend/scripts/railway-checklist.md` embedded real values) are burned —
if they were ever deployed, rotate them now.

---

## DEPLOY PROCESS

```bash
git push origin main      # Railway auto-deploys the service (root directory: backend)
railway redeploy          # redeploy the latest deployment (Railway CLI)
```

Roll back: Railway dashboard → Deployments → pick the last good deployment →
Redeploy. Restart: Railway dashboard → the service → Restart.

**Pre-deploy checklist:**
- [ ] `node scripts/check-env.js` passes
- [ ] Backend tests pass: `npm run lint && npm test` (in backend/)
- [ ] Frontend compiles: `npx tsc --noEmit` (in frontend/)
- [ ] No high+ production vulnerabilities: `npm audit --omit=dev --audit-level=high`
- [ ] If routes changed: `npm run generate:openapi` (repo root) and commit openapi.json
- [ ] New migrations applied to the production DB with psql **before** deploy

---

## DATABASE BACKUP

Two layers:

1. **Supabase** takes daily backups (Pro plan: 7 days; enable the PITR add-on
   for point-in-time recovery). Dashboard → Project → Database → Backups.
2. **Off-platform copy** (our scripts, tested in CI by
   `backend/src/__tests__/integration/backup_restore.int.test.js`):

```bash
# Back up (pg_dump custom format + .sha256; prunes dumps older than BACKUP_KEEP_DAYS=30)
DATABASE_URL=postgres://… backend/scripts/db-backup.sh /secure/backups

# Restore drill — into a NEW, EMPTY database, verified against the source
createdb jg_restore_drill
TARGET_DATABASE_URL=postgres://…/jg_restore_drill \
SOURCE_DATABASE_URL=postgres://…/source_db \
  backend/scripts/db-restore.sh /secure/backups/jg-<stamp>.dump
# → "verified: row counts and provider checksums match the source" / "restore ok"
```

The restore refuses a non-empty target (exit 4) and a dump whose checksum does
not match (exit 3). Run the backup daily from a machine/cron outside Railway
(dumps contain encrypted notes/messages but also e-mails and phone numbers —
store them encrypted, access-controlled) and do a restore drill monthly.
**Real restore (incident):** restore into a fresh Supabase project, point
`DATABASE_URL` at it, redeploy, then run the smoke test.

**Critical tables to verify after incidents:** `users`, `audit_log`
(append-only, never delete), `user_disclaimer_acceptance`, `refresh_tokens`,
`subscriptions`.

---

## STAGING

Staging = the production build with its own Railway environment, its own
Supabase project and test keys:
`NODE_ENV=production`, `APP_ENV=staging`, staging `DATABASE_URL`,
`PRODUCTION_DATABASE_URL=<prod URL>` (boot guard), Stripe `sk_test_…` or none,
`LIVE_REFRESH=false`. Config is in RAILWAY_ENV_SETUP.md → "Staging";
`backend/railway.staging.json` is the service config (same as production).
`NODE_ENV=staging` and live Stripe keys are refused at boot.

Promote a change: deploy to staging → apply new migrations there first →
`node backend/scripts/smoke-test.mjs https://<staging-host>` → only then
apply the migrations to production and deploy. `/health` reports `env`.

---

## AUTOMATED MONITORING — WHAT ACTUALLY RUNS

| Monitor | Frequency | Action |
|---------|-----------|-------------------|
| Memory watchdog (**RSS**, thresholds from `MEMORY_LIMIT_MB`, default 512) | 30 s | warn at 72% (368 MB) → force GC + SEV-2 at 85% (435 MB) → graceful restart at 93% (476 MB) |
| DB health check | 60 s | logs unhealthy state; `/health` turns 503 so the uptime monitor pages |
| Stale job locks | 15 min | auto-clear locks older than 30 min |
| Uncaught exception / unhandled rejection | immediate | SEV-1 notify, then process exit → Railway restarts |
| `invoice.payment_failed` webhook | per event | subscription state machine + SEV-2 notify |
| Slow queries | per query | WARN log when > `SLOW_QUERY_MS` (default 500 ms; SQL text only, never bind values) |

There are **no circuit breakers** (removed — dead code) and **no SMS alerts**
(no SMS provider is wired; `ADMIN_ALERT_SMS` is informational only).

### Alert channels

| Severity | Channel |
|----------|---------|
| SEV-1 (critical) | Email to `ONCALL_EMAIL` (+ `ONCALL_EMAIL_2`) + Slack `ALERT_WEBHOOK_URL` + Sentry |
| SEV-2 (error) | Email + Slack webhook + Sentry |
| SEV-3 (warn) | Log + Sentry warning, daily review |

Dedup: the same alert code is suppressed for **5 minutes** after first fire,
so an incident can't send thousands of emails.

Setup: Slack incoming webhook → `ALERT_WEBHOOK_URL`; `RESEND_API_KEY` must be
set for alert email to actually send (otherwise alerts are logged only);
`SENTRY_DSN` for error tracking.

### Production logs

One JSON object per line (Railway/Datadog-friendly). HTTP lines log the path
**without the query string** (search params can carry PII). `LOG_FORMAT=text`
switches to human-readable.

Every line written while a request is handled carries its `request_id` (the
`X-Request-ID` response header; 5xx bodies include it too) — search the logs
for it to follow one request. The logger, Sentry and alert e-mails/webhooks
scrub passwords, tokens, API keys, Authorization headers, e-mail addresses and
phone numbers (`backend/src/utils/redact.js`). Best-effort side effects that
fail are logged as `[best-effort] step failed` with where they happened.

### Duplicate protection

Create endpoints (cases, events, messages, reminders, saved lawyers, reviews,
feedback, SOS alerts, contacts, monitors, bookings) accept an
`Idempotency-Key`; the app sends one and retries a dropped request with the
same key, so the server replays the first answer instead of creating a
duplicate (`idempotency_keys`, 24 h, purged daily). `409
idempotency_in_progress` = the same request is still running.

---

## SCHEDULED JOBS

| Job | When | Requires |
|---|---|---|
| Reminder delivery (court dates + user-set reminders: push via Expo, email fallback) | every 60 s in each API process; re-plans missing court reminders every 6 h | always on; `REMINDERS_ENABLED=false` turns it off for a process |
| Check-in reminder blast `POST /api/checkins/remind-all` | external cron | staff token **or** `X-Admin-Key` |
| Nightly pipeline: provider refresh → Postgres (Google/Yelp; civil attorneys, state-bar listings and recovery agents on Sundays), arrest-feed ingestion, arrest alerts, payment-link expiry, token cleanup | `REFRESH_CRON` (default 3 am `REFRESH_TZ`) | `LIVE_REFRESH=true`; provider steps also need `GOOGLE_PLACES_KEY` and/or `YELP_API_KEY` (else skipped + logged) |
| Health scan | `HEALTH_SCAN_CRON` (default 2 am) | scheduler on |
| Bar re-verification sweep | daily tick, re-verifies attorneys whose verification is > 90 days old | scheduler on |
| Bar-prep reminders (`bar-daily-7am`, `bar-streak-3pm`, `bar-countdown-8am`) | daily | `REDIS_URL` (BullMQ) |

Manual bar-verification sweep: `POST /api/admin/bar-verification/sweep`
(bearer token of a user whose role is `admin`, plus the `X-Admin-Key` header —
the `/api/admin` guard applies to every `/api/admin/*` path). Manual nightly run:
`node -e "import('./src/services/barVerification.js').then(m=>m.runNightlyVerification())"`.

---

## DATA REFRESH (providers, arrests, legal reference data)

Every scraper, importer and scheduler step writes the **main Postgres
database** (`DATABASE_URL`) through `backend/src/services/dataRefresh/`. Nothing
writes `backend/data/providers.sqlite` any more (the file is kept, read-only,
for the one-off import below). Owner rule — `lawyers` / `bail_agents` (and
`recovery_agents`) rows are real, verified data:

- a provider **not yet listed** (matched by Google place id / `source_id`, then
  normalized phone, then normalized name + city + state) is **inserted** —
  active, unverified, with `source`, `source_id`, `created_at`, `updated_at`;
- a **difference** for a provider already listed (phone, hours, address,
  website, rating, reviews, lat/lng, email, bar / license number) is **never
  written to the row** — it is staged in `provider_update_proposals` as
  `pending` for an admin to apply or reject;
- rows a scrape does not return are never deleted, deactivated or hidden;
- re-running is idempotent (no duplicate rows, no duplicate proposals; a
  rejected value is never proposed again). Writers share one advisory lock,
  so two refreshes never run against the directory at once.
- every run writes a `scrape_runs` row: job, trigger (scheduler / manual /
  admin), status (`ok` / `partial` / `failed` / `skipped`) and counts
  fetched / inserted / proposed / unchanged / updated / skipped / errors.

**Run a refresh**

| What | How |
|---|---|
| Nightly (automatic) | `LIVE_REFRESH=true` + `GOOGLE_PLACES_KEY` (and/or `YELP_API_KEY`). No key → the step logs `provider refresh skipped` and records a `skipped` run. |
| From the admin console | `POST /api/admin/refresh` `{ "city"?: "Nashville, TN", "type"?: "lawyers|bail|civil|all", "source"?: "google|yelp|all", "dryRun"?: true }` → 202 (runs in the API process) or 200 `skipped` when no key is set |
| Everything, by hand | `railway run bash scripts/run-all-scrapes.sh [--dry-run] [--state TN]` (from `backend/`) |
| One script | `railway run node src/scripts/refresh.js --city "Nashville, TN" --dry-run` · `scrape_providers_national.js --state TX` · `scrape_recovery_agents.js` · `scrape_state_bars.js --state TN` |
| Import a file | `import_csv.js --file x.csv --type lawyers|bail` · `import_doi_bondsmen.js --file tn.txt --state TN` · `bash ../scripts/run_doi_import.sh` (NIPR / per-state DOI files) |
| Legal reference fix | `update_legal_data.js --type dui --state TN --set field=value --source-url https://… --verified-by JD [--dry-run]` (idempotent; audit-logged) |
| Arrest rosters | not scheduled (heuristic page parsing). `scrape_arrests.js --dry-run` first, review, then run; insert-only, validated. The scheduler ingests arrests only from `ARREST_FEED_URLS`. |

Every script supports `--dry-run` (fetch + match, write only the run log) and
exits 0 with a clear message when its API key is missing.

**Review staged changes** (admin role, read live from the DB, + `X-Admin-Key`):

```
GET  /api/admin/proposals?status=pending&table=lawyers&field=phone&limit=50
POST /api/admin/proposals/:id/apply    { "note"?: "...", "force"?: false }
POST /api/admin/proposals/:id/reject   { "note"?: "..." }
POST /api/admin/proposals/apply        { "ids": [1,2,3] }      # bulk, ≤ 500, per-id results
POST /api/admin/proposals/reject       { "ids": [4,5] }
GET  /api/admin/refresh/runs?job=providers
```

Applying writes only that one column (+ `updated_at`), refuses with 409
`stale` if the row changed since the proposal was made (re-check, or pass
`force: true`), supersedes other pending proposals for the same field, and
logs to `provider_update_log` (who / old / new) and `audit_log`.

**One-off legacy import.** `node src/scripts/import_legacy_providers_sqlite.js`
(dry run by default, `--apply` to write) compares the old SQLite file with
Postgres under the same rules. Against the migrated seed: 2,048 lawyers,
1,262 bail agents and 531 recovery agents — every one already in Postgres with
identical tracked fields (0 to insert, 0 to propose).

---

## CORE PATH ("Just arrested?") — queues, reminders, content

**Rights content.** `backend/src/services/rightsContent.js` serves the card (general = the app's bundled
card, state notes = the recorded state summaries) with source + "last reviewed" on every section. Lawyer-
reviewed text goes in `rights_cards` (one row per state+topic+language, `source` REQUIRED, `reviewed_by`,
`content_verified_at`); a row without a source is never shown. Check: `GET /api/rights/TN`.

**Listing reports** (users tapping "Report a problem with this listing"). They never edit the listing.
```bash
curl -H "Authorization: Bearer $ADMIN_JWT" -H "X-Admin-Key: $ADMIN_KEY" $API/api/admin/listing-reports
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H "X-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' \
     -d '{"status":"resolved","note":"phone fixed via proposal 123"}' $API/api/admin/listing-reports/42
```
A real fix goes through the normal provider edit / proposals review (DATA REFRESH above).

**Listing claims** ("Is this your business? Claim this listing"). Check the bar / bail-agent license, then
`POST /api/admin/listing-claims/:id {"decision":"approve"|"reject"}`. Approval links the claimant's own
profile (`attorney_profiles.lawyer_id` / `bondsman_profiles.bail_agent_id`); in-app messages then reach
lawyers (bail-agent messaging is not built yet). The listing row is never changed.

**Court reminders.** One set per hearing (`court_dates`, `scheduled_pushes.court_date_id`): 7 d 09:00,
3 d 09:00, 1 d 18:00, morning-of 06:30 in the user's zone; consented family followers get the same set
(`follower_court_reminder`). Delivery chain: push → e-mail (needs `RESEND_API_KEY`) → SMS (needs all of
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and the user's opt-in) → logged e-mail
(`channel = 'email_log_only'`). Each missing provider is skipped, never an error.
```sql
SELECT status, channel, error, count(*) FROM scheduled_pushes
 WHERE notification_type IN ('court_reminder','follower_court_reminder') AND created_at > now() - interval '1 day'
 GROUP BY 1,2,3;
```

## API RESPONSE SHAPE (for quick triage)

Errors are `{ "error": "message", "code"? }`; validation errors are
`400 { "error": "Validation failed", "errors": [{ field, message, code }] }`.
Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404, 429
(`Retry-After` set), 451 AI disclaimer not yet accepted (`disclaimer_required`
— a user action, not an incident), 500 (Sentry-logged), 503 deliberate
feature-off (`payments_unavailable` / `ai_unavailable` / `storage_unavailable`).
Full reference: API_REFERENCE.md + openapi.json.

---

## BAR PREP FEATURE (ops notes)

- Uses existing `ANTHROPIC_API_KEY` + `REDIS_URL`; no extra env vars.
- Schema ships in `supabase/migrations/00000000000004_bar_prep_schema.sql`
  and `..05_bar_prep_questions.sql` (applied with the rest).
- Content import: `POST /api/admin/bar-prep/import` (staff);
  question/flag admin under `/api/admin/bar-prep/*`.
- Free tier is hard-gated to 10 sample questions; paid tiers get the full bank.
