# Justice Gavel — Incident Runbook

**App version:** 8.7.60 (all packages aligned; `/health` reports it) |
**On-call contact:** engineering@justicegavel.app

---

## QUICK REFERENCE

| Service | URL | Dashboard |
|---------|-----|-----------|
| Production API | https://api.justicegavel.app | Render → `justice-gavel-api` |
| Staging API | `https://justice-gavel-api-staging.onrender.com` (Render shows the exact URL) | Render → `justice-gavel-api-staging` |
| Health check | https://api.justicegavel.app/health | 200 = DB round-trip OK, 503 = degraded |
| Metrics | https://api.justicegavel.app/metrics | JSON (or `?format=prometheus`) — memory, AI queue, pg pool |
| Sentry errors | https://sentry.io | Sentry dashboard |
| Database | Supabase (one project per environment) | Supabase dashboard |
| Uptime | BetterUptime (see UPTIME_MONITORING.md) | BetterUptime dashboard |

Environment variables: **DEPLOY_ENV_SETUP.md** is the single reference —
this document no longer duplicates the list. Services: **render.yaml**.

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

1. Check provider status: https://status.supabase.com (and https://status.render.com)
2. Check logs: Render → `justice-gavel-api` → **Logs** (look for `[db]` lines)
3. Verify `DATABASE_URL` is set: Render → service → **Environment**
4. If provider issue: wait for resolution, post a status update. While the DB
   is down `/health` answers 503, so Render marks the instance unhealthy and
   restarts it; boot is fatal without a reachable DB, so it keeps restarting
   until the DB is back — expected, it recovers on its own
5. If a bad deploy caused it: roll back (DEPLOY → "Roll back")
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
4. If stuck: Render → service → **Manual Deploy → Restart service**
   (SIGTERM → graceful shutdown drains the AI queue before exit)

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
3. Legitimate growth: raise `AI_DAILY_BUDGET_USD` in Render → service →
   Environment → **Save and deploy** (the instance restarts with the new value).
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

1. **IMMEDIATELY** rotate `JWT_SECRET` (Render → service → Environment → Save and deploy)
2. **IMMEDIATELY** rotate `JWT_REFRESH_SECRET`
3. Run: `DELETE FROM refresh_tokens;` (invalidates all sessions)
4. All users must re-login (expected — communicate it)
5. Check audit_log for unusual access:
   `SELECT * FROM audit_log WHERE action='user.login' ORDER BY created_at DESC LIMIT 100`

Also note: secrets that were ever committed (an old revision of the
go-live checklist, now `backend/scripts/go-live-checklist.md`, embedded real values) are burned —
if they were ever deployed, rotate them now.

---

## DEPLOY (Render)

Hosting is **Render**, defined in **`render.yaml`** (repo root, a Blueprint):

| Service | Branch | Database | Notes |
|---|---|---|---|
| `justice-gavel-api` | `main` | production Supabase project | `APP_ENV=production`, custom domain `api.justicegavel.app` |
| `justice-gavel-api-staging` | `main` | staging Supabase project | `APP_ENV=staging`, `NODE_ENV=production`, Render-generated secrets |

Both are Docker web services (Starter, Oregon) built from `backend/Dockerfile`
with the repo root as context. Every deploy: build image → **pre-deploy**
`sh /app/scripts/migrate.sh` (applies new `supabase/migrations/*.sql`, each
once, `ON_ERROR_STOP`; recorded in `jg_meta.schema_migrations`) → start →
`/health` must answer 200 → traffic switches to the new instance → the old one
gets SIGTERM and up to `maxShutdownDelaySeconds: 30` to drain (the server
force-exits at 25 s). A failed build, migration or health check fails the
deploy and the previous version keeps serving.

### First deploy (Blueprint)

1. Supabase: the existing production project, plus a NEW project for staging.
   For attachments, create a private Storage bucket `case-documents`
   (`ATTACHMENTS_BUCKET`) in each project.
2. Optional, existing production database only: the first pre-deploy finds no
   migration ledger and replays every migration once (they are idempotent; CI
   applies the whole set twice). To skip the replay, record what is already
   applied first, from a checkout:
   `DATABASE_URL=<prod> sh backend/scripts/migrate.sh --baseline 00000000000023_user_language.sql`
   (use the last file that is really applied; `--status` shows the ledger).
