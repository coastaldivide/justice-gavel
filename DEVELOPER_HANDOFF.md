# Justice Gavel — Developer Handoff
**Version:** 7.2.0 | **Date:** June 2026 | **Prepared for:** Russell Allen (russelltallen@gmail.com)

---

## Project Overview

Justice Gavel is a full-stack legal technology platform serving 10 legal verticals:
criminal defense, immigration, DV/crisis, bail, white-collar, juvenile, public defense,
family, civil rights, and appellate. It is NOT a demo — it has 17,800+ test assertions,
a 100k client simulation, and is deployment-ready.

**Repository:** https://github.com/coastaldivide/justice-gavel (private)
**Live API:** https://api.justicegavel.app
**Owner:** Aaron Hart — aa.n.hart@gmail.com / +19125858137

---

## Stack

| Layer | Technology |
|-------|-----------|
| Mobile (iOS/Android/iPad) | React Native + Expo (EAS) |
| Web | react-native-web |
| Desktop | Electron (macOS/Windows/Linux) |
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL) — project: yjeplvvnlennyxixwxfq |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Email | Resend |
| Push Notifications | Expo Push |
| Error Tracking | Sentry (Express, US region) |
| Hosting | Railway (backend) |
| Payments | Stripe (not yet configured — see below) |

---

## Repository Structure

```
justice-gavel/
  backend/          Node.js/Express API
    src/
      routes/       All API endpoints (50+ route files)
      services/     Business logic (email, AI, billing)
      monitoring/   Sentry, error notifier, self-healing watchdog
      middleware/   Auth, rate limiting, circuit breaker
      db/           Database connection + migrations
    scripts/
      setup-railway.sh      — Fill in credentials and run to deploy
      verify-deployment.sh  — Run after deploy to confirm live
      check-env.js          — Validates all required env vars
  frontend/         React Native (Expo)
    src/
      screens/      77 screens across all legal verticals
      components/   Shared UI (GradientHeader, HapticButton, etc.)
      utils/        responsive.ts, webCompat.ts, retry logic
    electron/       Desktop app wrapper
  supabase/
    migrations/     Database schema migrations
```

---

## First Day Setup

```bash
# 1. Clone
git clone https://github.com/coastaldivide/justice-gavel.git
cd justice-gavel

# 2. Backend
cd backend && npm install
cp .env.required .env.local
# Fill in your local dev values in .env.local

# 3. Frontend
cd ../frontend && npm install --legacy-peer-deps

# 4. Run backend locally
cd backend && npm run dev    # starts on :4000

# 5. Run frontend
cd frontend && npx expo start
```

---

## Environment Variables

All 30 production variables are already set in Railway.
For local dev, copy backend/.env.required to .env.local and fill in values.

**Key variables:**
- `DATABASE_URL` — Supabase Transaction pooler (IPv4, port 6543)
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` — get from Supabase dashboard
- `ANTHROPIC_API_KEY` — AI features
- `RESEND_API_KEY` — email
- `SENTRY_DSN` — error tracking
- `DEMO_MODE=false` — production mode
- `JWT_SECRET` / `JWT_REFRESH_SECRET` / `ENCRYPTION_KEY` — already set in Railway

---

## Deployment

Railway auto-deploys on push to `main`. The CI pipeline runs on every PR:
- TypeScript check
- ESLint
- Jest (683 unit + 17,800 backend assertions)
- npm audit
- 12 navigation/stub scans

**To deploy manually:**
```bash
npm install -g @railway/cli
railway login
railway link   # select justice-gavel project
railway up
```

**To verify the live deployment:**
```bash
bash backend/scripts/verify-deployment.sh
```

---

## Testing

```bash
# Frontend
cd frontend && npm test

# Backend (all suites)
cd backend && node --experimental-vm-modules node_modules/.bin/jest --no-coverage

# Navigation scans (12 checks — no stubs, no dead links)
cd backend && node --experimental-vm-modules node_modules/.bin/jest src/__tests__/nav_scan.test.js

# 100k client simulation
cd backend && node --experimental-vm-modules node_modules/.bin/jest src/__tests__/simulation_100k.test.js
```

---

## What's NOT Yet Configured (add when ready)

| Feature | What's needed | Impact if missing |
|---------|--------------|-------------------|
| **Stripe** | Secret key + webhook + 7 price IDs | Subscriptions don't process. App still works, billing disabled |
| **Google Places** | API key from Google Cloud | Attorney/bondsman location search returns empty |
| **Twilio** | Removed — not in use | None. Replaced by Resend + Slack |
| **SendGrid** | Replaced by Resend | N/A |

**To add Stripe:**
1. `dashboard.stripe.com` → Developers → API Keys → copy secret key
2. Set `STRIPE_SECRET_KEY` in Railway
3. Create 4 products with monthly/annual prices → copy 7 price IDs
4. Set all `STRIPE_*_PRICE_ID` vars in Railway
5. Create webhook → `https://api.justicegavel.app/webhooks/stripe`
6. Set `STRIPE_WEBHOOK_SECRET` in Railway

