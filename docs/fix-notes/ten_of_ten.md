# STEP 1 — legal-risk code fixes (sample arrests + flat bondsman lead fee)

## A. Sample arrest records hidden (rows kept in DB)
- New central filter `backend/src/utils/arrestVisibility.js`:
  - `realArrestSql(alias)`: excludes sample sources (`source ~* '^(seed|sample|demo|mock|fake|test)([^a-z]|$)'`, so `seed_v1`) and takedown-suppressed rows. Used by every automated or billing path. The toggle never changes it.
  - `visibleArrestSql(alias)`: same filter, but with `SHOW_SAMPLE_ARRESTS=true` it keeps sample rows (suppressed rows stay hidden). Used by read-only user views.
  - `isSampleColumnSql()` adds `is_sample` (boolean) to every arrest row the API returns.
- Applied in:
  - routes/arrests.js: /search (list and count), /recent, /:id, /stats/county, /warrant-check; /search and /recent also return `sample_mode`.
  - billing/bondsman.js: GET /leads uses the visible filter with `is_sample`; POST /leads/:id/accept uses the real filter, so a sample row can never be sold.
  - billing/connections.js: family connect uses the real filter and stores `arrest?.id`.
  - services/arrest_alerts.js: real filter.
  - services/outbound_bot.js: new `selectActionableArrests` and `getRealArrest` back the nightly run, sendPaymentLink and deliverLead.
- Takedown fix: suppressed rows were never actually filtered out, although the takedown route claimed they were. Both filters now hide them.
- Toggle `SHOW_SAMPLE_ARRESTS` (default false):
  - Added to config `OPTIONAL_FEATURES` and `ALL_ENV_VARS`.
  - The server logs a loud warning when it is `true` in production.
  - Documented in RAILWAY_ENV_SETUP.md and ENVIRONMENT_VARS.md.
  - The seed-migration header comment was updated to match.
- App:
  - New `components/SampleRecordBadge.tsx` shows "Sample record · not a real arrest". It is used in FamilyConnect results and the selected-arrest summary, and on Bondsman lead cards and the accept modal.
  - FamilyConnect now has an inline empty state (`arrest-search-empty`), tolerates a missing `records` field, and resets `loading`.
  - The Bondsman dashboard already had an empty state.
  - HomeScreen's locked "county analytics" teaser showed invented numbers (847 arrests, DUI, $2,400). They are now placeholders.
  - Types now include `is_sample` and the lead_fee fields.
- Migration 01 fix: the seed inserts use explicit ids and never advanced the sequences, so the first app INSERT into arrest_records, lawyers, bail_agents and similar tables hit a duplicate primary key. An idempotent `setval(MAX(id))` block was appended. It changes no rows.
- outbound_bot `sendSms` stub returned `null`, so every `result.error` read threw. It now returns `{error:'sms_not_configured'}`.

## B. Flat bondsman lead fee: one source of truth
- `backend/src/routes/billing/leadFee.js` defines `BONDSMAN_LEAD_FEE_CENTS = 7500`, `bondsmanLeadFeeCents()` (ignores bail), `formatLeadFee()` and `bondsmanLeadFeeInfo()`. It has no dependencies and is re-exported from billing/_shared.js.
- billing/bondsman.js no longer has a private `FLAT_LEAD_FEE_CENTS`. GET /leads and GET /bondsman/tiers now include `lead_fee` (`{cents, display, model:'flat'}`).
- outbound_bot.js: the bail-scaled `calcLeadFee` ($25 to $300) is gone. The SMS offer, payment-link amount and text, and the revenue_log / lead_purchases rows in deliverLead all use the flat fee.
- Frontend:
  - New `constants/leadFee.ts` holds the display fallback. `leadFeeLabel(lead)` prefers the server's `lead_fee_display`.
  - BondsmanDashboard's tiered table is removed.
  - SubscriptionScreen copy changed from "$25-$300 based on bail amount… no monthly fee" to a flat {fee}.
- Docs: README (2 places) and BONDSMAN_OUTREACH.md (header, email template, revenue table recomputed at $75) now say a flat $75.
- Payments are untouched: still 503 payments_unavailable without Stripe, and the integration test asserts this.

## Tests added
- backend `arrest_visibility.test.js`, 14 tests:
  - Helper unit tests (always run).
  - 9 Postgres tests (run when `TEST_DATABASE_URL` is set) that drive the real routers and services:
    - By default, the 600 seed rows are never returned by search, recent, :id, stats, warrant-check or bondsman leads.
    - With the toggle on, they come back flagged `is_sample:true`.
    - Takedowns stay hidden.
    - Even with the toggle on, samples are never bought, never selected by the bot, and get no payment link, delivery or alert.
    - A real $250k-bail lead is quoted and linked at $75.
- backend `lead_fee_consistency.test.js`, 8 tests: the constant, the re-export, frontend/backend parity, bot SMS at several bail levels, the tiers endpoint, and source/doc scans that stop bail-scaled fees coming back.
- frontend `render/arrests.test.tsx`, 3 tests: empty list, malformed response, Sample-record label. checkInFlow's local tiered-fee model was replaced with tests of the real `leadFeeLabel`.
- Three old source-grep tests pinned the old behaviour and were updated: brutal_trials_v17 6-03 ($25/$300 tiers) and v184 BOT-04 (calcLeadFee). v159 NULL-02 needed a code tweak only.
- CI: new step "Sample-arrest filter + flat lead fee on real Postgres (jest)" runs arrest_visibility.test.js against the migrated jg_ci database. The smoke test gained 2 checks: seeds hidden, and tiers quote a flat $75.

## Not done (deliberately)
- `routes/alerts.js` takedown and disposition write through the `arrests` view to any id. They return no record data, so they were left as is. Separate issue: takedown and disposition do not check that the requester owns the record.
- billing/pi_leads.js `piLeadFee` still tiers PI leads by severity ($50 to $499.99), while routes/pi_leads.js says it is flat for Rule 5.4/7.2 reasons. That is attorney leads, not bail-agent leads, so it is out of scope, but it is the same class of risk.
- The admin `ALLOWED_TABLES` list and the scrape_arrests.js CLI totals are operator-only (admin key / console), so they were not filtered.
- No arrest-monitor matching job exists; there was nothing to filter.
- Self-contained local fee models in old simulation tests (kraken, coverage_gap) were left alone. They do not import app code.

## Gate
1. Fresh DB, all migrations ON_ERROR_STOP, applied twice: OK (195 tables, 600 seed rows kept).
2. backend `npm ci` OK. Import smoke OK. Prod boot (TZ=UTC, generated secrets, no Stripe, mock Anthropic): smoke-test 31/31 passed, including the 2 new checks. A manual boot with SHOW_SAMPLE_ARRESTS=true returned seed rows with `is_sample:true` and logged the warning.
3. backend jest (in-memory, as CI): 315/315 suites, 27947 passed, 12 skipped (9 = the PG part of arrest_visibility), 0 failed. With TEST_DATABASE_URL set, arrest_visibility ran 14/14.
4. frontend: tsc 0 errors. eslint 0 errors (1465 warnings, as before). npm test 48 suites / 705 tests plus render 2 suites / 8 tests, all passing. nav-targets 0 problems. expo export web OK, and the bundle contains "Sample record".
5. ci.yml updated with the new Postgres jest step.

---

# Step 2: frontend lint to zero

## Result
`npx eslint src App.tsx --max-warnings 0` reports 0 errors and 0 warnings. The rule set is stricter than before:
- `no-unused-vars` is an error, and it now also covers caught errors (`caughtErrors: all`).
- `react-hooks/exhaustive-deps` is an error.
- `no-non-null-assertion` is an error.
- `no-promise-executor-return`, `no-template-curly-in-string` and `no-console` are errors.
- `no-require-imports` is an error, except for static assets.
- `reportUnusedDisableDirectives` is an error.

`npm run lint` and the CI ESLint step both use `--max-warnings 0`.

**eslint-disable comments: 1** (there were 69 at HEAD). It is in `payments/index.tsx`: a single-line, rule-specific `no-require-imports` disable with a justification. Stripe is required lazily so that its native module is not initialised while payments are disabled.

### Counts by rule (frontend `src` + `App.tsx`)
| rule | HEAD (old config: all warnings) | start of this session (stricter config, partial previous attempt) | now |
|---|---|---|---|
| @typescript-eslint/no-unused-vars | 1243 | 326 | 0 |
| react-hooks/exhaustive-deps | 87 | 78 | 0 |
| @typescript-eslint/no-non-null-assertion | 34 | 18 | 0 |
| no-var-requires / no-require-imports | 28 | 9 | 0 |
| no-promise-executor-return | 6 | 3 | 0 |
| unused eslint-disable directives | 58 | 0 | 0 |
| **total** | **1456 warnings, 0 errors** | **434 errors** | **0 / 0** |

## How the code was fixed
- Dead code was deleted: unused imports, unused `useHaptics()` / `useTheme()` destructures, the retry-counter boilerplate in 9 screens, unused `EmptyState` / `HighlightedText` / `TierGatedRow` helpers, unused `makeStyles(colors)` parameters, and the dead circuit breaker in `api.ts` (`checkCircuit` was never called). The 50-state `STATE_CARDS` in Expungement was deleted unrendered; it duplicated the backend rules.
- Hook dependencies were fixed without changing behaviour:
  - Stable dependencies were added: `showToast`, `confirm`, `navigation`, and `useRef(...).current` Animated values.
  - Functional state updates were used, for example in BarPrepHome / BarPrepSchedule `load`, so `load` no longer changes on every keystroke.
  - `useCallback` was added where it was missing.
  - A new `hooks/useLatestRef.ts` holds callbacks for effects that must keep a precise trigger. It is used by LawyersScreen, BailSearch, HelpNow and the Expungement auto-submit.
  - Effects were reordered where adding the dependency would have hit a TDZ, i.e. the dependency array referenced a `const` declared later: Discovery, LegalResearch and Messages header effects, Chat session load, CaseScreen scanner callbacks, LawyerProfile analytics, Search refresh, ArrestMonitor refresh.
- `require()` calls were replaced with static imports. The `.web.tsx` siblings already handle the web build. Affected: DocumentScanner (expo-camera), InterrogationRecorder and VoiceNote (expo-av), MotionLibrary (NetInfo), Onboarding (NativeModules / setLang).

## "Unused" values that were bugs, now wired up
- **PTR / refresh:**
  - BailCalculator had a `refreshing` state that never reset and no RefreshControl. Its fetch-error/retry UI sat inside a `.map` over an empty list, so it could never show. Both are fixed.
  - Booking (reloads slots), FirmPublicProfile and Matter had refresh state and no control. They now have real pull-to-refresh.
  - ArrestMonitor's refresh called `load()` twice.
  - RightsCard's effect depended on `state` and re-read the saved state, which reverted the user's state pick. It now loads once, and the picker and refresh call `loadCard(st)`.
- **Buttons with no `onPress`:**
  - EmergencyShare: Send Now (`sendShare` was never called), Try Again, Done, Cancel, Edit contacts, and the provider phone links. The phone regex `\d{7 }` was also fixed, and `result.action` no longer crashes when undefined.
  - CALL 911 in EmergencyScreen and InterrogationRecorder.
  - LawyerProfile "Send Message" (`handleMessage`), CrisisResources "Find a Lawyer", the ConsumerSubscription "Monthly" toggle, the Expungement petition "Close", the PILead "Browse Lawyers", SavedLawyers "Review", and the AttorneyPrivacy policy and legal-team links.
  - AttorneyDashboard case sort buttons: `setSortBy` was never called.
- **Data fetched or computed but never rendered:**
  - AttorneyDashboard: `AvailabilityGrid` and the bar renewal reminder.
  - CrisisResources: directory lines from `/resources`, deduplicated against the built-in list.
  - Booking: the server confirmation, showing booking number and fee charged.
  - Discovery: `[STRONG]` / `[NOTABLE]` / `[POSSIBLE]` tags are now shown as badges instead of raw text.
  - DeadlineCalculator: the state DMV DUI hearing table is now a deadline row, the urgent count passes the state, and a "Using {state} rules" note is shown.
  - LawyerProfile: the review form (`submitReview`, stars, text) and the average `StarRating`.
  - Lessons: the `query` deep link from the Home tip now opens the matching lesson.
  - Chat: `exportConversation` now has a Share button.
  - MatterIntelligence: the error message is shown.
  - CheckInManager: enrol errors are shown inline with the server message.
  - HelpNow: an offline cache (`saveCache` / `loadCache` / `isOffline`) with a banner.
  - MotionLibrary:
    - The consent modal (`disclaimerVisible`) was never rendered, so generation proceeded without consent. Generation is now gated.
    - `case_id` is sent to `/motions/generate`.
    - "Suggested for your charges" (`relevantMotions`) is shown.
    - An offline banner is shown.
    - The history write-through cache stored a single motion object as the list.
  - Home: the court-date countdown, visit greeting, tip of the day and nearby counts all had UI, but commit c9e4050 deleted their loaders while claiming to "merge". They are restored, with a single `/cases` call gated on a token.
  - Settings: `isAdmin` was never set, so admins never saw the Admin section. It now comes from the stored user's `is_admin` / `role`.
  - CaseScreen:
    - The "Lawyers" tab had no content. It now shows saved lawyers with loading, guest and offline states.
    - The tab was writing saved lawyers into the offline cases cache (`cacheCases`). That is removed.
  - BarPrepQuiz: the score was always 0%, because `answers` never carried `is_correct`. Graded results are now merged in (practice: per answer; timed: the batch response). BarPrepHome now shows its disclaimer.
