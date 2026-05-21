# Justice Gavel — Data & Feature TODO
**Last updated: v1.8.71 | versionCode 87**
**Status: Framework complete. Awaiting real data via production scrapers.**

---

## 🔴 PRIORITY 1 — Do With Google Places API (~$14 total)
*Run once from production server with `GOOGLE_PLACES_KEY` set in `.env`*

### 1A. Real Attorney Data ⚠ (requires production server + GOOGLE_PLACES_KEY — KEY IS SET)
```bash
node backend/src/scripts/scrape_providers_national.js
```
- Pulls from Google Places: "criminal defense attorney [city]" × 404 cities
- Real phone numbers, real hours, real photos, real ratings
- Cost: ~$0.017/call × 808 calls = **~$14 total**
- Result: `bar_verified` attorneys with real contact info

### 1B. Real Bail Bondsman Data ⚠ (requires production server — same scraper run as 1A)
```bash
node backend/src/scripts/scrape_providers_national.js --type bail
```
- Pulls from Google Places: "bail bonds [city]" × 404 cities
- Real phones (24/7 lines), real addresses, payment plan info
- Bundled in same ~$14 run above

### 1C. Geocoding Gaps (any future new cities)
- Use Google Geocoding API for exact lat/lng vs. city centroid
- Cost: $0.005/call — negligible

---

## 🔴 PRIORITY 2 — Real Bar Data (Free, needs non-datacenter IP)
*Run from VPS or local machine — government sites block AWS/GCP*

### 2A. State Bar Scraper ⚠ (free, requires non-datacenter IP — run locally)
```bash
node backend/src/scripts/scrape_state_bars.js --state all
```
- Pulls real licensed attorneys from state bar public directories
- Sets `bar_verified=1`, real bar numbers, real contact info
- **Cost: $0** — public government data
- Runtime: 2-4 hours (rate-limited to be respectful)
- Requirement: Non-datacenter IP (run locally or from residential VPS)

### 2B. DOI Bondsman Import ⚠ (free, public data — TN/TX/FL links in TODO)
```bash
# Download state DOI exports, then:
node backend/src/scripts/import_doi_bondsmen.js --file tn_producers.txt --state TN
node backend/src/scripts/import_doi_bondsmen.js --file tx_bail.csv --state TX
node backend/src/scripts/import_doi_bondsmen.js --file fl_bail.csv --state FL
```
- Tennessee DOI: https://www.tn.gov/content/dam/tn/commerce/documents/insurance/data-call/producer_license_extract.txt
- Texas TDI: https://www.tdi.texas.gov/agent/agentlookup.html
- Florida: https://www.myfloridacfo.com/division/agents/
- **Cost: $0** — public government data
- Sets `source='doi_import'`, `verified=1`

---

## 🟡 PRIORITY 3 — Complete Without Any API (next session)

### 3A. Bail Schedules — 44 Remaining States ✅
- ✅ Now: ALL 51 states covered — 273 total records in seed_providers.js
- Need: 44 more state-specific schedules
- Source: State criminal codes (all public)
- Pattern: 8-12 charges per state × 44 states = ~440 records
- **Same approach as current TN/CA/TX data — just more states**

### 3B. SOL Null Records — fix script added to update_legal_data.js ⚠ (run against production DB)
- 102 records have `years = NULL`
- Need: year values for all 5 crime types × 51 states
- Source: State criminal codes

### 3C. Language Tags ✅ (Mandarin/Korean/Tagalog/Arabic/Spanish/Vietnamese/Portuguese — demographic-aware)
- Missing: Mandarin, Korean, Tagalog, Arabic
- Method: Census demographic data (same as Spanish tags)
- Target cities:
  - Mandarin: LA, SF, NYC, Houston, Seattle, Boston
  - Korean: LA, NYC, Atlanta, Seattle, Chicago
  - Tagalog: LA, SF, San Diego, Seattle, Honolulu, Las Vegas
  - Arabic: Dearborn MI, LA, NYC, Chicago, Houston
- ~50-80 attorney tags to add

