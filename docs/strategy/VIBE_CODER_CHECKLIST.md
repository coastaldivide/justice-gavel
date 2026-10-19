# 50 things vibe-coded apps usually miss — Justice Gavel checklist

"Vibe coding" = building fast with AI by describing what you want. It produces
code that *looks* finished but often skips the unglamorous parts below. Each item
has a status for Justice Gavel; the audit fills in **Status** and **Evidence**
(a file, test or command that proves it).

Status key: ✅ done & tested · 🟡 partial · ❌ missing · ⏸ needs owner (keys, accounts, legal)

Audited 2026-10-18 against the code and by running it (fresh DB, production boot,
smoke test, jest, headless web). "Was" = status before this audit's fixes.
Test paths are relative to `backend/src/__tests__/` (backend) or
`frontend/src/__tests__/` (frontend); PG = runs against real Postgres
(`TEST_DATABASE_URL`, CI's migrated `jg_ci`).

**Totals — before: ✅ 23 · 🟡 19 · ❌ 4 · ⏸ 4 → after: ✅ 40 · 🟡 4 · ❌ 0 · ⏸ 6**

## Security (1–15)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Secrets kept out of code and git history | ⏸ (was ⏸) | Tree is clean: `git grep` for sk_live/sk-ant/AIza/whsec/re_/private keys → 0 hits; `.env*` ignored; `env_docs_consistency.test.js` "no real secret values". **History still holds a Google Places key** (removed in step 12) → owner must rotate it. |
| 2 | Every route requires auth unless deliberately public (deny by default) | ✅ (was 🟡) | `public_routes.test.js` walks every mounted route; the 66 non-JWT routes must be on a reviewed list with a reason (signed webhooks, capability tokens, guest core path) — a new unguarded route fails CI. `openapi_drift.test.js` checks auth marking. |
| 3 | Ownership checks on every record (no IDOR) | ✅ | PG suites `security/c1…c3c4,h1h2,h5,m8` replay cross-user/cross-firm attacks; `integration/cases.int.test.js` IDOR matrix; `/chat/stream` history scoped (audit11 M6). |
| 4 | Roles/permissions read from the database, not trusted from old tokens | ✅ | `middleware/auth.js` loads role/status from `users` (60 s cache, fail closed); `security/h3h4_live_roles_admin.int.test.js` (demoted admin's token → 403). |
| 5 | Input validated on every endpoint (types, lengths, formats) | ✅ (was 🟡) | `integration/input_fuzz.int.test.js` (PG): 14 core create/login endpoints × wrong types, nulls, arrays, 200 KB strings, non-object JSON → 0 × 5xx, oversized titles never stored. zod on auth/booking/check-ins, `sanitizeStr/truncateStr/safeInt` elsewhere. |
| 6 | All SQL parameterized | ✅ | `?`→`$n` binding in `db/index.js`; dynamic identifiers only via allowlists (`safeTable`, `accountDeletion.js ident()`); GATE-02 "0 SQL injection" scans; eslint `security/*`; grep for `${req.…}` inside SQL → 0. |
| 7 | Output escaped (HTML emails, web pages) — no XSS | ✅ | `security/m4_email_escaping.test.js`; `utils/html.js` + `frontend/src/utils/html.ts` for print/PDF; input stored raw (audit11 M1). |
| 8 | Rate limits on login, signup, password reset, AI and other costly endpoints | ✅ (was 🟡) | Smoke test (prod mode) "rate limits: failed logins, sign-ups and password resets → 429"; AI: `ai_budget.test.js` "61st AI call in an hour → 429"; upload/transcribe limits `security/c5_uploads.int.test.js`. |
| 9 | Passwords hashed; reset/refresh tokens hashed, single-use and expiring | ✅ | bcrypt 12, SHA-256 token hashes (`routes/auth.js`); smoke "refresh token rotation (single use)", "logout revokes the refresh token"; `integration/auth.int.test.js` reuse → 401. |
| 10 | File uploads: size limits, type checked by content, safe storage | ✅ | `middleware/uploads.js`; `security/c5_uploads.int.test.js` (413/429, byte budget); attachments sniffed by magic bytes + encrypted (smoke "attachment … stored encrypted"). |
| 11 | User-supplied URLs can't reach internal addresses (SSRF) | ✅ | `utils/ssrfGuard.js`; `security/h9_ssrf.int.test.js` (webhooks, DMS, CalDAV). |
| 12 | CORS limited to known origins | ✅ | `app.js isOriginAllowed`; smoke "CORS: allowed origin preflight ok, unknown origin → 403". |
| 13 | Security headers and HTTPS everywhere | ✅ | helmet + CSP `frame-ancestors 'none'`, HSTS 1 y preload, nosniff, `no-store` on /api — smoke "security headers…" (new). TLS terminates at Railway/Caddy (`Caddyfile`). |
| 14 | Dependencies audited; no known high/critical vulnerabilities shipped | 🟡 (was 🟡) | Backend `npm audit --omit=dev --audit-level=high` → **0** (CI-blocking). Frontend prod: 29 high / 5 moderate, all from 3 advisories with **no patched release upstream** (braces in metro/jest, node-forge in @expo/cli, sprintf-js) — build-time, not in the shipped JS. Re-check when upstream publishes fixes. |
| 15 | Logs never contain passwords, tokens or sensitive personal data | ✅ (was 🟡) | `utils/redact.js` used by the logger (text + JSON), Sentry `beforeSend`/`beforeBreadcrumb` (bodies, query strings, cookies, auth headers dropped) and alert e-mails/webhooks; `observability_redaction.test.js` (8 tests). HTTP log lines drop query strings. Live prod boot: 93 log lines, 0 unmasked e-mails. |

## Data (16–24)

| # | Item | Status | Evidence |
|---|---|---|---|
| 16 | One versioned, idempotent migration history; schema matches code | ✅ | `supabase/migrations/00…19` applied twice with ON_ERROR_STOP on a fresh DB (193 tables, 0 without RLS); `migration_idempotency.test.js`; static PREPARE check (step 1). |
| 17 | Backups exist and a restore has been tested | ⏸ (was ⏸) | New `backend/scripts/db-backup.sh` / `db-restore.sh` (checksum, non-empty-target refusal, source verification); `integration/backup_restore.int.test.js` (PG) does live DB → A → B round trips with provider md5 match; RUNBOOK "DATABASE BACKUP". Owner: enable Supabase backups/PITR and schedule the script off-platform. |
| 18 | Multi-step writes wrapped in transactions | ✅ (was 🟡) | `db.transaction` for register, reset-password, account delete, provider refresh, messages, and now firm create, matter create/delete, office join; `integration/transactions.int.test.js` injects a failure into the 2nd statement (trigger) → no half-written rows. |
| 19 | Indexes on the queries that actually run hot | ✅ | Migration 12 (EXPLAIN-verified, step 9), migration 19 unique index; slow-query log `SLOW_QUERY_MS`. |
| 20 | Dates and time zones handled correctly | ✅ | Smoke "court date round trip keeps the calendar day"; frontend `dateUtils.test.js` in 3 zones; reminders in the user's zone (`integration/audit11_functional` H11). |
| 21 | Users can export and delete their data | ✅ (was 🟡) | `GET /api/auth/export` returns every table in the registry (decrypted notes/messages, no secrets); in-app deletion now asks for the password (it sent none and always failed) and signs out — `integration/account_lifecycle.int.test.js`, `render/coreStates.test.tsx` "SettingsScreen — in-app account deletion". |
| 22 | Deletes are consistent (no orphans; soft-delete respected everywhere) | ✅ (was ❌) | `services/accountDeletion.js` classifies **every** users-referencing column (175) and every case child table (25); the PG test fails on an unclassified column and asserts **0 rows** still point at a deleted user/case; owned firms pass to a remaining member instead of cascading away; provider rows md5-identical. (Before: 16 hand-listed tables — chat history, monitors, contacts, reminders' links survived.) |
| 23 | Every list endpoint is paginated / bounded | ✅ (was 🟡) | 38 unbounded SELECTs given LIMITs; `list_bounds.test.js` fails on any new unbounded list (23 documented exceptions: complete documents, conflict checks, fixed catalogues); `integration/duplicates_bounds_ai.int.test.js` seeds 260/150/150 rows → responses capped. |
| 24 | Unique constraints + idempotency stop duplicates under double-clicks and retries | ✅ (was 🟡) | `middleware/idempotency.js` + migration 19 (`idempotency_keys`, unique saved-lawyer index); app sends keys and retries dropped POSTs with the same key (`frontend/services/api.ts`, `idempotentPost.test.js`); PG test: replay → same id/one row, concurrent → 1 row, reused key → 422; smoke "Idempotency-Key…". |

## Reliability (25–34)

| # | Item | Status | Evidence |
|---|---|---|---|
| 25 | Errors are never silently swallowed | 🟡 (was 🟡) | Backend: 121 empty `.catch(() => {})` → `logIgnored(where)` (logged, scrubbed); `errors_not_swallowed.test.js` keeps it at 0; scheduled-job failures alert. Fixed silent UI failures on the core path (save lawyer showed "Saved" on error, notification prefs, case list "No cases" on network error, Help Now "no contacts" on network error). Remaining: ~150 best-effort `.catch(() => {})` in the app (storage writes, haptics, analytics) — non-user-facing. |
| 26 | Health check really checks the database (and fails when it's down) | ✅ | `/health` runs `SELECT 1` (cached 5 s) → 503; smoke `--expect-db-down` check; `health.test.js`. |
| 27 | Timeouts and retries on every outside call | ✅ (was ❌) | `utils/http.js fetchWithTimeout` (timeout incl. body, retries w/ backoff + Retry-After); `services/aiClient.js` (60 s, 2 retries, SDK `timeout`/`maxRetries`); Resend 10 s + idempotent retries; Stripe `timeout`+`maxNetworkRetries`; web-push 10 s; `outbound_timeouts.test.js` (hung server, slow body, 503→retry, 529 AI retry) + static guard: no `fetch(` without a signal anywhere in src. |
| 28 | The app degrades gracefully when an outside service is down | ✅ | 503 `ai_unavailable` / `payments_unavailable` with friendly app copy (smoke + render tests); e-mail logs when Resend is unset; bar-prep falls back to static explanations; offline caches (#36). |
| 29 | Background jobs are idempotent, don't overlap, and are monitored | ✅ (was 🟡) | Reminders claimed `FOR UPDATE SKIP LOCKED`; refresh jobs use advisory locks + `scrape_runs`; new `guardJob()` (every `scheduleGuarded` job): no overlap per process, failures → SEV-2 alert, per-job stats on `/metrics` — `scheduled_jobs.test.js`. |
| 30 | Graceful shutdown | ✅ | `server.js shutdown()`; live: SIGTERM → "in-process queue drained" → "Shutdown complete". |
| 31 | No memory leaks or runaway timers | ✅ | 90-day `setInterval` overflow fixed (step 9), `cronGuard` refuses implausible schedules, timers `unref`'d, RSS watchdog; overlap guard (#29). |
| 32 | Required settings validated at startup; clear message when one is missing | ✅ | `config.validateEnv` (exit 1 in prod), `checkAppEnv` (bad APP_ENV / NODE_ENV=staging / live Stripe on staging) — `app_env.test.js`; `scripts/check-env.js`. |
| 33 | Error tracking and uptime monitoring wired up | ⏸ (was ⏸) | Sentry wired (backend `instrument.js`, app `App.tsx`), no-op without DSN; `/health` + `/metrics` (db pool, AI queue, jobs) ready for a poller (UPTIME_MONITORING.md). Owner: create Sentry projects (DSNs) and the uptime monitor. |
| 34 | Structured logs with a request ID per request | ✅ (was 🟡) | Production logs are one JSON object per line; AsyncLocalStorage stamps `request_id` on every line written during a request (routes, services, DB, error handler); 5xx bodies carry `request_id` — `observability_redaction.test.js`; live boot: every line JSON. |

## Frontend & UX (35–43)

| # | Item | Status | Evidence |
|---|---|---|---|
| 35 | Every screen has loading, empty and error states | ✅ (was 🟡) | Core path checked screen by screen: Home (static tiles, optional widgets), JustArrested (static), RightsCard (bundled card first), HelpNow (now a real error/offline state, not "no contacts"), Lawyers/BailSearch (`render/providerScreens`), LawyerProfile (network error + Try again vs 404), BailCalculator (no-schedule + sign-in states), Case (load error + Try again, never "No cases yet"), CourtLocator ("No courthouses found"), Chat (`render/homeChat`), Settings. `render/coreStates.test.tsx` (10 tests). |
| 36 | Works offline where it matters (rights, saved contacts, court dates) | ✅ (was 🟡) | Rights card bundled; Help Now + saved lawyers + bail agents cached; **court dates now cached** (titles/dates only, never notes) with an offline banner — `render/coreStates` "offline: court dates…"; `offlineCache*.test.js`. |
| 37 | Accessibility: screen-reader labels, contrast, large-text support | ✅ | `scripts/design-audit.mjs --ci` 0 in every category (both themes); axe 0 violations (step 4); `maxFontSizeMultiplier` throughout. |
| 38 | Looks right on small phones, tablets, web, and in dark mode | 🟡 (was 🟡) | Dark-mode contrast 0 failures; web smoke + journeys at 390×844 and 1280×900; `TabletLayout`, `supportsTablet`. Not verified on a real tablet / small Android device — needs a device pass. |
| 39 | Buttons can't be double-submitted | ✅ (was 🟡) | `hooks/useInFlight.ts` + ref guards (case save, save lawyer, reviews, account delete/export), server idempotency (#24); `render/coreStates` "a double tap on Save posts once". |
| 40 | Forms show clear validation messages | ✅ | `render/authScreens.test.tsx` (empty fields, 8-char rule, server 401/409 messages); case title / court-date format errors; account-delete "Enter your password" / server message. |
| 41 | Back button and deep links go where users expect | ✅ | `scripts/check-nav-targets.mjs` (250 refs, 0 problems); web smoke walks every deep link in `linking.ts`. |
| 42 | Login tokens stored securely on the device | ✅ | `utils/secureStorage.ts` (expo-secure-store; sessionStorage on web); `secureStorage.test.js`. |
| 43 | Permissions (location, notifications) asked in context with a reason | ✅ (was ❌) | `services/permissions.ts`: own explainer + "Not now" before the OS prompt, Settings link when permanently denied; notifications asked only when a court date is saved or reminders are switched on (never at launch/foreground); Home/Onboarding use location only if already granted; unused iOS "Always" location keys + background-location mode removed — `render/permissions.test.tsx` (8 tests). |

## Process, legal & cost (44–50)

| # | Item | Status | Evidence |
|---|---|---|---|
| 44 | CI blocks merges when tests, types or lint fail | ⏸ (was ⏸) | `.github/workflows/ci.yml`: every step blocking (lint 0/0, migrations, prod boot + smoke, full jest, PG suites, tsc, eslint, design audit, exports). Owner: turn on GitHub branch protection requiring both jobs. |
| 45 | Tests check behavior, not just that source text exists | 🟡 (was 🟡) | Core paths have behavioural suites (integration 15 PG suites, security 11, refresh 3, render 8) and every fix here has one; ~190 legacy `brutal_trials_*` files still assert source text — kept, updated when behaviour changes. |
| 46 | A staging environment separate from production | ⏸ (was ❌) | Config supports it cleanly: `APP_ENV=staging` + `NODE_ENV=production`, boot refuses NODE_ENV=staging / live Stripe keys / the prod DB (`app_env.test.js`); `/health`, logs, Sentry carry `env`; fixed `railway.staging.json` (it set NODE_ENV=staging + 15 min JWTs); RUNBOOK "STAGING", RAILWAY_ENV_SETUP "Staging". Owner: create the environment. |
| 47 | Reproducible builds (lockfiles committed, pinned versions) | ✅ | `package-lock.json` committed in backend/frontend; CI and gate use plain `npm ci`; Expo SDK pins via `expo install --check`. |
| 48 | Docs and runbook match what the code actually does | ✅ | `env_docs_consistency.test.js` (every env var read ↔ config ↔ docs ↔ .env.example), `openapi_drift.test.js`, `version_alignment.test.js`; RUNBOOK updated (backups, staging, AI cap, request ids, idempotency). |
| 49 | Legal/store compliance: terms, privacy policy, disclaimers, privacy labels, in-app account deletion | ⏸ (was 🟡) | In-app deletion now works end to end (#21); Terms/Privacy screens, ToS clickwrap + AI disclaimer (451 gate), UPL notices. Owner: App Store privacy "nutrition" labels + Play data-safety form, lawyer review (LEGAL_ACTION_ITEMS A0). |
| 50 | Cost controls on paid APIs (per-user AI limits, spend caps, alerts) | ✅ (was 🟡) | Per-user 60 AI calls/h + free daily chat cap; new global cap `services/aiBudget.js` (`AI_DAILY_BUDGET_USD`, default $50/UTC day; SEV-2 at 80 %, SEV-1 at 100 %) metering every call site (17 fetch sites + 2 SDK clients) into `ai_usage_log` — `ai_budget.test.js`, PG `/chat/ask` refused after the cap with 0 provider calls. Owner: pick the budget and set a hard limit in the Anthropic console (see below). |

## Owner actions

| # | What the owner must do |
|---|---|
| 1 | Rotate the Google Places API key that is still in git history (Google Cloud console → Credentials → regenerate, restrict by API + IP), then set `GOOGLE_PLACES_KEY` in Railway. Optionally purge history with `git filter-repo` (rewrites history — coordinate with every clone). |
| 17 | Supabase: confirm daily backups on the plan and enable the PITR add-on. Schedule `backend/scripts/db-backup.sh` daily from a machine outside Railway (encrypted, access-controlled storage, `BACKUP_KEEP_DAYS`), and run the restore drill in RUNBOOK monthly. |
| 33 | Create Sentry projects and set `SENTRY_DSN` (Railway) and `EXPO_PUBLIC_SENTRY_DSN` (EAS); create an uptime monitor on `https://api.justicegavel.app/health` (alert on non-200) and set `ONCALL_EMAIL` / `ALERT_WEBHOOK_URL` + `RESEND_API_KEY` so alerts are delivered. |
| 44 | GitHub → Settings → Branches → protect `main` (and `develop`): require the "Backend" and "Frontend" CI checks and a pull request before merging. |
| 46 | Create a Railway "staging" environment and a separate Supabase project: `NODE_ENV=production`, `APP_ENV=staging`, staging `DATABASE_URL`, `PRODUCTION_DATABASE_URL=<prod URL>`, test Stripe keys or none, own secrets; apply migrations there first (RUNBOOK → STAGING). |
| 49 | Fill in App Store Connect privacy labels and Google Play data-safety form (data: e-mail/phone, case notes & messages (encrypted), approximate/precise location when used, push token, crash data if Sentry is on; no tracking/ads); have a lawyer review Terms, Privacy Policy, disclaimers and the fee copy (LEGAL_ACTION_ITEMS A0). |
| 50 | Decide the daily AI budget (`AI_DAILY_BUDGET_USD`, default $50) and alert threshold (`AI_BUDGET_ALERT_PCT`, default 80), and set a monthly spend limit in the Anthropic console as the hard backstop. |
