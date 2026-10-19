# Core path — how to make each section thicker and stronger

> **Just arrested?** 1) Know your rights · 2) Find a lawyer and a bail agent ·
> 3) Never miss a court date

**Rule for every item: functioning comes first.** Nothing ships unless it works on a
real phone, offline where promised, with tests — and with a graceful fallback when
an outside service (AI, SMS, email, push, maps) isn't configured or is down.

Status: **Build** = code we can write now · **Owner** = needs an account, key, partner
or legal sign-off · ✅ = built (filled in as work lands).

## 0. The entry point: "Just arrested?" mode

| Improvement | Why it matters | Status |
|---|---|---|
| One-tap "Just arrested?" button on Home (and first screen after install) that walks the three steps in order | The marketing promise *is* the first screen | ✅ Home card + first-screen button → `JustArrestedScreen` 3-step hub |
| Works signed-out (guest) for steps 1–2; sign-in only to save a court date | People in crisis won't make an account first | ✅ public `/api/rights`, `/api/help/*`; step 3 shows a clear sign-in prompt |
| Progress shown ("Step 2 of 3") and resumable | Scared people get interrupted | ✅ saved on the device (`services/corePath.ts`) |

## 1. Know your rights

| Improvement | Why it matters | Status |
|---|---|---|
| State-specific rights card chosen by GPS or a state picker | Rights and procedures differ by state | ✅ `GET /api/rights/:state`; no paywall (the old subscription blur is gone) |
| Rights card cached for offline use (works in airplane mode, no account) | Phones lose signal in police stations and jails | ✅ bundled general card + saved state card; checked in headless Chromium offline |
| 30-second "What to say / what not to say" script, large text, plain language | Usable under stress | ✅ lines lifted from the existing card (no new law) |
| Every rights statement shows its source and a "last reviewed" date | Trust, and legal safety | ✅ content (source + "April 2026" as recorded; "Not yet reviewed by a lawyer") · ⏸ Owner: lawyer review → `rights_cards` rows with `reviewed_by` |
| AI chat answers grounded in the verified rights content, with links back to it; says "talk to a lawyer" instead of guessing | Stops confident wrong answers | ✅ verified card text + "say you are not sure, talk to a lawyer" rule in the prompt; `rights_refs` → "From your rights card →" links (model compliance is a prompt instruction, not a guarantee) |
| Share arrest info with family in one tap (who, where held, booking number, charges) | Families are the ones making calls | ✅ Emergency Share now carries who / where held / booking no. / charges (kept on the phone) |
| Spanish (and the app's other languages) for the rights card and script | Many arrested people's families aren't English-first | ✅ The whole core path in es/pt/vi: every app string (frontend/src/i18n, parity-tested — no English left), the server's rights card, script, notices, guidance, help notes, court-date text, .ics, reminders (push/e-mail/SMS) and family invites (backend/src/i18n, served by `?lang=` / Accept-Language, reminders in the person's saved language `users.preferred_language`). The card sections now match the English section by section. |

## 2. Find a lawyer **and** a bail agent

| Improvement | Why it matters | Status |
|---|---|---|
| One combined "Get help now" results screen: lawyers and bail agents together | Matches the promise; no competitor does it | ✅ `HelpNowScreen` ← `GET /api/help/nearby` |
| Filters: charge type (DUI, drugs, assault…), language, free consultation, open now / 24-7, distance | Find the *right* help fast | ✅ built on existing fields. Data limits (owner): every lawyer row lists only "Criminal Defense", English, and free_consultation=1, so charge matches name/firm/website, language finds no other languages yet, and free consultation does not narrow |
| "Open now" and 24/7 badges from stored hours | It's often 2 a.m. | ✅ parsed from stored hours in the provider's zone; unknown hours are never "open" (`bail_agents.available_24_7` is 1 on every row, so it is ignored) |
| One-tap call and text; directions | Fewer steps under stress | ✅ |
| Results ranked by distance + completeness of the listing (real phone, hours, website) — never by payment | Honest results; legal-advertising safety | ✅ `services/providerHours.js rankProviders` (paid flags never read; unit-tested) |
| "Report a problem with this listing" (wrong number, closed) feeding the admin review queue | Keeps 3,300 listings accurate | ✅ `listing_reports` + `/api/admin/listing-reports`; never edits the listing |
| Public-defender eligibility info and the local public defender office alongside paid lawyers | Many can't afford a lawyer | ✅ state office + eligibility text from `resources` |
| Bail calculator linked to the case: bail amount → typical agent fee (usually ~10%) | Families need the real cost | ✅ linked (state / charge / case pre-filled) with sourced bail ranges, public · **fee estimate NOT built**: no sourced per-state premium data (`bail_agents.fee_percent` is 10 on every row = a default); the old "10%" estimates were removed |
| County inmate-lookup link next to results | First thing families search for | ✅ 42 county links in 29 states |
| Claim-your-listing flow so lawyers/agents can receive in-app messages | Messaging reaches nobody today | ✅ claim → admin approves → lawyer's in-app messages arrive (bail-agent messaging does not exist yet) · ⏸ Owner: outreach |

## 3. Never miss a court date

| Improvement | Why it matters | Status |
|---|---|---|
| Reminders at 7 days, 3 days, 1 day and the morning of | Matches proven court-reminder programs | ✅ per hearing, user's zone |
| Fallback chain: push → email → SMS (SMS only when Twilio is configured) | Push alone gets missed | ✅ each step skipped cleanly when not configured; SMS opt-in · ⏸ Owner: `TWILIO_*`, `RESEND_API_KEY` |
| Add to phone calendar (.ics) | Survives app deletion | ✅ all-day or timed (TZID + VTIMEZONE) |
| Court date shows courthouse name, address, phone, directions | People get lost on the day | ✅ |
| "What to bring / what to wear" checklist on the court date | Reduces no-shows and bad first impressions | ✅ from existing app content, sourced · ⏸ Owner: lawyer review |
| Family follower: a loved one gets the same reminders (with the user's consent) | Families drive people to court | ✅ explicit consent, invite code, revocable by either side; follower sees court dates only |
| "I missed my court date — what now?" guidance + call your lawyer | Missed dates become warrants | ✅ generic, sourced, ends "Call your lawyer or the court clerk." |
| Multiple dates per case; past dates archived | Cases have many hearings | ✅ `court_dates` |
| Dates stay on the calendar day entered, any time zone | Already fixed; keep the test | ✅ |

## Order of work

1. ✅ "Just arrested?" mode + offline state rights card (the first impression).
2. ✅ Combined lawyer + bail results with filters, open-now, report-a-listing.
3. ✅ Court-date reminder schedule, .ics, courthouse details, missed-date guidance.
4. ✅ Family sharing and follower reminders.
5. Owner items: lawyer review of rights content, Twilio/Resend keys, listing-claim outreach.

Each step is tested on the Real-World Test Script before the next begins.

Verified (2026-10-19): backend `core_path_units` + PG `integration/core_path.int` (rights sources, filters,
ranking, reports/claims never touching provider rows, reminders, .ics, IDOR, SMS chain, follower consent
and revocation), app render tests `render/corePath`, smoke-test core-path checks, and the headless
"Just arrested?" journey in `frontend/scripts/web-journeys.cjs` (guest → rights → lawyer + bail →
report → sign up → court date → .ics → reminders → family follower → airplane mode).
