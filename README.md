# Justice Gavel

> *Justice, in your hands.* — **v8.7.60**

Mobile legal-services platform for criminal defendants, their families, and
defense attorneys: AI legal chat, lawyer & bail-agent search, case files,
encrypted attorney messaging, know-your-rights content, expungement tools, an
attorney practice dashboard, and a bail-bondsman lead pipeline.

All version numbers (root, `backend/`, `frontend/` package.json,
`frontend/app.json`, the `/health` response and the `X-API-Version` header)
are aligned at **8.7.60**; the backend reads its version from
`backend/package.json` at startup (`backend/src/utils/version.js`).

## Architecture

```
frontend/   React Native app — iOS, Android, Web (PWA + Electron wrapper)
            Expo SDK 57 · React Native 0.86 · React 19 · TypeScript 6 (strict)
            React Navigation 7 · FlashList 2 · i18n: EN/ES/PT/VI

backend/    Node 22 · Express 5 (ESM) · JWT access + rotating refresh tokens
            AES-256-GCM encryption for messages/case notes at rest
            AI: Anthropic Claude (CLAUDE_MODEL, default claude-sonnet-4-6)
            Email: Resend (emails are logged, not sent, until RESEND_API_KEY is set)
            Queue: BullMQ when REDIS_URL is set, in-process otherwise

supabase/migrations/   PostgreSQL schema — plain-SQL files (00…23), applied
            in filename order with psql (backend/scripts/migrate.sh, the
            Render pre-deploy step); idempotent; RLS enabled deny-all
            (no policies — the Express backend is the only DB client)
```

**Payments are disabled until Stripe keys are set.** Without
`STRIPE_SECRET_KEY`, every charging/subscribing endpoint returns
`503 payments_unavailable` and the app shows "Payments aren't available yet"
(free features keep working). Setting the keys
(see [DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md)) re-enables Stripe
automatically — no code change.

**Lead fees are flat — never scaled to bail amount or case value**
(bail-scaled fees implicate runner-capper statutes; value-scaled attorney fees
implicate ABA Model Rules 5.4/7.2). Single sources of truth:
`backend/src/routes/billing/leadFee.js` and `billing/attorneyLeadFee.js`;
`lead_fee_consistency.test.js` fails if anything drifts.

| Lead type | Fee per accepted lead |
|---|---|
| Bail bondsman | flat $100 |
| Personal injury / medical | $200 |
| Civil rights | $200 |
| Employment | $100 |
| ICE detention | $75 |

Consumer subscriptions: Legal Radar $19.99/mo · Advisor $24.99/mo ($199/yr) ·
Legal Pro $34.99/mo ($299/yr) · Esquire $49/mo ($410/yr). Bondsman plans
$49 / $149 / $349 per month, plus the flat $100 per accepted lead. Lawyer
search results are merit-ordered — no paid placement, no referral program.

## Quick start

Prereqs: Node ≥ 20.6 (22 recommended), npm ≥ 10, PostgreSQL 14+. If your
Postgres needs a user/password, export `PGUSER` / `PGPASSWORD` (psql and the
backend both honour them) or put them in the URL.

### Backend

```bash
cd backend
npm ci
createdb justice_gavel
for f in ../supabase/migrations/*.sql; do psql "postgres://localhost/justice_gavel" -v ON_ERROR_STOP=1 -q -f "$f"; done
DATABASE_URL=postgres://localhost/justice_gavel npm start
# → listening on :4000
curl -s http://localhost:4000/health
```

That boots with no API keys: dev secrets are generated per process, AI returns
`503 ai_unavailable`, payments return `503 payments_unavailable`, emails are
logged. Copy `backend/.env.example` to `backend/.env` and fill in keys to
enable features (every variable is documented in
[DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md)). Without `DATABASE_URL` the
dev server falls back to in-memory SQLite (`demo.db`) — fine for poking at
routes, not for real work.

### Frontend

```bash
cd frontend
npm ci
EXPO_PUBLIC_API_BASE=http://localhost:4000/api npx expo start
# press w for web, or scan the QR code in Expo Go
```

Unset, `EXPO_PUBLIC_API_BASE` falls back to the production API
(`https://api.justicegavel.app/api`).

## Tests & checks

```bash
# backend (from backend/)
npm run lint                  # ESLint (--max-warnings 0)
npm test                      # full jest suite (in-memory store)
TEST_DATABASE_URL=postgres://… npm test   # also runs the Postgres-gated suites
node scripts/smoke-test.mjs http://localhost:4000   # against a running server

# frontend (from frontend/)
npx tsc --noEmit              # strict TypeScript
npx eslint src App.tsx --max-warnings 0
npm test                      # logic + render suites
node scripts/design-audit.mjs --ci       # WCAG AA contrast, a11y, touch targets
npx expo export --platform web

# API spec (from the repo root)
npm run generate:openapi                 # regenerate openapi.json from the mounted routes
```

