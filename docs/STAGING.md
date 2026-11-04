# Staging — set it up, test it, promote to production

Staging is a full copy of the Justice Gavel API that runs the **same production build**
with **its own database, its own keys and fake money**. Every change goes to staging first;
production only gets it after staging passes.

```
your work ──push──▶ consumer-core-path ──CI passes──▶ STAGING deploys ──"Staging check" green──▶
              merge consumer-core-path into main ──CI passes──▶ PRODUCTION deploys
```

| | Staging | Production |
|---|---|---|
| Render service | `justice-gavel-api-staging` | `justice-gavel-api` |
| Git branch it deploys | `consumer-core-path` | `main` |
| Database | its own Supabase project | the production Supabase project |
| Stripe | **test** keys (`sk_test_…`) only — a live key is refused | live keys |
| Texts / e-mail | only to the numbers and addresses you allow (below) | everyone |
| Claude | its own key, spend capped at $5/day (`AI_DAILY_BUDGET_USD`) | production key |

Plan about an hour the first time. You need: the Render account, the Supabase account,
Stripe (test mode), Telnyx, Resend, the Claude Console, and admin rights on the GitHub repo.

---

## 1. Create the staging database (Supabase)

1. supabase.com → **New project** → name it `justice-gavel-staging` (same region as production).
   Save the database password it shows.
2. Project → **Connect** → copy the **connection string** (URI). Put the password into it.
   This is your **staging `DATABASE_URL`**. It must never be the production one.
3. Project settings → API → copy the **Project URL** (`SUPABASE_URL`) and the
   **service_role** key (`SUPABASE_SERVICE_KEY`) — staging stores uploaded files here.
4. Storage → create a **private** bucket named `case-documents` (the default `ATTACHMENTS_BUCKET`,
   DEPLOY_ENV_SETUP.md → "Attachments"), the same as production.

## 2. Get the staging keys ready

| Service | What to do | Render value |
|---|---|---|
| **Stripe** | Dashboard → switch on **Test mode** → Developers → API keys → copy the **secret key** (`sk_test_…`). Developers → Webhooks → add endpoint `https://<staging host>/api/billing/webhook` with the same events as production (render.yaml lists them) → copy its signing secret. For Bond Desk card payments add the Connect endpoint too (EXTERNAL_SERVICES_SETUP.md §3b). | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` |
| **Telnyx** | Either a **separate messaging profile** for staging (cleanest: its own webhook URL `https://<staging host>/api/webhooks/telnyx`), or the same number as production. Either way staging only texts the numbers on its allow-list (step 3). | `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_PUBLIC_KEY` |
| **Claude** | Claude Console → create a **separate API key** for staging (a separate workspace makes its usage easy to see). Staging also caps its own spend at $5 a day (`AI_DAILY_BUDGET_USD` in render.yaml). | `ANTHROPIC_API_KEY` |
| **Resend** | Create a separate API key named "staging" (easy to revoke). | `RESEND_API_KEY` |

## 3. Decide who staging may contact

Staging must never text or e-mail a real customer. It sends **only** to what you list here;
everything else is skipped (the log says `staging_recipient_not_allowed` with a count — never
the number or address).

- `STAGING_ALLOWED_PHONES` — your own test phones, in `+1` form, separated by commas:
  `+16155550123,+16155550124`
- `STAGING_ALLOWED_EMAILS` — exact addresses and/or whole domains, separated by commas:
  `you@gmail.com,@yourcompany.com`. Listing `you@gmail.com` also allows `you+anything@gmail.com`
  (they arrive in the same inbox) — the demo accounts use that.

Empty list = staging texts / e-mails nobody. Push notifications are not filtered (they only
reach phones signed in to staging accounts).

## 4. Create the staging service on Render

1. Render → **New → Blueprint** → pick this repository. Render reads `render.yaml` and shows
   both services. (If production already exists, use **Blueprint → Sync** instead.)
2. It asks once for every secret. For **`justice-gavel-api-staging`** enter the staging values
   from steps 1–3 (`DATABASE_URL` = the **staging** URL). Leave `APP_URL` as the staging web
   app address if you have one, otherwise `https://justicegavel.app`.
3. Render creates `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_KEY`, `METRICS_TOKEN` and
   **`STAGING_TEST_KEY`** for staging by itself. Open the staging service → Environment and
   copy `ADMIN_KEY` and `STAGING_TEST_KEY` — you need them in step 7.
4. Optional, to test the public defender channel on staging (⚖, off by default): add
   `PUBLIC_DEFENDER_CHANNEL_ENABLED=true` to the staging service only.
