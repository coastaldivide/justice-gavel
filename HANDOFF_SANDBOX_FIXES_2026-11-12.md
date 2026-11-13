# Hand-off: sandbox review fixes (November 12, 2026)

Branch **`sandbox-fixes-2026-11-12`**, on top of `consumer-core-path` at `e077537`. It has 13 commits, and each one stands on its own and explains itself. The same changes are also in `PATCHES/` at the top of the zip, if you'd rather review or apply them with `git am`.

## Do this first (not something code can fix)

1. **Revoke the Supabase personal access token** that was committed in `.mcp.json` (commit `45263fb`, token starting `sbp_7d69…`). Do it in the Supabase dashboard under Account → Access Tokens. The branch removes the file and git-ignores it, and `.mcp.json.example` now reads the token from `SUPABASE_ACCESS_TOKEN`. **The token is still in git history**, and that history is on GitHub and in every copy of the zip. Revoking the token makes that history harmless.
2. Optional, after revoking: rewrite history to drop the file. Run `git filter-repo --path justice-gavel/.mcp.json --invert-paths`, or use BFG, then force-push and have everyone re-clone. Coordinate this with anyone who has the repo checked out. I did not rewrite history in this hand-off, so the branch still lines up with `origin`.

## What changed

| # | Problem | Fix | Main files | Tests |
|---|---|---|---|---|
| 1 | The Resources tab opened Home, so the real Resources screen couldn't be reached. Screens opened from Home also highlighted Resources. | Home is now its own stack (`HomeNavigator`), and the Resources tab opens on `Resources`. Home's links stay inside Home. | `frontend/src/navigation/AppNavigator.tsx`, `screens/HomeScreen.tsx` | `src/__tests__/navigationTabs.test.js` |
| 1b | **Found while verifying #1 (web):** every bottom-tab tap reloaded the whole web app, losing anything typed. The Resources tab's link was `/`, so its reload landed on Home. | `TabButton` drops the `href` React Navigation passes on web, so the tab stays `role="tab"` instead of becoming an `<a>`. The Home stack now has `/` and `/home/…` web paths. | `AppNavigator.tsx`, `navigation/linking.ts` | `navigationTabs.test.js`, `render/webPaths.test.tsx` |
| 2 | The "Location unavailable" note on Quick Connect was unreadable in dark mode (dark text on dark amber). The star rating on the paid result card had the same problem. | Changed to the correct theme colours. The design audit only checked `<Text>` and missed text inside `<IconLabel textStyle>`. It now checks that too, which surfaced **11 more** unreadable dark-mode spots, all fixed (including the under-18 emergency button). | `QuickConnectScreen.tsx`, `scripts/design-audit.mjs`, 9 other screens | `design-audit --ci`: 0 failures in light and dark |
| 3 | Quick Sign Up used a 4-digit PIN typed twice as the password (10,000 possible values). Ten wrong guesses from anywhere locked the account, so anyone who knew a phone number could lock its owner out. | Quick Sign Up now asks for a password (8+ characters, with show/hide). A shared policy (`utils/passwordPolicy.js`) refuses doubled PINs, repeated characters, digit runs and common passwords at sign-up, reset and change. Lock-out is now 10 failures per account **and IP address** for 15 minutes; the whole account locks only after 50 failures. Login returns `password_change_required` for doubled-PIN passwords. New endpoint: `POST /api/auth/change-password`. | `components/AuthGate.tsx`, `backend/src/routes/auth.js`, `utils/passwordPolicy.js`, 8 language files on each side | `integration/auth_password_policy.int.test.js`; `brutal_trials_v16` 18-02/18-04 rewritten (they used to *require* the PIN) |
| 4 | Case Pass end dates were an hour off, and AI metrics landed on the wrong day, whenever the database wasn't set to UTC (daylight-saving shift). | Every connection runs `SET TIME ZONE 'UTC'`, and the server logs a warning at startup if the zone isn't UTC. The two failing queries now do their date maths explicitly in UTC. Migration `050` sets the database default to UTC and skips itself if it lacks permission. CI's Postgres now runs in `America/New_York`. | `db/index.js`, `services/casePass.js`, `monitoring/aiHealth.js`, `supabase/migrations/00000000000050_database_timezone_utc.sql`, `.github/workflows/ci.yml` | Each layer was checked on its own against a New York-time database |
| 4b | **Found while re-testing:** the restore check in `db-restore.sh` compared row fingerprints that include timestamps, printed in each server's own zone. Restoring onto a server with a different default zone would report a false MISMATCH. | Runs with `PGTZ=UTC` and gives the restored database the UTC default. | `backend/scripts/db-restore.sh` | `integration/backup_restore.int.test.js` |
| + | The "no Sundays" consultations test failed on US evenings (its stand-in code mixed local and UTC dates). The real slot service was already correct. | UTC throughout. CI's main jest step now runs in US Eastern time. | `__tests__/consultations.test.js`, `ci.yml` | Passes in New York, Tokyo, UTC and Kiritimati |
| A | Quick Connect charges $20 for phone numbers that Get Help shows free, calls the lawyer "verified", and promises both contacts are "real and available". | Removed the claims ("the closest … in our listings"; "numbers come from their public listings"). Added a link before Pay Now saying the same lawyers and bail agents are free in Get Help. All 8 languages. **The price and flow are unchanged.** | `QuickConnectScreen.tsx`, i18n | `brutal_trials_v27` 6-01 |
| B | Home's plan card advertised "Bar exam prep" and "Arrest monitoring (checked nightly)", but the consumer build hides both screens. | `plansFrom` drops any feature whose screen this build hides. **Server entitlements and prices are unchanged.** | `services/plans.ts` | `planFeatures.test.js`, `render/proDashboards` |
| C | Docs were out of date (migrations 00…12 / 00…28, seed counts, the tab name). | Corrected. API_REFERENCE now documents the password and lock-out rules, and the OpenAPI spec is regenerated. | `QUICKSTART.md`, `README.md`, `LEAD_DEVELOPER_HANDOFF.md`, `API_REFERENCE.md`, `openapi.json`, `../README_START_HERE.md` | `openapi_drift.test.js` |

