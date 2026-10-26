# Go-Live Checklist (Render) — Justice Gavel

Run through this top to bottom. Full variable reference:
[../../DEPLOY_ENV_SETUP.md](../../DEPLOY_ENV_SETUP.md). Render steps in detail:
[../../RUNBOOK.md](../../RUNBOOK.md) → "DEPLOY (Render)".

---

## STEP 1 — Generate secrets

**Moving an existing deployment?** Copy the CURRENT `ENCRYPTION_KEY` (and
`JWT_SECRET` / `JWT_REFRESH_SECRET` / `ADMIN_KEY`, to keep everyone signed in)
from the old host. A new `ENCRYPTION_KEY` makes every encrypted note and
message unreadable; it can never be regenerated once data exists.

For a brand-new deployment, generate fresh values locally and keep them in a
password manager — never commit them (an earlier revision of this checklist embedded real values;
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

## STEP 2 — Postgres (Supabase, 5 min)

[ ] Supabase → Settings → Database → Connection string (**Transaction** mode)
    → `DATABASE_URL` (one Supabase project for production, a second one for staging)
[ ] (If using Supabase Storage for attachments) Settings → API →
    `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
[ ] Migrations run automatically: Render's pre-deploy step
    (`sh /app/scripts/migrate.sh`) applies every new `supabase/migrations/*.sql`
    file before each deploy goes live. To check by hand from a checkout:
    `DATABASE_URL=… sh backend/scripts/migrate.sh --status`

---

## STEP 3 — Anthropic (2 min)

[ ] console.anthropic.com → API Keys → Create Key → `ANTHROPIC_API_KEY`
[ ] Without it the server still runs; AI endpoints return `503 ai_unavailable`

---

## STEP 4 — Stripe (15 min)

Payments stay cleanly disabled (`503 payments_unavailable`) until these are
set — everything else works without them. Do this twice: **test mode keys on
staging**, **live keys on production** (the server refuses a live key on staging).

[ ] dashboard.stripe.com → Developers → API Keys → Secret key → `STRIPE_SECRET_KEY`
[ ] Prices: run `cd backend && STRIPE_SECRET_KEY=… node scripts/setup-stripe-products.js`.
    It creates every price from `src/routes/billing/plans.js` and prints the
    `STRIPE_*_ID` values to paste into Render. Optional: without price ids the
    exact amounts are sent to Stripe inline, so nothing is mispriced either way.
    The price list (October 26, 2026 — docs/MONETIZATION_PLAN.md section 7):

| Plan | Monthly | Annual |
|------|---------|--------|
| Legal Pro (consumer) | $19.99 | $149/yr |
| Esquire (attorney) | $49.00 | $410/yr |
| Bail agent Starter | $99 | $950/yr |
| Bail agent Pro | $199 | $1,910/yr |
| Bail agent Market | $349 | $3,350/yr |

    One-time charges (no price id): Case Pass $29 (extension $19), bail lead $100,
    personal-injury / medical lead $250, civil rights $200, employment $100,
    ICE detention $75, consultation platform fee $10/$15/$25. Texts sent for bail
    agents: 5¢ each, added daily to their plan invoice. Legal Radar and 24 Hour
    Advisor are retired (old subscribers keep them; never sold again).

[ ] Webhooks → Add endpoint
    - URL: `https://<your-api-host>/api/billing/webhook`
    - Events: `checkout.session.completed`, `customer.subscription.created`,
      `customer.subscription.updated`, `customer.subscription.deleted`,
      `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`,
      `payment_intent.succeeded`, `charge.refunded`
    - Signing secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

---

## STEP 4b — Telnyx texts (start FIRST: carrier registration takes 1–3 weeks)

Court reminders by text, and every Bond Desk signing link and payment reminder,
go through Telnyx. Without these keys texts are skipped (push and e-mail still work).

[ ] telnyx.com → create the account, add a payment method
[ ] Messaging → 10DLC → register the **brand** (company legal name, EIN, address)
[ ] Register the **campaign**: use case "Mixed" (court-date reminders, account
    notifications, signing links for bail paperwork). Opt-in description: the
    in-app consent checkbox (text `cdd_sms_consent`, recorded per migration 31) and,
    for Bond Desk, the agent confirming the person agreed to texts about their bond.
    Sample messages: copy from `backend/src/i18n/messages/en.js` keys `reminder.sms`,
    `bd.sms.sign`, `bd.sms.remind_due`. Every message ends "Reply STOP to opt out."
[ ] Buy a local number; attach it to a messaging profile on the approved campaign
[ ] Keys: API key → `TELNYX_API_KEY`; the number (+1…) → `TELNYX_FROM_NUMBER`;
    profile id → `TELNYX_MESSAGING_PROFILE_ID`; Keys & Credentials → Public Key →
    `TELNYX_PUBLIC_KEY`
[ ] Messaging profile → webhook URL `https://<your-api-host>/api/webhooks/telnyx`
    (STOP / START replies and each text's delivery status)

---

## STEP 4c — File storage (required for Bond Desk)

[ ] Supabase → Storage → create a **private** bucket `case-documents`
[ ] `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (service role key) in Render.
    Bond Desk forms, signed copies and uploaded IDs are stored here, encrypted
    with `ENCRYPTION_KEY` before upload. Without storage, uploads answer 503
    `storage_unavailable`.

---

## STEP 5 — Resend email (5 min)

[ ] resend.com → API Keys → Create → `RESEND_API_KEY`
    (without it, emails are logged to the server log instead of sent)
[ ] Domains → add `justicegavel.app` and set the DNS records it gives you —
    without domain verification mail lands in spam
[ ] Set `EMAIL_FROM` / `ALERT_EMAIL_FROM` to addresses on the verified domain

---

## STEP 6 — Google Places (3 min, optional — operator scrapers only)

[ ] console.cloud.google.com → enable Places API (New) + Geocoding API
[ ] Credentials → Create API Key → `GOOGLE_PLACES_KEY`
[ ] (Recommended) restrict the key by API; Render's outbound IPs are listed on
    the service's **Connect → Outbound** tab if you also restrict by IP

---

## STEP 7 — Sentry (5 min, optional)

[ ] Server DSN is already in render.yaml (`SENTRY_DSN`, plain value). A new
    project: sentry.io → New Project → Node.js → DSN → update `SENTRY_DSN` in render.yaml
[ ] Alerts: "first occurrence of new error" + "error rate > 10/min" → email

---

## STEP 8 — Monitoring alerts (2 min)

[ ] Slack incoming webhook → `ALERT_WEBHOOK_URL`
[ ] `ALERT_EMAIL` / `ONCALL_EMAIL` (+ `ONCALL_EMAIL_2`) for SEV-1/SEV-2 email
[ ] Uptime monitor (BetterUptime or similar) on `https://<your-api-host>/health`,
    60 s interval, alert after 2 failures

---

## STEP 9 — Render services

[ ] Render → **New → Blueprint** → connect the GitHub repo → Render reads
    `render.yaml` and shows `justice-gavel-api` and `justice-gavel-api-staging`
[ ] Fill in every `sync: false` prompt (production first; order and values:
    RUNBOOK.md → "DEPLOY (Render)" → "First deploy"). Staging's JWT /
    encryption / admin secrets are generated by Render
[ ] Add any further keys from the steps above in Render → service →
    **Environment** (Stripe later, Telnyx, VAPID, OAuth pairs, …)
[ ] Custom domain: service → Settings → Custom Domains → `api.justicegavel.app`
    → add the CNAME Render shows at your DNS provider

---

## STEP 9b — Nightly off-site backup

[ ] GitHub → repo → Settings → Secrets and variables → Actions:
    `BACKUP_DATABASE_URL` (production, Session pooler URL, read-only role
    recommended) and `BACKUP_PASSPHRASE` (long random; keep it in your password
    manager). Optional second provider: `BACKUP_S3_BUCKET` (+ endpoint / keys).
[ ] Actions → "Nightly database backup + restore drill" → **Run workflow** once;
    it must end green ("verified: row counts and provider checksums match")

---

## STEP 10 — Verify deployment

[ ] On the server (Render → Shell): `node scripts/check-env.js --launch` — every
    feature ✅ and "Environment OK"
[ ] `GET /api/admin/diagnostics/jobs` (admin login + `X-Admin-Key`) — `"ok": true`
    a day after deploy (every scheduled job ran)
[ ] Work through **docs/LIVE_TEST.md** on staging (test mode) end to end
[ ] `curl https://<your-api-host>/health` → `{"ok":true,"status":"ok","db":"ok",...}`
    with the current version string, and `features` showing which keys are live
[ ] `cd backend && node scripts/smoke-test.mjs https://<your-api-host>` — all checks pass
[ ] Stripe → Webhooks → the endpoint → "Send test webhook" → 200
[ ] Trigger `/api/auth/forgot-password` for a test account → email arrives
[ ] Sentry dashboard shows the server start (if configured)
[ ] Client IP: `GET /api/admin/diagnostics/client-ip` from your phone (admin
    login + `X-Admin-Key`) and set `TRUST_PROXY` in render.yaml to the
    `candidates[].trust_proxy` whose `ip` is your phone's public IP
    (RUNBOOK.md → "Client IP / TRUST_PROXY")

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
