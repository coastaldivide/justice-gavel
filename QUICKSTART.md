# Justice Gavel — Quick Start
**v8.7.60**

Local setup from zero to a running API + app. The condensed version lives in
the [README](./README.md); environment variables are documented in
[DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md).

Prereqs: Node ≥ 20.6 (22 recommended), npm ≥ 10, PostgreSQL 14+. If your
Postgres needs a user/password, export `PGUSER` / `PGPASSWORD` (psql and the
backend both honour them) or put them in the URL.

## 1. Database

Schema **and** seed data ship as plain SQL in `supabase/migrations/`
(13 files, `00…12`). Apply them in filename order; they are idempotent and
there is no separate seed script:

```bash
createdb justice_gavel
for f in supabase/migrations/*.sql; do
  psql "postgres://localhost/justice_gavel" -v ON_ERROR_STOP=1 -q -f "$f"
done
```

What gets seeded (counts from a fresh migrate):

| Data | Rows | Notes |
|---|---|---|
| Lawyers | 2,055 | Seed directory — replace/extend with the operator scrapers |
| Bail agents | 1,265 | Seed directory (DOI import adds license numbers) |
| Recovery agents | 531 | Directory present but the screen is unregistered (legal hold) |
| Courthouses | 404 | Verified addresses |
| Bail schedules | 504 | All 51 jurisdictions |
| Know-Your-Rights lessons | 50 | 9+ categories |
| Arrest records | 600 | **Generated samples** — hidden from all user-facing and billing paths unless `SHOW_SAMPLE_ARRESTS=true` (demos only) |

## 2. Backend

```bash
cd backend
npm ci
DATABASE_URL=postgres://localhost/justice_gavel npm start   # listens on :4000
curl -s http://localhost:4000/health                        # {"ok":true,...}
```

No `.env` needed to boot: dev secrets are generated per process, AI returns
`503 ai_unavailable`, billing returns `503 payments_unavailable`, emails are
logged. To enable features, `cp .env.example .env` and fill in keys
(see DEPLOY_ENV_SETUP.md). Real arrest coverage additionally needs
`ARREST_FEED_URLS` — without it arrest screens show honest empty states.

## 3. Frontend

```bash
cd frontend
npm ci
EXPO_PUBLIC_API_BASE=http://localhost:4000/api npx expo start
# press w for web, or scan the QR code with Expo Go
```

## 4. Checks

```bash
# backend/
npm run lint && npm test
node scripts/smoke-test.mjs http://localhost:4000   # against the running server

# frontend/
npx tsc --noEmit && npx eslint src App.tsx --max-warnings 0 && npm test
```

## API documentation

| File | Contents |
|---|---|
| `openapi.json` | Generated OpenAPI 3.0 spec, auth-marked. Regenerate with `npm run generate:openapi` (repo root); `openapi_drift.test.js` fails CI when it goes stale. Postman: File → Import |
| `API_REFERENCE.md` | Human-readable overview: auth, errors, rate limits, resource groups |

## Deploying

1. Backend → Render: New → Blueprint → this repo (`render.yaml` creates the
   production and staging services); fill in the `sync: false` env vars
   (DEPLOY_ENV_SETUP.md, RUNBOOK.md → "DEPLOY (Render)"). The pre-deploy step
   applies the migrations with psql (the API itself never runs DDL).
2. Frontend → set `EXPO_PUBLIC_API_BASE=https://<your-api>/api` (EAS secret),
   then `eas build --platform all` / `eas submit`.
3. Verify: `node backend/scripts/smoke-test.mjs https://<your-api>`.

Go-live checklist: `backend/scripts/go-live-checklist.md` +
[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).

## Operator data tools (optional)

The data-refresh tools under `backend/src/scripts/` — Google Places / Yelp /
state-bar scrapers (`refresh.js`, `scrape_providers_national.js`,
`scrape_state_bars.js`, `scrape_recovery_agents.js`), importers
(`import_csv.js`, `import_doi_bondsmen.js`, `import_doi_supabase.js`) and
`update_legal_data.js` — write the **main Postgres database** (`DATABASE_URL`),
the same one the app serves; the nightly scheduler runs the provider refresh
when `LIVE_REFRESH=true`. New providers are inserted; changes to providers
already listed are staged for admin review (`/api/admin/proposals`) and never
written directly; nothing is deleted. Every script has `--dry-run`. Details:
[RUNBOOK.md → Data refresh](./RUNBOOK.md#data-refresh-providers-arrests-legal-reference-data).
Quick start: `cd backend && DATABASE_URL=… bash scripts/run-all-scrapes.sh --dry-run`.

---

⚖️ *Innocent until proven guilty.*
