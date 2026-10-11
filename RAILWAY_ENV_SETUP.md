# Railway Setup (backend API)

## Service settings

- **Root Directory: `backend`** — Railway then uses `backend/railway.json`, which
  builds `backend/Dockerfile` and health-checks `GET /health`.
  (The old repo-root `railway.json` was removed; it pointed the build at the
  wrong context.) If you build from the repo root instead, `nixpacks.toml` /
  `Procfile` start the same command.
- Start command: `node --import ./src/instrument.js src/server.js`
- The server listens on `$PORT` (Railway injects it; default 4000).
- `/health` returns **200** only when a real `SELECT 1` succeeds, **503** otherwise.

## Environment variables

Required in production (the server refuses to start without them):

```
NODE_ENV=production
DATABASE_URL=<postgres://... Supabase/Railway Postgres connection string>
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32, different from JWT_SECRET>
ENCRYPTION_KEY=<openssl rand -hex 32  (64 hex chars) — never change once data exists>
```

Optional — each one only enables a feature; a "feature disabled" line is
logged at boot when it is missing:

```
ANTHROPIC_API_KEY=<sk-ant-...>           AI chat/research/motions (else 503 ai_unavailable)
CLAUDE_MODEL=claude-sonnet-4-6           model override (default claude-sonnet-4-6)
STRIPE_SECRET_KEY=<sk_live_/sk_test_...> payments (STRIPE_SECRET also accepted); else billing → 503 payments_unavailable
STRIPE_WEBHOOK_SECRET=<whsec_...>        Stripe webhook verification (POST /webhooks/stripe)
STRIPE_*_PRICE_ID / STRIPE_*_ANNUAL_ID   subscription price ids
RESEND_API_KEY=<re_...>                  transactional email (else emails are only logged)
EMAIL_FROM=noreply@justicegavel.app
REDIS_URL=<redis://...>                  BullMQ queue (else AI jobs run in-process)
SENTRY_DSN=<https://...@sentry.io/...>   error tracking
GOOGLE_PLACES_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
CORS_ORIGIN / EXTRA_ORIGINS              extra comma-separated browser origins
                                          (justicegavel.app, www.justicegavel.app and
                                          localhost:8081/19006/3000 are always allowed)
APP_URL=https://justicegavel.app         base URL used in password-reset links
ADMIN_KEY=<random>                       required header for /api/admin and /api/bot
LIVE_REFRESH=true                        enable the nightly scheduler (scrapers, alerts,
                                          payment-link expiry, token cleanup). Off by default.
DEMO_MODE                                ignored in production unless explicitly "true"
JWT_EXPIRES_IN=30d                       access-token lifetime (the mobile app refreshes
                                          tokens older than 25 days — keep >= 30d)
ATTACHMENTS_DIR=/app/data/attachments    message attachments (POST /api/messages/attachment), stored
                                          AES-256-GCM encrypted. Default is <app>/data/attachments;
                                          on Railway attach a volume there, or set SUPABASE_URL +
                                          SUPABASE_SERVICE_KEY to use Supabase Storage instead
ATTACHMENTS_BUCKET=case-documents        Supabase Storage bucket for attachments (objects under messages/)
ATTACHMENTS_STORAGE=off|local|supabase   force a backend; "off" → attachment upload returns 503
                                          storage_unavailable
HEALTH_CACHE_MS=5000                     /health caches its DB probe this long (default 5 s)
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

## Verify a deploy

```
cd backend
node scripts/smoke-test.mjs https://<your-api-host> [--db-url $DATABASE_URL]
```
