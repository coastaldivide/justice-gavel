# Railway Deployment Checklist — Justice Gavel

Run through this top to bottom. Full variable reference:
[../../RAILWAY_ENV_SETUP.md](../../RAILWAY_ENV_SETUP.md).

---

## STEP 1 — Generate secrets

Generate fresh values locally and keep them in a password manager — never
commit them (an earlier revision of this checklist embedded real values;
those are burned — do not reuse them, and rotate them if they were ever
deployed):

```bash
openssl rand -hex 32    # JWT_SECRET
openssl rand -hex 32    # JWT_REFRESH_SECRET (different value)
openssl rand -hex 32    # ENCRYPTION_KEY — losing it makes encrypted data unreadable
openssl rand -hex 32    # ADMIN_KEY
npx web-push generate-vapid-keys   # VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY
```

---

## STEP 2 — Postgres (Supabase or Railway Postgres, 5 min)

[ ] Supabase → Settings → Database → Connection string (**Transaction** mode)
    → `DATABASE_URL`
[ ] (If using Supabase Storage for attachments) Settings → API →
    `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
[ ] Run migrations: apply every `supabase/migrations/*.sql` file in filename order
    (`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>`); the API never runs DDL itself

---

## STEP 3 — Anthropic (2 min)

[ ] console.anthropic.com → API Keys → Create Key → `ANTHROPIC_API_KEY`
[ ] Without it the server still runs; AI endpoints return `503 ai_unavailable`

---

## STEP 4 — Stripe (15 min, can be deferred)

Payments stay cleanly disabled (`503 payments_unavailable`) until these are
set — everything else works without them.

[ ] dashboard.stripe.com → Developers → API Keys → Secret Key → `STRIPE_SECRET_KEY`
[ ] Create Products in the Stripe dashboard:

| Plan | Billing | Monthly Price | Annual Price |
|------|---------|---------------|--------------|
| Legal Radar | Monthly | $19.99 | — |
| Advisor | Monthly | $24.99 | $199/yr |
| Legal Pro | Monthly | $34.99 | $299/yr |
| Esquire | Monthly | $49.00 | $410/yr |
| Bondsman | Monthly | $49.00 | — (leads billed flat $100 each) |

[ ] Copy each `price_...` id into the matching `STRIPE_*_PRICE_ID` /
    `STRIPE_*_ANNUAL_ID` variable
[ ] Webhooks → Add endpoint
    - URL: `https://<your-api-host>/webhooks/stripe`
    - Events: `checkout.session.completed`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `invoice.payment_failed`,
      `invoice.payment_succeeded`
    - Signing Secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

---

## STEP 5 — Resend email (5 min)

[ ] resend.com → API Keys → Create → `RESEND_API_KEY`
    (without it, emails are logged to the server log instead of sent)
[ ] Domains → add `justicegavel.app` and set the DNS records it gives you —
    without domain verification mail lands in spam
[ ] Set `EMAIL_FROM` / `ALERT_EMAIL_FROM` to addresses on the verified domain

---

## STEP 6 — Google Places (3 min, optional)

[ ] console.cloud.google.com → enable Places API (New) + Geocoding API
[ ] Credentials → Create API Key → `GOOGLE_PLACES_KEY`
[ ] (Recommended) restrict the key to your Railway egress IP

---

## STEP 7 — Sentry (5 min, optional)

[ ] sentry.io → New Project → Node.js → DSN → `SENTRY_DSN`
[ ] Alerts: "first occurrence of new error" + "error rate > 10/min" → email

---

## STEP 8 — Monitoring alerts (2 min)

[ ] Slack incoming webhook → `ALERT_WEBHOOK_URL`
[ ] `ALERT_EMAIL` / `ONCALL_EMAIL` (+ `ONCALL_EMAIL_2`) for SEV-1/SEV-2 email
[ ] Uptime monitor (BetterUptime or similar) on `https://<your-api-host>/health`,
    60 s interval, alert after 2 failures

---

## STEP 9 — Railway service

[ ] Service **Root Directory = `backend`** (uses backend/railway.json + Dockerfile,
    health-checks `GET /health`)
[ ] Set every variable from the steps above (Railway → Variables), plus:
    `NODE_ENV=production`, `APP_URL`, `BASE_URL`, `CORS_ORIGIN`
[ ] Optional: `bash scripts/setup-railway.sh` pushes a filled-in variable set
    through the Railway CLI (fill YOUR values in first — it ships empty)

---

## STEP 10 — Verify deployment

[ ] `curl https://<your-api-host>/health` → `{"ok":true,"status":"ok","db":"ok",...}`
    with the current version string, and `features` showing which keys are live
[ ] `cd backend && node scripts/smoke-test.mjs https://<your-api-host>` — all checks pass
[ ] Test Stripe webhook: `stripe trigger invoice.payment_succeeded` (Stripe CLI)
[ ] Trigger `/api/auth/forgot-password` for a test account → email arrives
[ ] Sentry dashboard shows the server start (if configured)

---

## STEP 11 — Go live

[ ] `DEMO_MODE` unset or `false`
[ ] `LIVE_REFRESH=true` if the nightly scheduler should run
[ ] Re-run the smoke test one more time
[ ] 🚀 Ship it

---

## Optional integrations (add later)

- `COURTLISTENER_TOKEN` — RECAP federal docket monitoring
- `CLIO_CLIENT_ID` / `CLIO_CLIENT_SECRET` (and the other practice-management
  OAuth pairs) — live integrations instead of demo data
- `GOOGLE_CALENDAR_CLIENT_ID` / `OUTLOOK_CLIENT_ID` — calendar sync
- `OPENAI_API_KEY` — Whisper transcription
- `DAILY_API_KEY` — video consultations
- `REDIS_URL` — durable AI job queue
