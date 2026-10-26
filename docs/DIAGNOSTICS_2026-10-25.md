# Diagnostics: October 25, 2026 (commit after `fb9ddb5`)

These checks ran on a clean `npm ci` install from the delivered zip, with a fresh Postgres
16 database, on a 2-CPU / 7 GB machine (about the size of a Render Starter instance).
Reproduce them with the commands in [LEAD_DEVELOPER_HANDOFF.md](../LEAD_DEVELOPER_HANDOFF.md) §4.

## Functional gate

| Check | Result |
|---|---|
| Migrations 00–28 applied twice (`backend/scripts/migrate.sh`) | clean; second run applies 0 |
| Production boot (`NODE_ENV=production`, no Stripe, mock Anthropic) + `scripts/smoke-test.mjs` | 40/40 |
| `scripts/route-sweep.mjs`: 614 routes × 6 callers (guest, consumer, attorney, bail agent, firm, admin), valid and junk input | 27,408 requests, 0 findings (no 500s, no IDOR, correct 401/403/404, localized errors) |
| Browser journeys `frontend/scripts/run-all-journeys.sh` (9 sets, Chromium, real API) | 149 steps passed, 0 failed |
| Frontend `tsc` / `eslint --max-warnings 0` / design audit (light + dark) | 0 / 0 / 0 |
| Frontend jest (logic + render) | 779 + 207 passed |
| Backend jest with `TEST_DATABASE_URL` (Postgres suites included) | 384 suites, 28,420 tests passed |
| Same suite under `TZ=America/New_York`, across the Nov 1 DST change | passed |
| Lawyer / bail-agent rows before and after every run | 2,046 / 1,262, unchanged |

## Test coverage

| Area | Lines | Branches | Functions |
|---|---|---|---|
| Backend (`src/`, excluding scripts) | 67.5% | 70.5% | 75.8% |
| Frontend unit + render tests | 36.3% | 27.6% | 27.4% |

The 149 browser-journey steps exercise much more frontend code than the coverage numbers
show; they aren't instrumented for coverage.

## Server performance (one instance, 2 CPUs, 20 concurrent clients, 15 s per endpoint)

| Endpoint | req/s | p50 | p95 | p99 |
|---|---|---|---|---|
| `/api/health` | 1,735 | 9.6 ms | 24 ms | 34 ms |
| Lawyers by city | 551 (was 57 before the directory cache) | 35 ms (was 345) | 50 ms | 62 ms |
| Bail agents by GPS radius | 164 (was 78) | 116 ms | 165 ms | 196 ms |
| My cases (signed in) | 777 | 24 ms | 39 ms | 48 ms |
| Court dates (signed in) | 472 | 41 ms | 57 ms | 76 ms |

Rights card, bail schedule, court-date guidance and Help Now answer in 1–8 ms per request.
They're rate-limited per IP (Help Now: 60/min), so the load test measured the limiter there.
**Server memory after load: about 375–400 MB.**

## Web performance (Chromium, 390×844, 4× CPU slowdown, ~8 Mbps, 150 ms RTT)

| Screen | First usable (cold) | Repeat visit | FCP | LCP | CLS |
|---|---|---|---|---|---|
| Home | 3.45 s | 0.72 s | 0.23 s | 3.78 s | 0.07 |
| Rights card | 3.35 s | 0.71 s | 0.23 s | 2.96 s | 0.004 |
| Help Now | 3.42 s | 0.73 s | 0.22 s | 2.97 s | 0 |

The main web bundle is 4,713 KB raw / 1,277 KB gzip. Cold LCP is 3–3.8 s against Google's
"good" target of 2.5 s. The next step is per-screen code splitting (see the handoff, §7).
Native builds load the bundle from the device, so they aren't affected.

## Security and dependencies

- `npm audit --omit=dev`, backend: **0** (this is what CI enforces).
- `npm audit --omit=dev`, frontend: 2 high, both build-time only: `node-forge` (via
  `expo-updates` code signing) and `zod` (via `@expo/cli`). Neither is in the shipped web bundle
  (verified by grep), and npm's only suggested fix is downgrading Expo. Recheck when Expo
  releases a fix.

## Data completeness (active listings)

| | Rows | Phone | GPS | Website | Hours | States |
|---|---|---|---|---|---|---|
| Lawyers | 2,046 | 100% | 100% | 97% | 64% | 51 |
| Bail agents | 1,262 | 100% | 100% | 82% | 92% | 51 |

Known data limits (owner):
- Every lawyer row lists only "Criminal Defense", English, and `free_consultation=1`.
- `bail_agents.available_24_7` is 1 on every row, so the app reads open hours from the
  stored hours instead.

## Code size

- Frontend `src`: about 48,500 app lines and 10,400 test lines; 92 screens.
- Backend `src`: about 59,400 app lines and 118,200 test lines; 114 route files.
- 29 migrations.
- 1 TODO; 235 `any` types in the frontend.
- Largest files: `routes/firm_verticals.js` (2,621 lines), `services/healthScan.js`
  (1,390), `routes/matter_intelligence.js` (1,361), `MotionLibraryScreen.tsx` (1,344).
