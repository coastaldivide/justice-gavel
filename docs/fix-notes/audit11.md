# Justice Gavel — Pre-launch Security / Correctness / Product Audit (audit11)

Independent read-only audit. Verified against code + a running instance (NODE_ENV=production,
Postgres `audit11`, generated secrets, no Stripe, local Anthropic mock). The backend booted clean,
all 12 migrations applied twice idempotently (195 tables), `lawyers`=2055 / `bail_agents`=1265
rows present and untouched. Backend jest: **27877 passed, 83 skipped, 0 failed** (10 PG-only suites
skip without DATABASE_URL). Web build exported and driven headless + by hand through the real journeys.

Severity reflects impact on *real users and attackers* of an app used by arrested people, their
families, and their defense attorneys, where the data is uniquely sensitive (confessions, immigration
status, privileged notes).

---

## CRITICAL

### C1. Any self-registered "attorney" can attach themselves to ANY user's case and read privileged messages + impersonate counsel
- **Evidence:** `routes/attorney/cases.js:114` `POST /api/attorney/cases/:caseId/assign` calls
  `requireAttorney` (role check only) then does `UPDATE/INSERT case_assignments … WHERE case_id=?`
  for an **arbitrary caseId with no ownership/firm/invite check**. `role:'attorney'` is granted at
  self-registration (`routes/auth.js:177`, `isAttorney` from the request body). Once assigned,
  `getCaseAccess` (`routes/messages.js:58-72`) treats them as counsel.
- **Verified live:** user A created case #1 with message "PRIVILEGED: I did it"; attacker Mallory
  registered with `isAttorney:true`, got 403 reading the thread, then `POST /attorney/cases/1/assign {}`
  → 201, then `GET /api/messages/1` → 200 (read the privileged message), and
  `POST /api/messages/1` → 200 posting "This is your attorney. Wire $5000 bail to…" which is delivered
  to the victim as an attorney message with a push notification.
- **Impact:** total breach of attorney-client confidentiality for every case in the system, plus a
  built-in fraud/phishing channel against arrested people. Likely the single worst bug here.
- **Fix:** `/assign` must verify the caller is authorized for that case (firm membership on the matter,
  an accepted client invite, or an admin action) — never allow self-assignment to an arbitrary caseId.
  Make `role:'attorney'` require verification, not a self-asserted registration flag; messaging access
  should derive from a client-initiated relationship.

### C2. Civil / ICE-detention lead victims' contact details are readable and "unlockable" by any account, for free
- **Evidence:** `routes/pi_leads.js:101` `GET /api/pi-leads/` lists open leads (incl. `incident_summary`)
  to any authenticated user; `routes/pi_leads.js:150` `POST /api/pi-leads/:id/accept` has **only
  `authRequired`** — no attorney check, no bar verification, and when Stripe is unset it skips payment
  entirely (`STRIPE_KEY && …` guard) yet still writes the purchase and returns
  `contact_name/contact_phone/contact_email`.
- **Verified live:** victim submitted an ICE-detention lead ("husband detained by ICE… undocumented",
  phone +1713…); a second ordinary account listed it and `POST /pi-leads/1/accept {}` → 200 returning
  the full name, phone, and email.
- **Impact:** a scraper (or ICE-adjacent actor, or scammer) harvests the contact details of people in
  the most vulnerable possible situations. Given the owner note that billing is intentionally disabled,
  these endpoints are *live and free right now*.
- **Fix:** gate list/accept behind verified-attorney + firm, and when payments are unavailable return
  503 `payments_unavailable` like the rest of billing instead of revealing contact info for free.

### C3. Cross-firm IDOR on matters: an unrelated firm_admin can read, edit, delete and re-team any matter
- **Evidence:** `middleware/rbac.js requireMatterAccess` step 2 grants full access to **any**
  `firm_admin`/`super_admin` without checking the matter's `firm_id` matches the caller's firm; firm
  creation auto-grants `firm_admin` to anyone (`routes/firms.js:70`).
- **Verified live:** user L created matter #2 (`client_name:"John Smith"`, notes "Client admitted fraud");
  attacker Eve created her own firm (→ firm_admin) and then `GET /api/matters/2` → 200 (full notes),
  `PUT /api/matters/2` → 200 (tampered), `POST /api/matters/2/team {user_id:Z, role:lead_attorney}` → 201.
