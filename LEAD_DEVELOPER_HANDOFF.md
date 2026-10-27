# Lead developer handoff: Justice Gavel

> *Justice, in your hands.* One app for the worst few days of someone's life:
> **Just arrested? → know your rights → find a lawyer and a bail agent → never miss a court date.**

This is the starting page. It tells you what the system is, how to run and test it, how to
deploy it, what is finished, and what's still open, with links to the detail. State as of
**October 25, 2026**, branch `fix/full-function` on `github.com/coastaldivide/justice-gavel`.

---

## 1. Read these, in this order

| # | File | Why |
|---|---|---|
| 1 | this file | orientation |
| 2 | [README.md](./README.md) | architecture, quick start, pricing rules |
| 3 | [docs/OWNER_DECISIONS.md](./docs/OWNER_DECISIONS.md) | what's blocked on the owner, a lawyer, keys or a real phone |
| 4 | [docs/DIAGNOSTICS_2026-10-25.md](./docs/DIAGNOSTICS_2026-10-25.md) | the latest measured state: tests, coverage, speed, security, data |
| 5 | [DEPLOY_ENV_SETUP.md](./DEPLOY_ENV_SETUP.md) and [render.yaml](./render.yaml) | every environment variable, and the Render blueprint |
| 6 | [RUNBOOK.md](./RUNBOOK.md) | operations: deploy, roll back, incidents, backups |
| 7 | [docs/strategy/CORE_PATH_PLAN.md](./docs/strategy/CORE_PATH_PLAN.md) | the core product path and its status |
| 8 | [docs/REAL_DEVICE_TEST_SCRIPT.md](./docs/REAL_DEVICE_TEST_SCRIPT.md) | the phone test to run before launch |
| 9 | [docs/fix-notes/debug_pass.md](./docs/fix-notes/debug_pass.md), [ui_pass.md](./docs/fix-notes/ui_pass.md) | what was broken and how it was fixed in the last passes (history, not docs) |

Other references: [API_REFERENCE.md](./API_REFERENCE.md) and `openapi.json`,
[ENVIRONMENT_VARS.md](./ENVIRONMENT_VARS.md),
[EXTERNAL_SERVICES_SETUP.md](./EXTERNAL_SERVICES_SETUP.md),
[LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), `backend/scripts/go-live-checklist.md`,
[docs/EAS_SECRETS_SETUP.md](./docs/EAS_SECRETS_SETUP.md) (mobile builds), and the strategy
docs in `docs/strategy/` (marketing lines, the "vibe coder" checklist).

## 2. The system in one screen

```
frontend/   Expo SDK 57 · React Native 0.86 · React 19 · TypeScript (strict)
            iOS / Android / web. 92 screens. i18n en/es/pt/vi/ht/zh/ar/tl (6,645 keys each; Arabic right to left; docs/TRANSLATIONS.md).
            Icons: Ionicons only, via components/AppIcon.tsx (ICONS map). No emoji (test-enforced).
            Theme tokens: constants/theme.ts (useTheme). Dark is the default theme.
backend/    Node 22 · Express 5 (ESM) · PostgreSQL 16. 114 route files, about 614 mounted routes.
            JWT access + rotating refresh tokens. AES-256-GCM for notes and messages at rest.
            AI: Anthropic, CLAUDE_MODEL (default claude-sonnet-5-5); no temperature/top_p.
            Jobs: BullMQ with REDIS_URL, otherwise in-process; each scheduled run is claimed
            by one instance (utils/jobLock.js). Errors: one localized JSON shape
            (middleware/errorShape.js). Server strings: backend/src/i18n/messages/*.js.
supabase/migrations/  00…28, plain SQL, idempotent, applied in filename order by
            backend/scripts/migrate.sh (records applied files in jg_meta.schema_migrations).
            RLS on, deny-all: the Express server is the only database client.
render.yaml Render blueprint: production + staging web services (Docker, Oregon, Starter),
            pre-deploy migrations, /health check, auto-deploy when CI passes.
```

**Rules the code enforces (tests fail if broken):**
- **Payments are off until Stripe keys exist.** Every money path returns `503
  payments_unavailable`, and the app says "Payments aren't available yet". Nothing counts as
  paid without a Stripe-verified payment. The prices live in one place,
  `backend/src/routes/billing/plans.js`; the Stripe setup script and every screen read from it.
- **Lead fees are flat:** bail $100; attorney PI / civil rights $200, employment $100, ICE $75
  (`billing/leadFee.js`, `billing/attorneyLeadFee.js`). Contact details go only to the
  verified buyer, after payment. Results are never ranked by payment.