---

## Monitoring & Alerts

| Event | Who gets notified |
|-------|------------------|
| SEV-1 (server down, DB unreachable) | aa.n.hart@gmail.com + russelltallen@gmail.com + Slack #jg-alerts |
| SEV-2 (AI down, payment failed) | Both emails + Slack |
| SEV-3 (elevated errors) | Sentry + Slack |
| CI failure on main | Both emails via GitHub Actions |

**Sentry:** https://sentry.io — project: justice-gavel
**Slack:** Justice-Gavel workspace → #jg-alerts

Self-healing behaviors (automatic, no action needed):
- DB reconnects with exponential backoff (5 attempts before alerting)
- Memory watchdog: GC at 512MB, restart at 600MB
- Circuit breakers auto-recover after 30s when service comes back

---

## Architecture Decisions Worth Knowing

**Why Resend instead of SendGrid?**
Twilio owns SendGrid. Twilio blocked account creation. Resend is cleaner API,
better deliverability, not owned by a carrier-compliance-heavy company.

**Why Transaction pooler for DATABASE_URL?**
Railway runs on IPv4. Supabase direct connections use IPv6. Transaction pooler
(port 6543) is IPv4-compatible and works perfectly with Railway.

**Why service_role key in backend?**
All DB access goes through our Express API. The service_role key bypasses
Supabase RLS, which is correct — RLS is enabled on all tables to block direct
client access. Backend is the only thing touching the DB directly.

**Why the legal disclaimer gate?**
Unauthorized Practice of Law (UPL) risk. Every user must accept the disclaimer
before any AI feature is accessible. Versioned consent with IP logging. This
is not optional — it's the legal protection that makes the AI features viable.

---

## Key Files to Know

| File | What it does |
|------|-------------|
| `backend/src/app.js` | Express app, all middleware, Sentry init |
| `backend/src/server.js` | Server startup, watchdogs, graceful shutdown |
| `backend/src/routes/auth.js` | Registration, login, JWT, disclaimers |
| `backend/src/routes/bail.js` | Bail calculator (no auth required) |
| `backend/src/routes/chat/` | AI legal chat (requires disclaimer) |
| `backend/src/monitoring/selfHealing.js` | Memory watchdog, DB reconnect |
| `frontend/src/navigation/AppNavigator.tsx` | All screen routing |
| `frontend/src/screens/HomeScreen.tsx` | App entry point after auth |
| `supabase/migrations/` | All database schema changes |
| `RUNBOOK.md` | Incident response procedures |

---

## Contacts

| Role | Name | Email | Phone |
|------|------|-------|-------|
| Owner | Aaron Hart | aa.n.hart@gmail.com | +19125858137 |
| Developer | Russell Allen | russelltallen@gmail.com | +16787864189 |

---

*Justice Gavel v7.2.0 — Built June 2026*

---

## Running the Data Pipeline (IMPORTANT — Do This First)

The database has the schema and RLS security in place but needs to be populated
with attorney, bail bondsman, and provider data. Run the pipeline via Railway
so it has database access.

### Quick seed (fastest — foundational data, no API calls needed)
```bash
railway run bash backend/scripts/run-all-scrapes.sh --seed-only
```
This populates all 50 states with structured foundational data in ~10 minutes.

### Full scrape (complete data — needs Google Places key)
```bash
# All 97 cities, full national scrape (~2-4 hours)
railway run bash backend/scripts/run-all-scrapes.sh

# Single state, faster (~10-20 minutes)
railway run bash backend/scripts/run-all-scrapes.sh --state TN
```

### What gets populated
| Script | Data | Time |
|--------|------|------|
| seed_providers.js | 97 cities × attorneys + bail agents (structured) | 10 min |
| import_doi_bondsmen.js | DOI licensed bondsmen database | 5 min |
| scrape_providers_national.js | Real Google Places data for all cities | 2-3 hr |
| scrape_recovery_agents.js | Bail enforcement / recovery agents | 20 min |
| update_legal_data.js | DUI laws, expungement rules, victim comp | 5 min |
| scrape_state_bars.js | Verified licensed attorneys from state bars | 1-2 hr |

### Run order matters
Always run in this order: seed → DOI import → national scrape → state bars

### Verify data is loaded
```bash
# Check record counts in Supabase
# Go to: supabase.com → Table Editor → attorneys, bail_agents tables
# Should show thousands of records after full scrape
```

### Scheduled refresh
The health scan cron runs twice daily (6am + 6pm CT) and auto-refreshes
stale provider data. Once the initial seed is complete, it maintains itself.
HEALTH_SCAN_CRON=0 6,18 * * *  (already set in Railway)
