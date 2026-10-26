# Environment & Deploy Setup (backend API — hosted on Render)

**This is the single environment-variable reference.**
Every backend variable below is actually read by the code, and every variable
the code reads is listed here. `backend/src/config.js` mirrors the list in
`ALL_ENV_VARS`; `backend/.env.example` and the repo-root `.env.example` carry
the same set with safe placeholder values (plus the frontend's `EXPO_PUBLIC_*`
build variables, see the end of this file).
`backend/src/__tests__/env_docs_consistency.test.js` fails if any of the four
drift from the code. `ENVIRONMENT_VARS.md` is just a pointer here.

## Render service settings

Everything below is declared in **`render.yaml`** (repo root, a Render
Blueprint): Render → New → Blueprint → this repo creates the production
service `justice-gavel-api` and the staging service
`justice-gavel-api-staging`. Walkthrough: RUNBOOK.md → "DEPLOY (Render)";
go-live order: `backend/scripts/go-live-checklist.md`.

- **Runtime: Docker.** Build context is the repo root (`dockerContext: .`),
  Dockerfile `./backend/Dockerfile`. The image carries the backend,
  `supabase/migrations` (at `/supabase/migrations`) and `psql`; the repo-root
  `.dockerignore` keeps everything else (frontend, tests, `.env`) out.
- Start command (Dockerfile `CMD`): `node --import ./src/instrument.js src/server.js`.
- The server listens on **`$PORT` on `0.0.0.0`**. Render injects `PORT`
  (default 10000; the image defaults to 10000 too). Locally the default is 4000.
- **Health check:** `healthCheckPath: /health` returns **200** only when a real
  `SELECT 1` succeeds, **503** otherwise. A new deploy only takes traffic once
  it answers 200; a running instance that keeps failing is restarted by Render.
- **Pre-deploy:** `preDeployCommand: sh /app/scripts/migrate.sh` applies new
  `supabase/migrations/*.sql` files (psql, `ON_ERROR_STOP`) before the new
  version starts; each file runs once and is recorded in
  `jg_meta.schema_migrations`. A failing migration fails the deploy and the
  previous version keeps serving. The API itself never runs DDL.
- **Auto-deploy:** `autoDeployTrigger: checksPass` — a push to `main` deploys
  only after the GitHub CI checks pass.
- **Shutdown:** `maxShutdownDelaySeconds: 30`. On SIGTERM the server stops
  accepting connections, drains in-flight requests and AI jobs, closes the
  pool and exits; it force-exits at 25 s, inside Render's 30 s window.
- `value:` entries in `render.yaml` are re-applied on every Blueprint sync;
  `sync: false` entries are asked for once and then owned by the dashboard
  (Render → service → Environment).

## Set by Render (do not set by hand)

```
PORT                                     listen port (Render default 10000; local default 4000)
RENDER=true                              marks the Render runtime (/health `commit`, boot log `platform`)
RENDER_GIT_COMMIT                        deployed commit: /health + /metrics `commit`, boot log,
                                          default Sentry release justice-gavel@<version>+<commit>
RENDER_INSTANCE_ID                       per-instance id in the boot log and the client-IP diagnostics
GIT_COMMIT                               host-neutral fallback for RENDER_GIT_COMMIT (other hosts,
                                          local docker runs); optional
```

Render also sets `RENDER_EXTERNAL_URL`, `RENDER_SERVICE_NAME`,
`IS_PULL_REQUEST` and `WEB_CONCURRENCY`; the API does not read them (it runs
one process per instance).

## Required in production

The server refuses to start without these:

```
NODE_ENV=production
DATABASE_URL=<postgres://... Supabase connection string>
                                          (POSTGRES_URL is read as an alias when DATABASE_URL is unset)
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32, different from JWT_SECRET>
ENCRYPTION_KEY=<openssl rand -hex 32  (64 hex chars) — never change once data exists.
                                          Moving hosts: copy the EXISTING value; a new key makes
                                          every encrypted note/message unreadable>
```

