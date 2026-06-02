# Railway Deployment Checklist — Justice Gavel

Run through this top to bottom. Each section has a ✅ when done.
The entire setup takes about 45 minutes.

---

## STEP 1 — Generate Secrets (already done ✅)

These were generated and are pre-filled in `setup-railway.sh`:

| Secret | Value |
|--------|-------|
| JWT_SECRET | `cf572f238accb8a37194b3d2a110412789c308639765511fe1b59ec2df2c67e0` |
| JWT_REFRESH_SECRET | `ce0315eb76f661cd6b4a03f766f20234edac427786eb3ca09fa7d9004f68ec41` |
| ENCRYPTION_KEY | `0c9a3213ff36a3c1170a81756532a1dcdef7031d9c38e533b1d9b23136ed4b12` |
| ADMIN_KEY | `d9f53ea794ee9b62adc6d37c7e62056e664a41f3dac1ce5fe24caa7118a14dff` |
| VAPID_PUBLIC_KEY | `8v9AfIU9KFaNO_7wpyurO9ySJrQ-z76TMQ7FW1nQOlgHvH-Ts9QzOFHdly4VMNn_Rhq6KkYLINX4kT8UVoGABw` |
| VAPID_PRIVATE_KEY | `tHETLTl0KZjBIDJmiUfmMjN5NClLCIN-DYgD80nx7rQ` |

> ⚠️  Save these somewhere secure (password manager). Losing ENCRYPTION_KEY
> makes all encrypted data permanently unreadable.

---

## STEP 2 — Supabase (5 min)

[ ] Go to supabase.com → your project `yjeplvvnlennyxixwxfq`
[ ] Settings → API → copy these 3 values into setup-railway.sh:
    - `SUPABASE_ANON_KEY`    (anon / public)
    - `SUPABASE_SERVICE_KEY` (service_role / secret)
[ ] Settings → Database → Connection string → **Transaction** mode
    - Copy into `DATABASE_URL`
[ ] Run migrations: `node src/db/migrate.js` (or push to Railway and it auto-runs)

---

## STEP 3 — Anthropic (2 min)

[ ] Go to console.anthropic.com
[ ] API Keys → Create Key → copy into `ANTHROPIC_API_KEY`
[ ] ⚠️  This is the only service with NO demo fallback — required for AI features

---

## STEP 4 — Stripe (15 min)

[ ] dashboard.stripe.com → Developers → API Keys
    - Copy Secret Key (`sk_live_...`) → `STRIPE_SECRET_KEY`
[ ] Create Products in Stripe dashboard:

| Plan | Billing | Monthly Price | Annual Price |
|------|---------|---------------|--------------|
| Legal Radar | One-time or monthly | $19.99 | — |
| Advisor | Monthly | $24.99 | $199/yr |
| Legal Pro | Monthly | $34.99 | $299/yr |
| Esquire | Monthly | $49.00 | $410/yr |

[ ] For each product, copy the `price_...` ID into setup-railway.sh
[ ] Set up Webhook:
    - Webhooks → Add endpoint
    - URL: `https://api.justicegavel.app/webhooks/stripe`
    - Events: `checkout.session.completed`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `invoice.payment_failed`,
      `invoice.payment_succeeded`
    - Copy Signing Secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

---

## STEP 5 — SendGrid (5 min)

[ ] app.sendgrid.com → Settings → API Keys → Create → Full Access
    Copy → `SENDGRID_API_KEY`
[ ] Settings → Sender Authentication → Domain Authentication
    - Domain: `justicegavel.app`
    - Add the 3 DNS records it gives you (takes 5 min in your DNS provider)
    - Without this, ALL emails go to spam

---

## STEP 6 — Twilio (5 min)

[ ] console.twilio.com → Account Info
    - Copy Account SID → `TWILIO_ACCOUNT_SID`
    - Copy Auth Token → `TWILIO_AUTH_TOKEN`
[ ] Phone Numbers → Buy a Number (local Tennessee number recommended)
    Copy → `TWILIO_FROM_NUMBER`
[ ] For production: Messaging → Senders → A2P 10DLC Registration
    (Takes 1-2 days, required by US carriers for business SMS)

---

## STEP 7 — Google Places (3 min)

[ ] console.cloud.google.com
[ ] APIs & Services → Library → Enable:
    - Places API (New)
    - Geocoding API
[ ] Credentials → Create API Key
    Copy → `GOOGLE_PLACES_KEY`
[ ] (Recommended) Restrict key to your Railway server IP

---

## STEP 8 — Sentry (5 min)

[ ] sentry.io → New Project → Node.js
    Copy DSN → `SENTRY_DSN`
[ ] In Sentry: Alerts → Create Alert Rule
    - "First occurrence of new error" → email notification
    - "Error rate > 10/min" → email notification

---

## STEP 9 — Monitoring Alerts (2 min)

[ ] Create Slack incoming webhook:
    - api.slack.com/apps → Create App → Incoming Webhooks
    - Add to workspace → copy URL → `ALERT_WEBHOOK_URL`
[ ] Set `ONCALL_PHONE` to your mobile number (receives SEV-1 SMS alerts only)
[ ] Set up BetterUptime (betteruptime.com):
    - New monitor → `https://api.justicegavel.app/health`
    - Check every 60 seconds
    - Alert via email + SMS on failure

---

## STEP 10 — Run setup-railway.sh

[ ] Fill in all values in `setup-railway.sh`
[ ] Install Railway CLI: `npm install -g @railway/cli`
[ ] `railway login`
[ ] `railway link` (select the justice-gavel project)
[ ] `bash scripts/setup-railway.sh`

---

## STEP 11 — Verify deployment

[ ] `curl https://api.justicegavel.app/health` → should return `{"status":"healthy"}`
[ ] `curl https://api.justicegavel.app/health` → check `jwt_secure: true`
[ ] Test Stripe webhook: `stripe trigger invoice.payment_succeeded` (Stripe CLI)
[ ] Send yourself a test email via the /api/auth/forgot-password endpoint
[ ] Check Sentry dashboard — should show the server starting

---

## STEP 12 — Go live

[ ] `DEMO_MODE=false` (set in setup-railway.sh already)
[ ] `LIVE_PAYMENTS=true`
[ ] `LIVE_EMAIL=true`
[ ] `LIVE_SMS=true`
[ ] Run health check one more time
[ ] 🚀 Ship it

---

## Optional integrations (add later)

- `COURTLISTENER_TOKEN` — RECAP federal docket monitoring
- `CLIO_CLIENT_ID` / `CLIO_CLIENT_SECRET` — Clio Manage integration
- `GOOGLE_CALENDAR_CLIENT_ID` — Calendar sync
- `OPENAI_API_KEY` — AI fallback if Anthropic is down

---

*Checklist generated for Justice Gavel v6.9.0*