- **Static screens whose content was unreachable or rendered as empty cards:**
  - FamilyCourt: ORDERS and SUPPORT sections had been commented out as "unused". They are restored and shown as tabs.
  - HousingRights: eviction tab.
  - ImmigrationConsequences: offense groups and status tab. They were rendering empty cards.
  - JuvenileJustice: process steps and 50-state sealing table. Rights cards had used `title` where the field is `heading`.
  - TenantRights: situation picker plus `GUIDANCE`. It previously rendered empty cards.
  - New `components/InfoTabs.tsx` provides the tab bar.
- **Other:**
  - CheckIn: the "Include my location" toggle was ignored, and GPS was always requested and sent. Location is now opt-in.
  - BondsmanDashboard: the profile had no License State field (`states` was always `[]`), and Company Name had a numeric keyboard with max length 15.
  - Lead loading ran twice on mount and again for profile and badge on every filter change. Leads now load via `useFocusEffect` (on focus and on filter change).
  - AttorneyDashboard: double mount fetch removed.
  - Focus refresh was added to Cases and SavedLawyers. At HEAD `useFocusEffect` was imported but never called.
  - BailSearch: the GPS-denied city box did nothing (`filteredCities` was always `[]`, there was no submit, and "Use My Location" set an unused `city`). It now searches.
  - FamilyConnect: the double-pay guard used a `submitting` flag that was never set. It now uses `paying`.
  - Translator: session creation now goes through `requireAuth`, because the endpoint requires auth.
  - JustArrested: a permanent "No results found / check connection" block was always rendered. It is removed.
  - Lessons: `markComplete` was a stale closure, so it could post `user_id` 1. Fixed.
  - SOS button: the haptic was never fired. It now fires.
- **Backend bugs found through the wiring:**
  - `routes/saved.js` GET `/saved/lawyers` selected `name = '', phone = ''`, which returned booleans instead of the name and phone.
  - `routes/resources.js` did not select `title` / `body` / `url`. Seeded rows use those columns, so the Resources screen showed blank titles. Both SELECTs now include them, and the screen also falls back to `name` / `description` / `website`.

## Removed rather than wired (and why)
- `onCivilRoute` (Chat): never called, and its `/ice/` regex matches "police" and "notice". Wiring it would have misrouted arrest questions to the ICE screen.
- Booking's `lawyerAvail` fetch: it called `/attorney/profile/availability`, which returns the *caller's own* schedule, so the data was wrong. `/consultations/slots/:lawyerId` already covers this.
- Hague `usResources`: it duplicated the hard-coded OCI/NCMEC/FBI contacts, was never rendered, and needed auth.
- Settings `TierGatedRow` / `subTier`: tier-locking the notification toggles would lock features that cannot be bought while Stripe is off.
- QuickConnect `showDemoHelp`: it showed developer instructions ("Open backend/.env") to end users.
- QuickConnect `practiceArea`: there is no picker, and an unset value sends the same request.
- Unused `todayStatus` / `streak` / `barPrepStreak` / `unreadMessages`: there is no UI for them.
- The circuit breaker: wiring it would block all requests after any 5 errors, including 4xx.

## Not done (noted)
- **Backend bar-prep practice mode:** POST `/bar-prep/sessions/:id/answers` marks the session completed on the first answer, so later practice answers get a 400 "already submitted". Only the first practice answer is graded. Retry-wrong sends `session_id: 0`. Both are backend changes, out of scope.
- **`/resources` and `/push/tip` access:** `/resources` requires auth, so Resources and Crisis directory lines are empty for guests. `/push/tip` is public.
- **Unused components:** `components/LawyerSkeletonCard` and `MotionTypeBadge` are still unused. LawyersScreen has its own animated skeleton.

## Tests
- **Updated backend source-text tests** (36 files): `brutal_trials_*` and `gap_and_error_discovery_v2`.
  - They had pinned dead imports and removed code: RefreshControl imports with no control, `useNavigation`, `Alert`, `onCivilRoute`, `loadUsResources`, `/attorney/profile/availability`, circuit breaker, `RIGHTS_KEYS`, haptic-import counts.
  - Each now asserts the real behaviour. For example, the PTR checks now require that "RefreshControl is only imported where `<RefreshControl` is rendered".
- **`arrest_visibility.test.js` (Postgres part):** this was stale before this step. It still expected $75 after the $100 pricing commit, and it fails in CI's Postgres job. It is updated to $100.
- **web-smoke.cjs:**
  - A storm detector fails the run if a screen issues more than `STORM_MAX` (4) identical API requests (method + URL + query) within `STORM_WINDOW_MS` (3000 ms). It was verified against synthetic input.
  - The run now also exits 1 on any non-network console error.

## Gate
1. A fresh DB (`jg_step2`) applied all 10 migrations with ON_ERROR_STOP, twice: OK (195 tables, 600 seed rows). The DB was dropped afterwards.
2. Backend:
   - `npm ci` OK; import smoke OK.
   - Prod boot (`npm start`, NODE_ENV=production, TZ=UTC, generated secrets, no Stripe, mock Anthropic) OK.
   - `smoke-test.mjs`: 31/31.
   - Manual check: `/resources` now returns titles, and `/saved/lawyers` returns name and phone.
3. Backend jest (in-memory): 315/315 suites, 27952 passed, 12 skipped, 0 failed. With `TEST_DATABASE_URL`, `arrest_visibility` passed 14/14.
4. Frontend:
   - tsc: 0 errors.
   - eslint `--max-warnings 0`: 0 errors and 0 warnings.
   - `npm test`: 48 suites / 705 tests plus render 2 suites / 8 tests, all passed.
   - nav-targets: 0 problems.
   - `expo export --platform web` OK.
   - Headless web smoke against that build and the live backend: 165 checks, 0 failed, 0 page errors, 0 console errors, 0 request storms (343 API requests).
5. ci.yml: the ESLint step now runs `--max-warnings 0`.

# STEP 3 — backend code quality (ESLint, dead code, arrest takedown authorization)

## Lint
- **Setup:** ESLint 9 flat config in `backend/eslint.config.js`.
  - devDeps: `eslint@9.39.5`, `@eslint/js`, `eslint-plugin-n@17.24.0`, `eslint-plugin-security@3.0.1`, `globals`.
  - `npm run lint` runs `eslint src scripts --max-warnings 0`.
  - Rules: recommended set, plus `no-unused-vars` (args / caught errors / destructuring), `eqeqeq: smart`, `no-var`, `prefer-const`, `no-duplicate-imports`, `no-empty` (an empty catch needs a comment), `require-await`, `no-promise-executor-return`, `n/no-missing-import`, `n/no-deprecated-api`, curated `security/*` rules, `no-eval` / `no-implied-eval`, and `reportUnusedDisableDirectives`.
  - `no-console` is an error in `src/`. It is off in `scripts/`, `src/scripts/` (CLI tools) and `src/utils/logger.js`.
  - Tests get jest globals, with `require-await` off and empty catches allowed. `no-undef` and `no-unused-vars` stay on.
- **Choice of `require-await` over `no-return-await`:** `no-return-await` is deprecated.
  - Async route handlers with no `await` dropped `async`. Express 5 catches synchronous throws, so behaviour is the same.
  - Helpers that return promises use `return await`.
  - The sql.js dev adapter wraps its synchronous methods in `asPromise()`.
- **Counts:**
  - Before, with the final config on HEAD: **2,868 errors / 0 warnings** (src 1,193, tests 1,619, scripts 56).
  - After: **0 / 0**.
- **eslint-disable:** 1 in total, and it was already there: `services/retention.js` (`eqeqeq`, an intentional loose compare of DB values). None were added.
- **Runtime `console.*`:** in config, instrument, server and googleCalendar these now go through `utils/logger.js`.

## Bugs found through lint and dead-code analysis (fixed)
- **Routes that were never registered:**
  - The `/asylum-clock` handler in `immigration.js` was never closed, so `/voluntary-departure` and `/relief-options` were defined inside it and returned 404.
  - Same problem in `research.js`: the `/index` handler swallowed `/topics`.
  - All three now return 200 against the live server.
- **`billing/webhooks.js`:**
  - A second `case 'customer.subscription.updated'` was a duplicate label and could never run, so bondsman tier changes and cancellations were never synced. It is merged into the first case as `syncBondsmanTier`.
  - The `deleted → updated` fallthrough is now explicit.
  - The dead `handleStripeWebhook` is removed.
- **`privilege.js`:**
  - `nextDocNumber` was `async` but not awaited, so bulk-generated entries stored `"[object Promise]"`.
  - The manual entry path called it as `(db, matterId, firmId)`, which produced `"PRIV-0NaN"`.
  - pg `COUNT()` returns a string, so `+= 1` concatenated instead of adding.
- **`makeUserLimiter(30, 60_000)`** in 10 route files: the function takes an options object, so every one of these silently fell back to 10 requests/min. They now pass `{ windowMs, max }`.
- **Rate limiters that were imported but never applied:**
  - `transcribeLimiter` is now on `/transcribe/audio` and `/transcribe/note` (Whisper).
  - `perUserAiLimit` is now on `/expungement/petition` and `/interrogation/transcribe`.
- **Bondsman lead purchase:** the Stripe idempotency key was computed but never passed. It is now passed.
- **`quickconnect`:**
  - `credit_cents` was taken from the client unchecked, so anyone could claim up to $20 off. It is now capped by the user's real balance.
  - The fallback provider search ignored `state`, and the coordinate validation was computed but unused. Both are fixed.
- **Family-connect lookup:** `city LIKE ? OR city LIKE ? AND active = 1` had wrong precedence (inactive listings got through) and no state filter. Fixed.
- **Access control that was computed but not enforced:**
  - `GET /time/matter/:id` and `/billing-summary` let any signed-in user read any matter's time entries, invoices and client name. They are now scoped to the caller's firm, or to the caller's own rows if they have no firm.
  - `GET /matters/:id/history` now uses `requireMatterAccess`.
- **`golden_gavel`:** `lessons_started = started ?? 0 > 0` returned the count instead of a boolean. Fixed.
- **`research /index` admin check:** it tested `req.user.is_admin`, which is not in the JWT, so it always returned 403. It now checks the database.
- **Template placeholders that were never substituted:**
  - `fact_check_monitor.js` escaped `\${…}`, so its DB staleness SQL ran `FROM ${t.name}` literally and the error was swallowed. Errors are now logged.
  - SEV-1 and SEV-2 alert email subjects said `${message}` literally.
- **`selfHealing`:**
  - It logged "User cache cleared" without clearing anything.
  - Its circuit-breaker monitor polled a breaker map that nothing ever filled. That map and `middleware/circuitBreaker.js` are removed.
- **`scripts/check-env.js`:**
  - A duplicate `JWT_SECRET` key overwrote the ≥32-character check.
  - It required Stripe and SendGrid, which conflicts with the no-Stripe owner constraint, and SendGrid is retired.
  - Required now matches `REQUIRED_IN_PROD`. The others are reported as optional.
- **Tests that computed results but never asserted them:**
  - The error counters in v21 and v24 are now asserted.
  - v130 `found` is asserted, and its directory walk that stopped early is fixed.
  - The import checks in v24, v90 and multi_user now assert.
  - The PTR finally-model test now actually exercises the `finally`.
  - Tautological literal checks are removed from godzilla and from the healthScan invariants.

## Security fix: arrest takedown and disposition (`routes/alerts.js`)
- **Before:** any signed-in user could suppress, or set the disposition of, any arrest record by id. There is no takedown UI in the frontend; this is API only. Arrest records have no link to a user account, so a requester cannot be verified as the person in the record.
- **Takedown requests:** `DELETE /api/alerts/record/:id` from a non-staff user now needs a `reason`.
  - It creates a **pending** row in `arrest_takedown_log` (reason, contact, relationship) and returns 202.
  - The record stays visible until reviewed.
  - A repeat request returns the existing pending one.
  - The route is limited to 5 requests per hour per user.