### 3D. Missing Specialties ✅ (DUI Specialist/Sex Crimes/Weapons/Wrongful Conviction/Cybercrime/Federal Tax)
- Add to relevant attorneys:
  - "Sex Crimes Defense" — criminal defense specialists in major cities
  - "Weapons Charges" — military cities + high-gun-crime cities
  - "DUI Specialist" — all DUI hotspot cities (already identified)
  - "Wrongful Conviction" — cities with law school Innocence Projects
  - "Cybercrime" — tech hub cities (SF, Seattle, Austin, NYC, Boston)
  - "White Collar" / "Federal Tax" — financial centers

### 3E. Lessons — 30 More Articles ✅
- ✅ Now: 30 new articles added to seed_providers.js (7 categories: arrest, DUI, expungement, immigration, juvenile, housing, civil)
- Target: 50 articles
- Missing topics:
  - State-specific rights cards (CA, TX, FL, NY, TN)
  - Veterans' courts and UCMJ
  - Mental health holds (5150 / Baker Act by state)
  - Restraining orders / protective orders
  - Bail hearing strategy (what to say, what to wear)
  - How to read a charging document
  - Victim impact statements
  - Diversion programs by state
  - Record sealing vs. expungement (state by state)
  - Sex offender registry requirements
  - Asset forfeiture
  - Civil liability after criminal charges

### 3F. CourtLocatorScreen.tsx ✅ (11,577 chars, wired, in navigator)
- 404 courthouse records exist in `courthouses` table
- No frontend screen consumes them
- Should show: map pin, name, address, phone, hours, directions button
- Wire to HelpNowScreen as "Find Courthouse" button

### 3G. BailCalculatorScreen.tsx ✅ (13,724 chars, calls /legaldata/bail)
- `bail_schedules` table has 144 records
- No frontend screen shows bail ranges by charge
- Should: Select state + charge → show typical bail range + bondsman cost

### 3H. Probation Offices API Endpoint ✅
- Table `probation_offices` has 57 records
- ✅ Added: `"probation": { table: "probation_offices", stateCol: "state" }`
- Add: `"probation": { table: "probation_offices", stateCol: "state" }`

### 3I. HelpNowScreen Enhancement ✅
- ✅ Already queries courthouse, public_defender, crisis_line. Added "Find Courthouses Near You →" button to CourtLocatorScreen.
- Should also show (data exists):
  - Local courthouse (from `courthouses` table by city)
  - Local public defender (from `resources` WHERE category='PUBLIC_DEFENDER')
  - Nearest drug treatment (from `resources` WHERE category='TREATMENT')
  - 24/7 crisis lines (from `resources` WHERE category='CRISIS_LINE')

### 3J. Forum Seed Posts ✅
- ✅ forum_posts table created + 20 posts seeded across 5 categories in seed_demo.js
- Empty forum looks dead to first users
- Seed with 20-30 common legal questions + AI-generated helpful answers
- Categories: DUI, Drug Charges, Assault, Bail, Rights

### 3K. Specialty Courts — Veterans & Drug Courts ✅
- ✅ specialty_courts table created + 30 courts seeded (10 veteran, 6 drug, 10 mental health, 4 DUI)
- Drug Courts: 3,000+ nationwide
- Mental Health Courts: 300+ nationwide
- These handle cases BEFORE regular courts and are valuable to know about
- Add as new `specialty_courts` table or to `resources`

### 3L. Arrest Monitor ✅ (10 demo arrests in seed_demo.js)
- `scrape_arrests.js` pulls from PD public records (real data)
- Demo mode needs synthetic recent arrest data for screenshots/testing
- Build: `seed_arrests.js` with realistic demo data for 10 major cities

---

## 🟢 PRIORITY 4 — Post-Launch Enhancements

### 4A. Attorney Claiming Flow ✅ CODE COMPLETE — needs TWILIO + SENDGRID keys
- Outbound bot (`outbound_bot.js`) already built
- Needs: Production SendGrid + Twilio keys
- When attorney receives lead → auto-text/email with claim link
- Attorney signs up, verifies bar number, upgrades profile

