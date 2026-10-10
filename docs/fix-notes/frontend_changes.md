# Frontend changes — Justice Gavel (branch fix/full-function)

Scope: `frontend/` only, plus removal of the duplicate root `eas.json`. No backend/ or supabase/ edits.
Most code fixes were made in an earlier session's working copy (`scratchpad/jg/frontend`, same baseline
as this repo) and ported here, then re-verified and extended in this session. 144 files changed.

## Toolchain / dependencies
- Aligned to **Expo SDK 52**: react-native 0.76.9, react/react-dom 18.3.1, @types/react ~18.3, reanimated ~3.16,
  every expo-* package at SDK-52 versions; removed react-native-worklets*, @react-native/jest-preset 0.86,
  posthog-react-native, @tanstack/react-query (unused), expo-blur (unused). Added typescript ~5.3.3, eslint 9,
  expo-asset, expo-constants, expo-clipboard, expo-crypto, expo-dev-client, expo-system-ui,
  react-native-gesture-handler. electron-log / electron-updater moved to `dependencies`.
- `overrides`: removed the ones that forced incompatible majors and broke tooling:
  `brace-expansion@5` (broke every minimatch@3 → glob/expo-cli/eslint), `tar@7` (broke `expo prebuild`
  → EAS builds), `uuid@14` (ESM-only; breaks `xcode` on Node 18/20), `@xmldom/xmldom@0.9`, `ws@8`.
  Kept/capped: postcss ^8.5.10, send ^0.19.0, markdown-it >=13, tmp ^0.2.3, uuid ^11.1.0, fast-xml-parser.
- `package-lock.json` regenerated; plain `npm ci` works (no --legacy-peer-deps).
- `package.json` `main` → `index.js`; Electron entry moved to `electron-builder.json` `extraMetadata.main`.
  `build` block removed from package.json (single electron-builder config).
- Versions: package.json / app.json **8.7.58** (iOS buildNumber 8758, Android versionCode 8758, sw cache name).
- `assets/fonts/Inter_*.ttf` were HTML pages (bad downloads) → replaced with real Inter TTFs (OFL).
- `npm test` now runs logic suite + render suite; new scripts `lint`, `check:nav`, `test:render`,
  `smoke:web`, `smoke:electron`.

## Config
- `app.json`: web.output `single`, favicon added (`assets/favicon.png`), `newArchEnabled` top-level, removed
  invalid keys (fonts, android.targetSdkVersion, experiments, sentry-expo hooks); store-listing keys
  (privacyPolicyUrl, termsOfServiceUrl, privacyChoicesUrl, metadata, keywords, shortDescription) moved to
  `extra.store` so the config validates.
- New `app.config.js`: drops `googleServicesFile` refs when the Firebase files are absent; drops the Stripe
  config plugin when no publishable key; disables OTA updates and clears `extra.eas.projectId` while it is
  the `PENDING_EAS_INIT` placeholder (derives `updates.url` from the real projectId once set).