- **Lawyer and bail-agent rows are real, sourced data.** App code only reads them. They change
  only through the data refresh (`services/dataRefresh/`) and admin-approved proposals.
- **Legal content is never invented.** Every legal statement shows its source, or is labelled
  "general information, not reviewed by a lawyer". Verdicts such as expungement eligibility
  are shown only when a statute is named.
- **Every user-facing string is translated** in all 8 languages (ht / zh / ar / tl still need a native-speaker legal review, docs/TRANSLATIONS.md): the i18n scan, parity tests
  and the no-emoji test run inside `npm test`.

## 3. Run it locally

```bash
# Postgres 16 running locally
createdb justice_gavel
DATABASE_URL=postgres://localhost/justice_gavel sh backend/scripts/migrate.sh

cd backend && npm ci
DATABASE_URL=postgres://localhost/justice_gavel npm start         # :4000, no keys needed
curl -s localhost:4000/health

cd ../frontend && npm ci
EXPO_PUBLIC_API_BASE=http://localhost:4000/api npx expo start      # press w for web, or scan with Expo Go
```

With no keys, the server generates development secrets. AI returns `503 ai_unavailable`
(point `ANTHROPIC_BASE_URL` at `node backend/scripts/anthropic-mock.mjs 4399` to work offline),
e-mails are logged instead of sent, and SMS, push and video report "not configured". Copy
`backend/.env.example` to `backend/.env` to add keys.

## 4. Test it (what CI runs, in `.github/workflows/ci.yml`)

```bash
# backend
cd backend
npm run lint
npm audit --omit=dev --audit-level=high
TEST_DATABASE_URL=postgres://localhost/jg_test node --experimental-vm-modules node_modules/.bin/jest --ci
node scripts/smoke-test.mjs http://localhost:4000 --anthropic-mock 4399          # 40 checks
node scripts/route-sweep.mjs http://localhost:4000 --db-url "$DATABASE_URL" --admin-key "$ADMIN_KEY"

# frontend
cd ../frontend
npx tsc --noEmit && npx eslint src App.tsx --max-warnings 0 && npm test
node scripts/design-audit.mjs --ci
EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
bash scripts/run-all-journeys.sh dist out --api http://localhost:4300/api \
     --mock http://127.0.0.1:4399 --db-url "$DATABASE_URL" --port 8300
```

Notes:
- **Database for jest:** give it a migrated database of its own (`TEST_DATABASE_URL`).
  Without one, the Postgres suites are skipped.
- **Journeys:** they need the API started in production mode with
  `CORS_ORIGIN=http://localhost:8300` and `JWT_SECRET` exported in the same shell, plus the
  Anthropic mock running. See the header of `run-all-journeys.sh`.
- **Memory:** jest recycles workers at 800 MB (`workerIdleMemoryLimit`). Without that, a full
  run on a 7 GB machine gets killed.
- **Source-pin tests:** many older tests (`brutal_trials_v*.test.js` and similar) read source
  text. When you change code on purpose, grep `backend/src/__tests__` for the file name and
  update the pins honestly, or replace them with behavior tests (preferred).
- **Latest results:** 28,420 backend tests and 986 frontend tests pass, along with 40/40 smoke
  checks, 27,408 sweep requests with 0 findings, and 149 journey steps
  ([diagnostics](./docs/DIAGNOSTICS_2026-10-25.md)).

## 5. Deploy (Render)

1. In Render: **New → Blueprint** → this repo. That creates `justice-gavel-api` (production)
   and `justice-gavel-api-staging`.
2. Fill the `sync: false` secrets on production. **Reuse the existing `ENCRYPTION_KEY`, `JWT_SECRET`
   and `JWT_REFRESH_SECRET`.** A new `ENCRYPTION_KEY` makes every stored note and message
   unreadable. Staging generates its own.