### 4B. Real Review System ✅ CODE COMPLETE — needs real users
- Users can currently submit reviews (route exists)
- Needs: First real users using the app and leaving reviews
- No code gap — data gap only

### 4C. Court Date Integration ✅ PARTIAL — manual entry works; county e-filing API is county-specific
- Users can set court dates in cases
- Potential: Pull actual court date from county e-filing system
- Requires: County-by-county court API (varies wildly)

### 4D. Push Notification Triggers ✅ CODE COMPLETE — needs EXPO_ACCESS_TOKEN + real users
- Infrastructure built (pushDelivery.js)
- Needs: Real users with real court dates for deadline reminders
- Add: 7-day DMV hearing reminder for DUI arrests

### 4E. Stripe Subscription Activation ✅ CODE COMPLETE — needs STRIPE_SECRET + price IDs
- Billing route built, Stripe webhook configured
- Needs: `STRIPE_SECRET` in production .env
- Subscription tiers already defined in DB

### 4F. ANTHROPIC_API_KEY ✅ CODE COMPLETE — needs API key only
- AI features (chat, motion generation, research) all need this
- All AI calls route through the aiQueue with job fallback
- No code gap — configuration only

---

## 📋 ENVIRONMENT CHECKLIST (Production Launch)
```
ANTHROPIC_API_KEY=         # AI chat, motions, research
GOOGLE_PLACES_KEY=         # Attorney/bondsman scraping (~$14 one-time)
STRIPE_SECRET=             # Subscription payments
TWILIO_ACCOUNT_SID=        # SMS alerts (outbound bot, arrest monitor)
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
SENDGRID_API_KEY=          # Email notifications
JWT_SECRET=                # Auth tokens (generate: openssl rand -hex 32)
LIVE_REFRESH=true          # Enables nightly data refresh scheduler
NODE_ENV=production
PORT=3000
```

---

## 📊 DATA COMPLETENESS SCORECARD

| Category | Records | States | Quality |
|---|---|---|---|
| Attorneys | 2,020 | 51/51 | ⚠️ Seed (needs real data) |
| Bail agents | 808 | 51/51 | ⚠️ Seed (needs DOI import) |
| Courthouses | 404 | 51/51 | ✅ Verified addresses |
| Public defenders | 51 | 51/51 | ✅ Real offices |
| Legal aid orgs | 93 | 51/51 | ✅ LSC verified |
| Probation offices | 57 | 51/51 | ✅ Real offices |
| Federal courts | 89 | 51/51 | ✅ PACER-sourced |
| Law school clinics | 96 | 50/51 | ✅ ABA-verified |
| DUI laws | 51 | 51/51 | ✅ Current statutes |
| Drug penalties | 153 | 51/51 | ✅ Current statutes |
| Bail schedules | 144 | 7/51 | ⚠️ 44 states missing |
| Statute of limits | 209 | 51/51 | ⚠️ 102 null records |
| Victim compensation | 51 | 51/51 | ✅ Real programs |
| DV shelters | 52 | 51/51 | ✅ Real coalitions |
| Immigration courts | 44 | nationwide | ✅ EOIR verified |
| Treatment helplines | 38 | 51/51 | ✅ SAMHSA sourced |
| Expungement programs | 17 | partial | ⚠️ Needs expansion |
| Inmate lookup URLs | 42 | major counties | ⚠️ Not all counties |
| Lessons | 20 | national | ⚠️ Target: 50 |
| Resources total | 376 | 51/51 | ✅ 9 categories |

---

## 🎯 ONE-DAY LAUNCH CHECKLIST
1. ☐ Set all ENV vars on production server
2. ☐ Run `node src/scripts/scrape_state_bars.js --state all` (4 hrs, free)
3. ☐ Run `node src/scripts/scrape_providers_national.js` ($14, 2 hrs)
4. ☐ Import TN/TX/FL DOI bail bondsman files (30 min, free)
5. ☐ Verify AI responses in chat (`curl /api/chat`)
6. ☐ Test one Stripe subscription payment
7. ☐ Submit to Apple App Store + Google Play Store
8. ☐ Set up Wyoming LLC EIN (already registered per earlier session)
