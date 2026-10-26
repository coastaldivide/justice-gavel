# Justice Gavel — Legal Action Items

> **Oct 26, 2026:** the current, complete list of questions for counsel — with today's prices
> (PI lead $250, bail-agent plans $99/$199/$349), Bond Desk e-signatures and texting — is
> **docs/COUNSEL_REVIEW_PACKET.md**. Fee amounts below are from August and are out of date.
## What Aaron Must Do (cannot be automated)

Generated from: JusticeGavel_v8756_Counsel_Reviews.md
Priority order matches counsel's blocker list.

---

## THIS WEEK — Personal exposure attached

### A0 — Lawyer review still required (not done by engineering)
The code and docs now match the owner's decisions, but none of this has been
reviewed by counsel. Before launch a licensed attorney should review:
- **Lead-fee structure** — flat per-lead fees to bail agents ($100) and to
  attorneys (PI/medical $200, civil rights $200, employment $100, ICE $75):
  runner-capper statutes, ABA Model Rules 5.4 / 7.2 (paying for referrals,
  fee-splitting) and each target state's equivalents.
- **UPL disclaimers** — the AI disclaimer text and its gate (AI endpoints
  return 451 until the current disclaimer version is accepted), the in-app
  "not legal advice" copy, and the App Store listing.
- **State rule accuracy** — bail schedules, expungement rules
  (`backend/src/routes/expungement/rules.js`), DUI/drug tables, crisis
  hotlines (process: FACT_CHECK_RUNBOOK.md).
- **Privacy policy subprocessor list** — the in-app policy
  (`frontend/src/screens/PrivacyPolicyScreen.tsx`) named SendGrid; it now
  names Resend (the actual email provider). Counsel should confirm the full
  list (hosting on Render, database on Supabase, Daily.co
  video, Mixpanel analytics, Google Places are not listed). The attorney
  privacy screen's infrastructure line (i18n key
  `x_attorney_privacy_data_at_rest_aes`) still names the previous host and
  must say Render (confirm Render's current SOC 2 report before claiming it) and align
  `docs/PRIVACY_POLICY.md` with the in-app text.
- **Marketing copy that implies paid placement** — the bondsman
  SubscriptionScreen lists "Top placement in all searches" and the
  Verified Badge is pitched as "top of search results", but bail search is
  ordered by distance/rating only. Either build it (and review it against
  advertising rules) or remove the copy. The archived outreach script
  (`docs/archive/BONDSMAN_OUTREACH.md`) also quotes arrest volumes the app
  does not have.

### A1 — TN criminal lawyer call (Monday)
Bondsman lead program. Lead fees are now flat and defined in one place
(`backend/src/routes/billing/leadFee.js` + `attorneyLeadFee.js`): bondsman
**$100**, personal injury/medical **$200**, civil rights **$200**, employment
**$100**, ICE detention **$75** — never scaled to bail or case value.
These amounts were **chosen by the owner** (Oct 2026); the ICE $75 fee is
unchanged by owner decision. Flat fees reduce the runner-capper / fee-splitting
risk but do not settle it: **a lawyer still needs to review the lead-fee
structure** (see A0 below). Get a Tennessee criminal defense attorney
to review:
- The arrest-alert → bondsman-notification pipeline
- Tex. Penal Code §38.12 (third-degree felony in aggravated forms)
- Fla. Stat. §877.02 equivalent
- Whether the 30-day waiting period in any scrape states applies
Cost: 1-hour consultation. Risk without it: personal criminal exposure.

### A2 — Import DOI producer files for bondsmen
1,262 seeded bail agents, 0 with a license number. The TN, TX, and FL
Department of Insurance producer files are **free and public**.
- TN: tn.gov/commerce/insurance
- TX: tdi.texas.gov/agent/agent-license-lookup.html
- FL: apps8.fldfs.com/LicenseCheck
Match on name + address → populate `license_number` in bail_agents table.
One day of work. Removes the "real licensed bondsmen" liability.

---

## THIS MONTH — Financing blockers

### A3 — CIIAA for all contributors
Confidential Information and Invention Assignment Agreement:
- Aaron Hart ← primary founder
- Russell Allen ← 35 human commits
- Any other human who contributed before entity formation
Also: get counsel to take a position on AI-generated portions
(107 commits from `Justice Gavel Build`). US copyright does not protect
purely machine-generated work. Usually a manageable disclosure.

### A4 — Entity resolution
An earlier README revision said "Register Tennessee LLC" (the claim was
removed in the Oct 2026 README rewrite; the entity question itself is still open).
`TERMS_OF_SERVICE.md:60` picks Tennessee law.
An earlier build referenced a Wyoming LLC EIN as already registered.

Steps:
1. Confirm what actually exists at the Secretary of State
2. If TN LLC: convert to Delaware C-corp before raising
   (institutional investors do not buy LLC interests)
3. If WY LLC: dissolve or merge
Cost: $500-2,000 in legal/filing fees. Wire-transfer blocker if skipped.

### A5 — Subscription compliance audit
Five Stripe tiers + annual options. Have counsel check:
- California Automatic Renewal Law (ARL): pre-checkout price disclosure,
  affirmative consent, post-purchase confirmation, easy cancellation
- FTC Negative Option Rule (updated 2024): same requirements federally
- Displayed vs charged price: `frontend/src/screens/SubscriptionScreen.tsx`
  shows $198.99 / $348.99 / $48.99 tiers under plan keys the backend prices
  differently (`backend/src/routes/billing/_shared.js`), and the bondsman
  dashboard shows the $49 Verified Badge as $48.99. Align the copy with what
  Stripe will charge before enabling payments.
Cost: 2-hour attorney review. Enforcement is active. Fixes are cheap now.

### A6 — Claims inventory / substantiation file
Build a one-page doc: every marketing claim, evidence behind it, who signed off.
Claims that currently need backing:
- "Bar-verified" (only for attorneys through verification.js — document the flow)
- "0 security vulnerabilities" (claim removed from the README in the Oct 2026 doc
  pass; if it returns to marketing copy, back it with `npm audit --omit=dev` at build time)
- "Legally reviewed content" (the claim was removed from QUICKSTART.md in the Oct
  2026 doc pass; restore it only with a named reviewer)
- "361/361 tests passing" (came from the archived docs/archive/SIMULATION_REPORT.md —
  generated assertions, not a real suite; current real numbers come from CI)
Post-DoNotPay FTC order ($193K), the App Store listing is a regulated document.

### A7 — Disposition update process for arrest data
Charges drop. Cases dismiss. Records get expunged.
Current system: arrest snapshots never update.
Build before public launch (not before TestFlight):
- Webhook or polling to county court systems (or manual flag by defendant)
- Expungement/sealing sync (case outcome → suppress from arrest alerts)
- 90-day retention limit enforcement in the database

---

## Notes from counsel
- "Fix the thing, then update the doc." (commit 52deb7d was the reverse)
- "Revert 52deb7d. Then build verification for real — the flow already exists."
  (`attorney/verification.js` grants bar_verified=1 through an actual process)
- "The engineering instincts in this build are consistently better than the
  documentation instincts." — Insurance reviewer
- "None of that takes long. All of it is easier now than after launch."

---
*Action items from JusticeGavel_v8756_Counsel_Reviews.md — Aug 3, 2026*