- **Staff:** staff means `users.role` admin / super_admin / staff, or `users.is_admin = 1`. This is read from the database by `utils/staff.js`, never from the token. Staff can:
  - suppress immediately (an audit row is written);
  - see the queue: `GET /api/alerts/takedown-requests`;
  - approve or reject: `POST /api/alerts/takedown-requests/:id/approve|reject`. The request is claimed first; approval suppresses the record and reverts if suppression fails.
  - record dispositions: `POST /record/:id/disposition` is now staff-only. The date must be `YYYY-MM-DD`, and a missing record returns 404.
- **Insert errors** were silently swallowed before. They now return 500.
- **New migration `00000000000010_takedown_review.sql`** (idempotent):
  - adds `relationship`, `reviewed_by`, `reviewed_at`, `review_note`;
  - drops the `taken_down_at` default;
  - adds a unique index allowing one pending request per (record, user), and a status index.
- **Tests:**
  - `alerts_takedown.test.js`: the real router on a fake DB, 7 tests covering the authorization matrix, including a token that claims admin while the DB says user.
  - `alerts_takedown_pg.test.js`: the real router on Postgres, 1 end-to-end test. It is added to the CI Postgres step.

## Dead code removed
- **Files (32)**, including:
  - `routes/discovery.js` (a duplicate of `routes/discovery/`);
  - `routes/expungement/outcomes.js`;
  - middleware `cache`, `validate`, `sentry` and `circuitBreaker`;
  - `modules/index.js`, `docs/openapi.js`, `db/migrate.js` (a retired stub);
  - services `dunning`, `jobPoller`, `ragRetrieval`, `sendgrid` (a shim), `supabase`, `tokenCostModel`, `calendly`, `funnelTracking`, `googleCalendar`;
  - utils `errors`, `logger.pino`, `circuitBreaker` (opossum), `retry`;
  - SQLite-only or stale scripts `src/scripts/{_db,migrate,migrate_to_postgres,db-health,seed_demo}.js` and `scripts/migrate-postgres.js`;
  - `cluster.js`, which imported `app.js`, a module that never listens.
- **Code:** about 40 exported functions and constants that nothing references, plus about 1,000 unused imports, variables and helpers.
- **Duplicates:** the scheduler's never-scheduled `cleanupRefreshTokens` (a scheduled `cleanupExpiredTokens` already exists) and `archiveOldAuditLogs` (it would delete audit logs older than 90 days).
- **Dependencies:** `pino`, `pino-http` and `opossum` are removed.
- **npm scripts:**
  - removed: `migrate`, `seed`, `db:health`, `migrate:postgres`, `predeploy`;
  - `deploy:check` is now `lint && test`;
  - `pipeline:full` no longer runs the no-op steps;
  - the `seed:rag` path is fixed.
- **Docs updated:** QUICKSTART seed section, railway-checklist migrate step, RUNBOOK Calendly section, ENVIRONMENT_VARS and `.env.example` (Calendly).
- **Tests:** tests that only pinned deleted files or dead imports were removed (about 45 cases). Discovery, email and sentry checks were retargeted to the live code.

## Not done or flagged (and why)
- **The offline scrapers and importers are SQLite-only.** They write `data/providers.sqlite` or `demo.db`, not Postgres:
  - `scrape_arrests`, `scrape_providers_national`, `scrape_state_bars`, `scrape_recovery_agents`, `refresh`, `import_csv`, `import_doi_bondsmen`, `update_legal_data`, `fact_check_monitor`.
  - `run-all-scrapes.sh` requires `DATABASE_URL`, but these steps never write to it, and `seed_providers.js` is a no-op.
  - The production nightly scheduler also spawns `refresh.js` and `scrape_arrests.js`, so that output goes to a local SQLite file.
  - They are kept as instructed. They all parse (`node --check`), their imports resolve (lint `n/no-missing-import`), and `bash -n` on the pipeline passes. Porting them to Postgres is a separate task.
- **`backend/src/migrations/*.sql`** (legacy SQLite-era DDL, with no runner now) is kept, because about 12 source-text tests read it.
- **Check-ins:** `POST /checkins/submit` does not tie the caller to the enrollment. Enrollments have no user link, so any signed-in user can check in for any enrollment id. The old comment claimed a name match; it now says what actually happens. Fixing this needs a data-model decision.
- **Pretrial:** `GET /pretrial/dashboard` lets an attorney pass any `agency_id`. Noted, not changed.
- **Prompt-injection filter:** `sanitizeUserMessage` was never applied. Its `/DAN/i` pattern would also strip the name "Dan", so it was removed rather than wired in.
- **Hollow tests:** many older tests (for example the whole of `brutal_trials_v21`) still only read a file and assert nothing. Rewriting them is out of scope.

## Gate
1. A fresh DB (`jg_step3`) applied all 11 migrations with ON_ERROR_STOP, twice: OK (195 tables, 600 seed rows, takedown indexes present). The DB was dropped afterwards.
2. Backend:
   - `npm ci` OK; audit (omit dev, high): 0; import smoke OK.
   - Prod boot (NODE_ENV=production, TZ=UTC, generated secrets, no Stripe, mock Anthropic) OK.
   - `smoke-test.mjs`: **31/31**.
   - Manual run on the live server: a user takedown returned 202 pending with the record still visible; user disposition and user access to the queue returned 403; admin approve gave suppressed and approved; the disposition was stored; the three formerly missing routes returned 200.
3. Backend jest (in-memory): **316 suites passed (1 skipped: PG-only), 27,867 passed, 13 skipped, 0 failed.** With `TEST_DATABASE_URL`, `arrest_visibility` + `alerts_takedown_pg` passed **15/15**.
   - Baseline before this step: 315 suites, 27,952 passed. The difference is the deleted dead-file tests.
4. Frontend: not touched.
5. `ci.yml`:
   - new step "ESLint (0 errors, 0 warnings)" running `npm run lint`, after the audit step;
   - the Postgres jest step now also runs `alerts_takedown_pg.test.js`;
   - the job name now includes "lint".

# STEP 4 — frontend design & accessibility (contrast, theme tokens, a11y, touch targets)

## Audit tooling (new)
- **`frontend/scripts/design-audit.mjs`** — static design/a11y audit (TypeScript-AST based). Per `.tsx` file in
  src/screens, src/components, src/navigation it:
  - resolves `StyleSheet.create` / `makeStyles` style maps, inline style objects/arrays, `colors.*` (themed) and
    `COLORS.*` (static light) tokens, rgba compositing, and walks the JSX tree keeping a backdrop stack;
  - checks every `<Text>` against its statically-determinable backdrop for WCAG AA (4.5:1, 3:1 large) **in both
    light and dark themes**, in two passes (conditional/selected-state styles evaluated as "base" and "active");
  - counts raw hex literals outside the token files (theme.ts, tokens.ts, responsive.ts);
  - flags interactive elements (TouchableOpacity/Pressable/HapticButton…) with no accessibilityRole/Label and no
    plain-text child, and ones statically sized under 44×44 pt after hitSlop;
  - `--ci` exits 1 on any contrast failure, raw hex in screens/components, missing role/label, or small target.
  A `design-audit-ignore` line comment suppresses the rare conditionally-rendered false positive (5 uses, each
  explained in-line: checkmarks rendered only on a filled checkbox, text inside the navy GradientHeader).
- ci.yml: new frontend step "Design audit" (`node scripts/design-audit.mjs --ci`); the old informational
  "raw hex in screens" step (warn > 50) now **fails > 0** (print-CSS receipt templates excluded).

## Before → after (design-audit on the same final script)
- Contrast failures: **light 392 / dark 616 (723 sites) → 0 / 0 (0 sites)**
- Raw hex literals outside token files: **554 (screens 242, components 285, other 27) → 0**
- Interactive elements missing role/label: **4 → 0** (plus roles/labels added along the way)
- Touch targets statically < 44×44 pt: **7 → 0** (ScreenHeader action 36→44, ArrestMonitor remove 30→36+hitSlop,
  AttorneyDashboard grid cells +vertical hitSlop, LegalResearch/Messages search 42→44, Translator send 40→44)
- `maxFontSizeMultiplier` support untouched (2,380 uses in screens; screens keep 1.4).

## axe-core 4.11 (WCAG 2.0/2.1 A+AA), 14 screens × light+dark (age gate, onboarding, login, register, home,
## lawyers, bail, chat, resources, settings, payments, subscription, cases, bar-prep home)
- Before: **256 serious/critical nodes** (color-contrast 206 serious; aria-required-children 20 +
  aria-required-attr 14 critical; nested-interactive 14; scrollable-region-focusable 2).