5. The first deploy builds, runs the database migrations and starts. Wait until the service
   shows **Live**, then open `https://<staging host>/health` — it must say `"env":"staging"`
   and `"db":"ok"`.

`STAGING_TEST_KEY` belongs to staging **only**. Never add it to production —
`node scripts/check-env.js` fails if it is set there.

## 5. Set up the staging database and demo data (one command)

Render → `justice-gavel-api-staging` → **Shell**, then:

```sh
sh scripts/staging-setup.sh --database-url "$DATABASE_URL"
```

You type the database URL on purpose (here: the staging service's own). The script:

1. refuses unless `APP_ENV=staging`, and refuses a URL equal to `PROD_DATABASE_URL` /
   `PRODUCTION_DATABASE_URL` when either is set;
2. applies any new migrations (`scripts/migrate.sh`);
3. checks the environment (`scripts/check-env.js`) — it lists which features are on and how
   many phones / e-mails staging may contact; it stops on any ❌;
4. adds demo data (`scripts/seed-staging.mjs`) and **prints the logins**:
   - a consumer with a case, 2 upcoming court dates and their reminders (texts on, to the first
     allowed phone),
   - a Bond Desk agency: owner + 1 staff seat, 2 bonds (one with an indemnitor),
   - a public defender office with 2 clients.

All demo phones / e-mails come from your allow-lists (or are clearly fake and blocked).
It is safe to run again: nothing is added twice; each run sets a new demo password and prints
it (set `STAGING_DEMO_PASSWORD` on the service to keep one fixed). To remove **only** the demo
data: `sh scripts/staging-setup.sh --database-url "$DATABASE_URL" --reset`.

## 6. Run the smoke test once by hand (optional)

From your computer (in `backend/`, with Node 22):

```sh
node scripts/smoke-test.mjs https://<staging host> --payments-live --ai-live --staging-key "<STAGING_TEST_KEY>"
```

It signs up a throwaway account, walks the core path, makes **one** real Claude call, checks
rate limits, and deletes the account. It ends `NN/NN checks passed`. `--staging-key` gives each
run (and each rate-limit check) its own made-up client address, so you can run it again right
away; without it the 5-sign-ups-per-hour limit stops a second run.

## 7. Let GitHub check staging after every push

GitHub → repository → Settings → **Secrets and variables → Actions** → New repository secret:

| Secret | Value |
|---|---|
| `STAGING_URL` | `https://<staging host>` (no slash at the end) |
| `STAGING_TEST_KEY` | the staging service's `STAGING_TEST_KEY` |
| `STAGING_ADMIN_KEY` | the staging service's `ADMIN_KEY` |
| `STAGING_DATABASE_URL` | optional — the staging database URL; adds database checks |

The **Staging check** workflow (`.github/workflows/staging-check.yml`) then:

- on every push to `consumer-core-path`: waits (up to 25 minutes) until staging's `/health`
  shows the pushed commit, then runs the smoke test with `--payments-live --ai-live --staging-key`;
- every night: runs the smoke test against whatever is deployed;
- by hand (Actions → Staging check → Run workflow): the same, and with **sweep** ticked also the
  route sweep — it calls every route as six kinds of user and makes **many real Claude calls**
  (a few dollars, capped by the staging $5/day budget).

Without `STAGING_URL` the workflow just says "skipped" — it does not fail.

## 8. The full live test

With the smoke test green, do **docs/LIVE_TEST.md** on staging (real phones, Stripe test
cards, your own inbox). Make sure every phone and inbox you test with is on the allow-lists
from step 3 first.

## 9. Promote to production

When staging is green and the live test passes:

1. GitHub → **New pull request**: base `main` ← compare `consumer-core-path` → merge.
2. CI runs on `main`; when it passes Render deploys production (migrations first, then the new
   version — a failed migration stops the deploy and the old version keeps serving).
3. Open `https://api.justicegavel.app/health` → `"env":"production"` and the new `commit`.

If production misbehaves: RUNBOOK.md → "Roll back".

---

### Reference

- Environment variables: DEPLOY_ENV_SETUP.md → "Staging".
- How the outbound guard works: `backend/src/services/sms.js`, `backend/src/services/email.js`
  (every text and e-mail in the app goes through these two).
- How the test-client key works: `backend/src/middleware/stagingTestClient.js` — only when
  `APP_ENV=staging`, the key is at least 32 characters and the request's `X-Staging-Test-Key`
  matches it does `X-Test-Client-Ip` replace the client IP the rate limits see. Both headers are
  removed before anything is logged or sent to Sentry. In production they do nothing.
- Runbook: RUNBOOK.md → "STAGING".
