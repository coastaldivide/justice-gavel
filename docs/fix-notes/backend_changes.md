# Backend change log (branch fix/full-function, uncommitted)

Scope: `backend/**` plus root deploy files (`railway.json` removed, `nixpacks.toml`,
`Procfile`, root `package.json`, `RAILWAY_ENV_SETUP.md`). Frontend / supabase untouched.
Lawyer and bail-agent rows were never modified (no code path writes them except the
admin CRUD, which was only ported to Postgres; app reviews no longer overwrite `lawyers.rating`).

## Install / packaging
- **B1** `package-lock.json` regenerated; `npm ci` and `npm ci --omit=dev` both succeed from a clean dir.
- **B7** declared `axios`, `web-push`, `csv-parse`; `@sendgrid/mail` not added (SendGrid retired, see F7).
- **B8** `@sentry/node` 7.120.4 → 10.55.0 to match `@sentry/profiling-node` 10.55.0. Single init in new
  `src/instrument.js` (idempotent, profiling optional, PII scrubbed); `monitoring/sentry.js` and
  `middleware/sentry.js` no longer init; app uses `Sentry.setupExpressErrorHandler`. Start command is
  `node --import ./src/instrument.js src/server.js` (server.js also imports it first). Boots with `SENTRY_DSN`.
- **B10** `multer` → ^2.0.2, `csv-parse` → 7.0.3, `npm audit fix`; `npm audit --omit=dev` = 0 vulnerabilities.
- removed `prestart` hook (it ran SQLite DDL and swallowed errors); `src/db/migrate.js` retired (schema = supabase/migrations).

