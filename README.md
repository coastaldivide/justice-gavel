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

backend/    Node 22 · Express 5 (ESM) · JWT auth (DB-checked roles)
            AES-256-GCM encryption for messages/case notes at rest
            AI: Anthropic Claude (CLAUDE_MODEL, default claude-sonnet-4-6)
            Email: Resend (emails are logged, not sent, until RESEND_API_KEY is set)
            Queue: BullMQ when REDIS_URL is set, in-process otherwise

supabase/migrations/   PostgreSQL schema — 13 plain-SQL files (00…12), applied
            in filename order with psql; idempotent; RLS enabled deny-all
            (no policies — the Express backend is the only DB client)
```

**Payments are disabled until Stripe keys are set.** Without
`STRIPE_SECRET_KEY`, every billing endpoint returns `503 payments_unavailable`
and the app shows "Payments are not available yet". Setting the keys
(see [RAILWAY_ENV_SETUP.md](./RAILWAY_ENV_SETUP.md)) re-enables Stripe
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
Legal Pro $34.99/mo ($299/yr) · Esquire $49/mo ($410/yr) · Bondsman $49/mo +
the flat $100 lead fee. Lawyer search results are merit-ordered — no paid
placement, no referral program.

## Quick start

Prereqs: Node ≥ 20.6 (22 recommended), npm ≥ 10, PostgreSQL 14+.

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
[RAILWAY_ENV_SETUP.md](./RAILWAY_ENV_SETUP.md)). Without `DATABASE_URL` the
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
npm run lint                  # ESLint, 0 errors 0 warnings
npm test                      # full jest suite (in-memory store)
TEST_DATABASE_URL=postgres://… npm test   # also runs the Postgres-gated suites
node scripts/smoke-test.mjs http://localhost:4000   # against a running server

# frontend (from frontend/)
npx tsc --noEmit              # strict TypeScript, 0 errors
npx eslint src App.tsx --max-warnings 0
npm test                      # logic + render suites
node scripts/design-audit.mjs --ci       # WCAG AA contrast, a11y, touch targets
npx expo export --platform web

# API spec (from the repo root)
node scripts/generate-openapi.mjs        # regenerate openapi.json from the mounted routes
```

CI (`.github/workflows/ci.yml`) runs all of the above plus fresh-database
migrations and an end-to-end smoke test; `openapi_drift.test.js` fails the
build if `openapi.json` no longer matches the mounted routes.

## API

Overview: [API_REFERENCE.md](./API_REFERENCE.md) — auth levels, error shapes,
rate limits, resource groups. Full machine-readable spec:
[openapi.json](./openapi.json) (generated — do not edit by hand). Typed
clients: `node scripts/generate-sdk.mjs [language]`.

## Deploy

Backend deploys to Railway from `backend/` (Dockerfile + `railway.json`,
health check `GET /health`); Postgres lives on Supabase or Railway and
migrations are applied manually with psql in filename order. Steps, required
variables and verification: [RAILWAY_ENV_SETUP.md](./RAILWAY_ENV_SETUP.md)
and `backend/scripts/railway-checklist.md`. Mobile builds ship through EAS
(`eas build` / `eas submit`); web exports with `npx expo export --platform web`.

## Documentation map

| Doc | What it is |
|---|---|
| [RAILWAY_ENV_SETUP.md](./RAILWAY_ENV_SETUP.md) | **The** environment-variable reference + Railway deploy settings |
| [API_REFERENCE.md](./API_REFERENCE.md) / [openapi.json](./openapi.json) | API overview / generated full spec |
| [QUICKSTART.md](./QUICKSTART.md) | Local setup + seeded-data overview |
| [RUNBOOK.md](./RUNBOOK.md) | Incident response, monitoring, backups |
| [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) | Pre-launch security/ops checklist |
| [EXTERNAL_SERVICES_SETUP.md](./EXTERNAL_SERVICES_SETUP.md) | Per-service signup/config walkthroughs |
| [docs/](./docs/) | Privacy policy, ToS, store listing, SDK guide, legal action items |
| [docs/fix-notes/](./docs/fix-notes/) | Historical fix/change logs (see its README) |
| [docs/archive/](./docs/archive/) | Superseded docs kept for history — do not rely on them |

## Security notes

- JWT auth on every protected endpoint; roles come from the database, never
  the token. Admin/staff actions are re-checked server-side.
- AES-256-GCM on message bodies, attachments and case notes.
- No TEST_MODE/DEMO_MODE payment bypasses; demo subscriptions are excluded
  from every payment gate.
- Seeded sample arrest records are hidden from all user-facing and billing
  paths (`SHOW_SAMPLE_ARRESTS` shows them read-only, flagged, for demos only).
