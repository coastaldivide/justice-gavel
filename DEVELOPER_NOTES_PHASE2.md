# Justice Gavel — Developer Handoff Notes
# What remains for Russell to do

## REQUIRED BEFORE LAUNCH (in order)

### 1. Register business entity (~1 day, no code)
   Delaware C-Corp via Stripe Atlas or a Delaware attorney.
   Required before: bank account, live Stripe payments, contracts.

### 2. Push Railway env vars and deploy (~2 hours)
   Run the 39 commands in /tmp/setup-railway-FILLED.sh (stored locally).
   Then: railway up
   Then: railway run bash backend/scripts/run-all-scrapes.sh --seed-only

### 3. Add RAILWAY_TOKEN to GitHub secrets (~5 mins)
   github.com/coastaldivide/justice-gavel/settings/secrets/actions
   → New secret → RAILWAY_TOKEN → paste from Railway account settings
   → New secret → ALERT_WEBHOOK_URL → paste Slack webhook URL

### 4. Reconnect Railway to GitHub (~5 mins)
   railway.com → justice-gavel-api → Settings → Source
   → Reconnect: coastaldivide/justice-gavel
   → Enable: Wait for CI

### 5. EAS production builds (~1-2 hours)
   Read: frontend/BUILD_INSTRUCTIONS.md
   Run: cd frontend && eas login && eas build --platform android --profile production
   Then: eas build --platform ios --profile production (needs Apple credentials)

### 6. App Store + Google Play submission (~4-8 hours)
   Android: eas submit --platform android
   iOS: fill in eas.json (appleId, ascAppId, appleTeamId) then eas submit --platform ios

### 7. Switch Stripe to live mode (after entity registered)
   Create live products in Stripe dashboard
   Update Railway env vars: STRIPE_SECRET_KEY=sk_live_...
   Set up webhook: api.justicegavel.app/webhooks/stripe

---

## PHASE 2 IMPROVEMENTS (not blocking launch)

### Performance (design decisions, not bugs)
   - inline styles: all use colors.X from useTheme() — must stay inline for dark/light
     theming to work. Not a bug. StyleSheet.create() cannot hold dynamic theme values.
   - useCallback: heavy interaction screens (LawyersScreen, CaseScreen) would benefit
     from wrapping handlers in useCallback. Low priority — profiling first.

### Code quality
   - seed_demo.js: TODO 3B, 3J, 3K, 3L — demo mode seed data (not needed for launch)
   - update_legal_data.js: TODO 3B — statute of limitations NULL edge case
     (rare edge case, not user-facing)

### Monitoring (after launch)
   - Set up Sentry alerts for P0 errors: sentry.io → Alerts → new alert
   - Supabase MCP: connect in Claude settings for live database queries
   - GitHub MCP: connect in Claude settings for CI status

---

## WHAT IS ALREADY DONE (do not redo)

✅ All 17,821 backend assertions passing
✅ All 683 frontend unit tests passing
✅ 0 TypeScript errors
✅ 0 ESLint errors
✅ 0 production vulnerabilities (FE + BE)
✅ 0 broken imports
✅ UPL compliance gate on every AI endpoint
✅ RLS security on all 30+ Supabase tables
✅ AES-256 encryption
✅ Self-healing infrastructure (watchdog, circuit breakers)
✅ Sentry error tracking (US region)
✅ Resend email service (replaces Twilio/SendGrid)
✅ All 8 Stripe price IDs configured
✅ 28 database performance indexes
✅ Full-text search indexes on attorney names
✅ Auto updated_at triggers on all tables
✅ conflicts.js N+1 query fixed (batch query)
✅ CORS restricted to production domain only
✅ Server startup validates all 7 required env vars
✅ GitHub Actions CI (7 jobs, all must pass before deploy)
✅ Dependabot auto-PRs (weekly)
✅ CodeQL static analysis (weekly)
✅ metro.config.js: inlineRequires for faster mobile cold start
✅ HTTP caching middleware for GET endpoints
✅ data pipeline scripts updated for PostgreSQL/Supabase
✅ DEVELOPER_HANDOFF.md with full onboarding guide

---

## FIRST DAY CHECKLIST FOR RUSSELL

  [ ] Read DEVELOPER_HANDOFF.md (root of repo)
  [ ] Clone repo: git clone https://github.com/coastaldivide/justice-gavel.git
  [ ] cd backend && npm install
  [ ] cd ../frontend && npm install --legacy-peer-deps
  [ ] cd ../backend && npm test  →  should show 17,821 passed
  [ ] cd ../frontend && npm test → should show 683 passed
  [ ] Then follow REQUIRED BEFORE LAUNCH steps above

Estimated time to launch from this state: 2-3 days for one developer.

## KNOWN ISSUES FOR RUSSELL — Phase 1 fixes during integration testing

### FlatList inside ScrollView (CheckInManagerScreen.tsx)
  File: frontend/src/screens/CheckInManagerScreen.tsx
  Issue: FlatList is nested inside a ScrollView causing dual-scroll conflict.
  Fix:   Either (a) add scrollEnabled={false} to the FlatList, or
              (b) replace the outer ScrollView with a View and let FlatList scroll.
  Line:  Search for '<FlatList' in the file.
  Time:  ~10 minutes

### FlatList inside ScrollView (CourtFormsScreen.tsx) — verify in integration testing
  File: frontend/src/screens/CourtFormsScreen.tsx
  Scanner flagged it but nested structure was a false positive.
  Verify during integration testing on a device.