- `eas.json`: single file **frontend/eas.json** (root eas.json deleted). Profiles extend a `base` env
  (EXPO_PUBLIC_API_BASE=https://api.justicegavel.app/api, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=""); the
  committed test Stripe key was removed; invalid top-level `channel` removed.
- `web/` → `public/` (Expo's static dir). CSP `connect-src` now also allows http://localhost:* /
  127.0.0.1 (local API); service worker is only registered on http(s) (not Electron's app://).
- tsconfig: lib += DOM, dropped `ignoreDeprecations`.

## Payments (Stripe unavailable)
- `src/payments/` platform split: `index.tsx` (native) mounts StripeProvider only when
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is non-empty, `index.web.tsx` never imports Stripe; `usePaymentSheet()`
  returns stubs that resolve `{error:{code:'payments_unavailable'}}`.
- Copy: "Payments aren’t available yet. No charge was made — free features keep working." used by
  `FRIENDLY_ERRORS.payments_unavailable` (api.ts), PaymentsScreen, Subscription, ConsumerSubscription,
  QuickConnect, Booking.
- 27 screens displayed the raw `response.data.error` code (e.g. "payments_unavailable") → now
  `apiErrorMessage(e, fallback)`; FamilyConnect, BondsmanDashboard badge, PILead also route errors through it
  (PILead no longer shows "submitted" when the POST failed).

## Code fixes (issue IDs from the audit)
- R7: all 171 `declare var` shims removed; `tsc --noEmit` = 0 errors; @ts-ignore/@ts-nocheck count 296 → 0.
- R4/R5/R6/A4: hooks moved inside components, JSX outside component fixed, useEffects no longer return JSX,
  duplicate imports / await-in-non-async fixed → eslint 0 errors (0 rules-of-hooks).
- R1 secureStorage imports expo-secure-store with a web (sessionStorage) branch; `clearAuth` clears every
  store independently. A5 storage util = AsyncStorage-backed (Expo Go + web safe), clipboard = expo-clipboard,
  app's own i18n kept (no i18next), GestureHandlerRootView at root.
- R2 AgeGate reads `onVerified` from props. R3 ChatScreen: errorMsg defined, ids via expo-crypto.
- R8 one linking config `src/navigation/linking.ts` built from real route names, domain justicegavel.app
  (LinkingConfig.ts deleted). R9 `scripts/check-nav-targets.mjs` → 0 unknown targets (OfflineStatus screen
  added, other targets corrected). R10 utils/queryClient.ts + hooks/useApi.ts removed.
- R11 `parseLocalDate()` in dateUtils (date-only strings = local dates); Expungement/Deadline use it;
  test fixed and passes in UTC, America/Los_Angeles, Pacific/Auckland.
- This session, found by the runtime smoke test / review:
  - BarPrepQuiz, BarPrepResults, FirmPublicProfile, Matter crashed (error boundary) when opened without
    params → empty states.
  - Dynamic `const { default: X } = await import('expo-print'|'expo-sharing'|'expo-calendar'|'expo-font')`
    was always undefined (no default export) → PDF export/share, add-to-calendar and theme font loading
    silently failed; now namespace imports.
  - Chat assistant bubble was white text on white; Login/Register wordmark white on light background.
  - 6 missing i18n keys rendered as raw keys (e.g. "SETTINGS.DISPLAY_NAME") → added in en/es/pt/vi.
  - Login/Register/AuthGate refuse to store an undefined token; push registration skipped on web and until
    an EAS projectId exists (getExpoPushTokenAsync({projectId})); duplicate /push/token post removed.
  - Sentry initialised once (App.tsx), disabled when EXPO_PUBLIC_SENTRY_DSN is empty; OTA check skipped
    when `Updates.isEnabled` is false.
  - Electron: dev/prod detection (unpackaged run with an existing web-build serves the build),
    path-traversal check uses path.sep; electron-builder `files` allow-list → linux-unpacked 725MB → 321MB.

## Verification (this session, final tree)
- `npm ci` (no flags) OK; `npx expo install --check` → up to date (offline map); expo-doctor 15/18
  (3 checks need network).
- `npx tsc --noEmit` 0 errors; `declare var` shims 0; @ts-ignore 0.
- `npx eslint src App.tsx` 0 errors, 1464 warnings.
- jest: logic 47 suites / 703 tests pass (was 682/683; device_compatibility now runs); render 5/5.
- `expo export` web / android / ios all succeed; web bundle contains app screens, no Electron code.
- `expo prebuild --platform all` (scratch copy, no Firebase files) succeeds.
- Web smoke (`scripts/web-smoke.cjs`, headless Chromium, API http://localhost:4100/api): 165 checks,
  0 failures, 0 uncaught page errors, 0 non-network console errors. Covers age gate → onboarding → login
  (real backend 401 shown) → register → guest home → 5 tabs → all 59 main + 4 guest linking paths → all 80
  MoreStack screens via `window.__navigateTo` → mocked backend: register+login succeed, payments 503 and
  AI 503 show friendly messages. Screenshots: /home/claude/work/notes/fe-screens/.
- Electron: packaged linux build boots on app://justicegavel/, age gate/home/settings render, SPA fallback
  200, missing asset 404, traversal 404, 0 page errors; electron-updater/electron-log load from app.asar.

## Owner actions remaining
- `eas init` (replace `PENDING_EAS_INIT` in app.json `extra.eas.projectId`); OTA updates + Expo push tokens
  turn on automatically once it is a real id.
- Store IDs: `ios.appStoreUrl` (id0000000000), eas.json submit `appleId`/`ascAppId`/`appleTeamId`,
  `google-play-service-account.json`.
- Firebase: add `google-services.json` (Android push via FCM) and optionally `GoogleService-Info.plist`;
  app.config.js picks them up automatically.
- Stripe: set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (EAS env) — enables StripeProvider + merchant plugin.
- Sentry: set `EXPO_PUBLIC_SENTRY_DSN` (optional).
- Backend CORS must allow the Electron origin `app://justicegavel` (and any web origin used).

## Known, not fixed
- Many pre-existing low-contrast styles (text colored `bgCard`/white on light cards, e.g. Payments option
  titles, Home header title) — cosmetic, ~250 style sites; needs a design pass.
- Web stores the auth token in sessionStorage by design → web/desktop users sign in again per session.
- `tar@6.2.1` (critical advisory) is required by Expo SDK 52's CLI (build-time only, not shipped);
  npm audit total 93 (mostly Expo/RN/jest toolchain), resolved only by a future SDK upgrade.
- useRealtimeMessages is a no-op (no @supabase/supabase-js); ChildSupportScreen exists but is unregistered.

## Re-verification after container restart (2026-10-10) + CI rewrite
- Clean `rm -rf node_modules && npm ci` (no flags) OK, Node 22.22. `tsc --noEmit` 0 errors; `eslint src App.tsx`
  0 errors / 1464 warnings; `check-nav-targets` 257 refs / 72 targets / 0 problems; `npm test` logic 47/47 suites,
  703/703 tests + render 1/1 suite, 5/5 tests. `expo export` web (84 chunks, 5.2 MB, screen chunks present, 0
  electron-log/electron-updater/ipcRenderer) and android both succeed.
- Web smoke (`web-smoke.cjs`, API http://localhost:4200/api = production backend on real Postgres): 165 checks,
  0 failed, 0 page errors, 0 console errors; 64 distinct API calls hit the real backend in phase A.
- **Fixed: stale EXPO_PUBLIC_* values from Metro's cache.** Metro's transform cache key ignored EXPO_PUBLIC_*
  env, so `EXPO_PUBLIC_API_BASE=http://localhost:4200/api expo export` reused the bundle built earlier with
  `localhost:4100` (identical hash), and a later export *without* the var would have shipped a localhost URL.
  `metro.config.js` now folds a hash of all EXPO_PUBLIC_* vars into `config.cacheVersion`; verified switching
  default → 4200 → default yields https://api.justicegavel.app/api / localhost:4200 / api.justicegavel.app.
  (EAS cloud builds start with an empty cache, so they were not affected; local release exports were.)
- `.github/workflows/ci.yml` rewritten (two blocking jobs, no continue-on-error):
  - `backend`: Node 22, `npm ci`, `npm audit --omit=dev --audit-level=high`, import smoke of src/app.js,
    postgres:16 service + `psql -v ON_ERROR_STOP=1` over supabase/migrations/*.sql in order, generated
    JWT/refresh/encryption secrets (masked), server in NODE_ENV=production (no Stripe, ANTHROPIC_API_KEY=dummy,
    ANTHROPIC_BASE_URL → smoke mock on :4010), wait for /health with db ok, `smoke-test.mjs --anthropic-mock 4010`,
    stop + print server log, then full jest without DATABASE_URL.
  - `frontend`: Node 22, `npm ci`, tsc, eslint (errors fail), check-nav-targets, `npm test`, web export +
    bundle check (index.html, Home/Chat/Lawyers/Payments/Settings chunks, no Electron code), android export,
    informational hex-colour count. Old hard-coded jest file lists (incl. files that no longer exist) dropped.
  - Locally executed the backend steps verbatim from the YAML (scratch DB ci_check, port 4300/4310): migrations
    OK (194 public tables), /health db ok, smoke 25/25. Full backend jest on a snapshot taken mid-way through
    the concurrent backend work: 311 suites, 188 pass / 123 fail (227 of 27,953 tests) — stale assertions in
    backend tests (e.g. i18n count 707 vs 791 already at HEAD, removed BUSINESS_CONSTANTS fields, schema text in
    pre-consolidation migration files); none caused by the frontend changes. The CI jest step stays red until
    the backend test work lands. Runtime ~21 min on 2 shared cores → backend job timeout 45 min.