3. Render → **New → Blueprint** → connect `coastaldivide/justice-gavel` →
   Render reads `render.yaml` and lists both services. Fill in the prompts:

   **Production (`justice-gavel-api`), in this order**
   1. `DATABASE_URL` — production Supabase connection string (Transaction pooler).
      If a migration ever fails on a pooler limitation, add
      `MIGRATIONS_DATABASE_URL` = the direct / session connection (port 5432).
   2. `ENCRYPTION_KEY` — the **EXISTING** key from the current deployment /
      password manager. Never a new one when data exists: every encrypted note
      and message would become unreadable, and it cannot be recovered.
   3. `JWT_SECRET`, `JWT_REFRESH_SECRET` — the existing values (users stay signed
      in) or new ones (`openssl rand -hex 32` each, different; everyone signs in again).
   4. `ADMIN_KEY` — existing value or `openssl rand -hex 32`.
   5. `ANTHROPIC_API_KEY`.
   6. `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — production project (attachments).
   7. Optional (leave empty to keep the feature off; if the form will not
      accept an empty value, delete that entry from render.yaml first):
      `RESEND_API_KEY`, `EXPO_ACCESS_TOKEN`, `GOOGLE_PLACES_KEY`,
      `ALERT_WEBHOOK_URL`, `ONCALL_EMAIL`.

   **Staging (`justice-gavel-api-staging`)**: `DATABASE_URL` (the STAGING
   project — never production), `ANTHROPIC_API_KEY`, `SUPABASE_URL` /
   `SUPABASE_SERVICE_KEY` (staging project). JWT / encryption / admin secrets
   are generated by Render (`generateValue`); read `ADMIN_KEY` from the
   staging service's Environment tab when you need it.

   Plain values (`NODE_ENV`, `APP_ENV`, `TRUST_PROXY`, `LIVE_REFRESH`,
   `MEMORY_LIMIT_MB`, `ATTACHMENTS_STORAGE`, `BASE_URL`, `APP_URL`,
   `SENTRY_DSN`) come from `render.yaml`. Stripe stays unset (payments answer
   `503 payments_unavailable`); add the Stripe variables later in the
   dashboard — no code change.
4. **Apply.** Watch the first deploy's log: `[migrate] done: N applied, …`, then
   `[server] Justice Gavel API started` with `platform: render` and the commit.
5. Custom domain: production service → **Settings → Custom Domains** → add
   `api.justicegavel.app` → create the CNAME Render shows at the DNS provider;
   Render issues and renews the TLS certificate.
6. Verify: `curl -s https://api.justicegavel.app/health` → `"db":"ok"`,
   `"env":"production"`, `"commit"` = the deployed commit; then
   `node backend/scripts/smoke-test.mjs https://api.justicegavel.app`.
7. Set `TRUST_PROXY` from a measurement — "Client IP / TRUST_PROXY" below.
8. Point the app at it (`EXPO_PUBLIC_API_BASE`, EAS) only after 6–7 pass;
   then retire the old host.

### Everyday deploy

- **Automatic:** push / merge to `main`. Render waits for the GitHub CI checks
  (`autoDeployTrigger: checksPass`); if CI fails, nothing deploys.
- **Manual:** service → **Manual Deploy** → *Deploy latest commit* (or *Deploy
  a specific commit*; *Clear build cache & deploy* if a build misbehaves).
- **Restart without a new build:** **Manual Deploy → Restart service**.
- Pre-deploy checklist:
  - [ ] CI green (lint 0/0, Postgres migrations ×2, smoke test, all jest suites)
  - [ ] `node scripts/check-env.js` passes for the target environment
  - [ ] If routes changed: `npm run generate:openapi` (repo root) and commit openapi.json
  - [ ] New migrations are idempotent (CI applies the set twice) — they run
        automatically in pre-deploy; a failing one fails the deploy

### Roll back

Service → **Events** → the last good deploy → **Rollback** (re-runs that
build with the CURRENT env vars). After a rollback check **Settings → Build &
Deploy → Auto-Deploy** and re-enable it once the fix is on `main`.
A rollback does **not** undo migrations: they are additive, so the previous
version runs against the newer schema; fix forward with a new migration if a
change must be reverted.

### Logs

Service → **Logs**: live tail and search (one JSON object per line; search a
`request_id` from an `X-Request-ID` header or 5xx body to follow one request;
filter by instance when there are several). Deploy output, including the
pre-deploy `[migrate]` lines, is under **Events → the deploy → Logs**. To keep
logs longer, add a Log Stream (Workspace settings → Log Streams → Datadog /
Better Stack / syslog).

### Environment variables

Service → **Environment** → edit → **Save and deploy** (restarts with the new
value), *Save, rebuild, and deploy*, or *Save only* (applies at the next
deploy). Keys with `value:` in `render.yaml` are re-applied on every Blueprint
sync — change those in `render.yaml` (commit + push). `sync: false` keys are
owned by the dashboard after creation. Reference: DEPLOY_ENV_SETUP.md.

### Health check behaviour

