# Justice Gavel — External Services Setup
### The complete checklist for everything the app needs from the outside world

> **How it works:** every external service is gated on its own API key. With a
> key absent, that one feature degrades gracefully (a "feature disabled" line
> is logged at boot) and everything else keeps working. Full variable
> reference: [RAILWAY_ENV_SETUP.md](./RAILWAY_ENV_SETUP.md).

---

## Behaviour without keys

| Service | Behavior while the key is absent |
|---|---|
| Stripe | Every billing endpoint returns `503 payments_unavailable`; the app shows "Payments are not available yet". Setting the keys re-enables payments automatically. |
| Resend (email) | Emails are logged to the server log. Never sent. |
| Expo Push | Push tokens accepted and stored. Delivery logged only. |
| AI (Anthropic) | AI endpoints return `503 ai_unavailable` — key required for AI features. |
| Google Places | Fallback search returns empty results with a warning log. |
| Integrations (Clio, etc.) | Demo data returned. No live API calls. |
| Redis | AI jobs run in-process instead of BullMQ. |

There is no payment/email "demo bypass": features are off until their real
keys exist. `LIVE_REFRESH=true` is the one activation flag that matters
operationally — it enables the nightly scheduler.

---

## 🔴 CRITICAL — Must have before launch (app broken without these)

### 1. JWT_SECRET + ENCRYPTION_KEY
```bash
# Generate both locally — never share or commit these values
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → ENCRYPTION_KEY
openssl rand -hex 32   # → ADMIN_KEY
```
`JWT_SECRET` signs every auth token. `ENCRYPTION_KEY` encrypts case notes and
attorney-client messages with AES-256-GCM. `ADMIN_KEY` protects `/api/admin/*`.

These are generated once and never change. Changing `ENCRYPTION_KEY` after
data is encrypted makes all existing encrypted data unreadable — treat it like
a master password.

```env
JWT_SECRET=<64-char hex>
ENCRYPTION_KEY=<64-char hex>
ADMIN_KEY=<64-char hex>
JWT_EXPIRES_IN=30d
```

---

### 2. Anthropic API
The AI legal assistant, legal research, contract review, discovery analysis,
privilege log generation, and signal explanations all require this key.

**Steps:**
1. Go to `console.anthropic.com`
2. Sign in → API Keys → Create Key
3. Copy the key (shown once — save it immediately)

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Cost:** Pay-per-token. The app uses Claude Sonnet 4.6 by default.
Moderate usage (active firm with AI features): $15–75/month.
Set `AI_CONCURRENCY=4` to limit parallel requests if costs run high.

---

### 3. Stripe
Subscription billing for all three user types: firms, attorneys, consumers.

**Steps:**
1. `dashboard.stripe.com` → Developers → API Keys
2. Copy Secret Key (`sk_live_...` for prod, `sk_test_...` for testing)
3. Create Products and Prices in Stripe dashboard:

| Product | Billing | Env var |
|---|---|---|
| Starter Plan | Monthly | `STRIPE_ADVISOR_PRICE_ID` |
| Starter Plan | Annual | `STRIPE_ADVISOR_ANNUAL_ID` |
| Pro Plan | Monthly | `STRIPE_LEGAL_PRO_PRICE_ID` |
| Pro Plan | Annual | `STRIPE_LEGAL_PRO_ANNUAL_ID` |
| Attorney Plan | Monthly | `STRIPE_ESQUIRE_PRICE_ID` |
| Attorney Plan | Annual | `STRIPE_ESQUIRE_ANNUAL_ID` |
| Legal Radar | Monthly | `STRIPE_LEGAL_RADAR_ID` |

4. Set up Stripe Webhook:
   - `dashboard.stripe.com` → Webhooks → Add endpoint
   - URL: `https://yourdomain.com/webhooks/stripe`
   - Events to listen for: `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.payment_failed`, `invoice.payment_succeeded`
   - Copy Signing Secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

```env
STRIPE_SECRET_KEY=sk_live_...        # STRIPE_SECRET accepted as alias
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_ADVISOR_PRICE_ID=price_...
STRIPE_LEGAL_PRO_PRICE_ID=price_...
STRIPE_ESQUIRE_PRICE_ID=price_...
STRIPE_ADVISOR_ANNUAL_ID=price_...
STRIPE_LEGAL_PRO_ANNUAL_ID=price_...
STRIPE_ESQUIRE_ANNUAL_ID=price_...
STRIPE_LEGAL_RADAR_ID=price_...
STRIPE_SUCCESS_URL=https://yourdomain.com/success
STRIPE_CANCEL_URL=https://yourdomain.com/cancel
```

Until these are set, billing deliberately returns `503 payments_unavailable`
— the rest of the app is unaffected.

**Cost:** 2.9% + 30¢ per successful charge. No monthly fee.

---

## 🟠 IMPORTANT — Major features missing without these

