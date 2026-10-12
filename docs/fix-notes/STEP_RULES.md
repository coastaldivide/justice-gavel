# Shared rules for every "10/10" step

Repo: /home/claude/work/justice-gavel (git, branch fix/full-function). Expo SDK 52 app in frontend/,
Node 22 / Express 5 backend in backend/ (ESM), Postgres migrations in supabase/migrations (00..09).
Change history and context: /home/claude/work/notes/*.md and docs/fix-notes/ in the repo — read the
ones relevant to your step first.

Owner constraints (never violate):
- Stripe cannot be set up yet. With no Stripe key, billing endpoints return 503 payments_unavailable and
  the app shows a friendly "Payments are not available yet". Keep that behaviour; Stripe must work again
  automatically once keys are set.
- Lawyer and bail-agent rows are real, verified data. Never modify, delete or hide them.
- Do NOT commit, reset, checkout or stash. The coordinator commits after each step.
- Don't reintroduce old bugs (SQLite SQL, retired model ids, secret fallbacks, mock payment activation).

Environment:
- Postgres 16 at localhost:5432, user postgres / password postgres. If it's not running:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgv/data -l /var/tmp/pgv/log -o '-p 5432 -k /tmp -c listen_addresses=localhost' start"`
  Use your own scratch database (create/drop it), not jg_final / jg_verify.
- Chromium for headless tests: /opt/pw-browsers (Playwright configured; never run `playwright install`).
- Don't use `pkill -f` with a pattern that also matches your own shell command line; kill by PID.

Verification gate (must all pass before you report done; report the numbers):
1. Fresh DB with all migrations applied in order (ON_ERROR_STOP), twice (idempotent).
2. backend: `npm ci`, import smoke, boot NODE_ENV=production TZ=UTC (generated secrets, no Stripe,
   ANTHROPIC_API_KEY=dummy, ANTHROPIC_BASE_URL=http://127.0.0.1:<mockport>), then
   `node scripts/smoke-test.mjs http://localhost:<port> --anthropic-mock <mockport>` all checks pass.
3. Full backend jest `node --experimental-vm-modules node_modules/.bin/jest --no-coverage` 0 failures
   (only required if you touched backend/ or supabase/).
4. frontend: `npx tsc --noEmit` 0 errors, `npx eslint src App.tsx` 0 errors, `npm test` all pass,
   `npx expo export --platform web` OK (only required if you touched frontend/).
5. .github/workflows/ci.yml still matches what you changed (update it if your step adds a check).

Report back concisely: what changed (files/areas), anything you chose NOT to do and why, the gate
numbers. Append the same as a section to /home/claude/work/notes/ten_of_ten.md.