CI (`.github/workflows/ci.yml`) runs these plus fresh-database migrations,
the Postgres-gated suites and an end-to-end smoke test against a production
boot. Docs are tested too: `openapi_drift.test.js` fails if `openapi.json` no
longer matches the mounted routes, `env_docs_consistency.test.js` if an
environment variable is read but not documented (or documented but unused),
and `version_alignment.test.js` if any version number disagrees.

## API

Overview: [API_REFERENCE.md](./API_REFERENCE.md) — auth levels, error shapes,
rate limits, resource groups. Full machine-readable spec:
[openapi.json](./openapi.json) (generated — do not edit by hand). Typed
clients: `node scripts/generate-sdk.mjs [language]`.

## Deploy

Backend deploys to **Render** from the Blueprint [`render.yaml`](./render.yaml):
a production and a staging Docker web service built from `backend/Dockerfile`
(repo-root context), health check `GET /health`, auto-deploy of `main` once CI
passes. Postgres lives on Supabase; Render's pre-deploy step
(`backend/scripts/migrate.sh`) applies new `supabase/migrations` files with
psql before each deploy goes live. Steps, required variables and verification:
[DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md), [RUNBOOK.md → DEPLOY (Render)](./RUNBOOK.md#deploy-render)
and `backend/scripts/go-live-checklist.md`. Mobile builds ship through EAS
(`eas build` / `eas submit`); web exports with `npx expo export --platform web`.

## Data refresh

Provider scrapers (Google Places, Yelp, public state-bar listings), the DOI /
CSV importers and the legal-reference updater write the main Postgres
database through `backend/src/services/dataRefresh/` — nightly when
`LIVE_REFRESH=true`, or by hand (`cd backend && DATABASE_URL=… bash
scripts/run-all-scrapes.sh --dry-run`). New providers are inserted; changes to
providers already listed are staged in `provider_update_proposals` for an
admin to apply or reject (`/api/admin/proposals`) — a scrape never overwrites,
hides or deletes a lawyer / bail-agent row. Each run is logged in
`scrape_runs`. How-to: [RUNBOOK.md → Data refresh](./RUNBOOK.md#data-refresh-providers-arrests-legal-reference-data).

## Documentation map

| Doc | What it is |
|---|---|
| [DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md) | **The** environment-variable reference + Render deploy settings |
| [render.yaml](./render.yaml) | Render Blueprint: production + staging services |
| [API_REFERENCE.md](./API_REFERENCE.md) / [openapi.json](./openapi.json) | API overview / generated full spec |
| [QUICKSTART.md](./QUICKSTART.md) | Local setup + seeded-data overview |
| [RUNBOOK.md](./RUNBOOK.md) | Incident response, monitoring, backups, scheduled jobs, data refresh |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) | Pre-launch security/ops checklist |
| [EXTERNAL_SERVICES_SETUP.md](./EXTERNAL_SERVICES_SETUP.md) | Per-service signup/config walkthroughs |
| [UPTIME_MONITORING.md](./UPTIME_MONITORING.md) | `/health` contract + uptime monitor setup |
| [FACT_CHECK_RUNBOOK.md](./FACT_CHECK_RUNBOOK.md) | Verifying legal reference data against official sources |
| [docs/LEGAL_ACTION_ITEMS.md](./docs/LEGAL_ACTION_ITEMS.md) | Open legal/compliance items, incl. the lawyer review still required |
| [PHASE_2_ROADMAP.md](./PHASE_2_ROADMAP.md) | Deferred feature territory (decision record) |
| `backend/scripts/go-live-checklist.md` | Step-by-step go-live checklist (Render) |
| [docs/](./docs/) | Privacy policy, ToS, store listing, SDK guide, legal action items |
| [docs/fix-notes/](./docs/fix-notes/) | Historical fix/change logs (see its README) |
| [docs/archive/](./docs/archive/) | Superseded docs kept for history — do not rely on them |

## Security notes

- JWT auth on every protected endpoint. The token only identifies the user:
  role, account status, admin/defender flags, bar verification and tier are
  read from the `users` row (cached 60 s per process), so a demotion, ban or
  deletion takes effect within a minute and fails closed if the DB is
  unreachable. Firm roles always come from `firm_members` and every
  matter / privilege-log / firm-finance route is scoped to the caller's own
  firm. `/api/admin/*` additionally requires the `X-Admin-Key` header.
- Attorneys reach a client's case only through a relationship the client
  created (invite → accept, or a booked consultation); leads reveal contact
  details only after a completed Stripe charge; uploads are size-capped,
  streamed to disk where large, and admitted against a process-wide budget;
  firm-supplied URLs (webhooks, integrations) cannot reach private addresses;
  SAML uses @node-saml/node-saml and requires a signed assertion.
  Regression tests: `backend/src/__tests__/security/` (CI, real Postgres).
- AES-256-GCM on message bodies, attachments and case notes.
- No TEST_MODE/DEMO_MODE payment bypasses; demo subscriptions are excluded
  from every payment gate.
- Seeded sample arrest records are hidden from all user-facing and billing
  paths (`SHOW_SAMPLE_ARRESTS` shows them read-only, flagged, for demos only).