### 4. Resend (Email)
Transactional email for: welcome messages, password resets, ToS acceptance
confirmations, subscription lapse notices, health scan CRITICAL alerts,
attorney match notifications, ops alerts. Without the key, every email is
logged instead of sent.

**Steps:**
1. `resend.com` → API Keys → Create API Key
2. **Verify the sender domain:** Domains → add `justicegavel.app` and set the
   DNS records it gives you (without this, emails go to spam)

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=noreply@justicegavel.app
ALERT_EMAIL_FROM=alerts@justicegavel.app
ADMIN_ALERT_EMAIL=admin@yourfirm.com
```

**Cost:** Free: 3,000 emails/mo. Pro: $20/mo for 50,000/mo.

> **SMS:** no SMS provider is wired up — the SMS senders in the code are
> no-op stubs and `ADMIN_ALERT_SMS` is informational. Critical alerts go out
> via email + the Slack webhook (`ALERT_WEBHOOK_URL`).

---

### 6. Expo Push Notifications (iOS + Android)
Every push alert on iOS and Android goes through Expo's push gateway.
This powers all attorney alerts: asylum bar, plea expiry, VOP compound,
health scan findings, escalation SLA.

**Steps:**
1. `expo.dev` → Sign in → Account → Access Tokens → Create Token
2. Name it `justice-gavel-push-production`
3. For iOS: `eas credentials --platform ios` → set up APNs key
4. For Android: `eas credentials --platform android` → upload FCM key
   (`console.firebase.google.com` → Project Settings → Cloud Messaging → Server Key)

```env
EXPO_ACCESS_TOKEN=eas_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Cost:** Free for up to 1 million notifications/month.

---

### 7. Google Places API
Attorney and bail bondsman location search, geocoding for address-based matching.

**Steps:**
1. `console.cloud.google.com` → Select/create project
2. APIs & Services → Library → Enable: **Places API (New)**, **Geocoding API**
3. APIs & Services → Credentials → Create API Key
4. Optional but recommended: Restrict the key to your server's IP

```env
GOOGLE_PLACES_KEY=AIzaSy...
```

**Cost:** $17 per 1,000 Place Search requests. Google gives $200/mo free credit
(~11,700 searches/month free).

---

### 8. Sentry (Error Monitoring)
Backend error tracking and React Native crash reporting.

**Steps:**
1. `sentry.io` → New Project → **Node.js** → copy DSN for backend
2. `sentry.io` → New Project → **React Native** → copy DSN for mobile
   (Can use the same DSN or separate projects for clearer separation)
3. In Sentry: set up Alerts → notify on first occurrence of new errors

```env
SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/456789
```

**Cost:** Free tier: 5,000 errors/month. Team: $26/month.

---

### 9. VAPID Web Push (Browser + Desktop push)
Push notifications for attorneys using the web app or Electron desktop.
Generated locally — no external account needed.

