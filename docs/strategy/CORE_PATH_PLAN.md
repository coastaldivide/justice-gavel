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
| One-tap "Just arrested?" button on Home (and first screen after install) that walks the three steps in order | The marketing promise *is* the first screen | Build |
| Works signed-out (guest) for steps 1–2; sign-in only to save a court date | People in crisis won't make an account first | Build |
| Progress shown ("Step 2 of 3") and resumable | Scared people get interrupted | Build |

## 1. Know your rights

| Improvement | Why it matters | Status |
|---|---|---|
| State-specific rights card chosen by GPS or a state picker | Rights and procedures differ by state | Build |
| Rights card cached for offline use (works in airplane mode, no account) | Phones lose signal in police stations and jails | Build |
| 30-second "What to say / what not to say" script, large text, plain language | Usable under stress | Build |
| Every rights statement shows its source and a "last reviewed" date | Trust, and legal safety | Build (content) + Owner (lawyer review) |
| AI chat answers grounded in the verified rights content, with links back to it; says "talk to a lawyer" instead of guessing | Stops confident wrong answers | Build |
| Share arrest info with family in one tap (who, where held, booking number, charges) | Families are the ones making calls | Build |
| Spanish (and the app's other languages) for the rights card and script | Many arrested people's families aren't English-first | Build (existing i18n) + Owner (native review) |

## 2. Find a lawyer **and** a bail agent

| Improvement | Why it matters | Status |
|---|---|---|
| One combined "Get help now" results screen: lawyers and bail agents together | Matches the promise; no competitor does it | Build |
| Filters: charge type (DUI, drugs, assault…), language, free consultation, open now / 24-7, distance | Find the *right* help fast | Build (uses existing fields) |
| "Open now" and 24/7 badges from stored hours | It's often 2 a.m. | Build |
| One-tap call and text; directions | Fewer steps under stress | Build |
| Results ranked by distance + completeness of the listing (real phone, hours, website) — never by payment | Honest results; legal-advertising safety | Build |
| "Report a problem with this listing" (wrong number, closed) feeding the admin review queue | Keeps 3,300 listings accurate | Build |
| Public-defender eligibility info and the local public defender office alongside paid lawyers | Many can't afford a lawyer | Build (data exists) |
| Bail calculator linked to the case: bail amount → typical agent fee (usually ~10%) | Families need the real cost | Build |
| County inmate-lookup link next to results | First thing families search for | Build (data exists for major counties) |
| Claim-your-listing flow so lawyers/agents can receive in-app messages | Messaging reaches nobody today | Build + Owner (outreach) |

## 3. Never miss a court date

| Improvement | Why it matters | Status |
|---|---|---|
| Reminders at 7 days, 3 days, 1 day and the morning of | Matches proven court-reminder programs | Build |
| Fallback chain: push → email → SMS (SMS only when Twilio is configured) | Push alone gets missed | Build + Owner (Twilio, Resend keys) |
| Add to phone calendar (.ics) | Survives app deletion | Build |
| Court date shows courthouse name, address, phone, directions | People get lost on the day | Build (courthouse data exists) |
| "What to bring / what to wear" checklist on the court date | Reduces no-shows and bad first impressions | Build |
| Family follower: a loved one gets the same reminders (with the user's consent) | Families drive people to court | Build |
| "I missed my court date — what now?" guidance + call your lawyer | Missed dates become warrants | Build |
| Multiple dates per case; past dates archived | Cases have many hearings | Build |
| Dates stay on the calendar day entered, any time zone | Already fixed; keep the test | ✅ |

## Order of work

1. "Just arrested?" mode + offline state rights card (the first impression).
2. Combined lawyer + bail results with filters, open-now, report-a-listing.
3. Court-date reminder schedule, .ics, courthouse details, missed-date guidance.
4. Family sharing and follower reminders.
5. Owner items: lawyer review of rights content, Twilio/Resend keys, listing-claim outreach.

Each step is tested on the Real-World Test Script before the next begins.