`healthCheckPath: /health` — 200 only when a real `SELECT 1` succeeds (probe
cached `HEALTH_CACHE_MS`, 5 s), otherwise 503. A new deploy receives traffic
only once healthy; if it never becomes healthy the deploy fails and the old
version keeps serving. A running instance that keeps failing is restarted by
Render — during a database outage that means a restart loop (boot is fatal
without a database) that ends by itself when the database is back. The
Dockerfile `HEALTHCHECK` only matters for plain `docker run`.

### Scaling

- **Default (render.yaml): attachments in Supabase Storage** — the service is
  stateless, so it can run more instances (`numInstances`, or autoscaling on a
  Professional workspace) and keeps zero-downtime deploys. Caveats before
  going above 1 instance: the nightly scheduler (`LIVE_REFRESH=true`) runs in
  every instance (keep 1 instance while it is on, or move it to a Render Cron
  Job); rate limits and the 60 s principal cache are per instance (effective
  limits multiply by the instance count). Reminder delivery is safe across
  instances (rows claimed `FOR UPDATE SKIP LOCKED`).
- **Alternative: Render disk** (commented block in render.yaml,
  `ATTACHMENTS_STORAGE=local`, `ATTACHMENTS_DIR=/var/data/attachments`) —
  paid plans only, exactly one instance (no scaling), zero-downtime deploys
  turn off (the old instance stops before the new one starts: a short outage
  per deploy), daily snapshots kept 7 days. The image runs as uid 1001; if
  the mount is not writable, attachment upload answers `503
  storage_unavailable` — check after the first deploy.
- Bigger instance: change `plan` in render.yaml and set `MEMORY_LIMIT_MB` to
  the plan's RAM (Starter 512, Standard 2048) so the memory watchdog thresholds
  follow.

### Sentry

The server DSN is a plain env var in `render.yaml` (`SENTRY_DSN`, both
services — not a secret, never hard-coded in code):
`https://ad2ee2fa5207f691bf98e75d1b6c213f@o4511570018041856.ingest.us.sentry.io/4511570031673344`.
Events carry `environment` = `APP_ENV` (production / staging) and `release`
= `justice-gavel@<version>+<RENDER_GIT_COMMIT>` (override with
`SENTRY_RELEASE`). To change the DSN edit render.yaml and push (a dashboard
edit is reverted by the next Blueprint sync). The app's DSN is separate:
`EXPO_PUBLIC_SENTRY_DSN` (EAS).

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
not match (exit 3). Run the backup daily from a machine/cron outside Render
(dumps contain encrypted notes/messages but also e-mails and phone numbers —
store them encrypted, access-controlled) and do a restore drill monthly.
**Real restore (incident):** restore into a fresh Supabase project, point
`DATABASE_URL` at it (Render → Environment → Save and deploy — the pre-deploy
migration step then finds every migration already recorded), then run the
smoke test. Render itself holds no application data (attachments are in
Supabase Storage), so Supabase backups cover everything; with the optional
Render disk instead, Render keeps daily disk snapshots for 7 days (service →
Disks → Snapshots).

**Critical tables to verify after incidents:** `users`, `audit_log`
(append-only, never delete), `user_disclaimer_acceptance`, `refresh_tokens`,
`subscriptions`.

---

## STAGING

Staging = the production build as its own Render service
(`justice-gavel-api-staging` in `render.yaml`), its own Supabase project and
test keys:
`NODE_ENV=production`, `APP_ENV=staging`, staging `DATABASE_URL`,
`PRODUCTION_DATABASE_URL=<prod URL>` (boot guard), Stripe `sk_test_…` or none,
`LIVE_REFRESH=false`. Config is in DEPLOY_ENV_SETUP.md → "Staging"; the
service definition is the second entry in `render.yaml` (same Dockerfile,
health check and pre-deploy migrations as production; JWT / encryption /
admin secrets generated by Render). `NODE_ENV=staging` and live Stripe keys
are refused at boot.

Both services track `main` and auto-deploy once CI passes, so a migration
runs on staging and production in the same push. For a staging-first flow:
create a `staging` branch, set the staging service's `branch: staging` in
render.yaml, merge to `staging` first →
`node backend/scripts/smoke-test.mjs https://<staging-host>` → then merge to
`main`. `/health` reports `env` and `commit`.

---

## AUTOMATED MONITORING — WHAT ACTUALLY RUNS

| Monitor | Frequency | Action |
|---------|-----------|-------------------|
| Memory watchdog (**RSS**, thresholds from `MEMORY_LIMIT_MB`, default 512) | 30 s | warn at 72% (368 MB) → force GC + SEV-2 at 85% (435 MB) → graceful restart at 93% (476 MB) |
| DB health check | 60 s | logs unhealthy state; `/health` turns 503 so the uptime monitor pages |
| Stale job locks | 15 min | auto-clear locks older than 30 min |
| Uncaught exception / unhandled rejection | immediate | SEV-1 notify, then process exit → Render restarts the instance |
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

