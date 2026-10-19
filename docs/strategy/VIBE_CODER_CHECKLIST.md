# 50 things vibe-coded apps usually miss — Justice Gavel checklist

"Vibe coding" = building fast with AI by describing what you want. It produces
code that *looks* finished but often skips the unglamorous parts below. Each item
has a status for Justice Gavel; the audit fills in **Status** and **Evidence**
(a file, test or command that proves it).

Status key: ✅ done & tested · 🟡 partial · ❌ missing · ⏸ needs owner (keys, accounts, legal)

## Security (1–15)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Secrets kept out of code and git history | | |
| 2 | Every route requires auth unless deliberately public (deny by default) | | |
| 3 | Ownership checks on every record (no IDOR: user A can't read user B's data) | | |
| 4 | Roles/permissions read from the database, not trusted from old tokens | | |
| 5 | Input validated on every endpoint (types, lengths, formats) | | |
| 6 | All SQL parameterized (no string-built queries) | | |
| 7 | Output escaped (HTML emails, web pages) — no XSS | | |
| 8 | Rate limits on login, signup, password reset, AI and other costly endpoints | | |
| 9 | Passwords hashed; reset/refresh tokens hashed, single-use and expiring | | |
| 10 | File uploads: size limits, type checked by content, safe storage | | |
| 11 | User-supplied URLs can't reach internal addresses (SSRF) | | |
| 12 | CORS limited to known origins | | |
| 13 | Security headers and HTTPS everywhere | | |
| 14 | Dependencies audited; no known high/critical vulnerabilities shipped | | |
| 15 | Logs never contain passwords, tokens or sensitive personal data | | |

## Data (16–24)

| # | Item | Status | Evidence |
|---|---|---|---|
| 16 | One versioned, idempotent migration history; schema matches code | | |
| 17 | Backups exist and a restore has been tested | | |
| 18 | Multi-step writes wrapped in transactions | | |
| 19 | Indexes on the queries that actually run hot | | |
| 20 | Dates and time zones handled correctly (calendar dates stay the same day) | | |
| 21 | Users can export and delete their data (privacy law, app-store rule) | | |
| 22 | Deletes are consistent (no orphans; soft-delete respected everywhere) | | |
| 23 | Every list endpoint is paginated / bounded | | |
| 24 | Unique constraints + idempotency stop duplicates under double-clicks and retries | | |

## Reliability (25–34)

| # | Item | Status | Evidence |
|---|---|---|---|
| 25 | Errors are never silently swallowed | | |
| 26 | Health check really checks the database (and fails when it's down) | | |
| 27 | Timeouts and retries on every outside call (AI, email, push, maps) | | |
| 28 | The app degrades gracefully when an outside service is down | | |
| 29 | Background jobs are idempotent, don't overlap, and are monitored | | |
| 30 | Graceful shutdown (finish in-flight work, close connections) | | |
| 31 | No memory leaks or runaway timers | | |
| 32 | Required settings validated at startup; clear message when one is missing | | |
| 33 | Error tracking and uptime monitoring wired up | | |
| 34 | Structured logs with a request ID per request | | |

## Frontend & UX (35–43)

| # | Item | Status | Evidence |
|---|---|---|---|
| 35 | Every screen has loading, empty and error states | | |
| 36 | Works offline where it matters (rights, saved contacts, court dates) | | |
| 37 | Accessibility: screen-reader labels, contrast, large-text support | | |
| 38 | Looks right on small phones, tablets, web, and in dark mode | | |
| 39 | Buttons can't be double-submitted | | |
| 40 | Forms show clear validation messages | | |
| 41 | Back button and deep links go where users expect | | |
| 42 | Login tokens stored securely on the device | | |
| 43 | Permissions (location, notifications) asked in context with a reason | | |

## Process, legal & cost (44–50)

| # | Item | Status | Evidence |
|---|---|---|---|
| 44 | CI blocks merges when tests, types or lint fail | | |
| 45 | Tests check behavior, not just that source text exists | | |
| 46 | A staging environment separate from production | | |
| 47 | Reproducible builds (lockfiles committed, pinned versions) | | |
| 48 | Docs and runbook match what the code actually does | | |
| 49 | Legal/store compliance: terms, privacy policy, disclaimers, privacy labels, in-app account deletion | | |
| 50 | Cost controls on paid APIs (per-user AI limits, spend caps, alerts) | | |