- **Impact:** any attorney/firm's entire matter set — client names, notes, opposing parties — is readable
  and writable by any other registered firm. Also affects every `requireMatterAccess` route (time,
  events, team, history).
- **Fix:** `requireMatterAccess` must verify `matter.firm_id === ctx.firm_id` before the firm_admin
  bypass; apply the same scoping the conflicts routes already use (`if (ctx.firm_id !== firmId) 403`).

### C4. Privilege-log IDOR: any user can read, edit, and delete any firm's attorney work-product privilege entries
- **Evidence:** `routes/privilege.js` — `GET /entries/:id` (382 area), `PUT /entries/:id`,
  `DELETE /entries/:id` (`:387`), and `GET /matter/:matterId` (`:395`) select/update/delete
  `privilege_log WHERE id=?` / `WHERE matter_id=?` with **`authRequired` only** — no firm or matter
  scoping at all.
- **Verified live:** seeded a `privilege_log` row for firm 3 ("Memo re client confession"); an unrelated
  user `GET /privilege/entries/1` → 200, `GET /privilege/matter/77` → 200, `PUT` → 200, `DELETE` → 200.
- **Impact:** a litigation privilege log (the record of what a firm is withholding and why) is readable
  and destructible by anyone with an account.
- **Fix:** scope every `/privilege/*` query by the caller's `firm_id` (the `POST` and `/review` routes
  already load firm context — the read/update/delete ones must too).

### C5. Unauthenticated denial-of-service that takes the process down (memory, confirmed self-kill)
- **Evidence:** `routes/interrogation.js:76` allows **100 MB** in-memory multipart uploads
  (`multer.memoryStorage()`), and several other routes buffer 20–32 MB in memory
  (`discovery/_helpers.js:86`, `transcribe.js:13`). `middleware/auth.js` lets any registered user hit them.