One JSON object per line (Render log stream / Datadog-friendly). HTTP lines log the path
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
| Everything, by hand | `DATABASE_URL=… bash scripts/run-all-scrapes.sh [--dry-run] [--state TN]` (from `backend/` in a checkout; copy the URL from Render → Environment) |
| One script | Render service **Shell**: `node src/scripts/refresh.js --city "Nashville, TN" --dry-run` · `scrape_providers_national.js --state TX` · `scrape_recovery_agents.js` · `scrape_state_bars.js --state TN` |
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

**Rights content.** `backend/src/services/rightsContent.js` serves the general card (the app's bundled
card) with source + "last reviewed" on every section. A STATE section is shown — and given to the AI chat —
only when it has a real citation (`source_url`, or a statute cite such as "Tenn. Code Ann. § 40-7-123" in
`source`) or `reviewed_by`. The built-in per-state summaries (`STATE_RIGHTS`) have neither, so they are kept
as draft material and never shown: every state gets "State-specific details for <state> haven't been reviewed
yet — ask a local lawyer or public defender." To publish a state section, insert a `rights_cards` row (state,
topic, title, content, `source` with the cite, `source_url`, `reviewed_by`, `content_verified_at`); it shows
automatically (and the app's offline copy drops any section that does not qualify). Check: `GET /api/rights/TN`.

**Bail-agent fees.** There is no sourced premium data: no endpoint, screen, lesson or tip states a fee
percentage (`no_unsourced_legal_claims.test.js` scans for it). `/api/bail/estimate-total` only multiplies a
rate the person was quoted.

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
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and the user's opt-in). Each missing
provider is skipped, never an error. A reminder that reached NO channel is `status = 'undeliverable'`
(`delivered = 0`, reason in `error`, e.g. `no_push_token; email_not_configured; sms_not_configured`) — never
"sent". `/metrics` → `reminders.undeliverable_24h` (+ `jg_reminders_undeliverable_24h` in Prometheus format)
and `jobs['reminders:dispatch']`; the court-date screen asks the person once to turn on notifications or add
an e-mail. A rising `undeliverable_24h` usually means `RESEND_API_KEY` is missing.

**Family followers.** A follower gets their own court reminders (courthouse named, never the owner's free-text
location or case title) and ONE other push: "A court date you follow was updated" when a date is added,
moved or cancelled — never for other case edits. Owners see only the name / e-mail they typed on the invite,
for active follows only. Invite e-mails: 10 per user and 3 per recipient address per 24 h (429).

**Client IP / TRUST_PROXY (rate limits, guest report keys).** Express `trust proxy` is `TRUST_PROXY`
(render.yaml; default `1` = trust one proxy hop). It decides which `X-Forwarded-For` entry is the client:
too small and every user shares one proxy address (one user's 429 locks out everyone); too large and a
client can spoof its IP by sending its own `X-Forwarded-For`. Render does not document its proxy chain (one
community measurement found 3 hops), so **measure it after the first deploy — never guess, never `true`**:

1. Find your public IP on a laptop: `curl -s https://api.ipify.org`.
2. Get an admin token: `curl -s https://api.justicegavel.app/api/auth/login -H 'Content-Type: application/json'
   -d '{"email":"<admin email>","password":"…"}'` → `token` (the account's DB role must be `admin` or `super_admin`).
3. From the same laptop:
   ```bash
   curl -s https://api.justicegavel.app/api/admin/diagnostics/client-ip \
     -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $ADMIN_KEY" | jq
   ```
   → `ip` (what the app uses now), `ips`, `x_forwarded_for`, `socket_remote_address`,
   `trust_proxy.{env,effective}` and `candidates`: `[{trust_proxy: 0, ip: <socket peer>}, {trust_proxy: 1, ip: …}, …]`
   — the IP each hop count would pick.
4. Take the **smallest** `trust_proxy` whose `ip` equals your public IP. If that is the current value, stop.
5. Spoof check: repeat step 3 with `-H "X-Forwarded-For: 203.0.113.9"`. `ip` must still be your real IP;
   if it shows `203.0.113.9` the value is too large.
6. Set it: edit `TRUST_PROXY` for both services in `render.yaml`, commit, push (a dashboard-only edit is
   reverted by the next Blueprint sync); after the deploy repeat steps 3 and 5, and once more from another
   network (e.g. phone hotspot, IPv6). If the hop count differs between requests, use the proxies' address
   ranges instead of a count, e.g. `TRUST_PROXY=10.0.0.0/8` (comma-separated CIDRs; Express also accepts
   `loopback`, `uniquelocal`) — every address in the chain that is not the client must be covered.

Behind Caddy on a self-managed server (`Caddyfile`) the value is `1`. Guest listing-report keys
are a hash of that IP (documented limitation: an IPv4 hash can be brute-forced).


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