3. Database: Supabase Postgres (`DATABASE_URL`). File attachments: Supabase Storage bucket
   `case-documents` (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`). The disk block in `render.yaml` is
   commented out on purpose.
4. On an existing production database, run `sh backend/scripts/migrate.sh --baseline` **once**
   before the first deploy. It records the migrations already applied so they aren't run again.
5. After the first deploy, run `/api/admin/diagnostics/client-ip` (admin) and confirm it
   shows your real IP. If `TRUST_PROXY` is wrong, every user shares Render's IP and the
   per-IP rate limits (for example Help Now at 60/min) apply to everyone at once.
6. Point the mobile builds at the API: `frontend/eas.json` → `EXPO_PUBLIC_API_BASE`. The
   Sentry DSN for the app is already there.
7. `backend/scripts/verify-deployment.sh <url>` and the smoke test against staging, then production.

**Rollback:** see "DEPLOY (Render)" in [RUNBOOK.md](./RUNBOOK.md). Every migration is
idempotent, and the code never drops columns.

## 6. Accounts and keys (each feature fails gracefully until its key is set)

| Feature | Variables | State |
|---|---|---|
| AI chat, research, translation | `ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL` | code complete; tested against a mock |
| E-mail (password reset, booking, alerts) | `RESEND_API_KEY` | complete; never sent for real |
| SMS (court reminders, SOS) | `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER` (+ optional `TELNYX_MESSAGING_PROFILE_ID`) | Telnyx (owner choice Oct 26, 2026; Twilio is not used). **Owner: create the account + 10DLC registration.** Without it SOS opens the phone's own Messages app |
| Push (Expo) / web push | `EXPO_ACCESS_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | complete; one device per user for now |
| Video consultations | `DAILY_API_KEY` | complete; tested against a fake Daily server |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price ids (`node backend/scripts/setup-stripe-products.js` builds them from `plans.js`) | **owner: not set up yet** |
| Errors and alerts | `SENTRY_DSN` | **configured.** Sentry org `justice-gavel`: projects `node` (server) and `justice-gavel-app` (React Native), with alert rules for new/returning errors and 20+ in 5 min |
| Queue | `REDIS_URL` (optional) | in-process without it; job locks make multiple instances safe |

## 7. What's open: your backlog, in priority order

1. **Real-device pass on iPhone and Android.** Camera, microphone and recording, the
   document scanner, push delivery, the native Stripe payment sheet, the iOS multi-recipient
   SMS link, app lock. All of these were checked in code only. Follow
   [docs/REAL_DEVICE_TEST_SCRIPT.md](./docs/REAL_DEVICE_TEST_SCRIPT.md).
2. **Turn on the outside services** in §6 on staging and run each flow once for real.
3. **Web first load:** cold LCP is 3–3.8 s on a throttled phone, against a 2.5 s target.
   Split the 1.28 MB gzip main bundle per screen (lazy screens in `navigation/AppNavigator.tsx`),
   and keep the offline core-path screens in the main chunk (`services/corePath.ts`,
   `OfflineStatusScreen`).
4. **Owner and lawyer items** in [docs/OWNER_DECISIONS.md](./docs/OWNER_DECISIONS.md): refund
   policy, bail-agent and firm plans, check-in verification codes, and the full list of legal
   content to review. After the review, translate the database legal text, which is English in
   every language today: expungement notes, resource descriptions, bar-prep questions.
5. **Maintainability:**
   - split the largest files (`routes/firm_verticals.js`, 2,621 lines; `matter_intelligence.js`;
     `MotionLibraryScreen.tsx`);
   - reduce the 235 `any` types in the frontend;
   - replace source-pin tests with behavior tests;
   - remove `backend/data/providers.sqlite` and `backend/demo.db` once nothing reads them
     (legacy).
6. **Dependencies:** two frontend advisories (`node-forge`, `zod`) come only from Expo's build
   tooling, have no upstream fix and aren't in the bundle. Recheck after the next Expo SDK
   patch. CI enforces 0 high advisories on the backend.
7. **Data:** listing specialties, languages, consultation terms and lawyer hours (64% complete)
   need richer sources. Use the data refresh's proposals queue, never direct edits.

## 8. Conventions

- **Branches:** work on a branch, open a PR, and merge once CI is green. Render auto-deploys
  only after checks pass.
- **New UI strings:** add them to all 4 files in `frontend/src/i18n/` (JSON, indent 2, UTF-8,
  trailing newline). Translate to native quality: Spanish with "usted" (US/LatAm),
  Brazilian Portuguese with "você", Vietnamese with full diacritics.
- **Icons:** `<AppIcon name={ICONS.x} />` or `<IconLabel>`. Never emoji.
- **Colors:** use `useTheme()` tokens only. The design audit fails on hard-coded light colors
  in dark mode.
- **Payments and prices:** change `billing/plans.js` only.
- **New environment variables:** add each one to `config.js` `ALL_ENV_VARS`,
  `DEPLOY_ENV_SETUP.md` and both `.env.example` files; `env_docs_consistency.test.js` checks this.
- **New list endpoints** must use `LIMIT`, or be listed with a reason in `list_bounds.test.js`.
- **Every bug fix** comes with a regression test: backend jest, a frontend render test, or a
  step in a `web-journeys-*.cjs`.
