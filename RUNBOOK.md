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

Supabase takes daily backups automatically (point-in-time recovery on Pro).
Manual: Supabase Dashboard → Project → Backups → Download.

**Critical tables to verify after incidents:** `users`, `audit_log`
(append-only, never delete), `user_disclaimer_acceptance`, `refresh_tokens`,
`subscriptions`.

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

---

## SCHEDULED JOBS

| Job | When | Requires |
|---|---|---|
| Reminder delivery (court dates + user-set reminders: push via Expo, email fallback) | every 60 s in each API process; re-plans missing court reminders every 6 h | always on; `REMINDERS_ENABLED=false` turns it off for a process |
| Check-in reminder blast `POST /api/checkins/remind-all` | external cron | staff token **or** `X-Admin-Key` |
| Nightly refresh (scrapers, arrest alerts, payment-link expiry, token cleanup) | `REFRESH_CRON` (default 3 am `REFRESH_TZ`) | `LIVE_REFRESH=true` |
| Health scan | `HEALTH_SCAN_CRON` (default 2 am) | scheduler on |
| Bar re-verification sweep | daily tick, re-verifies attorneys whose verification is > 90 days old | scheduler on |
| Bar-prep reminders (`bar-daily-7am`, `bar-streak-3pm`, `bar-countdown-8am`) | daily | `REDIS_URL` (BullMQ) |

Manual bar-verification sweep: `POST /api/admin/bar-verification/sweep`
(bearer token of a user whose role is `admin`, plus the `X-Admin-Key` header —
the `/api/admin` guard applies to every `/api/admin/*` path). Manual nightly run:
`node -e "import('./src/services/barVerification.js').then(m=>m.runNightlyVerification())"`.

---

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
