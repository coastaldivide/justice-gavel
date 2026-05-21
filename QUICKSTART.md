# Justice Gavel — Quick Start Guide
## Version 5.89.11 | versionCode 5991

---

## 🗄️ Database (Current State)
| Table | Count | States | With Phone |
|---|---|---|---|
| Real Attorneys | 1,459 | 40/51 | 99% |
| Bail Agents | 884 | 39/51 | 99% |
| Recovery Agents | 555 | 48/51 | 99% |

**11 states still need real attorney data:**
DC, DE, ME, MT, ND, NH, RI, SD, VT, WV, WY

---

## 🔄 Scraper Files (run from `backend/` folder)

| File | Purpose | Runtime |
|---|---|---|
| `RUN_MISSING_STATES.bat` | **START HERE** — fills the 11 missing states only | ~30–45 min |
| `RUN_SCRAPER_WINDOWS.bat` | Full rescrape — all 530 cities | ~2.5 hrs |
| `RUN_RECOVERY_AGENTS.bat` | Recovery agents only | ~30 min |
| `RUN_BAIL_ONLY.bat` | Bail agents only | ~30 min |

**To complete the database:** double-click `RUN_MISSING_STATES.bat`
Then upload the zip here for final packaging.

---

## 🌱 Seed Data (run once after deploy)

```bash
# Full seed — attorneys, bondsmen, courts, resources, lessons, bail schedules, forum
node backend/src/scripts/seed_providers.js

# Demo data — synthetic users, arrests, forum posts, specialty courts
node backend/src/scripts/seed_demo.js
```

**What gets seeded:**
- 2,020 attorneys + 808 bondsmen (seed; replace with scrapers after deploy)
- 404 courthouses + 57 probation offices + 96 law school clinics
- 51 DUI law records + 153 drug penalty records
- 144 bail schedules (7 original states) + 129 new records (44 states) = 273 total
- 30 Know Your Rights lesson articles (arrest, DUI, expungement, immigration, juvenile, housing)
- 20 forum posts across 5 categories (AI-generated, realistic legal Q&A)
- 30 specialty courts (10 veteran, 6 drug, 10 mental health, 4 DUI)

---

## 🚀 Deployment Steps

1. Set `.env` keys (see below)
2. Deploy backend to Railway
3. Set `EXPO_PUBLIC_API_BASE=https://your-app.railway.app/api` in `frontend/.env`
4. Run `eas build --platform all`
5. Submit `.aab` to Google Play, `.ipa` to Apple App Store

---

## 🔑 Required .env Keys

| Key | Status | Powers |
|---|---|---|
| GOOGLE_PLACES_KEY | ✅ SET | Scraper (~$14 one-time) |
| JWT_SECRET | ✅ SET | Auth tokens |
| ENCRYPTION_KEY | ✅ SET | AES-256-GCM data encryption |
| ADMIN_KEY | ✅ SET | Bot admin webhook auth |
| ANTHROPIC_API_KEY | ⚠️ EMPTY | AI Chat, Motions, Research |
| STRIPE_SECRET | ⚠️ EMPTY | Payments — get from dashboard.stripe.com |
| STRIPE_WEBHOOK_SECRET | ⚠️ EMPTY | Stripe event verification |
| STRIPE_PRO_PRICE_ID | ⚠️ EMPTY | Create product in Stripe dashboard |
| STRIPE_STARTER_PRICE_ID | ⚠️ EMPTY | Create product in Stripe dashboard |
| STRIPE_ATTORNEY_PRICE_ID | ⚠️ EMPTY | Create product in Stripe dashboard |
| TWILIO_ACCOUNT_SID | ⚠️ EMPTY | SMS arrest alerts |
| TWILIO_AUTH_TOKEN | ⚠️ EMPTY | SMS verification |
| SENDGRID_API_KEY | ⚠️ EMPTY | Transactional email |
| VAPID_PUBLIC_KEY | ⚠️ EMPTY | Web push — run: npx web-push generate-vapid-keys |
| SENTRY_DSN | ⚠️ EMPTY | Error monitoring — sentry.io (free tier) |

---

## 📊 Data Completeness After v157

| Category | Records | States | Quality |
|---|---|---|---|
| Attorneys | 2,020 | 51/51 | ⚠️ Seed (run scraper to get real data) |
| Bail agents | 808 | 51/51 | ⚠️ Seed (run DOI import for verified data) |
| Courthouses | 404 | 51/51 | ✅ Verified addresses |
| Bail schedules | 273 | 51/51 | ✅ All states covered |
| Know Your Rights | 30 | national | ✅ 7 categories, legally reviewed content |
| Specialty courts | 30 | 14 states | ⚠️ Major metros covered; national expansion TODO |
| Forum posts | 20 | national | ✅ Seeded AI-generated Q&A |
| Specialty courts | 30 | major cities | ✅ Veteran, drug, mental health, DUI courts |
| DUI laws | 51 | 51/51 | ✅ Current statutes |
| Drug penalties | 153 | 51/51 | ✅ Current statutes |
| Statute of limits | 209 | 51/51 | ⚠️ 102 null records (manual fix needed) |
| Resources total | 376 | 51/51 | ✅ 9 categories |

---

## ⚖️ Innocent until proven guilty.

---

## 📋 API Documentation

| File | Contents |
|---|---|
| `openapi.json` | **OpenAPI 3.0 spec** — 439 endpoints, machine-readable, Postman-importable |
| `API_REFERENCE.md` | Human-readable API reference (23K chars) |

Import `openapi.json` into Postman: **File → Import → openapi.json**

---

## 🗂️ New in v161

- OpenAPI 3.0 spec generated (`openapi.json`) — 365 paths, 435 operations
- 11 composite DB indexes added (matters, firms, audit_log, cases, docket, subscriptions)
- Migration 043: 5 previously missing tables (recovery_agents, feedback, firm_invites, account_deletion_log, ai_jobs)
- Migration 044: Performance indexes for high-traffic query patterns
- All SELECT * queries projected or marked intentional
- SOL null record fix script in update_legal_data.js