- After: **0 violations of any impact** (serious/critical 0; nothing waived).
- Non-contrast axe fixes: bottom tab bar now renders real `role="tab"` buttons inside the tablist (web default was
  `<a role="link">` → aria-required-children); Settings switches no longer duplicate `role="switch"` on the
  wrapper (RN-web's inner checkbox already carries role/checked → aria-required-attr + nested-interactive);
  bail agent FlashList is keyboard-focusable.

## Theme (frontend/src/constants/theme.ts — navy/gold identity kept)
- New tokens in BOTH palettes: `white`, `black`, `textOnNavy`, `textOnAccent` (per-mode: white on dark-accent
  buttons in light mode, near-black on the light accents dark mode uses), `textOnGold`, `goldText`, `textBrand`
  (navy ⇄ steel brand headings).
- Fixed dark values: `textMuted` #7A90A8→#8CA2BA (≥5.5:1 on every dark surface incl. legacy card), `warnDark`
  #E65100→#FF8F4D (4.48→7.5:1 on warnBg), `cardTitle` was navy-on-dark → #E8EDF5; light `tabInactive`
  #8FA3B1→#5C6F82 and dark `tabInactive` #4A6070→#8CA2BA (tab labels failed axe).
- LIGHT gained the keys only DARK had (`cardTitle`, `borderSubtle`, `text`) — `colors.text`/`colors.borderSubtle`
  were `undefined` in light mode before.
- New exports: `ART` (fixed illustration/logo/chart inks), `TINTS` (categorical tinted-badge pairs, AA-checked),
  `TOAST_TINTS`, `TOAST_ACCENTS` — the palettes that previously lived as raw hex in Illustrations, JTBLogo,
  LegalCharts, GradientHeader, MotionTypeBadge, CaseStatusBadge, Toast, ToastProvider, UPLDisclaimer.

## Contrast / theming fixes (≈115 files)
- The known bugs are gone: Payments option titles and dozens of other `color: colors.bgCard`-on-light-card sites;
  header titles colored `bgCard` on navy (invisible in dark); text painted with the same token as its background
  (legal-on-legal banners, steelMid-on-steelMid boxes → tinted `*Bg` + semantic text); static `COLORS.*` text on
  themed backdrops (invisible in dark) and themed text on static backdrops; `colors.steel`/`textFaint`/`gold`
  used as small text on light surfaces; module-level helper components themed via useTheme (AttorneyDashboard
  grid, Expungement/Messages/LegalResearch stylesheets, BarPrep helpers, GoldenGavel, LawyerProfile,
  BondsmanDashboard, VideoConsultation — which had a dead stub `useThemeColors` and never themed at all).
- Real bugs the audit surfaced beyond color pairs: HelpNow courthouse/defender/crisis phone buttons had **white
  text on no background**; RightsCard's "subscribe to unlock" overlay was absolutely positioned at the top of the
  screen over the 911/988 buttons (now overlays the card, with scrim); Bail search disclaimer rendered over the
  list (no background); Register's account-type selector was nested inside the display-name input wrapper
  (clipped overflow); BarPrep screens used non-existent `colors.background` (undefined → white page in dark
  mode), Hague `colors.primaryLight`, TermsModal `colors.subtext`; bail city input was red-on-red; BarPrep streak
  showed "undefinedd"; Expungement rendered a literal `state\'s`.
- Mode-mixed buttons standardized: accent CTAs use fixed-dark backdrops (`emergencyDark`/`legalDark`/`blue`/
  `steelDark`) with `colors.white`, or keep themed accents with `textOnAccent`.
- Raw hex → tokens across all screens/components/navigation (AST-based mapper; JSX attributes re-wrapped in
  braces). Print-receipt HTML/CSS template strings keep their CSS hex (paper documents, excluded + documented).
- `tokens.ts` and `utils/responsive.ts` are treated as token-definition files (their 9 hexes are shadow scales).

## Verification gate
1. Fresh DB `jg_step4`: all 11 migrations, ON_ERROR_STOP, applied **twice** (idempotent), 195 tables. Dropped after.
2. Backend boot NODE_ENV=production TZ=UTC (generated secrets, no Stripe, mock Anthropic): `/api/health` ok,
   payments:false. (Backend runtime untouched by this step; booted for the web smoke.)
3. Backend jest (in-memory): **316 suites passed, 1 skipped (PG-only); 27,867 passed, 13 skipped, 0 failed.**
   4 suites asserted the old raw-hex strings in frontend sources (MotionTypeBadge/CaseStatusBadge/EmergencyStrip/
   JTBLogo/LawyerSkeletonCard); their assertions now check the equivalent theme tokens (same colors, same intent).
4. Frontend: `tsc --noEmit` 0 errors; `eslint src App.tsx --max-warnings 0` 0/0; `npm test` 48 suites / 705 tests
   + render 2/8, all green; nav-targets 0 problems; `expo export --platform web` OK.
5. Web smoke vs live backend: **165 checks, 0 failed, 0 page errors, 0 console errors, 0 request storms** (343 API
   requests).
6. ci.yml updated (design-audit step; hex step now failing; everything else unchanged).

## Screenshots
- `/home/claude/work/notes/fe-screens-step4/` — 38 shots: 19 screens × light + dark (age gate, onboarding, login,
  register, home, lawyers, bail, chat, resources, settings, payments, subscription, cases, bar prep, help now,
  expungement, rights card, match, check-in), taken against the exported web build with a mocked backend, after
  the fixes. All reviewed by eye; the issues found that way (RightsCard overlay, bail overlap/red input, register
  overflow, language chips, "undefinedd", `state\'s`, dark-mode Home having no background at all) are fixed above.

## Chose not to do / notes
- Illustration, chart, gradient and badge palettes stay fixed in both modes **by design** (decorative artwork and
  AA-checked tinted pairs); they now live in theme.ts as `ART` / `TINTS` / `TOAST_*` instead of scattered hex.
- Quick-access tiles on Home keep their static light tints in dark mode (cards-on-dark look); the Home root is now
  themed (`colors.bg`), which it previously wasn't at all.
- 5 `design-audit-ignore` suppressions for conditionally-rendered elements the static walker cannot model —
  each is a checkmark drawn only on a filled (navy/gold/legal) checkbox, or a header action inside the navy
  gradient. Verified correct by eye and by axe (0 violations).
- No axe violations were waived: serious/critical and moderate are all 0 on the audited screens.

## Step 5 — Strict TypeScript (frontend)
- tsconfig: full `strict: true` — removed the escape hatches (`noImplicitAny:false`,
  `strictFunctionTypes:false`, `strictPropertyInitialization:false`).
- `ScreenProps.route` is now required (react-navigation always passes it); RouteParams gained
  matterId/attorneyId/topic; payments `initPaymentSheet` takes Stripe's real `SetupParams` via a
  type-only import (erased on web); realtime/BarPrep/Matter/VideoConsultation/LegalDisclaimer callbacks typed.
- Final 23 strict errors fixed by hand: FlashList keyExtractor/renderItem annotations in 7 screens,
  MediaStreamTrack in the 2 web recorders, BailSearch `res` definite-assignment guard (now throws into
  the offline-cache fallback instead of a potential undefined deref).
- Real bugs strict mode surfaced, fixed:
  1. InsuranceScreen compared `f['legal_pro']` but rows define `pro` — the Legal Pro column of the
     comparison table always rendered "--" for every feature.
  2. ExpungementScreen passed `{params}` as cachedGet's TTL argument — the state/limit params were
     never sent, and the URL-keyed cache served one state's attorney list to every state. Params now
     ride in the URL (per-state cache keys).
- Gate: tsc --noEmit 0 errors; eslint src App.tsx --max-warnings 0 → 0/0; jest 48 suites/705 + render
  2/8 pass; nav-targets 0 problems; expo export --platform web OK. Backend untouched this step.

## Pricing follow-up (owner instruction, Oct 11)
- Bail-agent lead fee confirmed flat $100 (commit 257bd17 had already applied it across code, app,
  docs, smoke test). Retired the last three test files that still asserted the abandoned bail-scaled
  tiers ($15–$1,000 / $15k–$100k cents) as "correct"; kraken K-02/K-09, crash_paths and coverage_gap
  now import routes/billing/leadFee.js and prove the fee never varies with bail. (commit 5200f98)

# STEP 6 — finish or honestly remove every half-built feature

## Inventory (feature → outcome)
| # | Feature | State found | Outcome |
|---|---|---|---|
| 1 | `hooks/useRealtimeMessages.ts` | Dead stub: Supabase client commented out, `supabase = null`, no screen imported it. Worse: `MessagesScreen.tsx` was a verbatim clone of LegalResearchScreen (clobbered pre-baseline at b493700) — every "Messages" navigation (CaseScreen, AttorneyInbox, AttorneyDashboard, LawyerProfile, LawyersScreen, deep link `messages/:caseId`, push notifications) landed on a second Legal-Research paywall | **DONE** — stub deleted; new `hooks/useCaseMessages.ts` (authenticated REST polling every 8 s, foreground-only via AppState, merge-by-id dedupe, stale-case guard, optimistic-free send that keeps the draft on failure, full cleanup). New real `MessagesScreen` (thread bubbles, day separators, read receipts, attachment chips, pull-to-refresh, guest sign-in gate, lawyerId→case resolution mirroring LawyersScreen, case picker when opened without params). **No Supabase anon key anywhere** (RLS has no policies); API no longer advertises `realtime_channel`/`channel` fields and no UI claims "realtime" |
| 2 | `ChildSupportScreen` | Complete calculator, never registered ("orphaned route removed in v8.6.3") | **DONE** — registered in MoreStack (`ChildSupport`, "🧮 Support Calculator") + CTA "Estimate your child support →" on FamilyCourt's Child Support tab. nav-targets: 250 refs, 0 problems. Other orphans: `RecoveryAgentsScreen` stays unregistered **deliberately** (item 5.5, licensing), `TermsAcceptanceModal` is used by App/Register |
| 3 | `services/arrest_ingest.js` | Fake sources returning `[]` (Davidson/Shelby TODO scrapes + invented judyrecords API) | **DONE / honest** — rewritten around operator-configured `ARREST_FEED_URLS` (JSON array of `{id,url,state,county}`; https-only, slug ids, dedupe, 2-letter states; records validated/sanitized: name+parseable booking_date required, lengths capped, source stored as `feed_<id>` so it can never collide with the sample-row filter). No feed ⇒ loud log + `{feeds_configured:false, inserted:0}`; startup warns via `OPTIONAL_FEATURES`. `dry_run` now actually works (the route already passed it). Documented in ENVIRONMENT_VARS.md / RAILWAY_ENV_SETUP.md / .env.example; judyrecords key + `API_URLS.JUDYRECORDS` removed. `/arrests/search`, `/arrests/recent` and `/billing/leads` now return `feeds_configured`; FamilyConnect empty state and BondsmanDashboard empty state show "No public arrest feeds configured for your area yet" when it is false. Dishonest copy fixed: ArrestMonitor upsell/"3am scan across the US", Bondsman "real-time feed"/"within minutes of booking", ConsumerSubscription "24/7 arrest monitoring"/"Real-time arrest monitoring", HelpNow "real-time arrest alerts". Sample rows stay hidden |
| 3b | Arrest monitors (found during 3) | CRUD-only: **no job ever matched monitors**, and `last_checked`/`last_result` the app renders did not exist in Postgres | **DONE** — migration 11 adds the columns; `arrest_alerts.sendArrestAlerts` now checks every active monitor each run (pure `monitorMatches`: all watch-name words + county/state filters), push-notifies owners (`screen:'ArrestMonitor'`), stamps `last_checked`/`last_result` even on zero-arrest runs; GET /monitors returns them. Also fixed the County input's wrong `keyboardType="numeric"` |
| 4 | Unused dependencies | depcheck hits | **Removed** frontend: @gorhom/bottom-sheet, @hookform/resolvers, zod, expo-asset (expo itself depends on it), expo-linking, expo-status-bar (App uses RN StatusBar); devDeps @testing-library/jest-native, eslint-plugin-react-native. backend: body-parser (Express 5 built-ins), p-queue (aiQueue is bullmq/in-process). **Kept deliberately**: react-dom (expo web), expo-dev-client (native dev builds), expo-system-ui (app.json `userInterfaceStyle`), @babel/preset-typescript (babel.config.test.js). Lockfiles regenerated; `npm ci` green in both |
| 5 | Stub sweep | grep TODO/FIXME/coming soon/not implemented/placeholder in runtime code | `useRealtimeMessages` TODO → replaced (above); arrest_ingest TODO/placeholder → replaced (above); `PlaceholderIllustration` (dashed "design placeholder" circle rendered live in JustArrested) → **deleted**, screen now uses the finished `IllustrationRights` SVG; payments "coming soon"/503 → **kept (intentional)**; `[PLACEHOLDER]` in motion/expungement AI prompts → intentional model instruction, kept; `routes/time.js` bind-param refactor TODO + `scripts/update_legal_data.js` "TODO 3B" header → kept (documented tech-debt notes on working code; scrapers are operator-only per step 3); remaining "no-op" mentions are real feature-flag shims (Sentry, ensureTables, webCompat). `LawyerSkeletonCard`/`MotionTypeBadge`/`CaseStatusBadge` stay as unused-but-finished library components (pinned by v11/v154/v163 with prior-step rationale; they mislead no user) |
| 6 | `FlashListCompat` `props: any` | untyped passthrough | **DONE** — generic `FlashListCompat<T>(props: FlashListCompatProps<T>)` = `FlashListProps<T>` + optional FlatList-only virtualization props (still stripped). Surfaced a real bug: CourtLocator passed `maxWidth/alignSelf/width` in `contentContainerStyle`, which FlashList ignores — centered max-width column now lives on a wrapper View (and actually works) |

## Other changes
- Tests added: `arrest_ingest.test.js` (11: config validation, sanitization, no-feed honesty, dry-run, broken-feed error), `arrest_monitors.test.js` (5: matcher rules; fake-DB run proves push + stamping, incl. zero-arrest runs).
- Stale source-pin tests updated to current intent: v8 7-04 + v27 3-03 (route REQUIRED since step 5 — these were failing at HEAD because step 5 never ran backend jest), v8 §5 / v31 S7-03 / v43 S7-03 / v154 M19-02 / v155 M19b-03 (PlaceholderIllustration → Illustrations), v45 S6-03 ("Real-time lead feed" → honest docblock), arrest_visibility PG (sendArrestAlerts result now includes monitor stats).
- smoke-test.mjs: new check "arrest search reports honest feed coverage (feeds_configured)" (32 checks total).
- Live manual verification against the booted prod server: `/arrests/search` → `feeds_configured:false`; case message POST/GET round-trips; monitors return `last_checked`/`last_result`.

## Gate
1. Fresh DB `jg_step6`: all **12** migrations ON_ERROR_STOP, applied **twice** — OK (195 tables incl. views, 600 seed rows kept, new monitor columns present). Dropped after.
2. Backend: `npm ci` OK (new lockfile); import smoke OK; prod boot NODE_ENV=production TZ=UTC (generated secrets, no Stripe, mock Anthropic) `/health` db ok, payments:false; **smoke-test 32/32** (incl. the new feeds_configured check). Startup logs the new "ARREST_FEED_URLS not set — Arrest ingestion disabled" warning.
3. Backend jest (in-memory): **318 suites passed, 1 skipped (PG-only); 27,861 passed, 13 skipped, 0 failed.** With TEST_DATABASE_URL: arrest_visibility + alerts_takedown_pg **15/15**. `npm run lint` 0/0.
4. Frontend: tsc --noEmit **0 errors**; eslint `--max-warnings 0` **0/0**; `npm test` 48 suites/705 + render 2/8 all pass; nav-targets **0 problems** (250 refs); design-audit `--ci` **0** failures in every category; `expo export --platform web` OK (ChildSupport + real Messages bundles present, honest copy in bundles).
5. Headless web smoke vs live backend: **166 checks, 0 failed, 0 page errors, 0 console errors, 0 request storms** (344 API requests).
6. ci.yml: unchanged — new tests run inside the existing in-memory jest step, the new smoke check inside the existing smoke step, and the new migration inside the existing migration loop.

## Chose not to do (and why)
- RecoveryAgentsScreen stays present-but-unregistered: deliberate legal suspension (item 5.5), documented in AppNavigator; not a half-built feature.
- Direct (non-case) messaging UI for `/messages/direct`: LawyerProfile/Lawyers message flows resolve to a case thread (matching the existing LawyersScreen behavior); a separate DM inbox is new product surface, not a half-built one.
- PI lead fee tiering (`billing/pi_leads.js`) still differs from its route's flat-fee comment — attorney-lead scope flagged since step 1, unchanged.
- Did NOT commit (coordinator commits).

## Step 7 — real behavioural tests (completed by coordinator)
- backend/src/__tests__/integration/: 10 suites / 89 tests running every route group the app calls
  against a real migrated Postgres (gated on TEST_DATABASE_URL, skipped in-memory). New CI step runs them
  on the migrated jg_ci database.
- frontend render tests: apiMock.ts harness + authScreens / homeChat / providerScreens suites (31 render
  tests total). Found and fixed a real bug: the consultations booking schema rejected every payload the
  app actually sends (24h time_slot, string-enum duration, required numeric lawyer_id, no lawyer_name);
  schema now matches BookingScreen, which now also sends lawyer_name. Verified live: app payload → 503
  payments_unavailable (payments off), garbage → 400 with field errors.
- Test-only fixes made when finishing the step: LawyersScreen render tests must seed the
  'lawyers_need_shown' AsyncStorage flag (first-visit modal gates fetching — now covered by its own
  test); empty result asserts the status message the user actually sees; CALL NOW matched via getAllByText.
- Verification: backend full jest 0 failed / 27,861 passed / 83 PG-gated skips; integration suite on
  jg_int 89/89; frontend tsc 0, eslint 0/0 (--max-warnings 0), logic 705 + render 31 pass; ci.yml YAML OK.

# STEP 8 — Expo SDK upgrade 52 → 57 (frontend only)

## What the registry says (2026-10-11)
- `expo` dist-tags: `latest` = **57.0.27** (SDK 57); 58.0.x exists but is still tagged `next`
  (prerelease channel, not yet promoted) → SDK 57 is the newest **stable** and is what shipped.
- SDK 57 pairs: react-native **0.86.3**, react/react-dom **19.2.3**, react-native-web **0.21**,
  reanimated **4.5.1** + react-native-worklets 0.10.1, TS ~6.0 (versions taken from
  expo@57.0.27's bundledNativeModules.json + the sdk-57 template, verified by `expo install
  --check` (offline) and expo-doctor).

## Dependency changes (package.json rewritten, lockfile regenerated, plain `npm ci`, no flags)
- expo ~52.0.49 → **~57.0.27**; every expo-* package to its ~57.x line; react 18.3.1 → **19.2.3**;
  react-native 0.76.9 → **0.86.3**; react-native-web 0.19 → **0.21.4**.
- **expo-av removed from SDK 57** → replaced with **expo-audio ~57.0.5** (+ expo-asset ~57.0.19,
  its required peer — flagged by expo-doctor). Recording code migrated (below).
- reanimated ~3.16 → **4.5.1** + new **react-native-worklets 0.10.1** (babel-preset-expo wires the
  worklets plugin automatically); gesture-handler 2.20 → 2.32; screens 4.4 → 4.26.2;
  safe-area-context 4.12 → 5.7; svg 15.8 → 15.15.4.
- @react-navigation v6 (now marked unsupported, pulls vulnerable query-string) → **v7**
  (native 7.5.0, bottom-tabs/native-stack 7.20.0).
- @shopify/flash-list 1.7.3 → **2.0.2**; @stripe/stripe-react-native 0.38.6 → **0.64.0** (SDK-57
  pin); @sentry/react-native 6.10 → **7.11.0**; async-storage 1.23 → 2.2.0; netinfo 11 → 12;
  picker 2.9 → 2.11.4; mixpanel 3.3 → 3.8.1.
- Dev: typescript 5.3 → **6.0.3**; @typescript-eslint 8.59 → 8.71.1 (TS 6 support); jest-expo 52 →
  **57.0.5**; @testing-library/react-native 12.9 → **13.3.3**; react-test-renderer 18.3.1 → 19.2.3
  (jest-expo 57's exact pin). jest stays 29.7 (jest-expo 57 is a jest-29 preset).
- No --legacy-peer-deps anywhere; `npm ci` resolves clean. expo-doctor **19/21** (the 2 failures
  are network-only in this sandbox: exp.host schema fetch + RN Directory query).

## Code fixes for breaking changes (29 tsc errors → 0)
- **expo-av → expo-audio**: VoiceNoteScreen + InterrogationRecorderScreen now use
  `useAudioRecorder(RecordingPresets.HIGH_QUALITY)`, `requestRecordingPermissionsAsync()`,
  `setAudioModeAsync({allowsRecording, playsInSilentMode})`, `recorder.stop()` / `recorder.uri`
  (hook releases the mic on unmount); webCompat's AudioMode shim now dynamic-imports expo-audio.
  Web variants (.web.tsx MediaRecorder) untouched.
- **FlashList v2**: `estimatedItemSize` prop removed from 15 screens (v2 self-measures);
  FlashListCompat accepts-and-strips it as a legacy prop; ChatScreen ref type `FlashList<T>` →
  `FlashListRef<T>`.
- **react-navigation v7**: `tabBarTestID` → `tabBarButtonTestID`; linking config/navigationRef/
  getStateFromPath patterns unchanged and verified by the smoke's 63 deep-link paths.
- **RN 0.86**: `StyleSheet.absoluteFillObject` removed → `absoluteFill` (ScreenHeader).
- **React 19 types**: `useRef()` without initial value no longer allowed → explicit `(undefined)`
  in BarPrepQuizScreen (2 sites).
- **expo-notifications**: NotificationBehavior now requires `shouldShowBanner`/`shouldShowList` —
  added in App.tsx + services/push.ts handlers.
- **expo-haptics on web is no longer a silent no-op**: LessonsScreen fired a mount-time success
  haptic that Chromium blocks (`navigator.vibrate` before user gesture) and logs a console error →
  now gated off web. Press-triggered haptics (HapticButton, EmergencyStrip) stay — they run inside
  a user gesture.

## Android store requirement
- `expo prebuild --platform all` on a scratch copy (no Firebase files): **succeeds**; generated
  project resolves SDK versions from RN 0.86's version catalog via `expoAutolinking.
  useExpoVersionCatalog()` → **targetSdk 36 / compileSdk 36** (Expo plugin fallback floor is 35).
  ≥ 35 requirement met.

## npm audit (the point of the exercise)
| | critical | high | moderate | total |
|---|---|---|---|---|
| before (SDK 52) total | 1 | 59 | 32 | **92** |
| before prod (--omit=dev) | 1 | 36 | 25 | **62** |
| after (SDK 57) total | 0 | 52 | 12 | **64** |
| after prod | 0 | 29 | 5 | **34** |
- The critical (tar, via SDK 52's CLI) and the nav-v6 query-string/decode-uri-component chain are
  gone. **Every remaining flag traces to 3 advisories with no patched release at all** (latest
  version == vulnerable range, ecosystem-wide): `braces` ≤3.0.3 (micromatch — inside metro *and*
  jest, poisons ~50 transitive rows incl. expo/react-native themselves), `node-forge` ≤1.4.0
  (@expo/cli + expo-updates code-signing; build-time), `sprintf-js` ≤1.1.3 (jest's argparse,
  electron-builder's roarr; dev-only). Nothing further to pin until upstream publishes fixes.

## Verification (all green)
- `npm ci` (no flags) OK, Node 22.22; `tsc --noEmit` **0 errors** (TS 6.0, full strict);
  `eslint src App.tsx --max-warnings 0` **0/0**; design-audit --ci all categories 0;
  check-nav-targets **250 refs / 73 targets / 0 problems**.
- `npm test`: logic **48 suites / 705 tests**, render **5 suites / 31 tests** — all pass
  (jest-expo 57 + RNTL 13 + react-test-renderer 19.2.3).
- `expo export --platform web`: 79 chunks, 6.0 MB; index.html + Home/Chat/Lawyers/Payments/
  Settings chunks present; **0** electron-log/updater/ipcRenderer matches; default API base baked
  in (metro EXPO_PUBLIC_* cacheVersion fix still effective — smoke build carried localhost:4700,
  release build carries api.justicegavel.app). `--platform android`: Hermes .hbc exported.
- Web smoke vs live backend (fresh DB jg_step8: 12 migrations ×2 ON_ERROR_STOP, 195 tables;
  backend NODE_ENV=production on :4700, mock Anthropic :4710, payments off): **166 checks,
  0 failed, 0 page errors, 0 console errors, 0 request storms** (343 API requests). Payments-
  disabled copy and web Stripe stubs verified by the smoke's phase-B 503 checks.
- Electron (xvfb + CDP, web-build from the new stack): app://justicegavel/ boots, Settings renders
  via __navigateTo (screenshot verified), SPA fallback 200 / missing asset 404 / traversal 404,
  **0 page errors**.
- Backend untouched; full backend jest run after the frontend diff: **27,860 passed / 83 PG-gated
  skips / 1 failed** — v19 7-05 pinned the string "expo-av" in webCompat.ts. Fixed from the
  frontend side (the shim's comment now reads "expo-audio — replaces the removed expo-av", which
  is simply true); 7-05 re-run passes. backend/ and supabase/ have zero diffs.
- Versions: package.json + app.json **8.7.59**, iOS buildNumber **8759**, Android versionCode
  **8759**, sw.js cache `justice-gavel-v8.7.59`.
- ci.yml: **unchanged** — Node 22 and every command/check still apply as written (verified by
  running the frontend job's steps locally, including the bundle-content checks).

## Chose not to do / notes
- SDK 58 (`next`) not taken: not yet the npm `latest` stable; first-party pairings (e.g.
  expo-notifications 58.1.x) were still churning on the next channel.
- jest 30 (npm's suggested "fix" for braces/sprintf-js) not taken: jest-expo 57 is a jest-29
  preset, and braces/sprintf-js have no fixed release anyway — the flags would survive.
- eslint 9.39.5 prints a deprecation notice (v10 exists); left as-is — flat config and
  @typescript-eslint 8.71 both work, and the lint gate is 0/0. Candidate for a later chore.
- `newArchEnabled: true` kept in app.json (SDK 57 is new-arch-only; key is tolerated).
- react-native-markdown-display 7.0.2 unchanged — still the latest release and works under
  React 19 (exercised by ChatScreen render tests + smoke).

# STEP 9 — performance & operations (indexes, runtime, bundle, ops)

## 1. Database indexes — migration `supabase/migrations/00000000000012_performance_indexes.sql`
(The brief named it `…10_performance_indexes.sql`, but 10 = takedown_review and 11 = arrest_monitor_checks
already exist, so it is number 12. Index-only, `IF NOT EXISTS` everywhere, applied twice cleanly.)

Method: scratch DB migrated 00..11 with the real seeded reference data (2,055 lawyers / 1,265 bail
agents / 600 seed arrests), plus synthetic volume from a scratchpad script (NOT a migration): 50k users,
200k cases, 200k case_messages, 300k chat_sessions rows, 200k arrest_records (source `feed_synth`),
150k refresh_tokens, 100k saved_lawyers, 120k bar_prep_progress, 100k direct messages, 100k docket
entries, 30k bookings, 20k subscriptions. Every candidate was kept only if EXPLAIN (ANALYZE, BUFFERS)
showed the planner using it with a real win.

Before → after (execution time, the exact SQL the routes issue):
| query (route) | before | after | index |
|---|---|---|---|
| case thread `GET /api/messages/:caseId` | 22.3 ms | 0.08 ms | `idx_case_messages_case_sent (case_id, sent_at DESC) WHERE deleted_at IS NULL` |
| unread badge `GET /api/messages/unread` | 22.8 ms | 0.14 ms | `idx_case_messages_unread (case_id) WHERE read_at IS NULL` |
| read-marking UPDATE on thread open | seq scan | index scan | same (predicate deliberately `read_at IS NULL` only — the UPDATE has no deleted_at filter, so a stricter predicate would disqualify it) |
| chat history `GET /api/chat/history/:id` | 31.5 ms | 0.07 ms | `idx_chat_sessions_session_created (session_id, created_at DESC)` |
| chat free-tier daily count (ask/stream) | 35.1 ms | 0.03 ms | `idx_chat_sessions_user_created (user_id, created_at DESC)` |
| arrest name search `GET /api/arrests/search?name=` | 154.5 ms | 6.1 ms | `idx_arrest_records_name_trgm` GIN `gin_trgm_ops` (ILIKE '%…%' is only trigram-indexable) |
| arrests by county+24h `GET /api/arrests/recent` | 93.1 ms | 0.39 ms | `idx_arrest_records_county_lower (LOWER(county), created_at DESC)` |
| scheduler unsent-arrest 24h scan (alerts + bot) | 85.9 ms | 0.50 ms | `idx_arrest_records_created (created_at DESC)` |
| saved lawyers `GET /api/saved/lawyers` | 16.3 ms | 0.05 ms | `idx_saved_lawyers_user_saved (user_id, saved_at DESC)` |
| lawyers city path `GET /api/providers/lawyers?city=` | 1.5 ms | 0.12 ms | `idx_lawyers_city_lower (LOWER(city), state) WHERE COALESCE(active,1)=1` |
| bail bbox GPS path `GET /api/providers/bail` | 0.8 ms | 0.08 ms | `idx_bail_agents_lat_lng (lat,lng) WHERE COALESCE(active,1)=1` |

The lawyers/bail indexes resurrect what the baseline schema SKIPPED (its comments show them dropped
because `active`/`lat`/`lng` didn't exist yet — migration 3 added the columns and nobody revisited).
pg_trgm: `CREATE EXTENSION IF NOT EXISTS` inside a DO block that catches insufficient_privilege /
undefined_file and skips only the trigram index — migration succeeds with or without it (Supabase
ships pg_trgm; local PG16 contrib verified).

Tested and REJECTED (planner ignored them or gain was noise): `arrest_records(state, booking_date)`;
partial `docket_entries(due_date) WHERE status='pending'` (overdue query LIMITs out of a seq scan at
0.5 ms); partial consultation-reminder index (unindexable `(date_slot||time_slot)::timestamp`
dominates, 4.4→3.6 ms hourly); refresh-token cleanup indexes (the daily DELETE removes most rows, scan
is the cheap part). Refresh rotation already rides the `(user_id, token_hash)` PK (0.09 ms);
cases-by-user and bar-prep progress were already covered by migrations 0/4. `charges ILIKE` stays
unindexed (a second GIN taxes every ingest write; name is the primary family-search key).

## 2. Backend runtime
- gzip + strong ETags verified live: `compression()` + `app.set('etag','strong')` were already wired;
  spot-check shows `Content-Encoding: gzip` + `ETag` on /api/providers/lawyers.
- Pagination: lawyers & bail cap `limit` at 50 (city path reads ≤300 candidates, fallback ≤500 before
  paging); arrests search ≤100 / recent ≤500. Now documented in API_REFERENCE.md.
- **Production logs are one-line JSON.** `utils/logger.js` now defaults to JSON when
  NODE_ENV=production (LOG_FORMAT=text opts out); morgan's prod format replaced with a JSON line that
  logs `req.originalUrl` **without the query string** (search params carry names/emails — verified a
  `?city=PIIMARKER` request leaves zero trace), plus request_id/status/bytes/ms. Spot-checked auth,
  messages and the global error handler: they log `e.message` and ids only — no tokens, no bodies.
  Also fixed `selfHealing.runHealthCheck` writing `process.env.SELF_HEAL_SECRET` into its results.
- **Slow-query log added** in db/index.js: queries ≥ SLOW_QUERY_MS (default 500 ms, 0=off) WARN with
  the SQL text — bind placeholders only, never parameter values. Verified: `pg_sleep(0.2)` logs
  `{ ms: 202, sql: 'SELECT pg_sleep(0.2)…' } [db] slow query`.

## 3. Frontend perf
- `expo export --platform web`: 79 chunks. Main bundle **4,244 KB → 3,368 KB minified (−21%);
  1,056 KB → 902 KB gzipped**. Top chunks after: CaseScreen 227 KB (markdown-display +
  expo-calendar + expo-image-picker — already lazy), __common 186 KB, FirmVerticalScreen 94 KB.
- The win: source-map-explorer showed **react-native-reanimated (836 KB) in the web ENTRY bundle**
  with exactly one app consumer — SkeletonLoader's opacity pulse. Replaced the pulse with core RN
  `Animated` (identical visuals) and deleted the otherwise-unused `utils/animations.tsx`. Reanimated
  still landed in the entry via gesture-handler's *guarded* `try{require('react-native-reanimated')}`
  (Metro bundles any static require), so metro.config.js now resolves the package to an empty module
  **on web only** — the wrapper's own `Reanimated?.useSharedValue` fallback is the supported
  no-reanimated path. Native bundles untouched; package stays installed (SDK 57 pairing).
- Verified on real Chromium: headless web smoke vs live prod backend — **166 checks, 0 failed,
  0 page errors, 0 console errors, 0 request storms** (343 API requests).
- List screens: all FlashList with stable keys (`String(item.id)`; BailSearch falls back to index only
  when a row has no id). Lawyer cards render **no images at all** (text + badge views), so there is no
  unsized-image layout thrash to fix.
- Not done (documented): the Sentry web stack is ~940 KB of the remaining entry (replay/feedback
  included because Metro doesn't tree-shake); no cheap safe fix. 69 screens were already React.lazy;
  the eager ones are startup/tab roots, worth ~100 KB total — left alone.

## 4. Ops polish
- `/metrics` now includes **db_pool {total, idle, waiting, max}** from new sync `getPoolStats()`
  (in-memory pg Pool counters — zero queries), alongside the existing in-process AI queue stats and
  memory; Prometheus format gained jg_db_pool_* gauges. Verified live.
- **Graceful shutdown drains the AI queue**: new `drainLocalJobs()` waits (AI_DRAIN_TIMEOUT_MS,
  default 10 s, within the 25 s force-exit) for in-flight in-process jobs before `stopAIWorkers()`
  closes BullMQ workers (whose `close()` already waits on active jobs). Verified: SIGTERM →
  "in-process queue drained" → "Shutdown complete" → clean exit.
- **Memory watchdog refit for the 512 MB Railway container**: it watched *heap* with warn 384 / crit
  512 / restart 600 MB — unreachable before the kernel OOM-kills on RSS. Now watches **RSS** with
  thresholds derived from MEMORY_LIMIT_MB (512 default): warn 72% (368 MB), crit+GC 85% (435 MB),
  graceful restart 93% (476 MB). Its interval is now registered so stopAllWatchdogs() clears it.
- **Found & fixed a production-killer:** server.js armed the quarterly bar re-verification with
  `setInterval(fn, 90 days)` — 7,776,000,000 ms overflows Node's 32-bit timer and clamps to **1 ms**
  (TimeoutOverflowWarning observed), so 2 minutes after boot the job ran in a tight loop: ~2.07M
  runs/log lines in ~40 min of soak, DB query per run. Now a daily tick that fires only when 90 days
  have elapsed. Soak after fix: exactly 1 run, 0 overflow warnings, 84 log lines.
- Docs: LIVE_REFRESH and HEALTH_CACHE_MS were already in RAILWAY_ENV_SETUP.md; expanded
  HEALTH_CACHE_MS and added SLOW_QUERY_MS, PG_POOL_MAX, MEMORY_LIMIT_MB, AI_DRAIN_TIMEOUT_MS,
  LOG_FORMAT there and in ENVIRONMENT_VARS.md + .env.example + config.js ALL_ENV_VARS.

## Gate
1. Fresh DB `jg_step9_gate`: all **13** migrations ON_ERROR_STOP applied **twice** — OK. 195 tables;
   row counts unchanged (600 arrests / 2,055 lawyers / 1,265 bail agents); 10 new indexes present.
2. Backend: `npm ci` OK; import smoke OK; prod boot (NODE_ENV=production TZ=UTC, generated secrets,
   no Stripe, mock Anthropic) — **smoke-test 32/32**, run twice (before and after the server.js timer
   fix). Live: gzip+ETag, /metrics db_pool, JSON one-line logs without query strings, slow-query warn,
   SIGTERM drain + clean exit.
3. Backend jest (in-memory), re-run after every change: **318 suites passed / 10 PG-gated skipped,
   27,861 passed / 83 skipped, 0 failed.** PG-gated suites on a migrated DB (integration +
   arrest_visibility + alerts_takedown_pg): **12 suites / 104 tests, all pass.** `npm run lint` 0/0.
4. Frontend: tsc --noEmit **0**; eslint --max-warnings 0 **0/0**; logic **48 suites / 705** + render
   **5 / 31** all pass; design-audit --ci all categories **0**; nav-targets **250 refs / 0 problems**;
   `expo export --platform web` OK; headless web smoke **166 / 0 / 0 / 0**.
5. ci.yml: **unchanged** — the migration step globs `supabase/migrations/*.sql` (picks up 12), and the
   postgres:16 CI image ships pg_trgm; lint/jest/smoke steps apply as written.

## Chose not to do (and why)
- GPS lawyers path still loads all active lawyers into memory for haversine+radius expansion — at
  2,055 rows it is ~1–2 ms; an SQL bbox would change the radius-fallback semantics (feature refactor).
- No index on `refresh_tokens` cleanup, `docket_entries`, `consultation_bookings`, `charges` — EXPLAIN
  rejected them (details above).
- Sentry web bundle weight and the eager startup screens — noted above, not cheap/safe.
- bar-prep leaderboard (computed-expression ORDER BY over a 20-row LIMIT) left unindexed — not one of
  the hot paths and not btree-servable.
- Did NOT commit (coordinator commits).

# STEP 10 — documentation (built on the earlier partial attempt, wip commit ef4a4ed)

## What changed
- **README.md**: one concise README at v8.7.60. Covers architecture (Expo SDK 57 / RN 0.86 / React 19; Node 22 / Express 5; 13 migrations 00..12 applied with psql; Resend; Claude via CLAUDE_MODEL, default claude-sonnet-4-6), payments off until Stripe keys are set, and flat lead fees checked against leadFee.js / attorneyLeadFee.js (bondsman $100, PI/medical $200, civil rights $200, employment $100, ICE $75). Also covers quick start, tests, deploy, a doc map and corrected security notes.
- **Quick start verified verbatim** in a scratch copy (PGUSER/PGPASSWORD set in the environment only):
  - `npm ci`, createdb, the migrate loop, `npm start` and `/health` all worked (version 8.7.60), and smoke-test passed 32/32.
  - `cp .env.example .env` then boot also worked.
  - Frontend: `npm ci` and `EXPO_PUBLIC_API_BASE=… npx expo start` served index.html and the web bundle (200, 8.8 MB).
  - QUICKSTART's root-level migrate loop and `design-audit --ci` also worked.
- **Env docs**: RAILWAY_ENV_SETUP.md is the single reference.
  - config.js `ALL_ENV_VARS` now lists exactly what the code reads (124 vars). Added 44 that were missing (integration OAuth pairs, Sentry, Supabase, bondsman Stripe ids, PORT, DEMO_MODE, LIVE_*, POSTGRES_URL, RAILWAY_ENVIRONMENT, …).
  - Removed 2 vars that nothing reads (UPLOAD_DIR, BOT_WEBHOOK_BASE_URL), plus the fake built-in Stripe price-id fallbacks (nothing ever used them).
  - backend/.env.example and root .env.example are identical: every var with a placeholder, plus the EXPO_PUBLIC_* section. frontend/.env.example was fixed.
  - ENVIRONMENT_VARS.md is a pointer. The stale backend/.env.manifest was deleted.
  - Honest descriptions added for LIVE_PAYMENTS (only the /api/pay orchestrator), LIVE_EMAIL, DEMO_MODE (label only) and the alt-payment adapters (mock stubs, "leave unset").
- **New test `env_docs_consistency.test.js`** (7 tests). It scans process.env reads (dot, bracket and destructuring) and requires ALL_ENV_VARS = the code set. Every var must also appear in RAILWAY_ENV_SETUP.md and the .env.example files (no unused backend lines). Root must equal backend, EXPO_PUBLIC_* must match frontend reads, and placeholders must contain no real secret values.
- **OpenAPI**: kept the earlier runtime route walker and generator, then improved both.
  - `staffOnly` is now recognised.
  - The spec adds `x-requires-ai` + 503, `451` on requireDisclaimer routes, and `x-payments-gated` + 503 on the 16 operations that return payments_unavailable.
  - The BadRequest shape now matches zod's `errors[]`.
  - Regenerated: 475 paths / 559 ops (485 bearer, 74 public/admin-key).
  - `npm run generate:openapi` works from the root (new script) and from backend/.
  - openapi_drift.test.js was proven to fail when a path is removed.
- **API_REFERENCE.md** is an overview. It was corrected against the code:
  - Real error shapes: zod `errors[]`, the 404 shape, and 5xx messages hidden in production.
  - 451 disclaimer flow, the exact payments_unavailable / ai_unavailable bodies, and which writes are payment-gated.
  - Refresh rotation and reuse revocation.
  - Rate limits with their env knobs.
  - `/api/admin` needs a token role plus X-Admin-Key.
  - Outbound webhooks are firm subscriptions, not bot callbacks.
- **Other docs updated after checking against the code**: RUNBOOK, LAUNCH_CHECKLIST, QUICKSTART, EXTERNAL_SERVICES_SETUP, UPTIME_MONITORING, FACT_CHECK_RUNBOOK, PHASE_2_ROADMAP (test count removed), railway-checklist, setup-railway.sh, SDK_GUIDE, APP_STORE_LISTING, frontend BUILD_INSTRUCTIONS and e2e/README.
  - EXTERNAL_SERVICES_SETUP had a wrong Stripe product table. It is now the real plans and prices, including the bondsman ids.
  - Google Places is used by the operator scrapers only. OpenAI is for Whisper only.
  - SDK_GUIDE: /api/match → /api/match/lawyers, refresh_token → refreshToken, expungement/check is a GET.
  - APP_STORE_LISTING:
    - Removed a committed reviewer password.
    - Removed the false "all attorneys bar-verified" claim (0 of 2,055 are).
    - Removed "licensed bail agents" (0 of 1,265 have a license number).
    - Removed the claim that the app does not handle attorney-client communications.
  - e2e/README now says the Detox suite is not wired up. RUNBOOK: replaced railway CLI commands that don't exist, and the bar-verification sweep needs an admin token plus X-Admin-Key.
- **Archived** to docs/archive with a banner:
  - BONDSMAN_OUTREACH.md: it pitches badge "top of search" placement and arrest volumes the product doesn't have.
  - BILLING_DECOMPOSITION_PLAN.md: already done, and it mentions calcLeadFee.
  - The earlier attempt had already archived DEVELOPER_HANDOFF, DEVELOPER_NOTES_PHASE2, SIMULATION_REPORT, TODO, CIVIL_ATTORNEY_DATA and i18n_legal_audit.
  - docs/fix-notes/README.md exists.
- **docs/LEGAL_ACTION_ITEMS.md**:
  - States that the owner chose the flat fees.
  - New A0 item: a lawyer must still review the lead-fee structure, the UPL disclaimers/451 gate, state-rule accuracy, the privacy subprocessor list and the paid-placement copy.
  - Price display mismatch added under A5.
  - Bail-agent count corrected to 1,265.
- **Small code fixes found through the docs**:
  - discovery/analyze.js only read `STRIPE_SECRET`, so analysis stayed free even with STRIPE_SECRET_KEY set. It now uses `STRIPE_SECRET_KEY || STRIPE_SECRET`.
  - Dropped the SendGrid env alias from email.js.
  - In-app PrivacyPolicyScreen listed SendGrid as the email processor; it now says Resend.
  - Dockerfile no longer sets the unused UPLOAD_DIR.
- **Versions**: everything is 8.7.60, including root/backend/frontend package.json, app.json, iOS buildNumber 8760 / Android versionCode 8760, sw.js, README, /health and X-API-Version. The backend reads backend/package.json through utils/version.js with no fallback. New `version_alignment.test.js` (5 tests) enforces all of it.
- Tests updated for the moves: lead_fee_consistency (archived outreach path) and v156 I1-04 (unused vars removed).

## Global grep (outside docs/archive, docs/fix-notes, node_modules; *.md, *.example)
- **sqlite**: remaining hits only describe the dev-only fallback without DATABASE_URL (true; db/index.js) and the operator scripts that still write local SQLite (true). None claims SQLite as the runtime DB.
- **sendgrid**: 0 in docs. Code keeps the `sendgrid_id` column name only.
- **Tiered fees** (tiered/bail-scaled/severity/$25–$300/$15–$1,000): 0. The only hits are README's "flat — never scaled" and RUNBOOK's incident severity levels.
- **Test-count / "0 errors" metrics**: 0. The PHASE_2 count and the README "0 errors" comments were removed.
- **RLS**: README and LAUNCH_CHECKLIST say "deny-all, no policies". Verified on a fresh DB: 188/188 public tables have RLS on and pg_policies = 0.
- **Port 3000 / localhost:3000**: 0. The CORS line no longer lists it.
- **Retired model id** (claude-sonnet-4-20250514 / claude-3*): 0 anywhere outside archive/fix-notes.
- **Secret values** (sk_live/test, sk-ant, whsec, re_, 64-hex, JWTs, AIza): 0 in all docs, including archive and fix-notes.

## Flagged, not fixed (outside a docs step, or owner/legal decisions)
- `POST /api/checkins/remind-all` is unauthenticated: anyone can trigger pushes to every user with a check-in due. `GET /api/checkins/my/:id` and `/status/:id` are also public. The generated spec makes this visible.
- Most role checks (including /api/admin/*) read the token's role claim, which can be up to 30 days old. Only takedown/disposition/research indexing re-read the role from the DB. Verified live: a demoted admin's old token still passes the /api/admin guard (with the admin key). The docs that claimed "roles always come from the DB" were corrected, and a LAUNCH_CHECKLIST item was added.
- `/api/admin/lawyers` and `/api/admin/bail` return 500 "Unknown table": safeTable's allowlist lacks lawyers/bail_agents. Left alone because those rows must not be modified anyway.
- billing/bondsman.js has an unreachable `!LIVE` mock badge activation. The router-level 503 gate blocks it.
- payments/* alt-provider adapters (PayPal, Braintree, Square, …) are mock stubs that return placeholder URLs. They are documented as "leave unset".
- Bondsman SubscriptionScreen prices and the "Top placement" copy disagree with the backend and with search ordering. These are in LEGAL_ACTION_ITEMS.
- Operator scrapers, which the nightly scheduler runs when LIVE_REFRESH=true, still write local SQLite. This is documented.
- Did NOT commit. The two renames are staged via git mv, the .env.manifest deletion via git rm.

## Gate
1. Fresh DB `jg_s10doc`: 13 migrations ON_ERROR_STOP applied twice, OK. 188 tables, all RLS on, 0 policies. Seed counts: 2,055 lawyers, 1,265 bail agents, 531 recovery agents, 404 courthouses, 504 bail schedules, 50 lessons, 600 sample arrests.
2. Backend:
   - `npm ci` OK, `npm run lint` 0/0, import smoke OK.
   - Production boot (NODE_ENV=production TZ=UTC, generated secrets, no Stripe, mock Anthropic): /health version 8.7.60, X-API-Version 8.7.60, **smoke-test 32/32**.
   - Live checks: 451 disclaimer_required, 503 payments_unavailable body, zod 400 shape, admin guard 401 without the key.
3. Backend jest (in-memory): **320 suites passed / 10 PG-gated skipped; 27,872 passed / 83 skipped / 0 failed**. Suites edited mid-run were re-run: 10 suites / 142 tests pass. PG-gated suites with TEST_DATABASE_URL on a fresh migrated `jg_s10pg` (integration, arrest_visibility, alerts_takedown(_pg), final_pass_fixes): **14 suites / 136 tests pass**.
4. Frontend: tsc 0; eslint --max-warnings 0 gives 0/0; npm test 48/705 logic + 5/31 render pass; `expo export --platform web` OK (sw.js cache v8.7.60); design-audit --ci 0.
5. ci.yml unchanged and valid YAML. The new tests (openapi drift, env docs, version alignment) run inside the existing jest step. Scratch DBs were dropped and scratch servers stopped.

# STEP 11 — audit11 remediation (finished from wip checkpoint 3dae8ea)

## Starting point
`3dae8ea` held two interrupted agents' work: security fixes C1–C5/H1–H9/M4/M8 with PG tests for
C1–C4/H1–H8 (no C5/H9/M4 tests, CI not running them), and functional fixes H10–H12/M1–M7 with no
tests, no M7 fix, no verification. Full jest on the checkpoint: 44 failures; frontend eslint 1 error;
render tests 8 failures (api mock lacked the new helpers).

## What step 11 changed (on top of the checkpoint)
- **C1 hardening**: consultation-based self-assignment matched `consultation_bookings.lawyer_id`
  (a directory id) against the caller's USER id → any account whose id equals a booked lawyer's id
  could claim that client. Now only via the account's linked listing. Attorney inbox no longer shows
  unread message bodies / client e-mail / today's hearings to pending or revoked counsel; fixed the
  `OR`-precedence bug that listed every booking regardless of status/date.
- **M6/IDOR**: `/chat/stream` loaded history by `sessionId` without the user filter (another user's
  conversation could be pulled into the prompt). Scoped.
- **C5**: transcription routes refuse before reading the body when Whisper isn't configured or the
  plan lacks it. **H9 class**: SSRF guard applied to DMS / CalDAV firm-supplied URLs.
- **H3**: token refresh paths refuse suspended/deleted/disabled accounts (was: banned only).
- **Billing**: bondsman tier subscribe activated a tier for free when Stripe was set but the tier had
  no price id → now 503 payments_unavailable; dead mock badge activation removed (503).
- **Data loss**: `GET /api/cases` never returned notes, so editing any case from CaseScreen re-sent
  `notes:''` and erased the user's encrypted notes. List/create now return decrypted notes.
- **Frontend**: M7 carousel uses measured width (+ removed invented "4.9 App Store" rating);
  provider plan Cancel restored; `$48.99` badge copy → `$49`; print/PDF HTML escaping via new
  `utils/html.ts` (titles were no longer pre-encoded after M1); crisis-lines refresh unwraps the
  envelope (same crash class as H12); bail calculator dark-mode explainer was invisible
  (green on green) and the web state picker unreadable; BailSearch console.warn dev-guarded;
  onboarding "licensed bail agents" → "bail agents" (0 of 1,265 have license numbers);
  `/api/advocacy` invented counters removed (L4).
- **M1 repair**: `backend/scripts/repair-legacy-entities.mjs` (dry run default, `--apply`), tested on
  planted encrypted + plain rows, idempotent; listed in LAUNCH_CHECKLIST.
- **Tests added**: `security/c5_uploads`, `security/h9_ssrf`, `security/m4_email_escaping`,
  `security/l1_no_personal_emails`, `integration/audit11_functional` (H11×6, M1, M2, M5, M6×2),
  C1 +3 cases; frontend `render/audit11.test.tsx` (H10×3, H12×2, M3, M7);
  `frontend/scripts/web-journeys.cjs` (real-backend headless journeys: H10 desktop+phone, M6, H12,
  H11, M1, M7). web-smoke Phase B now loads real plan catalogues. 44 stale source-text assertions
  updated to the new behaviour; `api_contract` 200+error regex made statement-local;
  `migration_idempotency` RLS check pinned to `08_enable_rls`; `nav_scan` accepts App.tsx root
  modals; `arrest_visibility` uses a real bondsman account (live roles + C2).
- **CI**: new step runs `src/__tests__/security` with TEST_DATABASE_URL; `final_pass_fixes` added to
  the PG step. openapi.json regenerated (482 paths / 568 ops).
- **Docs**: README security notes, LAUNCH_CHECKLIST (live roles, repair script), RUNBOOK scheduled
  jobs (reminder dispatcher, remind-all), API_REFERENCE (live roles, fail-closed).
- Full per-finding table: `audit11.md` → "Remediation status" (copied to docs/fix-notes/audit11.md).

## Live attack replay (production mode, fresh DB, no Stripe) — 19/19 blocked
C1 assign 403 / read 403 / post 403 · C2 ordinary list 403, verified attorney sees no contact, accept
503 payments_unavailable · C3 GET/PUT/team 404 · C4 entry/matter GET, PUT, DELETE 404, row intact ·
H5 404/404 · M8 404/404 · H1 401 · H2 401/401 · H4 lawyers 200 / bail 200 · H6 403 · H7 anon 403/403,
0 Anthropic calls · H8 cert-less config 400, unsigned assertion 401, no token · H9 5 internal URLs 400 ·
M1 exact round trip · M5 201 · H11 `scheduled_for` 201 + 4 reminders for a free account · H12 87 rows ·
C5 4×95 MB → 413/400/429, RSS +49 MB, no restart, temp dir empty · H3 demoted admin's old token
200 → 403 after the 60 s cache. Live reminder dispatch: due court reminder delivered to the mock Expo
endpoint within 6 s (status sent, channel push).

## Gate
1. Fresh DBs (`jg_s11live`, `jg_s11pg2`): all **15** migrations ON_ERROR_STOP applied **twice** — OK;
   196 tables, 0 tables without RLS; lawyers 2,055 / bail_agents 1,265 with identical md5 checksums
   across fresh and exercised DBs (never modified).
2. Backend: `npm ci` OK; `npm audit --omit=dev --audit-level=high` 0; `npm run lint` 0/0; import smoke
   OK; production boot (TZ=UTC, generated secrets, no Stripe, mock Anthropic) → **smoke-test 32/32**.
3. Full backend jest (in-memory): **322 suites passed / 20 PG-gated skipped; 27,904 passed /
   169 skipped / 0 failed** (+ `security/l1_no_personal_emails` added after that run: 2/2).
   PG-gated (integration + security + arrest_visibility + alerts_takedown(_pg) + final_pass_fixes)
   on fresh `jg_s11pg2`: **27 suites / 242 tests, 0 failed**.
4. Frontend: tsc **0**; eslint --max-warnings 0 **0/0**; npm test logic **48 / 705** + render
   **6 / 38** pass; nav-targets 250 refs / 0 problems; design-audit --ci 0; `expo export --platform
   web` OK; headless web smoke **166 checks / 0 failed / 0 page errors / 0 console errors / 0 storms**;
   web-journeys **8 / 0 failed**.
5. ci.yml updated (security suite step; final_pass_fixes) and valid YAML.

## Not done (and why)
- No generic cross-user IDOR sweep over every `:id` route — each audited class has its own
  attack + legit tests; a blind sweep over 568 ops needs per-route fixtures to be meaningful.
- `/api/legaldata/*` (bail schedules) still requires sign-in; guests get the error state. Product call.
- Other screens' web `<Picker>` may share the contrast issue fixed in the bail calculator.
- web-journeys needs a live backend + Chromium, so it is a documented script, not a CI step (like web-smoke).
- Did NOT commit. Scratch DBs dropped and scratch servers stopped.

# STEP 12 — operator data refresh moved from SQLite to the main Postgres DB

## What was wrong
Every scraper/importer in `backend/src/scripts/` (refresh, scrape_providers_national,
scrape_state_bars, scrape_recovery_agents, import_csv, import_doi_bondsmen, scrape_arrests)
wrote `backend/data/providers.sqlite` (sqlite3/sqlite), `update_legal_data.js` /
`fact_check_monitor.js` used better-sqlite3 on `demo.db`, `import_doi_supabase.js` overwrote
bail_agents rows through the Supabase REST client (fuzzy match → update, columns that don't
exist), and the LIVE_REFRESH scheduler spawned those scripts — so a nightly run never reached
what the app serves. Also found: the national scraper pushed its "missing states" city list
into the *records* array; the scheduler passed `--type civil` (rejected by yargs);
`update_legal_data.js` "SOL null fix" invented statute-of-limitations years (felony=3,
misdemeanor=1); a real-looking Google API key hard-coded in the six Windows RUN_*.bat/.ps1
wrappers; `scripts/run_doi_import.sh` had a bash syntax error; `data-pipeline/run_refresh.js`
was an orphan that pip-installed sqlite3 into a non-existent `repo/` dir.

## What changed
- **`backend/src/services/dataRefresh/`** (new): `normalize.js` (phone/name/city/url keys,
  lenient comparators), `providerStore.js` (the only write path to lawyers / bail_agents /
  recovery_agents: match by Google place id/source_id → normalized phone (same state) →
  normalized name+city+state; unmatched → INSERT active/unverified with source, source_id,
  created_at/updated_at; matched → per-field proposals, never a row write; chunked
  transactions with a SAVEPOINT per record; same-phone-other-city never proposes
  address/lat/lng/hours), `proposals.js` (list/apply/reject/bulk; apply = row lock, stale
  check (409 unless force), writes one column + updated_at, supersedes siblings, logs
  provider_update_log + audit_log), `googlePlaces.js` (one client: injectable fetch,
  GOOGLE_PLACES_MIN_INTERVAL_MS rate limit (150 ms), GOOGLE_PLACES_MAX_REQUESTS budget (5000),
  retry/backoff on OVER_QUERY_LIMIT/5xx/429, REQUEST_DENIED aborts the run, missing key →
  PlacesKeyMissingError), `runLog.js` (scrape_runs start/finish/skip, Postgres advisory lock
  per job — one `provider_directory` lock shared by every writer of lawyers/bail_agents;
  refuses the sql.js fallback), `providerRefresh.js` (Google/Yelp/bar fetchers; Yelp's listing
  URL is never used as a website; bar parser needs person-like name + phone or bar number),
  `recoveryRefresh.js`, `barCities.js` (121 deduped cities), `scheduled.js` (nightly steps +
  admin `runRefresh`).
- **Migration `00000000000015_provider_refresh_staging.sql`** (idempotent, RLS on):
  `scrape_runs` (job/trigger/params/dry_run/status/counts/message/error_sample) and
  `provider_update_proposals` (table/record/field/old/new/source/run/fetched_at/last_seen_at/
  seen_count/status pending|applied|rejected|superseded/decided_by/at/note) with a partial
  unique index on (table, record, field, md5(new_value)) WHERE status <> 'applied' → reruns
  bump seen_count, a rejected value is never re-proposed, a superseded value is revived.
- **Scripts rewritten onto the store** (all `--dry-run`, all refuse without DATABASE_URL, all
  exit 0 with a clear message when their key is missing, all log a scrape_runs row; shared
  `src/scripts/lib/refreshCli.js`): refresh.js, scrape_providers_national.js,
  scrape_recovery_agents.js, scrape_state_bars.js, import_csv.js (state column / "City, ST"),
  import_doi_bondsmen.js and import_doi_supabase.js (fuzzy match kept as a match *hint*;
  `--reset` refused; no borrowed lat/lng), scrape_arrests.js (Postgres, insert-only,
  normalizeRecord validation, source `roster_<key>`, **not** scheduled), update_legal_data.js
  (Postgres; show / `--set field=value --source-url --verified-by [--dry-run]`, idempotent,
  bail_min/max_cents kept in step, audit_log per field; SOL guessing removed),
  fact_check_monitor.js (read-only Postgres staleness check). seed_providers.js stays a no-op.
  New one-off `import_legacy_providers_sqlite.js` (dry run default, `--apply`).
- **Scheduler**: steps run in-process on the shared pool (no spawn): step 1 provider refresh
  (metros; civil on Sundays) or a logged skip without keys; step 2 arrest ingestion from
  ARREST_FEED_URLS (logged as job arrest_feeds); Sunday step 6 bar listings + recovery agents.
  `runRefresh` kept as an export (now in-process). healthScan/contentRefresh already used
  Postgres — unchanged.
- **Admin API** (`/api/admin`, auth + live DB role admin/super_admin + X-Admin-Key):
  `GET /proposals`, `POST /proposals/:id/apply|reject`, `POST /proposals/apply|reject`
  (bulk ≤500, per-id results), `POST /refresh` (in-process, 202 / 200 skipped, validated
  input; was a detached `node refresh.js` spawn), `GET /refresh/runs`. openapi.json
  regenerated (488 paths / 574 ops).
- Small fixes: `/api/bail`, `/api/recovery-agents`, match fallback order `rating DESC NULLS
  LAST` (unrated new rows no longer float to the top on Postgres).
- **Deps**: removed `sqlite` (dep), `sqlite3` (optional), `better-sqlite3` (dev) + dead
  `__tests__/setup.js` (only user of sqlite3); `sql.js` kept (db/index.js dev fallback,
  tests, legacy import). Dockerfile comment updated. Removed env vars PROVIDERS_DB,
  SUPABASE_PUBLISHABLE_KEY; added GOOGLE_PLACES_MIN_INTERVAL_MS / GOOGLE_PLACES_MAX_REQUESTS
  (config ALL_ENV_VARS, both .env.example, RAILWAY_ENV_SETUP.md).
- **Ops**: `backend/scripts/run-all-scrapes.sh` rewritten (flag parsing, Postgres-only,
  --dry-run/--state, failing step reported, rest continue); `scripts/run_doi_import.sh` needs
  DATABASE_URL (+ syntax fix); hard-coded Google key removed from the Windows wrappers (they
  now require GOOGLE_PLACES_KEY + DATABASE_URL from the environment); npm scripts
  `scrape:recovery[:dry]`, `import:doi`, `import:legacy-sqlite`, `legal:update`,
  `pipeline:full|dry` → run-all-scrapes.sh; `data-pipeline/` deleted.
- **Docs**: RUNBOOK "DATA REFRESH" section (rules, how to run, review endpoints, legacy
  import result) + scheduled-jobs row; RAILWAY_ENV_SETUP, README (Data refresh), QUICKSTART,
  FACT_CHECK_RUNBOOK, EXTERNAL_SERVICES_SETUP, docs/DOI_IMPORT_GUIDE, API_REFERENCE (admin
  queue; stale "admin reads role from token" sentence fixed), LAUNCH_CHECKLIST (apply 15,
  rotate the leaked key, review queue, junk state_bar rows).

## Legacy providers.sqlite
Read (not modified, not deleted) and compared under the same rules against a freshly migrated
DB: lawyers 2,048, bail_agents 1,262, recovery_agents 531 → **0 to insert, 0 to propose**
(all already in Postgres with identical tracked fields). `--apply` run is a verified no-op.

## Tests added
- `__tests__/data_refresh_unit.test.js` (in-memory run, 15): normalizers/comparators,
  matching order incl. other-state/other-city phone, diff allowlist, Places client
  retry/paging/fatal/budget/rate-limit, bar parser junk filter, sql.js refusal.
- `__tests__/refresh/` (PG-gated, Places mocked, 22): data_refresh.int (new provider
  inserted with provenance; verified lawyer + bail agent rows unchanged and a proposal created
  instead; rerun = no dupes/no duplicate proposals (seen_count bump); name-match dedupe;
  absent rows kept active; dry run writes only its log; list/apply/reject/bulk/stale 409;
  plain user 403, no key 401, **demoted admin's valid token 403**; POST /refresh with no key
  → logged skip; CLI scripts exit 0 without key; **md5 of all pre-existing lawyers /
  bail_agents rows identical after every mocked scrape**), importers.int (CSV insert +
  proposal + idempotent re-import, no-DATABASE_URL refusal, recovery agents, update_legal_data
  read-only/dry-run/same-value/sourced write + audit + exact restore), scheduler_wiring.int
  (LIVE_REFRESH=true → startScheduler registers runNightlyJob on REFRESH_CRON; invoking it
  inserts a mocked provider in Postgres and logs scrape_runs providers ok + arrest_feeds
  skipped; no key → skipped run, zero requests).
- security/_world providerChecksum ignores `%JGTEST%` fixture rows; 24 stale source-text
  assertions (file lengths, "Arrest record harvest (97 cities)", SOL guess SQL) updated to the
  new behaviour. CI: new step "Data refresh suite on real Postgres (jest)" (`--runInBand
  src/__tests__/refresh`) after the security step; valid YAML.

## Gate
1. Fresh DB, all **16** migrations ON_ERROR_STOP applied **twice** — OK; 191 base tables,
   0 without RLS; lawyers 2,055 / bail_agents 1,265 / recovery_agents 531 md5 identical on the
   fresh DB and on DBs after the PG suites, live replay and legacy `--apply`.
2. Backend `npm ci` OK, `npm audit --omit=dev --audit-level=high` 0, lint 0/0, import smoke
   OK; production boot (TZ=UTC, generated secrets, no Stripe, mock Anthropic) → smoke-test
   **32/32**; LIVE_REFRESH=true production boot schedules cleanly. Live replay: admin
   promotion picked up from DB (403 → 200 after the 60 s cache), /proposals 200, /refresh
   without keys → 200 skipped + scrape_runs row, no X-Admin-Key 401, bad id 400.
3. Full backend jest (in-memory): **324 suites passed / 23 PG-gated skipped; 27,921 passed /
   191 skipped / 0 failed**. PG-gated on fresh DB: arrest_visibility+alerts_takedown_pg+
   final_pass_fixes 3/40, integration 11/100, security 12/95, refresh 3/22 → **29 suites /
   257 tests, 0 failed**.
4. Frontend not touched.
5. ci.yml updated (refresh suite step).

## Not done / open
- Nightly arrests come only from ARREST_FEED_URLS; the heuristic roster scraper stays a manual
  tool (writing guessed names into arrest_records would feed alerts / outbound SMS).
- Rating / review-count changes are proposals like any other field (one pending row per
  field, superseded nightly) — the queue has no "auto-apply low-risk fields" option.
- Two pre-existing `source='state_bar'` lawyer rows are page headings ("A Colorado Bar
  Association membership…", "Layer") — not touched (owner rule), flagged in LAUNCH_CHECKLIST.
- The removed Google key is still in git history → must be rotated (LAUNCH_CHECKLIST).
- No admin UI for the proposals queue (API only). New rows carry NULL rating when the source
  has none (never the schema's invented 4.0/4.5 default); 15 lawyers / 52 bail agents already
  had NULL ratings and the frontend rating renders are null-guarded (checked LawyerCard,
  LawyersScreen, SavedLawyers, QuickConnect, RecoveryAgents, BailSearch, Match).
- Did NOT commit. Scratch DBs dropped, scratch servers stopped.