## Owner decisions still open (I chose the safer default)

- **Quick Connect:** keep it, change what the $20 buys, or drop it. Also: should there be a refund rule if neither contact answers? I added question **1.5** to `docs/COUNSEL_REVIEW_PACKET.md`: is charging the *person* for a lawyer connection allowed under the lawyer-referral rules?
- **Plan contents:** the server still *grants* bar prep and arrest monitoring to Legal Pro / Case Pass (`backend/src/routes/billing/plans.js`). The app just stops advertising them. Decide whether to remove them from the plans, then re-run `setup-stripe-products.js`.
- **Quick sign-up method:** I chose a password. A one-time text code is the faster alternative once Telnyx is live.
- **Home while payments are off:** the plan card and the $20 Quick Connect card still show, and tapping them says "Payments aren't available yet". That's the existing design, and the browser journeys test for it, so I left it.
- **New and changed strings in 7 languages** need native-speaker review, as with the rest of the translations: `x_auth_gate_phone_number_password`, `x_quick_connect_free_directory_note`, `qc_bondsman_sub`, `qc_lawyer_sub`, `qc_step4`, `x_quick_connect_call_them_directly_they`, `x_quick_connect_call_them_now_they`, and on the backend `auth.err.password_weak`.

## Follow-ups not done

- **No change-password screen in the app.** The endpoint exists, and login returns `password_change_required: true` for old PIN accounts, but the app ignores that flag for now. The app hasn't launched, so there should be no PIN accounts. Build the screen if any exist on staging.
- `db/index.js` connects to hosted Postgres with `ssl: { rejectUnauthorized: false }` (encrypted, but the server certificate isn't verified). Pin the provider's CA if you can.
- `POST /auth/register` returns 409 for an email or phone that's already registered, which lets anyone check whether a number has an account (common practice; rate-limited at 5 per hour per IP).
- The onboarding banner says "24/7 AI Legal Help" even when AI is switched off.

## Verification (this sandbox: Node 22, Postgres 16; the machine and every database were set to America/New_York time)

| Check | Before (e077537) | After |
|---|---|---|
| Migrations on a fresh database, run twice | 50, clean | 51, clean |
| Backend lint | clean | clean |
| Backend jest (main suite) | 28,639 passed, **1 failed** | **28,652 passed, 0 failed** |
| Database suites (integration, security, refresh, in-band) | 557 / 559 | **574 / 574** (40 + 409 + 99 + 26) |
| Smoke test against the running API | 44 / 44 | 44 / 44 |
| Frontend type check, lint, design audit (`--ci`), nav targets | clean (audit missed IconLabel) | clean (audit now covers IconLabel) |
| Frontend tests (logic + render) | 874 + 404 | **881 + 407** |
| Web export (core and full builds) | ok | ok |
| CI web journeys, run locally (production-mode API, AI stand-in, both builds) | — | **196 / 197**. E13 (resources: veterans/text-line rows) also fails on the untouched `e077537` build here, so it's an environment quirk, not a regression. CI passed it on the original commit. |
| My browser check of each fix (390 px) | — | **18 / 18**: five tabs each highlight their own page, 0 page reloads, Resources shows Legal Resources, Quick Connect from Home keeps Home highlighted, warning contrast 7.5:1, free-directory note shown, no "verified" or "real and available", password field (a 4-character password is refused in the app, a doubled PIN by the server), plan card without bar prep or arrest monitoring, 0 console errors |

Not provable here, because there are no real accounts: AI against the real Claude API, texts, card charges, store builds. Run `docs/LIVE_TEST.md` on staging, and on staging run `SHOW timezone;` (expect `UTC`).

## Applying it

- **From this repo folder:** `git push origin sandbox-fixes-2026-11-12` and open a PR into `consumer-core-path`. The GitHub CI runs all three jobs; the backend database now runs in New York time.
- **From the patches:** `git checkout -b sandbox-fixes consumer-core-path && git am PATCHES/*.patch && git rm justice-gavel/.mcp.json` (run from the repo root; inside `justice-gavel/` use `git rm .mcp.json`). Patch 0008 deliberately leaves out deleting `.mcp.json`, because a deletion patch would contain the token.
- Run migration `050` like the others (`backend/scripts/migrate.sh` or the Render pre-deploy step).