- **Verified live:** 4 concurrent 95 MB uploads drove RSS from 146 MB to 588 MB; the app's own
  `monitoring/selfHealing.js:120` then called `process.exit(1)` ("SEV-1 Memory exhaustion — forcing
  restart"), i.e. a handful of requests crash the server. On Railway it would restart-loop under load.
- **Impact:** trivial, cheap DoS against an app whose whole premise is being available "24/7" to people
  mid-arrest.
- **Fix:** stream large uploads to disk/temp instead of memory, drop the interrogation limit to a sane
  size, cap total concurrent upload bytes, and raise/parameterize the memory kill threshold.

---

## HIGH

### H1. (Previously reported — confirmed) `POST /api/checkins/remind-all` requires no auth → push spam to everyone
- **Evidence:** `routes/checkins.js:329` — no `authRequired`. Verified: unauthenticated call → 200
  `{reminded:0,total_due:0}`; it iterates every user with a due check-in and sends a push to each token.
- **Impact:** anyone on the internet can trigger a push blast to the entire check-in population (abuse /
  cost / trust). **Fix:** require staff/internal auth (it's meant to be scheduler-only).

### H2. (Previously reported — confirmed) Two check-in status routes are public and leak PII
- **Evidence:** `routes/checkins.js:258` `GET /status/:enrollmentId` and `:312` `GET /my/:enrollmentId`
  have no `authRequired`. Verified live (200 unauthenticated). The status route returns the full
  enrollment row: `defendant_name, defendant_phone, defendant_email, case_number, court_date,
  bondsman_id`, plus check-in GPS history.
- **Impact:** enumerable by integer enrollmentId → bulk disclosure of defendants' identity, phone,
  email, case number, court date and locations. **Fix:** require auth + ownership (bondsman or the
  enrolled user).

### H3. (Previously reported — confirmed) Role checks trust the role baked into long-lived JWTs; demoted admins keep access
- **Evidence:** `JWT_EXPIRES_IN=30d`; `routes/admin.js:62` `requireSuperAdmin` reads `req.user.role`
  from the token; `routes/attorney/verification.js`, `admin/*`, `push.js:264` etc. likewise trust the
  JWT role. **Verified live:** promoted a user to `admin` in the DB, logged in, then demoted to `user`
  in the DB — the *old token still returned 200* on `/api/admin/stats` and `/api/attorney/pending-verification`
  (which leaks pending attorneys' emails/bar numbers). The admin console additionally requires `ADMIN_KEY`,
  which mitigates `/api/admin/*` but not `pending-verification` or other role-gated routes.
  Note: staff-mutating routes (`utils/staff.js`) correctly re-read role from the DB — the inconsistency
  is the problem.
- **Impact:** deprovisioning is not effective for up to 30 days; privilege persists after demotion/offboarding.
- **Fix:** resolve role from the DB (as `utils/staff.js` does) for every authorization decision, or add a
  token version / `role_changed_at` check; shorten access-token lifetime with real refresh rotation
  (rotation already exists in `auth.js`).

### H4. (Previously reported — confirmed) `/api/admin/lawyers` and `/api/admin/bail` return 500
- **Evidence:** `routes/admin.js:304-305` mount CRUD for tables `'lawyers'` and `'bail_agents'`, but
  `utils/routeHelpers.js:203 ADMIN_TABLES` does **not** include either, so `safeTable()` throws
  "Unknown table" → 500 (seen in server log). **Verified live** (500 with valid admin + key).
- **Impact:** the core provider-management console is unusable; also means no one is reviewing/moderating
  the directory through the intended tool. **Fix:** add `'lawyers'` and `'bail_agents'` to `ADMIN_TABLES`
  (and verify the column allowlists match those tables).

### H5. Financial IDOR: any user can read any firm's invoice totals and billable time
- **Evidence:** `routes/firms.js:418 GET /:id/invoice-summary` and `:441 GET /:id/time-entries` have
  **`authRequired` only**, query `WHERE firm_id = ?` from the path param, no membership check.
- **Verified live:** a brand-new user with no firm got `GET /api/firms/1/invoice-summary` → 200 and
  `GET /api/firms/1/time-entries` → 200. **Fix:** require firm membership and `ctx.firm_id === :id`.

### H6. `GET /api/billing/admin/stats` exposes platform revenue to any authenticated user
- **Evidence:** `routes/billing/consumer.js:101` — `authRequired` only, returns subscription counts/MRR,
  lead revenue, family-connection revenue. **Verified live:** plain user → 200. **Fix:** require admin.

### H7. Public translation session endpoints allow unauthenticated AI abuse and message injection
- **Evidence:** `routes/translate.js:188 POST /session/:code/message` and `:235 GET …/messages` have
  **no auth**; the POST calls the Anthropic API (`translate()` → paid model call) with attacker-controlled
  text of effectively unbounded length. **Verified live:** unauthenticated POST with a 200 KB body → 200
  and it fired an Anthropic request. 6-char session codes are guessable/enumerable.
- **Impact:** free AI-cost amplification + ability to inject messages into any live attorney/client
  translation session by guessing the code. **Fix:** require auth, bind to the session's participants,
  and enforce a length limit.

### H8. SAML ACS signature verification is incomplete (signature-wrapping) and skipped entirely when no cert is stored
- **Evidence:** `routes/sso.js:113 verifySamlSignature` verifies only the `<ds:SignedInfo>` blob against
  the cert; it never validates the `Reference`/`DigestValue` against the actual assertion, nor canonicalizes,
  nor checks the signature wraps the NameID/attributes it later extracts by naive regex
  (`extractNameId`, `extractAttr`). `POST /acs` (`:241`) also **skips signature checking when
  `ssoConfig.certificate` is falsy** and auto-provisions/auto-logs-in the user, honoring an IdP-supplied
  role claim. Config is self-serve per firm (`requireFirmRole('firm_admin')`).
- **Impact:** classic SAML signature-wrapping → assertion forgery / account takeover within an SSO-enabled
  firm; role elevation via the `role` attribute. (Exploit not executed here — reported from code review.)
- **Fix:** use a vetted SAML library (e.g. `@node-saml/node-saml`) that validates the signed reference and
  canonicalization; require a signed assertion always; never auto-provision from an unsigned response.

### H9. Firm webhook subscriptions have no SSRF protection (internal address egress)
- **Evidence:** `routes/webhooks/outbound.js:111` fetches the firm-supplied `url`; the only guard is
  "must be https in production" (`:104`). **Verified live:** a firm_admin created subscriptions pointing
  at `https://127.0.0.1:5432/`, `https://127.0.0.1:1/`, and `https://169.254.169.254/latest/meta-data/`
  → 201 (the test-send currently 500s on an unrelated signing bug, but the create/delivery path will POST
  to those hosts). **Impact:** SSRF to localhost / cloud metadata from the server. **Fix:** resolve + block
  private/link-local/loopback ranges before fetching; keep an allowlist or require URL verification.

### H10. Desktop web users can never accept the Terms gate → AI, research, motions, translate all blocked (core feature outage)
- **Evidence:** `TermsAcceptanceModal.tsx:78-92` only enables "I Agree" after an `onScroll` reaches the
  bottom (`scrolledToBottom`). On wide/desktop viewports the summary fits without scrolling, so the
  scroll event never fires and the button stays disabled forever.
- **Verified live:** at 1280×900 the "I Agree" button is permanently disabled even with both boxes checked
  and the content fully visible; at 390×844 (mobile) it works. Separately, the backend AI disclaimer
  (`451 disclaimer_required`) is only recorded by `LegalDisclaimerScreen` (a guest-stack deep-link screen),
  so a freshly registered user who accepts the ToS modal still hits 451 on first chat ("Sorry, I had
  trouble responding") until `/auth/disclaimer/accept` is called — which no in-app flow reliably triggers.
- **Impact:** on the web/Electron build (a shipped target), paying users are gated out of the headline AI
  features. **Fix:** treat "content not scrollable" as satisfied (measure content vs. viewport), and wire
  disclaimer acceptance into the same modal so ToS acceptance also records the AI disclaimer.

### H11. Court-date reminders are broken end-to-end (the app's signature "never miss court" promise)
- **Evidence:** Frontend `CaseScreen.tsx:67` posts `{ scheduled_for }` but the API
  (`routes/push.js:132`) requires `deliver_at` → **400** ("Could not set reminder"). **Verified live**
  (clicking "Remind me" → toast "Could not set reminder", API 400). Separately, the auto-scheduled
  reminders in `routes/cases.js:600 scheduleCourtReminders` only run for paid tiers
  (`STARTER_TIERS` gate) and require a stored push token, so a free user who sets a court date gets no
  reminder at all. For a product aimed at helping people not miss court (a bench-warrant trigger), this
  is a serious, legally-loaded failure. **Fix:** align the field name, and reconsider gating court-date
  reminders behind a paywall.

### H12. Bail calculator crashes to the error boundary for every user
- **Evidence:** `GET /api/legaldata/bail?state=TN` returns `{ data: [...] }`, but
  `BailCalculatorScreen.tsx:52` does `setSchedules(r.data || [])` and then `schedules.filter(...)` at
  `:58`. The axios wrapper's `r.data` is the envelope object, so `.filter` is called on an object →
  **"B.filter is not a function"**, caught by the ErrorBoundary ("Something went wrong"). **Verified live**
  on the exported web app. (The headless smoke "passes" because it only waits for network idle, not for
  a crash that renders after the data arrives.) **Fix:** read `r.data.data` (or unwrap consistently).

---

## MEDIUM

### M1. HTML-entity double-encoding corrupts user text everywhere it's shown
- **Evidence:** `utils/sanitize.js:19-23 sanitizeStr` HTML-encodes `< > " ' \`` on the way *into* the DB.
  React Native renders text literally, so stored values come back as mojibake.
- **Verified live:** a case message `I don't know what "bail" means <3` is stored and shown as
  `I don&#x27;t know what &quot;bail&quot; means &lt;3`. Names, notes, messages are all affected
  (`GET /auth/me` shows the display name with raw `&quot;`). It's cosmetically broken and, for legal
  notes/messages, genuinely confusing. **Fix:** store raw text; escape only at HTML sinks (emails/PDFs).

### M2. Review system stamps every review `verified: 1` with no proof of a real relationship
- **Evidence:** `routes/reviews.js:76` inserts `verified=1` for any authenticated user reviewing any
  `entity_id`. **Verified live:** a new account posted a 5-star "Best lawyer ever (I have never met them)"
  review on real lawyer #1 → returned `verified:1`. **Impact:** on a directory of *real, verified*
  attorneys, fake "verified" reviews are a reputational/legal liability and mislead defendants choosing
  counsel. **Fix:** only mark verified when tied to a real consultation/case; otherwise `verified:0`.

### M3. (Previously reported — confirmed) Bondsman SubscriptionScreen prices and claims don't match the backend
- **Evidence:** `frontend/src/screens/SubscriptionScreen.tsx:23/40/58/78` show `$78.99 / $198.99 /
  $348.99 / $48.99`, while the API (`GET /api/billing/bondsman/tiers`) and the owner's stated pricing are
  `$49 / $149 / $349 / $49` (badge). The screen also advertises "Top placement in all searches"
  (`grep` hit in the same file), a claim the matching/sort code doesn't honor and that is legally risky
  as an unqualified promise. **Fix:** source prices from the API; remove unsubstantiated placement claims.

### M4. HTML-injection surface in transactional emails (stored name/notes rendered unescaped)
- **Evidence:** `services/email.js` interpolates `displayName`, `clientName`, `attorneyName`, `caseTitle`,
  etc. straight into `html` templates (`:78`, `:164-218`) with no escaping. `sanitizeStr` (M1) happens to
  blunt the obvious vectors for some fields, but not all paths run through it (e.g. attorney/booking alert
  fields, SSO-provisioned names). **Impact:** stored-XSS/phishing in attorney alert emails once a real
  email provider is enabled. **Fix:** HTML-escape all interpolated values at the template boundary.

### M5. Feedback submission 500s for unauthenticated/anonymous users
- **Evidence:** `routes/feedback.js:24` sets `userId = 'anon'` and inserts into `feedback.user_id`
  (bigint). **Verified live:** `POST /api/feedback` unauthenticated → 500, server log
  `invalid input syntax for type bigint: "anon"`. **Fix:** allow NULL user_id or make the column text.

### M6. `chat/stream` logs "Cannot set headers after they are sent" (double-send on disclaimer path)
- **Evidence:** `routes/chat/stream.js:124-131` writes an SSE `disclaimer` frame **before**
  `res.setHeader(...)`/`flushHeaders()`, so when the disclaimer middleware or an early error also responds,
  the handler tries to set headers post-send. **Verified:** server log `[chat/stream] Cannot set headers
  after they are sent to the client` during the smoke run. Cosmetic today but indicates the SSE error
  path is unreliable. **Fix:** set headers/flush before any `res.write`, and guard the catch with
  `res.headersSent`.

### M7. Welcome carousel renders broken on desktop web
- **Evidence:** at 1280px the `/welcome` onboarding carousel shows a blank center slide with adjacent
  slides bleeding outside the phone frame (screenshot captured). Low user impact but it's the first screen
  a web/Electron user sees. **Fix:** constrain the carousel to the frame width on wide viewports.

### M8. `remind-all` / cross-firm ethics-wall writes are not matter-scoped
- **Evidence:** `routes/conflicts.js:505 POST /ethics-wall/:matterId` (and the `GET` at `:458`) use
  `requireFirmRole('partner')` but never check the `:matterId` belongs to the caller's firm (unlike the
  `/report/:firmId` routes which do check `ctx.firm_id !== firmId`). A partner can set/read ethics walls on
  another firm's matter IDs. Lower severity because it needs partner role + the matters table has its own
  FK issues, but it's the same class as C3/C4. **Fix:** verify matter→firm ownership.

---

## LOW

- **L1. Hard-coded personal on-call emails in source.** `monitoring/errorNotifier.js:106-107,129-130`
  default SEV alerts to `aa.n.hart@gmail.com` / `russelltallen@gmail.com`. These fire on the C5 OOM path.
  Move to env-only; don't ship personal addresses.
- **L2. `userExists` / role cache fail open.** `middleware/auth.js:50` returns `true` on DB error, and
  `.catch(() => next())` lets a request through if the existence check throws — deleted/suspended users can
  slip through during a DB blip. Prefer fail-closed for auth.
- **L3. `translate` message length unbounded** (ties to H7) — even authenticated `/translate/message`
  should cap input length to bound AI cost.
- **L4. `GET /api/advocacy` returns hard-coded marketing stats** ("1247 laws tracked", "8 active
  campaigns") unauthenticated — ensure these aren't presented as live data if they're static.
- **L5. Request-storm on GoldenGavel / CaseTimeline.** web-smoke flagged 6× duplicate GETs within 3s on
  `/golden-gavel` (status/eligibility/hall) and `/cases/:id/events` — an effect/deps refetch loop; wasteful
  but not fatal.
- **L6. Session codes (translate) and short tokens are only 6 chars** — enumerable; raise entropy.

---

## Checked and found solid (brief)
- **Consumer case ownership (C/R/U/D) is correctly scoped** to `user_id` (`routes/cases.js`), as are
  saved lawyers, motions history, discovery analyses, research sessions, arrest monitors, push tokens —
  all `WHERE … AND user_id=?`. IDOR probes across users returned 404/403.
- **Case messaging access** (`getCaseAccess`) is correct *given a legitimate assignment* — the hole is C1
  (how assignments are created), not the access check itself.
- **Message bodies and case notes are encrypted at rest** (AES-256-GCM, `services/encryption.js`); verified
  ciphertext in `case_messages.body`/`cases.notes`; attachments encrypted before storage and sniffed by
  magic bytes (client MIME not trusted), 10 MB cap, path-traversal-safe filenames, download scoped to
  uploader or case members.
- **Admin provider CRUD guards the real risk**: `safeTable`/`safeAdminCols` allowlist table and column
  names; dynamic ORDER BY in recovery_agents/admin is built from validated numbers / fixed strings — no
  SQL injection found in the dynamic-SQL paths I probed.
- **Password security**: bcrypt cost 12, generic login errors, lockout after 10 failures, reset tokens
  SHA-256-hashed + single-use + revoke-all-sessions, forgot-password is non-enumerating. Refresh tokens are
  single-use with reuse-detection that revokes all sessions.
- **CORS** rejects unknown origins with 403 (verified `Origin: https://evil.example` → 403); Helmet CSP,
  HSTS, nosniff, frame-ancestors none, `Cache-Control: no-store` on `/api/*` all present. Auth rate limits
  (10/15min login, 5/hr register) and per-user AI limits (60/hr + 3/day free) are wired.
- **Owner constraints honored:** billing endpoints return 503 `payments_unavailable`; sample `seed_v1`
  arrests are hidden (search/get/stats/warrant-check all return nothing for them with SHOW_SAMPLE_ARRESTS
  unset); flat lead fees intact ($75 ICE verified in response). Lawyer/bail rows unchanged by the app.
- **Resilience:** DB-down → `/health` 503 and data routes 500 cleanly, auto-recovers when DB returns;
  AI-down → chat job records `failed` rather than hanging; court-date handling keeps the literal calendar
  day (no TZ drift) and rejects impossible dates.
- **Migrations** apply twice idempotently; `openapi.json` drift is guarded by a test.

## Test / CI integrity (task item 6)
- **The suite is large (27,877 passing) but much of it asserts source text, not behavior.** ~190 of the
  `*.test.js` files `readFileSync` a route file and `toContain("router.post('/…')")` (e.g.
  `brutal_trials_v150.test.js`), and the "multi_user"/"attorney_platform" suites **re-implement the route
  logic inline** (`buildApp` with its own `auth`/`requireDefender` and hand-written SQL) instead of
  importing the real routers — so they pass even though the real `requireMatterAccess` has the C3 cross-firm
  hole and real `/assign` has C1. None of C1–C4, H1–H12 are caught by the suite.
- **ci.yml would NOT catch a regression in auth or payments as exercised.** It runs the smoke test +
  integration suite against real Postgres (good), but the smoke test asserts the *happy path* (payments
  503, AI mock answers) and the auth/authorization negative cases above aren't tested anywhere. The
  frontend "web bundle verify" only greps for screen chunks, so the ToS-gate outage (H10) and bail-calc
  crash (H12) ship green. Recommend: add real IDOR/authz integration tests that import the actual routers,
  and a web-smoke assertion that fails on an ErrorBoundary after data load.

## Environment used
Postgres 16 DB `audit11`; backend booted NODE_ENV=production on :47110 with generated
JWT/refresh/encryption/admin secrets, ANTHROPIC_BASE_URL → local mock on :47111 (logged outgoing requests,
model `claude-sonnet-4-6` confirmed, API key forwarded). Web build exported with
`EXPO_PUBLIC_API_BASE=http://localhost:47110/api`, served statically, driven with Playwright/Chromium at
/opt/pw-browsers. Scratch work in the audit11 scratchpad. No repo files modified.

---

## Remediation status (step 11, 2026-10-12)

Started from the unverified checkpoint `3dae8ea` (two agents were cut off mid-way: security fixes
through H8 with tests, functional fixes without tests/verification). Every finding was re-read in
the code, finished where needed, and proven with a regression test that replays the attack plus a
live re-run against a production-mode server (`NODE_ENV=production`, fresh migrated DB, no Stripe,
mock Anthropic + mock Expo push). Live replay: **19/19 attacks blocked**.

| # | Status | Fix (summary) | Regression test(s) |
|---|---|---|---|
| C1 | Fixed + tested | `/attorney/cases/:id/assign` needs a client-created relationship: client invite (`POST /api/cases/:id/counsel`, new `routes/caseCounsel.js`) accepted by the attorney, a confirmed consultation with the attorney's **linked listing**, active counsel adding a same-firm colleague, or staff. Never overwrites other counsel; client can revoke. Step 11 also fixed: lawyer-id/user-id confusion (booking with directory lawyer #N granted user #N access), inbox leaking unread message bodies / client e-mail / hearings to pending or revoked counsel, inbox `OR` precedence bug. | `security/c1_case_assignment.int.test.js` (11 tests incl. id-confusion + inbox leak) |
| C2 | Fixed + tested | Lead lists: attorney accounts only, no free text / contact before a **succeeded** charge; accept → 503 `payments_unavailable` without Stripe, bar-verified attorneys only with it; legacy demo "purchases" voided (migration 14); bail leads bondsman-only, initials, no mock purchase. | `security/c2_leads.int.test.js` |
| C3 | Fixed + tested | `resolveMatterAccess`: firm_admin bypass only inside the matter's own firm; outsiders 404; `matters.firm_id` FK fixed to `firms` (migration 14). | `security/c3c4_firm_scoping.int.test.js` |
| C4 | Fixed + tested | Every `/privilege/*` read/update/delete scoped to the caller's firm + matter access; `doc_number` TEXT. | same file |
| C5 | Fixed + tested | `middleware/uploads.js uploadGuard`: auth before body, 413 on declared size, route caps (audio 25 MB → disk, docs 10 MB, contracts 5 MB), process byte budget (503 `upload_busy`), 2 concurrent/user (429), temp files removed. Step 11: transcription routes refuse **before** reading the body when no Whisper key / free plan. Live: the audit's 4×95 MB attack → 413/400/429, RSS +49 MB (was +442 MB and a self-kill). | `security/c5_uploads.int.test.js` (7) |
| H1 | Fixed + tested | `remind-all` requires staff token or `X-Admin-Key`. | `security/h1h2_checkins.int.test.js` |
| H2 | Fixed + tested | status/history need auth + ownership (bondsman, enrolled defendant by account e-mail, staff); others 404. | same |
| H3 | Fixed + tested | `authRequired` loads role/status/flags from `users` (60 s cache, invalidation hook), ignores token role claims, fails closed (503). Step 11: refresh paths also refuse suspended/deleted accounts. Live: demoted admin's old token 200 → 403. | `security/h3h4_live_roles_admin.int.test.js` |
| H4 | Fixed + tested | `lawyers`/`bail_agents` in `ADMIN_TABLES`; INSERT column list bug fixed. Tests only read. | same |
| H5 | Fixed + tested | `requireFirmMember` on firm finance/member routes; non-members 404. | `c3c4_firm_scoping` |
| H6 | Fixed + tested | `/billing/admin/stats` super_admin only. | `c3c4_firm_scoping` |
| H7 | Fixed + tested | Session endpoints need the per-session secret token (or bound participant), seat binding, 2 000-char cap, 300-message budget, 4 h expiry; no AI call without auth. | `security/h7_translate.int.test.js` |
| H8 | Fixed + tested | SAML via `@node-saml/node-saml` (signed assertion required, wrapping rejected, audience/issuer/replay/InResponseTo checks), no cert → config rejected, no takeover of non-member accounts, IdP role never maps to admin tiers. | `security/h8_saml.int.test.js` (10 incl. forged, tampered, wrapped, unsigned) |
| H9 | Fixed + tested | `utils/ssrfGuard.js`: static + resolve checks, connect-time lookup guard (DNS rebinding), no redirects, https in prod. Step 11: same guard on firm integration URLs (DMS `instance_url`, CalDAV `calendar_url`/`href`). | `security/h9_ssrf.int.test.js` (6, new) |
| H10 | Fixed + verified | "I Agree" unlocks when the summary fits the viewport; accepting also records the AI disclaimer; App re-checks on every sign-in and on any 451. Verified in headless Chromium at 1280×900 (no scroll needed) and 390×844 (disabled until scrolled). | `frontend render/audit11.test.tsx` (H10 ×3), `scripts/web-journeys.cjs` H10 desktop + phone |
| H11 | Fixed + verified | Court reminders for every account in the user's zone (7d/3d 09:00, eve 18:00, day-of 06:30), re-planned on date/title/state change, cancelled on close/delete; `POST /push/reminders` accepts `deliver_at` and legacy `scheduled_for`; dispatcher (every 60 s, independent of LIVE_REFRESH) sends push via injectable Expo endpoint with e-mail fallback and drops dead tokens. Live: reminder delivered to the mock Expo endpoint. | `integration/audit11_functional.int.test.js` (H11 ×6), web-journeys H11 |
| H12 | Fixed + verified | `unwrapList` for every list response (bail calculator + other screens; also the crisis-lines refresh). Step 11 also fixed the dark-mode "How bail bondsmen work" box (green text on green) and the unreadable state picker on web. | render/audit11 (H12 ×2), web-journeys H12 |
| M1 | Fixed + verified | Input is stored raw (no HTML encoding); escaping only at HTML sinks (backend `utils/html.js`, new `frontend/src/utils/html.ts` for print/PDF, which now escapes case titles/motion labels that the old input encoding used to cover). `backend/scripts/repair-legacy-entities.mjs` (dry-run default) restores rows written by the old encoders (case_messages, messages, feedback). Also fixed: the case list never returned notes, so editing any case erased its notes. | audit11_functional M1, web-journeys M1 |
| M2 | Fixed + tested | `verified` only with a completed consultation / assignment; migration 13 recomputes existing rows (directory rows untouched). | audit11_functional M2 |
| M3 | Fixed + tested | Provider and consumer plans load from `/billing/tiers` + `/billing/bondsman/tiers`; no placement claims. Step 11: restored the provider plan **cancel** action, fixed `$48.99` badge copy, removed a free tier activation when Stripe is set but a tier has no price id, removed the dead mock badge activation. | render/audit11 M3, updated brutal_trials_v14/v44 |
| M4 | Fixed + tested | All e-mail templates escape interpolations; `safeUrl` for links; subjects header-safe. | `security/m4_email_escaping.test.js` (new) |
| M5 | Fixed + tested | Anonymous feedback → `user_id NULL`, 201. | audit11_functional M5 |
| M6 | Fixed + verified | SSE headers set/flushed before the first frame; errors before streaming are JSON. Step 11: `/chat/stream` history now scoped to the caller (a guessed `sessionId` pulled another user's conversation into the prompt). | audit11_functional M6 ×2, web-journeys M6 (0 "Cannot set headers") |
| M7 | Fixed + verified | Carousel slides use the measured carousel width (`onLayout` + `getItemLayout`). Also removed the invented "★★★★★ 4.9 App Store" rating. | render/audit11 M7, web-journeys M7 |
| M8 | Fixed + tested | Ethics-wall routes verify the matter belongs to the caller's firm. | `c3c4_firm_scoping` |
| L1 | Fixed + tested | Alert recipients env-only. | `security/l1_no_personal_emails.test.js` (new) |
| L2 | Fixed + tested | Auth fails closed (503). | h3h4 "L2" |
| L3 | Fixed + tested | Translation text capped. | h7 "L3" |
| L4 | Fixed | `GET /api/advocacy` no longer returns invented counters (`static: true` + link to the live `/stats`). | — (no consumer) |
| L5 | Verified | Web smoke: 0 request storms (362 API requests). | web-smoke storm detector |
| L6 | Mitigated | 6-char codes no longer authorise anything; a 256-bit per-session token does. | h7 |

Also changed in step 11: CI runs `src/__tests__/security` (and `final_pass_fixes`) against the CI
Postgres; 44 stale source-text assertions were updated to the new behaviour (none weakened a security
check); `openapi.json` regenerated (568 ops); docs (README security notes, LAUNCH_CHECKLIST, RUNBOOK
scheduled jobs, API_REFERENCE) corrected.

Not done / open: a generic cross-user IDOR sweep over every `:id` route (the per-finding suites cover
the audited classes); `/api/legaldata/*` (bail calculator data) still requires sign-in — a product
decision, guests see the sign-in/error state, not a crash; other screens' web `<Picker>`s may have
the same white-background contrast issue fixed in the bail calculator.