**Steps:**
```bash
# Run once in the backend directory
npm install web-push
npx web-push generate-vapid-keys

# Output:
# Public Key: BIxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Private Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```env
VAPID_PUBLIC_KEY=BIxxxxx...
VAPID_PRIVATE_KEY=xxxxx...
VAPID_EMAIL=admin@justicegavel.app
```

The frontend registers with the browser's `PushManager` using the public key.
No external service — uses the W3C Web Push standard directly.

**Cost:** Free.

---

## 🔵 INTEGRATION — Add when ready (runs in demo mode until then)

All integrations work fully in demo mode before credentials are added.
Firms connecting them will go through an in-app OAuth flow — no server restart needed.

### 10. Clio Manage
```
Register: app.clio.com/settings/developer_applications → New Application
Redirect URI: https://yourdomain.com/api/integrations/oauth/callback
```
```env
CLIO_CLIENT_ID=...
CLIO_CLIENT_SECRET=...
```

### 11. Google Calendar
```
Register: console.cloud.google.com → OAuth2 → Create OAuth client ID → Web Application
Authorized redirect: https://yourdomain.com/api/integrations/oauth/callback
Scopes: https://www.googleapis.com/auth/calendar.events
```
```env
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
```

### 12. Microsoft Outlook / Exchange
```
Register: portal.azure.com → App Registrations → New Registration
Redirect URI: https://yourdomain.com/api/integrations/oauth/callback
API permissions: Calendars.ReadWrite, offline_access
```
```env
OUTLOOK_CLIENT_ID=...          # This is the Application (client) ID
OUTLOOK_CLIENT_SECRET=...      # Certificates & secrets → New client secret
```

### 13. CourtListener (RECAP + Precedent Monitoring)
```
Register: courtlistener.com/sign-in → Profile → API Token
```
```env
COURTLISTENER_TOKEN=...
COURTLISTENER_ENABLED=true
```
Without the token, anonymous access works at 5,000 requests/day. Free.

### 14. iManage Work
```
Register: docs.imanage.com/api → Register OAuth App
Redirect URI: https://yourdomain.com/api/integrations/oauth/callback
```
```env
IMANAGE_CLIENT_ID=...
IMANAGE_CLIENT_SECRET=...
```

### 15. PracticePanther + MyCase
```
PracticePanther: practicepanther.com/api → Developer Settings
MyCase: app.mycase.com/api → Developer Settings
Both: Redirect URI: https://yourdomain.com/api/integrations/oauth/callback
```
```env
PRACTICEPANTHER_CLIENT_ID=...
PRACTICEPANTHER_CLIENT_SECRET=...
MYCASE_CLIENT_ID=...
MYCASE_CLIENT_SECRET=...
```

---

## ⚪ OPTIONAL

### PostgreSQL — **required in production** (listed here only because it's
"external"). The server refuses to start in production without `DATABASE_URL`;
the in-memory SQLite fallback exists for local development only. Apply
`supabase/migrations/*.sql` in filename order with psql before first boot.

```
Railway: railway.app → New Project → PostgreSQL → Connect
Supabase: supabase.com → New Project → Settings → Database → Connection string
```
```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname   # POSTGRES_URL accepted as alias
```

### Yelp (attorney/bondsman ratings)
```
Register: fusion.yelp.com/v3 → Manage App → API Key
```
```env
YELP_API_KEY=...
```

### OpenAI (AI redundancy fallback)
```env
OPENAI_API_KEY=sk-...
```

---

## Deployment: Required env vars summary

Copy this block into your Railway / Fly.io / Heroku environment:

```
# ── Security (generate all four with: openssl rand -hex 32) ──
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=
ADMIN_KEY=
JWT_EXPIRES_IN=30d

# ── App ──
NODE_ENV=production
DATABASE_URL=
BASE_URL=https://api.yourdomain.com
APP_URL=https://yourdomain.com
CORS_ORIGIN=https://yourdomain.com
APP_OAUTH_REDIRECT=https://yourdomain.com/settings/integrations

# ── AI ──
ANTHROPIC_API_KEY=

# ── Payments (optional — billing returns 503 payments_unavailable until set) ──
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_ADVISOR_PRICE_ID=
STRIPE_LEGAL_PRO_PRICE_ID=
STRIPE_ESQUIRE_PRICE_ID=
STRIPE_ADVISOR_ANNUAL_ID=
STRIPE_LEGAL_PRO_ANNUAL_ID=
STRIPE_ESQUIRE_ANNUAL_ID=
STRIPE_LEGAL_RADAR_ID=
STRIPE_SUCCESS_URL=https://yourdomain.com/success
STRIPE_CANCEL_URL=https://yourdomain.com/cancel

# ── Email (Resend) ──
RESEND_API_KEY=
EMAIL_FROM=noreply@yourdomain.com
ALERT_EMAIL_FROM=alerts@yourdomain.com
ADMIN_ALERT_EMAIL=admin@yourfirm.com

# ── Push (mobile) ──
EXPO_ACCESS_TOKEN=

# ── Push (web/desktop) ──
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_EMAIL=admin@yourdomain.com

# ── Maps ──
GOOGLE_PLACES_KEY=

# ── Monitoring ──
SENTRY_DSN=

# ── Health scan ──
HEALTH_SCAN_CRON=0 6,18 * * *
REFRESH_TZ=America/Chicago
SCAN_QUIET=false
LIVE_REFRESH=true

# ── CourtListener ──
COURTLISTENER_ENABLED=true
COURTLISTENER_TOKEN=

# ── Demo mode ──
DEMO_MODE=false
```

---

## Electron Desktop: additional steps

### macOS DMG
```bash
cd frontend
npm run electron:build
# Output: electron-dist/Justice Gavel-<version>.dmg (version from frontend/package.json)
```
Requires: macOS or CI with macOS runner. For notarization (required for Gatekeeper):
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` in env.

### Windows Installer
```bash
npm run electron:build -- --win
# Output: electron-dist/Justice Gavel Setup <version>.exe
```
For code signing: EV certificate from DigiCert or Sectigo (~$300/year).
Without signing: Windows SmartScreen shows a warning on first run.

### Auto-updater (GitHub Releases)
1. Create a GitHub repository for desktop releases
2. Add to package.json `build.publish`: `{ "provider": "github", "owner": "your-org", "repo": "desktop" }`
3. Set `GH_TOKEN` env var to a GitHub personal access token with `repo` scope
4. `electron-updater` will check for new releases on every app launch

---

## iOS + Android: EAS Build

```bash
# Install EAS CLI
npm install -g eas-cli
eas login

# Configure credentials
eas credentials --platform ios     # APNs key, provisioning profiles
eas credentials --platform android # Upload key, FCM key

# Build
eas build --platform ios --profile production
eas build --platform android --profile production

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

App Store: requires Apple Developer Program ($99/year).
Google Play: requires Google Play Developer account ($25 one-time).

---

*Last verified against the code: October 2026 — v8.7.60.*
*Update this document when adding new external services.*
