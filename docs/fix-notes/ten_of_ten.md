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
