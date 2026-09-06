# Justice Gavel — Legal Action Items
## What Aaron Must Do (cannot be automated)

Generated from: JusticeGavel_v8756_Counsel_Reviews.md
Priority order matches counsel's blocker list.

---

## THIS WEEK — Personal exposure attached

### A1 — TN criminal lawyer call (Monday)
Bondsman lead program. Even with the flat subscription restructuring,
get a Tennessee criminal defense attorney to review:
- The arrest-alert → bondsman-notification pipeline
- Tex. Penal Code §38.12 (third-degree felony in aggravated forms)
- Fla. Stat. §877.02 equivalent
- Whether the 30-day waiting period in any scrape states applies
Cost: 1-hour consultation. Risk without it: personal criminal exposure.

### A2 — Import DOI producer files for bondsmen
1,262 bail agents with 0 license numbers. The TN, TX, and FL
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
`README.md:142` says Tennessee LLC.
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
Cost: 2-hour attorney review. Enforcement is active. Fixes are cheap now.

### A6 — Claims inventory / substantiation file
Build a one-page doc: every marketing claim, evidence behind it, who signed off.
Claims that currently need backing:
- "Bar-verified" (only for attorneys through verification.js — document the flow)
- "0 security vulnerabilities" (run npm audit prod at build time — documented)
- "Legally reviewed content" (QUICKSTART.md says KYR articles are legally reviewed — by whom?)
- "361/361 tests passing" (SIMULATION_REPORT.md — clarify these are generated assertions)
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
