# Justice Gavel — Pre-Launch Security Checklist
*(claims verified against the code at v8.7.60)*

## Authentication ✅
- [x] JWT access tokens: `JWT_EXPIRES_IN` default **30d** (the mobile app
      refreshes tokens older than 25 days — keep ≥ 30d)
- [x] Refresh tokens: single-use, rotated, DB-stored (`JWT_REFRESH_EXPIRES_IN` default 60d)
- [x] bcrypt rounds = 12
- [x] Ghost-session protection (user existence check on every auth)
- [x] Takedown review / dispositions / research indexing re-check the role
      **in the database**; `/api/admin/*` needs an admin token **and** `X-Admin-Key`
- [x] Every role check uses the live `users` row (middleware/auth.js, ≤ 60 s
      cache): a demoted / banned / deleted account loses access within a minute
      (audit11 H3). Still delete its `refresh_tokens` rows when offboarding staff.
- [ ] One-off after deploying step 11: `node scripts/repair-legacy-entities.mjs`
      (dry run) then `--apply` with the production `DATABASE_URL` + `ENCRYPTION_KEY`
      to restore messages/feedback stored HTML-encoded by the old sanitiser (M1)
- [x] Login rate-limited (10/15 min), registration (5/hr), password reset (5/hr)

## Transport Security ✅
- [x] helmet.js: HSTS, CSP, X-Frame-Options, noSniff, referrer policy
- [x] CORS locked to production domains (+ localhost dev origins)
- [x] TLS handled by Railway (auto-renewed)

## Data ✅
- [x] Cases soft-deleted (`deleted_at`)
- [x] Audit log on sensitive operations (append-only)
- [x] Input validation (zod schemas + per-route checks) on critical routes
- [x] Postgres RLS enabled **deny-all** on all tables (no policies; the
      backend is the only DB client — anon/authenticated PostgREST roles get nothing)
- [x] Performance indexes on hot query paths (migration 12)
- [x] Production logs: one-line JSON, query strings stripped (PII), no tokens/bodies

## AI / Legal ✅
- [x] UPL disclaimer on all AI-generating screens; disclaimer versioning
- [x] Crisis hotlines verified Jan 2026
- [x] Minor-specific content disclaimers
- [x] Attorney-client privilege notice on the attorney platform
- [x] Sample (seeded) arrest records hidden from all user-facing, alerting and
      billing paths; takedown requests reviewed by staff
- [x] Lead fees flat (bondsman $100, PI/civil-rights $200, employment $100,
      ICE $75) — never scaled to bail or case value; enforced by
      `lead_fee_consistency.test.js`

## Payments ✅ (dormant until Stripe keys are set)
- [x] Without `STRIPE_SECRET_KEY`: billing returns `503 payments_unavailable`,
      app shows a friendly message; setting keys re-enables everything
- [x] Stripe webhook signature verified (raw body, `constructEvent`)
- [x] Idempotency keys on Stripe create calls (incl. bondsman lead purchase)
- [x] Subscription state machine (trialing→active→past_due→canceled), grace
      period on `past_due`
- [x] No TEST_MODE/DEMO_MODE payment bypasses; demo subscriptions excluded
      from every payment gate

## Operations ✅
- [x] Sentry error monitoring (`SENTRY_DSN`)
- [x] `/health`: real `SELECT 1` (cached `HEALTH_CACHE_MS`), feature flags, version
- [x] `/metrics`: memory, AI queue, pg pool (JSON + Prometheus)
- [x] Graceful shutdown on SIGTERM: AI queue drained (`AI_DRAIN_TIMEOUT_MS`,
      force-exit at 25 s)
- [x] Memory watchdog on RSS (72%/85%/93% of `MEMORY_LIMIT_MB`)
- [x] Refresh-token cleanup scheduled job
- [x] GDPR/CCPA export (`GET /api/auth/export`) + account deletion
- [x] `openapi.json` regenerated from mounted routes; drift fails CI

## ⚠️ PENDING BEFORE LAUNCH
- [ ] Set all Railway env vars (see RAILWAY_ENV_SETUP.md) — **rotate any
      secret that ever appeared in git history**
- [ ] Configure Sentry DSN
- [ ] Configure uptime monitor on /health (UPTIME_MONITORING.md)
- [ ] Set STRIPE_WEBHOOK_SECRET from the Stripe dashboard (when enabling payments)
- [ ] Test full payment flow in Stripe test mode (when enabling payments)
- [ ] Legal consultant sign-off on state rule accuracy
- [ ] Configure `ARREST_FEED_URLS` (or accept honest empty arrest states)
- [ ] Apply `supabase/migrations/00000000000015_provider_refresh_staging.sql`
      (scrape_runs + provider_update_proposals) before enabling `LIVE_REFRESH`
- [ ] **Rotate the Google Places key** that was hard-coded in the Windows
      `backend/RUN_*.bat` / `.ps1` wrappers (removed in step 12, still in git
      history); restrict the new key to the Places API + server IP
- [ ] Review the data-refresh queue (`GET /api/admin/proposals`) after each
      refresh; scraped changes to existing providers are never applied automatically
- [x] Junk `state_bar` lawyer rows (scraped page headings "A Colorado Bar
      Association membership…" and "Layer") removed by migration 016 and added to
      `provider_suppressions` so a scrape can't re-add them — run 016 on production
- [ ] EAS build submitted to App Store / Google Play
- [ ] Legal action items in docs/LEGAL_ACTION_ITEMS.md resolved
