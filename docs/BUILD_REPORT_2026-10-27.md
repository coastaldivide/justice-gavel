# Build report — competitor features, October 27, 2026

This build adds the features from docs/BUILD_PLAN_COMPETITOR_FEATURES.md. The work ran in four
rounds, then an independent review and its fixes. Branch: `consumer-core-path`.

## What was built
| Plan item | Feature | Where it is documented |
|---|---|---|
| A1 | Bond Desk court-date texts to the defendant and every indemnitor (7 days, 3 days, evening before, morning of), several hearings per bond, delivery timeline | docs/BOND_DESK.md |
| A6 | Rewritten reminder texts covering the consequence, what to expect, and a plan prompt; a text the morning after a missed date | docs/COURT_REMINDERS_PLAN.md |
| A7 | "Did you make it to court?" by push or by text reply 1/2/3, with appearance metrics for admins and agents | docs/BOND_DESK.md |
| A2, A3 | Check-ins by text link with no app needed, and a missed-check-in alert to the agent | docs/CHECKINS.md |
| B1 ⚖ | Location alerts at check-in (home point and radius) | docs/CHECKINS.md |
| B6 | "Your bail agent" card in the free app, shown only through a verified phone | docs/CHECKINS.md |
| A5 ⚖, B2 | Stripe Connect for agencies, automatic payment-plan charges, a "Pay {agency}" page | docs/BOND_DESK.md, EXTERNAL_SERVICES_SETUP.md §3b |
| A12, B8 | Forms set up by staff (admin queue), CSV import of open bonds, export-everything ZIP, staff seats (3 / 10 / 20). No "$1 first month" (owner decision). | docs/BOND_DESK.md |
| A4 ⚖ | Re-arrest alerts for an agent's own defendants, using the counties we import | docs/BOND_DESK.md |
| A9 ⚖ | Custody alerts for families (release or transfer, as the roster shows it) | docs/BOND_DESK.md |
| B4 ⚖ | Sharing a forfeited bond with a recovery agent, owner only, read-only, every view logged | docs/BOND_DESK.md |
| B5 | Tennessee quarterly report (T.C.A. § 40-11-314, Dept. of Revenue Notice #25-08), as CSV and PDF | docs/BOND_DESK.md |
| A11 ⚖ | Public defender offices: client upload, reminders under the office's name, two-way texting inbox, appearance dashboard, annual invoice | docs/PUBLIC_DEFENDER.md, docs/PUBLIC_DEFENDER_PILOT.md |
| A8 | "Plan your court day" checklist, 211 and transit links (10 TN counties, sourced), "Offer a ride" | docs/COURT_DAY_HELP.md |
| A10 | Toll-free court-date phone line (English and Spanish); four new languages: Haitian Creole, Simplified Chinese, Arabic (right to left), Tagalog | docs/PHONE_LINE.md, docs/TRANSLATIONS.md |
| B10 | Ameelio link on the family screens | — |
| B11 | Results page: shows only a snapshot an admin publishes, and only with 100 or more answered court dates | — |
| Security | Phone verification by texted code; links to bail-agent and check-in records only through a verified phone | docs/CHECKINS.md |
| PDFs | Chinese and Arabic print as real letters in Bond Desk PDFs (bundled subset fonts, Arabic shaping and right-to-left) | docs/BOND_DESK.md "Letters in the PDFs" |

**Not built**
- **Background checks (B3).** They need a contract with a licensed background-check provider, and federal credit-report law applies.
- **A support desk (B9).** It is staffing, not code.

## ⚖ Features off in production until counsel answers
Each is fully built and tested, and is switched on with one setting. `scripts/check-env.js --launch` warns if any of them is on in production.

| Setting | Counsel question |
|---|---|
| `BOND_AUTOPAY_ENABLED` | 3.2 (debt collection) |
| `CHECKIN_LOCATION_ALERTS_ENABLED` | 2.4 |
| `BOND_REARREST_ALERTS_ENABLED` | 1.2 |
| `CUSTODY_ALERTS_ENABLED` | 6.3 |
| `BOND_RECOVERY_SHARING_ENABLED` | state recovery-agent rules |
| `PUBLIC_DEFENDER_CHANNEL_ENABLED` | 3.2 and 6.1 |

The phone line is off until `TELNYX_VOICE_ENABLED` and its number are set.

## One-time setup for the owner
1. **Stripe Connect.** Turn on Express accounts and add the second webhook endpoint for connected-account events (`STRIPE_CONNECT_WEBHOOK_SECRET`). See EXTERNAL_SERVICES_SETUP.md §3b and backend/scripts/go-live-checklist.md.
2. **Telnyx.** Set up the voice number and TeXML webhook for the phone line (EXTERNAL_SERVICES_SETUP.md). Update the 10DLC sample messages to match the new reminder wording (docs/COURT_REMINDERS_PLAN.md).
3. **Translations.** Have a native-speaker legal translator review every non-English language (docs/TRANSLATIONS.md).
4. **Live test.** Run docs/LIVE_TEST.md on staging. New sections cover court dates, check-in links, card payments, staff, re-arrest and recovery, public defenders and the phone line.

## Owner decisions made during the build (defaults; change any)
All are listed in docs/OWNER_DECISIONS.md. The main ones:
- **Accents and text length.** Texts in Spanish, Portuguese and Vietnamese keep their accents (your choice). Accented and non-Latin texts may run up to 6 segments; English stays within 2.
- **Card payments.** Charges go directly to the agency's Stripe account, so the agency pays Stripe's fees. Justice Gavel's fee is 99¢ per successful automatic charge and nothing on pay-page payments. Express accounts make the platform liable for an agency's negative balance.
- **Public defender pricing.** $20,000 setup plus $2 per active client per year; 5 staff seats per office; texts included.
- **Re-arrest alerts** are included on every bail-agent plan.
- **Tennessee report "liability".** Both bonds written in the quarter and bonds open at quarter end are shown, labelled. Confirm with the Department which one Form PRV413 wants.
- **Chinese PDF font** covers the full CJK Unified Ideographs block (6.9 MB on disk; each PDF adds only a few KB).

## Independent review
A reviewer who had not seen the build checked all new code and verified 15 defects. All 15 were fixed with regression tests (list: docs/REVIEW_FIXES_2026-10-27.md). The worst one: tapping "Confirm payment" twice could charge a payer twice while recording only one payment.

The reviewer found these areas clean:
- webhook signatures;
- per-agency and per-office access checks;
- token hashing and expiry;
- CSV and ZIP export safety;
- SQL parameters;
- receipt numbering;
- autopay never charging twice or more than the balance;
- ⚖ settings being off in production;
- account deletion.

## Also fixed along the way
- **Voluntary-departure deadline.** It was counted in clock hours, so it could be off by one depending on the time of day and across daylight-saving time, and the deadline day showed as "missed". It now counts calendar days.
- **Roster ingest** duplicated rows on every run; it now updates a booking already seen.
- **Account deletion** failed for an agent with an executed power.
- **Inter in PDF form fields** had a spacing bug.

## Final verification
See the end of this file (filled in after the last full run).