## Module loading
- **B2** 44 broken relative imports fixed (`../` → `../../` in routes/*/ subfolders), sendgrid imports → `services/email.js`.
- **B3** `sharedAiLimiter` exported (alias of `perUserAiLimit`); `calcLeadFee` imports removed (fn intentionally removed);
  scheduler uses real `scheduleGuarded(expr, label, fn, opts)`; `schemas`/`createReviewSchema` come from `validation/schemas.js`.
- **B4** stray top-level code removed: app.js request-id block (now a real middleware), checkins.js tail (file also lacked `export default`).
- **B5** arrests/bail/cases/checkins validators imported; firms.js `directoryLimiter`/`inviteLimiter`/`apiLimiter`, providers.js `apiLimiter`/`getDb` defined.
- **B6** `app.options('*')` removed (Express 5 path error); single `cors()` handles preflight.
- **F11** every runtime-undefined identifier from the AST scanner fixed (now 0): safeJson imports (13 files), consultations
  booking (notification block had been pasted into the cancel handler; `lawyerId`), messages `sendPushToUser`,
  reviews `db`, expungement `getEligibility`/`logger`, conflicts `compactName` + `res` in SOC2 helper, scheduler `db`,
  ragRetrieval `TOPIC_TRIGGERS`, caseLifecycle `require()` of missing file, outbound_bot `sqlite3`, scraper `d/place`.
  Also fixed 6 assignments to `const` (saved lawyers, push test, golden gavel – all 500'd).

## Process / server (B9, F9, F12)
- `server.js` is the only place with process handlers: validates env, connects DB (exit 1 if unreachable),
  listens on `$PORT||4000`, then starts AI workers, scheduler, watchdogs (`startAllWatchdogs` now called),
  push loop, content refresh, bar re-verification. One `shutdown()` path (SIGTERM/SIGINT/uncaughtException)
  closes server, timers, scheduler, watchdogs, BullMQ, DB pool, flushes Sentry; uncaught exceptions exit 1;
  `EADDRINUSE` exits 1. `app.js` has no side effects beyond building the app.
- `/health` (and `/api/health`): real `SELECT 1` with 5s timeout → 200 / 503; only booleans for features (ai/payments/email).
- watchdog/scheduler timers are unref'd and stoppable; scheduler fixes (`scheduleGuarded` args, `runExpungementTriggerSweep(db)`,
  token cleanup scheduled). Scheduled jobs still require `LIVE_REFRESH=true` (documented in RAILWAY_ENV_SETUP.md).

## Config / env
- `config.js`: `validateEnv()` hard-requires JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY, DATABASE_URL only in production;
  one "feature disabled" line per missing optional var. STRIPE_SECRET/STRIPE_SECRET_KEY aliased; POSTGRES_URL → DATABASE_URL.
  DEMO_MODE false in production unless explicitly "true". Dev/test generate random secrets; all `dev_secret_change_me`
  fallbacks removed (auth middleware, auth routes, sso, caldav). JWT access lifetime default 30d (the app only stores the
  access token and refreshes after 25 days); refresh tokens 60d, single-use.
- **F2** new `src/utils/ai.js`: `CLAUDE_MODEL` (env, default `claude-sonnet-4-6`), `ANTHROPIC_BASE_URL`/`ANTHROPIC_MESSAGES_URL`,
  `requireAi` → 503 `{error:'ai_unavailable'}`. All 20 model strings / API URLs replaced; `API_URLS.ANTHROPIC` (was undefined) added.
- **F10** one CORS config: justicegavel.app, www, localhost:8081/19006/3000 (+ any localhost/expo in non-prod),
  CORS_ORIGIN/EXTRA_ORIGINS/FRONTEND_URL lists, no-Origin and Electron allowed; others → 403 JSON.

## Database (D1, D2, D3, D8)
- `db/index.js` rewritten: errors are thrown (no silent stub); Postgres required when `NODE_ENV=production`;
  sql.js fallback only when DATABASE_URL is unset (loud warning). `?`→`$n` rewrite skips string literals, quoted
  identifiers, comments, dollar-quotes and jsonb `?|` `?&` `? 'key'` (`??` = literal `?`). `RETURNING id` only for tables
  that have an `id` column (cached from information_schema). `db.transaction(fn)` on a dedicated client; bare
  BEGIN/COMMIT/PRAGMA on the pool are no-ops (they used to leave pooled connections inside open transactions).
  `db.close()` is a no-op (several handlers closed the shared pool!); `closeDb()` ends it. BIGINT/NUMERIC → JS numbers.
  JS booleans bound as 1/0. `DB_LOG_ERRORS=true` logs failing SQL.
- SQLite SQL converted: ~60 `datetime/date('now', …)`, `strftime`, `julianday`, 29 `INSERT OR IGNORE`
  (→ `ON CONFLICT DO NOTHING`), 9 `INSERT OR REPLACE` (→ upserts / update-then-insert), `COLLATE NOCASE`, `MAX(a,b)`→`GREATEST`,
  ambiguous `ON CONFLICT … SET x = x + 1`, `GROUP BY` / `DISTINCT … ORDER BY` errors, `UPDATE … ORDER BY LIMIT`,
  broken SQL (consultations double ORDER BY, firm directory missing comma, checkin insert column list, video duplicate INSERT),
  integer flags compared to `true`, uuid ids parsed with `safeInt` (bar-prep sessions/explain/flag), uuid[] column written as JSON.
  All 5 runtime `CREATE TABLE` calls removed. Static-SQL `PREPARE` check: 1,084/1,084 statements valid on the migrated DB.
- **D8** arrest_alerts, outbound_bot, arrest_ingest, arrests route, reviews, match, advocacy, admin moved off
  `data/providers.sqlite` to the main Postgres DB. (Offline scraper scripts under src/scripts still use SQLite.)
- **F5** placeholder/param mismatches fixed (cases insert 11 vs 6, providers city query, search.js mixed `$1`/`?` rewritten
  to ILIKE, outbound_messages insert with no params). Scanner now reports 0.
- **F13** arrest_ingest data sources unchanged (placeholders return []); it now uses the main DB and does not error.

## Auth (F1, F6)
- Register accepts the app's `{identifier, password, displayName, isAttorney, barNumber, barState, firmName}`
  (and legacy `email`/`phone`); login accepts `{identifier, password}`; email matched case-insensitively; returns
  `{token, refreshToken, user}` (handlers used to `res.json(promise)` → `{}`), 201 on register, 409 duplicate,
  400 on validation (zod 4 `.issues`; validate() now merges parsed fields instead of stripping unknown keys).
- Lockout implemented on login (10 failures → 15 min, 423). Refresh tokens stored as SHA-256, single-use rotation,
  reuse revokes all sessions; `/refresh` also accepts the bearer access token (what the mobile app sends).
- Password reset stores a hashed token in `password_resets`; new `POST /api/auth/reset-password`; welcome/reset email via Resend.
- `/me`, logout (revokes refresh token), account delete in one transaction with savepoints, export fixed.
- **F3** disclaimer acceptance is a Postgres upsert; AI routes pass the 451 gate after accepting.

## Payments (F4 + owner constraint)
- Stripe webhooks mounted with `app.use` + `express.raw` before the JSON parser at `/webhooks/stripe` and
  `/api/webhooks/stripe`; JSON parser skips webhook paths (incl. `/api/billing/webhook`). Missing secret or bad
  signature → 400 (the old handler accepted unsigned events). Verification no longer needs the API key.
- Without a Stripe key: every billing/pay/consultation-booking endpoint that would charge or activate a subscription
  returns 503 `{error:'payments_unavailable', message:'Payments are not available yet'}` (no more free "mock"
  activations); GETs keep working and everyone is on the free tier.

## Email / queues (F7, F8)
- `services/email.js` (Resend) is the single sender, lazy client, logs instead of sending without RESEND_API_KEY;
  `sendgrid.js` is a shim (HTML builders + `sendEmail` → Resend); errorNotifier and arrest alerts route through it.
- `aiQueue.js`: BullMQ uses its own ioredis connection (`maxRetriesPerRequest: null`); workers started at boot;
  in-process job store for closure jobs (`enqueue(type, fn)`, pending→processing→done|failed, 45 s timeout, 15 min TTL)
  so `/api/jobs/:id` polling works with or without Redis (it previously returned 404/garbage). Verified end-to-end
  with a local Redis + mock Anthropic. Same connection fix in questionExplainer and barPrepNotifications.

## Route fixes found by the sweep / write probe
- attorney portal guard returned the `res` object (crash after 403) or nothing (request hang) — new `requireAttorney`;
  `requireDefender` returned `res` too. `req.db` attached for pretrial/legal-aid/impact/bondsman CRM routers.
- route shadowing: `/messages/unread`, `/lessons/progress/me`, `/matters/{dashboard,workload,retention-status}`.
- `requireMatterAccess('id','partner')` ignored the role argument (everything required only "viewer").
- lessons progress IDOR (`/progress/:userId` returned anyone's progress).
- push receipt cleanup nulled a random user's push token; push scheduling without a token 500'd.
- added endpoints the app already calls: `DELETE /api/push/token/:token`, `POST /api/conflicts/check`,
  `POST /api/transcribe/text` (works without AI), `POST /api/transcribe/note` (Whisper; 503 without OPENAI_API_KEY).
- saved lawyers accepts `{lawyer_id}` from the profile screen; lawyer search by `state`/`city`/"City, ST";
  bail search by city/state and GPS; legaldata double-quoted literals; cases accept the app's statuses ('Active', …)
  and date format; bail calculator schema matches the handler; motions/generate accepts `{motion_type, fields}`
  and returns a job; time summary SQL-injection via date params closed.

## Deploy
- `backend/Dockerfile`: multi-stage, `npm ci --omit=dev` (toolchain only in build stage), non-root `nodejs`,
  writable `/app/{data,logs,tmp}`, `HEALTHCHECK` on `${PORT:-4000}`, `CMD node --import ./src/instrument.js src/server.js`.
  (Docker daemon not available here, so the image build itself was not run; `npm ci --omit=dev` was.)
- root `railway.json` deleted; `backend/railway.json` builds `Dockerfile`; Railway service root must be `backend`
  (RAILWAY_ENV_SETUP.md rewritten with required/optional env vars). `nixpacks.toml`, `Procfile`, root `package.json` aligned.

## Tooling added
- `backend/scripts/smoke-test.mjs <baseUrl> [--db-url] [--anthropic-mock <port>] [--expect-db-down] [--payments-live]`
- `backend/scripts/route-sweep.mjs <baseUrl> [--list] [--json out]`
- tests: 190 files' hard-coded `/tmp/JG_fresh` paths → repo root resolved from `import.meta.url`.

## Final pass (court dates, messages bulk/attachment, migration 09, /health cache)

### 1. Court dates no longer shift by a day
- Cause: date-only values were TIMESTAMPTZ (cases.next_court_date …) → returned as `2026-11-20T00:00:00.000Z`; and the
  existing DATE columns came back from node-pg as JS Dates at server-local midnight (same ISO form). Devices west of UTC showed Nov 19.
- `db/index.js`: `pg.types.setTypeParser(1082, v => v)` — every DATE column is returned as the plain `'YYYY-MM-DD'` string.
- migration 09 converts date-only TIMESTAMPTZ columns to DATE (only while still timestamps; `USING (col AT TIME ZONE 'UTC')::date`):
  cases.next_court_date/court_date, matters.court_date/next_court_date/opened_date/trial_start_date/trial_end_date,
  eviction_trackers.court_date, civil_leads.incident_date, pi_leads.incident_date. Real timestamps (firm_trials, arrests, *_at) untouched.
  (`attorney/inbox` "today's hearings" `next_court_date = CURRENT_DATE` now actually matches.)
- `cases.js` `safeCourtDate()` (exported) keeps the day as written (`'2027-01-05T18:30-08:00'` → `2027-01-05`), rejects
  impossible days (2026-02-30); reminders are only rescheduled when the normalised date changes; reminder text formats the day in UTC.
- `pi_leads.js` inserted `''` into the incident_date timestamp column when omitted (500) → NULL.
- frontend `parseLocalDate()` also treats exact midnight-UTC timestamps (`…T00:00:00(.000)Z` / `+00:00`) as that calendar day
  (offline caches / older API); MatterScreen, CheckInManager, AttorneyInbox (`fmtDate` + "today" = local day), Booking slots,
  BarPrep calendar, FirmVertical defaults no longer use `new Date(x)` / `toISOString().slice(0,10)` for calendar days.
- Verified: server NODE_ENV=production TZ=UTC; create → list → display with the real frontend helper under
  TZ=America/Los_Angeles, Pacific/Honolulu, Pacific/Auckland → API returns `"2026-11-20"`, app shows "Nov 20, 2026"
  (also with a 10 pm local pick). New frontend test `courtDateRoundTrip.test.js` passes in LA / UTC / Auckland.

### 2. POST /api/messages/bulk and /api/messages/attachment (routes/messages.js rewritten)
- Case message bodies are now encrypted at rest (AES-256-GCM, services/encryption.js — the module header already said
  "used for case messages", the route never called it). `decrypt()` passes legacy plaintext through. Readers updated:
  thread GET, send response, attorney inbox previews, global search (matches on decrypted text of the user's last 500 messages).
- Shared `getCaseAccess()`: case owner or attorney/defender with an ACTIVE assignment (GET thread now works for the assigned
  attorney too; outsiders 404, unassigned attorneys 403). POST/GET `/:caseId` skip non-numeric ids.
- `POST /bulk` `{lawyer_ids:[≤3], message, case_id?}` (LawyersScreen "message up to 3 attorneys"): auth, 10/hour per user,
  400 on bad ids / >3 / blank / >5000 chars; recipient account = `lawyers.user_id` or `attorney_profiles.user_id` of a claimed
  listing (and the user must exist). Writes one encrypted row per account to the existing `messages` table + push; returns
  `{sent, requested, recipients, skipped:[{lawyer_id,name,phone,website,reason:no_account|self|duplicate|not_found}], message}`.
  Lawyer rows are only read (test asserts no write to lawyers/attorney_profiles/bail_agents). Today every directory lawyer
  has no account → sent 0 + "contact them by phone" summary.
- `GET /direct` — the recipient's (and sender's) decrypted direct messages, so bulk messages are readable.
- `POST /attachment` multipart (native field `file`, web field `document`, optional `case_id`): multer 2 memory storage,
  10 MB / 1 file limits (413 `file_too_large`), type sniffed from bytes — JPEG/PNG/WebP/HEIC/HEIF/PDF only (415),
  filename sanitised (path stripped, extension from sniffed type), bytes encrypted (`encryptBuffer`, iv|tag|ct) before storage,
  metadata in new `message_attachments` table; with a case it also posts an `attachment` message into the thread.
  `GET /attachment/:id` (uploader, case owner, assigned attorney) decrypts and serves with nosniff, `attachment` disposition,
  sandbox CSP, no-store. Storage (`services/attachmentStorage.js`): Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_KEY
  (bucket ATTACHMENTS_BUCKET, default case-documents), else ATTACHMENTS_DIR / `<app>/data/attachments` (= /app/data in the
  Docker image, writable by the nodejs user) if writable, else **503 `storage_unavailable`**; ATTACHMENTS_STORAGE=off forces 503.
  Server-generated keys only (YYYY/MM/uuid.bin, path-checked). Warns at boot-time use if local disk in production without
  ATTACHMENTS_DIR. `data/attachments` added to backend .gitignore/.dockerignore.
- Account deletion also purges direct messages, the user's case messages and attachments (rows in the transaction, files after commit).
- Frontend: LawyersScreen shows sent count + which attorneys aren't on in-app messaging (with phone); DocumentScanner (native)
  no longer shows "attached" after a failed upload, shows the server's message (e.g. storage unavailable / too large);
  web scanner sends the case id and shows real errors.
- Env vars documented in RAILWAY_ENV_SETUP.md (ATTACHMENTS_DIR/BUCKET/STORAGE, HEALTH_CACHE_MS).

### 3. supabase/migrations/00000000000009_constraints.sql (idempotent; CI applies it via the existing glob)
- unique indexes `uq_firm_members_firm_user (firm_id,user_id)`, `uq_integration_connections_firm_provider (firm_id,provider)`,
  `uq_vertical_deadline_presets_rule (vertical,rule_key)` (from 037_firm_verticals.sql / original firm + integrations schema);
  each created only if absent and no duplicates exist, otherwise `RAISE WARNING` and skip (verified with injected duplicates:
  warning, exit 0, index created on re-run after cleanup). No rows deleted.
- `can_edit` default → 0 (type-matched; boolean → false) on matter_team_members (the column with default 1) and on matter_teams
  if that column exists (it does not in the current schema).
- date-only TIMESTAMPTZ → DATE (see 1); `message_attachments` table with RLS enabled + client roles revoked (08's invariant).
- ON CONFLICT: all 22 explicit `ON CONFLICT (cols)` targets in backend/src match a non-partial unique index on the migrated DB
  (scripted check). Integration connect/OAuth inserts now `ON CONFLICT DO NOTHING` + update fallback (race-safe, and still
  correct if the index could not be created because of duplicates).

### 4. /health
- `utils/healthCheck.js` `createDbHealthCheck(getDb, {ttlMs})`: one `SELECT 1` per 5 s (HEALTH_CACHE_MS) regardless of request
  volume, concurrent requests share the in-flight probe, failures cached too (still 503 while the DB is down), 5 s probe timeout.
  Response adds `db_checked_at`, `db_cached`. /health stays exempt from the rate limiter.

### Tests added / changed
- backend `messages_bulk_attachment.test.js` (23, real router + fake DB), `final_pass_fixes.test.js` (25: health cache,
  safeCourtDate, DATE parser, migration 09 static checks, plus 3 real-Postgres checks gated on TEST_DATABASE_URL — pass locally).
- `self_healing_config.test.js`: locates the /health route definition instead of the first "/health" substring (now the
  healthCheck.js import).
- smoke-test.mjs: +4 checks (court-date round trip incl. DATE column type, encrypted case messages, bulk, attachment upload/
  download/415/401) and /health cache assertion → 29 checks.
- frontend `courtDateRoundTrip.test.js` (8).

### Verification (final tree)
- Fresh DB: 00..09 with ON_ERROR_STOP OK (195 public tables); applied all again → OK, no warnings; lawyers/bail_agents/
  quiz_questions = 2055/1265/548 before and after; lawyers and bail_agents md5 identical in the fresh DB and in jg_verify
  (which got 09 on top of existing data).
- backend: `npm ci` OK; `npm audit --omit=dev` → 0 vulnerabilities (also with --audit-level=high); import smoke OK;
  boot NODE_ENV=production TZ=UTC, generated secrets, no Stripe → /health db ok; smoke `--anthropic-mock` **29/29**;
  route-sweep: 553 routes, 185 GETs swept, only 5xx = 4× 503 "Admin access is not configured" (/api/bot/*).
- full jest: **313/313 suites, 27,932 passed, 0 failed, 3 skipped** (the TEST_DATABASE_URL-gated checks).
- frontend: `tsc --noEmit` 0; `eslint src App.tsx` 0 errors (1464 warnings, unchanged); check-nav-targets 0 problems;
  `npm test` 48/48 suites, 710/710 + render 5/5; `expo export` web OK (index.html, 5 screen chunks, no Electron code,
  bulk endpoint present) and android OK.
- CI workflow steps run locally verbatim (fresh DB jg_ci, ports 4000/4010): all pass. Migration step uses
  `ls supabase/migrations/*.sql | sort`, so 09 needs no workflow change.