In development/test a missing secret is replaced by a random per-process value
(tokens don't survive restarts); without `DATABASE_URL` the dev server falls
back to in-memory SQLite — local dev against real Postgres is recommended.

## Feature keys (each one enables one feature)

A "feature disabled" line is logged at boot for each missing key:

```
ANTHROPIC_API_KEY=<sk-ant-...>           AI chat/research/motions (else 503 ai_unavailable)
CLAUDE_MODEL=claude-sonnet-5-5           model override (default claude-sonnet-5-5)
STRIPE_SECRET_KEY=<sk_live_/sk_test_...> payments; unset → charging/subscribing endpoints return
                                          503 payments_unavailable and the app shows "Payments aren't
                                          available yet". Setting it re-enables Stripe, no code change.
STRIPE_SECRET                            legacy alias of STRIPE_SECRET_KEY (prefer STRIPE_SECRET_KEY)
STRIPE_WEBHOOK_SECRET=<whsec_...>        Stripe webhook verification (POST /webhooks/stripe)
STRIPE_LEGAL_RADAR_ID                    consumer subscription price ids: Legal Radar $19.99/mo,
STRIPE_ADVISOR_PRICE_ID                   24 Hour Advisor $24.99/mo or $199/yr, Legal Pro
STRIPE_ADVISOR_ANNUAL_ID                  $34.99/mo or $299/yr, Esquire $49/mo or $410/yr. Create
STRIPE_LEGAL_PRO_PRICE_ID                 them in Stripe (backend/scripts/setup-stripe-products.js
                                          helps); a plan whose id is unset cannot be purchased
STRIPE_LEGAL_PRO_ANNUAL_ID
STRIPE_ESQUIRE_PRICE_ID
STRIPE_ESQUIRE_ANNUAL_ID
STRIPE_BONDSMAN_STARTER_ID               bondsman plan price ids, monthly / annual: Starter $49/mo
                                          ($490/yr), Pro $149/mo ($1,490/yr), Market $349/mo ($3,490/yr)
STRIPE_BONDSMAN_STARTER_ANNUAL_ID
STRIPE_BONDSMAN_PRO_ID
STRIPE_BONDSMAN_PRO_ANNUAL_ID
STRIPE_BONDSMAN_MARKET_ID
STRIPE_BONDSMAN_MARKET_ANNUAL_ID
STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL   checkout redirect pages
STRIPE_ACH_ENABLED=false                 enable Stripe ACH bank transfer
RESEND_API_KEY=<re_...>                  transactional email (else emails are only logged)
LIVE_EMAIL                               "false" forces log-only email even with RESEND_API_KEY set
EMAIL_FROM=noreply@justicegavel.app      sender for user email (ALERT_EMAIL_FROM for ops alerts)
REDIS_URL=<redis://...>                  BullMQ queue (else AI jobs run in-process); on Render, the
                                          internal URL of a Render Key Value instance
SENTRY_DSN=<https://...@sentry.io/...>   error tracking (SENTRY_ENVIRONMENT / SENTRY_RELEASE /
                                          SENTRY_TRACES_SAMPLE_RATE / SENTRY_PROFILES_SAMPLE_RATE
                                          / SENTRY_PROFILING optional tuning). Server DSN (not a
                                          secret; set as a plain value in render.yaml, never in code):
                                          https://ad2ee2fa5207f691bf98e75d1b6c213f@o4511570018041856.ingest.us.sentry.io/4511570031673344
                                          Environment = APP_ENV; release = SENTRY_RELEASE or
                                          justice-gavel@<version>+<RENDER_GIT_COMMIT>
OPENAI_API_KEY=<sk-...>                  Whisper transcription (else transcription 503)
DAILY_API_KEY=<...>                      Daily.co video consultation rooms (else video 503)
DAILY_API_BASE=<url>                     Daily REST base URL (default https://api.daily.co/v1; tests / staging only)
METRICS_TOKEN=<random>                   bearer token for GET /metrics in production (falls back to ADMIN_KEY)
GOOGLE_PLACES_KEY=<AIza...>              data refresh: provider scrapers + nightly refresh (in-app
                                          search reads Postgres and never calls Google). Unset →
                                          those steps skip with a log line.
GOOGLE_PLACES_MIN_INTERVAL_MS=150        data refresh: min ms between Places requests (rate limit)
GOOGLE_PLACES_MAX_REQUESTS=5000          data refresh: Places request budget per run (cost cap)
YELP_API_KEY=<...>                       data refresh: Yelp as a second business-data source
SUPABASE_URL + SUPABASE_SERVICE_KEY      Supabase Storage (attachments) + RAG helpers
EXPO_ACCESS_TOKEN=<...>                  Expo push notifications
EXPO_PUSH_API_URL=<url>                  Expo push endpoint override (default https://exp.host/--/api/v2;
                                          point at a mock for staging/tests)
TELNYX_API_KEY=<KEY...>                  Telnyx API v2 key: text-message court reminders (last step after push,
                                          browser push and e-mail) and SOS texts. Needs TELNYX_FROM_NUMBER too.
TELNYX_FROM_NUMBER=<+1...>               Telnyx sender, E.164, on a 10DLC-registered campaign (US carriers block
                                          unregistered application-to-person texts)
TELNYX_MESSAGING_PROFILE_ID=<uuid>       optional: Telnyx messaging profile (opt-out / STOP handling, number pool)
TELNYX_API_BASE=<url>                    Telnyx API base override (default https://api.telnyx.com/v2; tests / mock only)
TELNYX_PUBLIC_KEY=<base64>               Telnyx webhook public key (Ed25519). Point the messaging profile's webhook at
                                          https://<api host>/api/webhooks/telnyx so STOP replies turn text reminders off.
                                          Unset → the webhook refuses every request (503).
TRUST_PROXY=<hops|CIDRs>                 Express "trust proxy" (default 1). Decides which X-Forwarded-For entry is the
                                         client IP for rate limits / guest report keys — see RUNBOOK "Client IP".
VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY     web push (npx web-push generate-vapid-keys)
VAPID_EMAIL=admin@justicegavel.app       web push contact
```

## URLs, CORS and auth tuning

```
CORS_ORIGIN / EXTRA_ORIGINS              extra comma-separated browser origins
                                          (justicegavel.app, www.justicegavel.app and the local
                                          Expo/web dev-server origins are always allowed)
FRONTEND_URL                             additional allowed origin, fallback base for links
APP_URL=https://justicegavel.app         base URL used in password-reset links
BASE_URL=https://api.justicegavel.app    this API's public URL (SAML ACS + OAuth redirect URIs)
APP_SSO_REDIRECT / APP_OAUTH_REDIRECT    where users land after SAML / provider OAuth
ADMIN_KEY=<openssl rand -hex 32>         X-Admin-Key header: /api/bot/* (key only) and /api/admin/*
                                          (key AND a signed-in admin/super_admin account). Unset =
                                          those consoles are closed
JWT_EXPIRES_IN=30d                       access-token lifetime (the mobile app refreshes
                                          tokens older than 25 days — keep >= 30d)
JWT_REFRESH_EXPIRES_IN=60d               refresh-token lifetime (single-use, rotated)
AUTH_RATE_LIMIT=10                       logins per 15 min per IP
REGISTER_RATE_LIMIT=5                    registrations per hour per IP
RATE_LIMIT_PER_MIN=200                   global per-IP request limit
DIRECTORY_CACHE_TTL_MS=60000            lawyer / bail-agent directory cache in ms (0 = off; default 60000)
```

## Attachments

```
ATTACHMENTS_DIR=/app/data/attachments    message attachments (POST /api/messages/attachment), stored
                                          AES-256-GCM encrypted. Default is <app>/data/attachments;
                                          on Render the container disk is ephemeral, so use Supabase
                                          Storage (SUPABASE_URL + SUPABASE_SERVICE_KEY,
                                          ATTACHMENTS_STORAGE=supabase — render.yaml does) or a
                                          Render disk (render.yaml has the commented block)
ATTACHMENTS_BUCKET=case-documents        Supabase Storage bucket for attachments (objects under messages/)
ATTACHMENTS_STORAGE=off|local|supabase   force a backend; "off" → attachment upload returns 503
                                          storage_unavailable
```

## Scheduler, alerts and admin

```
LIVE_REFRESH=true                        enable the nightly scheduler (provider refresh into
                                          Postgres, arrest-feed ingestion, alerts, payment-link
                                          expiry, token cleanup). Off by default. See RUNBOOK.md
                                          "Data refresh".
                                          Does NOT affect reminder delivery (below).
REMINDERS_ENABLED=true                   court-date / user reminder delivery: every API process
                                          drains due scheduled_pushes each minute (push → email
                                          fallback) whatever LIVE_REFRESH says. Set false to turn
                                          it off in a process. Default true.
REFRESH_CRON=0 3 * * *                   nightly refresh schedule   (REFRESH_TZ=America/Chicago)
HEALTH_SCAN_CRON=0 2 * * *               nightly health-scan schedule (SCAN_QUIET=true to hush)
ALERT_EMAIL / ONCALL_EMAIL / ONCALL_EMAIL_2   SEV-1/SEV-2 alert recipients
ALERT_WEBHOOK_URL=<slack webhook>        Slack channel for operational alerts
ADMIN_EMAIL / ADMIN_ALERT_EMAIL / ADMIN_ALERT_SMS   admin notification targets
ADMIN_PANEL_URL / ADMIN_URL              links embedded in admin notification emails
DEMO_MODE                                only labels the instance: /health reports mode demo|live.
                                          In production only an explicit "true" counts. Never
                                          bypasses payments or auth
LIVE_PAYMENTS=false                      /api/pay multi-provider orchestrator: returns a mock
                                          session URL unless "true" (and POST /api/pay/* is still
                                          503 payments_unavailable without STRIPE_SECRET_KEY).
                                          Subscriptions and lead fees do NOT use this flag
```

## Staging

Staging is the second service in `render.yaml` (`justice-gavel-api-staging`)
with its own Supabase project; it runs the SAME production build:

```
NODE_ENV=production                      production hardening (required secrets, strict CORS, no stack traces)
APP_ENV=staging                          labels logs / Sentry / /health "staging"; refuses LIVE Stripe keys
PRODUCTION_DATABASE_URL=<prod URL>       optional guard: staging refuses to boot if DATABASE_URL equals it
DATABASE_URL=<staging Supabase URL>      never the production database
STRIPE_SECRET_KEY=sk_test_…              test keys only (or unset → payments_unavailable, as in prod today)
LIVE_REFRESH=false                       keep nightly jobs off unless you are testing them
JWT_SECRET / JWT_REFRESH_SECRET / ENCRYPTION_KEY / ADMIN_KEY
                                         render.yaml generates random values (generateValue) — fine
                                          for staging, never for production
```

`PRODUCTION_DATABASE_URL` on staging is optional: it stores the production
database credential in the staging service, so weigh that against the guard.

`NODE_ENV=staging` is rejected at boot (it would silently switch production
hardening off). Deploy and smoke-test steps: RUNBOOK.md → "Staging".

## Performance / ops tuning

```
HEALTH_CACHE_MS=5000                     /health caches its DB probe this long (default 5 s).
                                          Uptime pollers hit /health freely; at most one SELECT 1
                                          per window reaches the database
SLOW_QUERY_MS=500                        queries slower than this are logged at WARN with the SQL
                                          text (bind placeholders only, never values). 0 disables
PG_POOL_MAX=20                           Postgres connection pool size (default 20)
PGSSL=false                              disable TLS to Postgres (local dev; auto-off for localhost)
MEMORY_LIMIT_MB=512                      container memory limit; the self-healing watchdog warns at
                                          72%, GCs/alerts at 85% and restarts gracefully at 93% of
                                          this (defaults match the 512 MB Render Starter instance)
AI_DAILY_BUDGET_USD=50                   global daily AI spend cap in USD (UTC day). Every model call is
                                          metered into ai_usage_log; at the cap AI features answer 503
                                          ai_unavailable (reason daily_budget_reached) until 00:00 UTC.
                                          'off' disables the cap (not recommended)
AI_BUDGET_ALERT_PCT=80                   one SEV-2 alert per day at this share of the cap, one SEV-1
                                          at 100 % (ONCALL_EMAIL / ALERT_WEBHOOK_URL / Sentry)
AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK
                                         override the USD per 1M tokens used for metering (defaults by
                                          model family: Sonnet 3/15, Opus 15/75, Haiku 1/5)
AI_CONCURRENCY=8                         parallel AI jobs (in-process or BullMQ)
AI_JOB_TIMEOUT_MS=45000                  per-AI-job timeout
AI_DRAIN_TIMEOUT_MS=10000                graceful shutdown waits this long for in-flight AI jobs
                                          before closing the process (force-exit at 25 s regardless)
LOG_LEVEL=info                           debug | info | warn | error
LOG_FORMAT=json                          production defaults to one-line JSON logs; set LOG_FORMAT=text
                                          to get the human-readable format instead
DB_LOG_ERRORS=true                       also log failing SQL statements (dev debugging)
ANTHROPIC_BASE_URL                       Anthropic API override — tests/mock server only
```

## Arrest data

```
ARREST_FEED_URLS=[...]                   JSON array of public arrest feeds to ingest, e.g.
                                          [{"id":"davidson_tn","url":"https://example.gov/bookings.json",
                                          "state":"TN","county":"Davidson"}]. Each url must be https and
                                          return a JSON array (or {records:[...]}) of
                                          {name, booking_date, charges, bail_amount, court_date, county,
                                          state, jail_location, has_attorney, case_number}. Rows are
                                          validated/sanitized and stored with source=feed_<id>.
                                          UNSET (default) = no arrest coverage: POST /api/arrests/ingest
                                          ingests nothing and the app shows "no public arrest feeds
                                          configured" empty states. Never point this at a non-public or
                                          unverified source.
SHOW_SAMPLE_ARRESTS=false                default false — leave unset in production. The database
                                          ships 600 GENERATED arrest rows (source seed_v1); they are
                                          hidden from every API response, alert, bot message and lead
                                          sale. "true" (demos only) shows them in read-only arrest
                                          views, flagged is_sample:true and labelled "Sample record"
                                          in the app; they are still never alerted on, messaged
                                          about or sold.
```

## Integration OAuth credentials (optional, one pair per provider)

Each pair enables one live integration (demo data without it). Register the
redirect URI `<BASE_URL>/api/integrations/oauth/callback` with the provider.

| Provider | Variables |
|---|---|
| Clio | `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET` |
| MyCase | `MYCASE_CLIENT_ID`, `MYCASE_CLIENT_SECRET` |
| PracticePanther | `PRACTICEPANTHER_CLIENT_ID`, `PRACTICEPANTHER_CLIENT_SECRET` |
| iManage | `IMANAGE_CLIENT_ID`, `IMANAGE_CLIENT_SECRET` |
| NetDocuments | `NETDOCUMENTS_CLIENT_ID`, `NETDOCUMENTS_CLIENT_SECRET` |
| Google Calendar | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` |
| Outlook | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET` |
| CourtListener | `COURTLISTENER_TOKEN` (optional, raises rate limits); `COURTLISTENER_ENABLED=false` turns it off |

## Alternative payment provider stubs (leave unset)

`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `BRAINTREE_MERCHANT_ID`,
`SQUARE_ACCESS_TOKEN`, `AUTHORIZE_NET_API_LOGIN_ID`, `AMAZON_PAY_PUBLIC_KEY_ID`,
`COINBASE_COMMERCE_API_KEY`, `BITPAY_TOKEN`, `NOWPAYMENTS_KEY` are read by the
adapters in `backend/src/payments/`, which are only reachable through
`/api/pay` with `LIVE_PAYMENTS=true`. Most of them are placeholders that
return mock checkout URLs even when a key is set. They are not production
integrations: Stripe is the only supported payment provider.

## Operator scripts and platform

- `REPORT_DIR`: output directory for `src/scripts/fact_check_monitor.js` reports.
- The data-refresh scripts in `src/scripts/` (`refresh.js`,
  `scrape_providers_national.js`, `scrape_recovery_agents.js`,
  `scrape_state_bars.js`, `import_csv.js`, `import_doi_*.js`,
  `update_legal_data.js`) write the **main Postgres database** and need only
  `DATABASE_URL` (plus `GOOGLE_PLACES_KEY` / `YELP_API_KEY` for the Google /
  Yelp sources). They refuse to run without `DATABASE_URL`; there is no local
  SQLite output any more. Run them from the Render service **Shell** tab
  (`node src/scripts/<script>.js` — the env is already set), or locally with
  `DATABASE_URL` exported.
- Migration runner (`backend/scripts/migrate.sh`, the Render pre-deploy step):
  `MIGRATIONS_DATABASE_URL` (optional; defaults to `DATABASE_URL` — set it to a
  direct / session-mode connection if `DATABASE_URL` is a transaction pooler
  that rejects a statement), `MIGRATIONS_DIR` (optional; defaults to the repo /
  image layout). `--status` lists applied / pending files; `--baseline <file>`
  records files up to `<file>` as applied without running them.
- Platform variables: see "Set by Render" above.

## Verify a deploy

```
cd backend
node scripts/smoke-test.mjs https://<your-api-host> [--db-url $DATABASE_URL]
```

Full go-live sequence: `backend/scripts/go-live-checklist.md`.

## Frontend build variables (EXPO_PUBLIC_*)

Read by the app at **build** time (`frontend/.env` or EAS secrets), never by
the backend. They are listed in all three `.env.example` files.

| Variable | Effect |
|---|---|
| `EXPO_PUBLIC_API_BASE` | API base URL. Unset → `https://api.justicegavel.app/api`. Local: `http://localhost:4000/api` |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Native payment sheet. Leave empty until Stripe is live |
| `EXPO_PUBLIC_SENTRY_DSN` | App error tracking (off when empty) |
| `EXPO_PUBLIC_MIXPANEL_TOKEN` | Analytics (off when empty) |
| `EXPO_PUBLIC_BETA` | `true` shows the beta banner (TestFlight/beta builds) |
