# Build plan: competitor features for Justice Gavel (October 27, 2026)

Step-by-step plan for every feature in docs/COMPETITOR_STRENGTHS.md: the "biggest gaps" (part A) and
the other competitor strengths (part B). Each step names the file or table it touches in this repo.

**Rules for every feature:**
- **Money:** integer cents only.
- **Texts:**
  - go through `services/sms.js` (Telnyx);
  - check `sms_opt_outs` before sending; STOP wins;
  - Bond Desk texts are billed 5¢ through `services/bondDesk/textBilling.js`.
- **Wording:** all text is in the app's languages, in `i18n/messages/{en,es,pt,vi,ht,zh,ar,tl}.js` (eight since Oct 27 2026; docs/TRANSLATIONS.md).
- **No refunds and no guarantees.** No claim is made without a source.
- **Tests and checks:** each feature ships with:
  - unit tests;
  - a test against real Postgres in `backend/src/__tests__/integration/`;
  - a regenerated `openapi.json`;
  - a step in docs/LIVE_TEST.md.
- **Counsel:** marked ⚖ means the counsel question must be answered before the feature is switched on in production. The feature can sit behind a setting until then.

Effort: S = 1–2 days, M = 3–5 days, L = 1–2 weeks (one developer).

---

## Part A — Biggest gaps, in build order

### A1. Bond Desk court-date reminders to the defendant and every indemnitor (M)
*Proven by Captira, eBail, BailBooks, Simply Bail.*

**Database**
1. New migration `supabase/migrations/00000000000035_bond_desk_court_dates.sql`:
   - **`bd_court_dates` table:** bond_id, court date, local time, court name, room, status.
     - Status values: `scheduled | attended | missed | rescheduled | cancelled`.
     - Bonds have more than one hearing; today `bd_bonds.court_date` holds only one.
     - Copy each existing `bd_bonds.court_date` in as the first row.
   - **`bd_reminders` table:** court_date_id, signer type (defendant / indemnitor / contact), phone, send-at time in UTC, status, and `bd_texts` id once sent.
     - Unique on (court_date_id, phone, offset), so a reminder can never be sent twice.

**Scheduling**

2. Write `services/bondDesk/courtReminders.js`.
   - Reuse `COURT_REMINDER_PLAN` and the time-zone logic from `services/courtReminders.js`: 7 days before at 09:00, 3 days at 09:00, the evening before at 18:00, the morning of at 06:30, in the bond's county time zone.
   - Re-plan the reminders whenever a court date or an indemnitor's phone number changes.
   - Cancel the reminders when the bond is exonerated, forfeited or closed.
3. Add a job `bd-court-reminders` (every 5 minutes) in `services/scheduler.js`.
   - It sends what is due, skips numbers that replied STOP, and records each text in `bd_texts` so the existing 5¢ billing picks it up.
   - Register it in `monitoring/jobHealth.js` so a stalled job raises an alert.

**Agent controls**

4. **Routes** in `routes/bondDesk/bonds.js`:
   - `POST/PATCH/DELETE /api/bond-desk/bonds/:id/court-dates`;
   - `GET .../reminders` returns the planned and sent texts;
   - a per-bond on/off switch.
   - The agent ticks the existing "the person gave me this number for texts" confirmation for each number.
5. **Screens** in the Bond Desk frontend:
   - a court-dates list on the bond, with add/edit;
   - a reminder timeline showing each text and its delivery status from `sms_delivery`.
6. **Wording.** Short texts naming the defendant, the court and the time, ending "Reply STOP to opt out". The indemnitor text explains why they are receiving it.

**Tests**

7. Cover:
   - each offset in each time zone;
   - a late-added date still gets one text;
   - STOP blocks the text;
   - running the job twice sends nothing new;
   - the billing count matches;
   - deleting a court date cancels its texts.

8. **Live test:** a bond with a court date 8 days out; check that all four texts arrive on both phones.

### A2. Check-ins by text link, no app needed (M)
*Proven by Captira.*

**Database**
1. Add `checkin_enrollments.channel` (`app | sms`) and a per-enrollment link token (hashed).

**Sending the link**

2. Change `services/checkinReminders.js`. When the channel is `sms`, plan a text with a personal link instead of a push notification, at the agent's chosen frequency and in the defendant's time zone.

**The check-in page**

3. Add a public page at `/c/:token` that needs no account, served like the signing links.
   - The defendant confirms their name and optionally shares location; location is asked separately each time.
   - It posts to `POST /api/checkins/link/:token`, which writes `checkin_records`.
   - Rate-limit it and make tokens expire.
4. The agent chooses "text" or "app" when enrolling (`POST /api/checkins/enroll`).

**Tests and billing**

5. **Tests:** expired or invalid token; one check-in counts once per day; location is stored only when shared; STOP stops the texts.
6. **Billing:** texts are billed 5¢. Check-ins themselves stay free ("no per-client fee").

### A3. Instant missed-check-in alert to the agent (S)
*Proven by Captira.*
1. Add a job `checkin-missed` (hourly). For each active enrollment whose local day has ended without a check-in, write one `checkin_missed` event, which is unique per enrollment and day.
2. Notify the agent by push and e-mail, and by text if the agent turned that on, which is billed 5¢. Show the missed check-in on the Bond Desk dashboard.
3. Optional: a gentle text to the defendant ("You missed today's check-in — check in now").
4. **Tests:** time zones and daylight saving; one alert per day; nothing is sent for paused enrollments.

### A4. Re-arrest alert for an agent's own defendants (M) ⚖ counsel question 1.2
*Proven by Captira Defendant Watch, eBail, BailBooks, Simply Bail.*

**Matching**
1. Write `services/bondDesk/rearrest.js`.
   - After each roster import (`services/arrest_ingest.js`), compare new bookings with active bonds and defendants.
   - **Match rules:**
     - a strong match needs the normalized last name, first name and date of birth;
     - name only is a "possible match" and needs the agent to confirm.
   - Record each match in a new `bd_rearrests` table that stores the arrest id and bond id. It is unique on the pair, so an agent is never alerted twice.

**Alert and agent view**

2. Alert the agent who wrote the bond (push and e-mail; text optional), and add the event to the bond timeline.
3. On the bond, show the coverage honestly: "Covered: these counties' rosters (from `arrest_monitors` / feed list)". Never claim nationwide.

**Pricing, takedowns and tests**

4. **Pricing.** Include it on the $199 and $349 plans, or $0.99 per monitored defendant on Starter, as a Stripe invoice line like the text billing. Decide the price before building.
5. **Takedowns and sealed records:** never match a record that has been taken down or sealed (`arrest_visibility`).
6. **Tests:** exact and possible matches; no match on sample/seed rows; no match on taken-down records; never alerted twice.

### A5. Automatic payment-plan collection (M) ⚖ counsel question 3.2 (debt collection)
*Proven by Captira Auto Pay and Simply Bail.*

**Saving the card**
1. On the signing or payment page, the payer can save a card. Use a Stripe SetupIntent on the agency's connected account, or on the platform account with a transfer; pick one with counsel and Stripe.
   - Show consent text: the amounts, the dates, how to stop it, and "all payments final".
2. Store the Stripe customer id and payment method on a new `bd_autopay` table, with a consent snapshot (text, IP address, time).

**Charging and recording**

3. Add a job `bd-autopay` (daily). For each installment in `bd_installments` that is due today and covered by autopay:
   - create an off-session PaymentIntent with the idempotency key `bd-inst-<id>-<attempt>`;
   - when it succeeds, record it in `bd_payments` using the same function that hand-entered payments use, so receipt numbers and oldest-first coverage stay correct;
   - when it fails, text and e-mail the payer and the agent, and retry once after 3 days.
4. In `services/stripeWebhook.js`, handle `payment_intent.succeeded` and `payment_intent.payment_failed` for these payments, without double-posting.

**Fee and tests**

5. **Fee:** 99¢ per successful charge, the same as Captira, billed to the agency like texts.
6. **Tests:** a payment never exceeds the balance; webhook replays change nothing; a card that needs 3-D Secure goes to an "action needed" text with a link.

### A6. Better reminder wording, plus a text after a missed date (S)
*Proven by the NYC study: 26% fewer missed dates.*
1. Rewrite `reminder.body.*` (consumer) and the A1 Bond Desk texts in all four languages, stating:
   - what happens if you miss court (a warrant can be issued, the bond can be forfeited);
   - what to expect (security, waiting, bring ID and papers);
   - a plan prompt ("How will you get there? Reply or open the app to plan your court day").

   Keep each text to 1–2 SMS segments. A test checks the length in every language.
2. Add a morning-after message, sent when a court date passes without being marked attended.
   - Wording: "If you missed court, act today: call the clerk / your lawyer / your bail agent", with a link to the existing missed-court guide (`services/courtDayGuidance.js`).
   - Apply it to consumer cases and to Bond Desk bonds. The bail agent gets their own alert.
3. Optional: an A/B test of two wordings, recording the attendance answers from A8.

### A7. "Did you make it to court?" — appearance tracking (S)
*Uptrust and Captira publish results; we have none.*
1. On the afternoon of the court date, ask by push or text: "Did you make it to court today? Reply 1 = yes, 2 = rescheduled, 3 = missed". In the app, it's one tap.
2. **Handling replies.** Inbound Telnyx replies are handled in the webhook where STOP/START already are.
   - Parse 1/2/3 and set `court_dates.status`, or `bd_court_dates.status`, to `attended / rescheduled / missed`.
   - "missed" triggers A6 step 2.
3. **Report.** Add `GET /api/admin/metrics/appearance`: appearance rate per county and month, for consumer users and Bond Desk separately, with counts. Show it to agents for their own bonds.
4. This becomes the public-defender pilot metric and the investor proof point.

### A8. Help getting to court (S–M)
*Proven by Uptrust.*
1. Add a "Plan your court day" checklist on each court date: ride, time off work, child care, documents, address and room. The answers are saved on the court date.
2. **Links:**
   - **Every county:** 211 and the county's transit trip planner.
   - **Public defender office phone, where known:** source it from the directory, and show only rows with a cited source.
3. A family follower who receives reminders sees "Offer a ride" and the owner is notified.
4. A6 plan-prompt texts link here.

### A9. Release / transfer alerts for families (M) ⚖ counsel question 6.3
*Proven by VINE: 20M users a year.*
1. **Following a booking:** a family member can follow a booking from the arrest record, or link it to a case. Store it in `booking_follows` with the follower's consent to texts.
2. **Detecting changes:**
   - During roster ingest, detect when a booking disappears or its status or facility changes.
   - Record a custody event only when the source shows it. Never guess "released" from a missing row alone; mark that "no longer listed — call the jail".
3. **Alert wording:** "No longer listed on the {county} roster as of {time}. Call {jail phone} to confirm." It names the source and the time, and makes no promise.
4. **Tests:** status changes, missing rows, records taken down, never alerting twice.

### A10. More languages and a phone line (M each)
*Proven by VINE: phone, TTY, 195 languages.*
1. **Languages:**
   - Add Haitian Creole, Chinese (Simplified), Arabic (right to left) and Tagalog to `i18n/messages` and the frontend. **Done Oct 27 2026** (docs/TRANSLATIONS.md; review by native-speaker legal translators still needed).
   - Use professional translation of legal wording; machine translation for the rest, with review.
   - The key-parity tests already fail on a missing key.
2. **Phone line:** a Telnyx toll-free voice number with a voice menu.
   - Enter the case code or the phone number on file, hear the next court date and location, press 1 for a reminder text, press 2 for the missed-court guidance.
   - The menu is in English and Spanish first.
   - Bill it as a platform cost and watch it in `monitoring/`.

### A11. Public-defender channel and two-way messages (L) ⚖ counsel questions 3.2 and 6.1
*Proven by Uptrust. Benchmark: about $20K setup plus $2 per person per year.*

**Office accounts and roster**
1. Add an organisation account type `public_defender` with staff seats; reuse the firm and organisation tables.
2. **CSV client upload.** Columns: name, phone, language, case number, court dates.
   - Validate and de-duplicate it.
   - The office states the consent basis for texting.

**Reminders and messages**

3. **Reminders:** clients get the A1/A6 reminders under the office's name and the A7 attendance question.
4. **Two-way messages:**
   - Inbound replies go to a shared office inbox; reuse the in-app messages tables.
   - A social worker can reply.
   - Every message is logged, so office staff can see that history.
5. **Office dashboard:** appearance rate (A7), messages, opt-outs, and an export of all of it.
6. **Billing:** an annual invoice (setup fee plus per-client fee) through Stripe invoicing.
7. **Pilot:** one Tennessee office. Measure the appearance rate against the office's own baseline for 90 days.

### A12. Easier agent sign-up (S each)
*Proven by Captira and eBail.*
1. **$1 first month** on the bail-agent plans: a Stripe coupon in `services/stripeBilling.js`. The checkout states the full price and the date it begins.
2. **Forms setup done for the agency:** an admin queue where staff upload an agency's surety PDF and map its fields with the existing mapping tool, then hand it over. The agency sees "forms ready".
3. **CSV import of open bonds:**
   - Upload a CSV with defendant, phone, bond amount, surety, power number, court date, balance and indemnitors.
   - Show a preview with errors per row; the import is all-or-nothing, in one transaction.
   - Opening balances post as a charge with a note "imported balance".
   - **Tests:** bad rows are refused; money is in cents; power numbers stay unique.
4. **Export everything:** one ZIP per agency with the CSV reports, signed PDFs and receipts. Data ownership is stated in the Terms.

---

## Part B — Other competitor strengths to match

| # | Strength (who) | Status in JG | Steps |
|---|---|---|---|
| B1 | Location alerts (GeoFence) by text and e-mail (Captira, BailBooks) | Missing | ⚖ counsel question 2.4 (location privacy). (1) Agent sets a home point and radius per enrollment. (2) On each check-in that shares location, compare the distance, and alert the agent when it is outside the radius. (3) Location only at check-in, never tracked in the background, and the defendant is told. (S after A2.) |
| B2 | Pay before the case file exists, "Bail Pay" (Captira) | Partly: payment links exist in `services/outbound_bot.js` | (1) A public "Pay {agency}" link per agency that takes an amount and the payer's details and creates a pending payment. (2) The agent attaches it to a bond later, and it is posted through `bd_payments` with a receipt. (S) |
| B3 | Background and ID checks (eBail) | Missing (we collect ID photos only) | ⚖ (FCRA). Partner with a consumer reporting agency through its API (decide which one), charge per use, collect FCRA-required consent and notices, and never store the full report longer than needed. (M; legal first.) |
| B4 | Recovery agents can see forfeited bonds (Captira, Simply Bail) | Partly: a recovery-agent directory exists, but no sharing | (1) The agent shares one forfeited bond with a recovery agent by e-mail invite. (2) Read-only view of the defendant's details, last check-ins, re-arrest alerts and the forfeiture deadline. (3) It ends when the bond is reinstated or the agent stops sharing. ⚖ (state recovery-agent rules, already listed per state in `routes/recovery_agents.js`). (M) |
| B5 | Surety, sheriff and Department of Insurance reports (Captira, Simply Bail) | Surety and liability reports exist | Add a Department of Insurance report per state in the format each state requires. Start with Tennessee, from the state's published rules, with the source cited. (S per state.) |
| B6 | Free defendant mobile app (eBail, BailBooks) | Done: our consumer app is free | Make "Your bail agent" a card in the consumer app when an enrollment or bond is linked: next court date, balance, pay, check in. (S) |
| B7 | Daily backups, export any time (Simply Bail, Captira) | Done: nightly encrypted backup with a restore drill | Add A12 step 4 (export everything) and state data ownership in the Terms. |
| B8 | Unlimited users / offices (Captira, BailBooks, Simply Bail) | Check the plan seat limits | Decide seats per plan (eBail: 3 / 10 / 20, then $9 each). Show them on the plans screen and enforce them in Bond Desk staff invites. (S) |
| B9 | Same-day first case, live support (Captira); 24/7 staffed line (VINE) | No support desk | Add an in-app support chat (help-desk tool), a published support-hours page, and a first-week check-in call for each new agency. Operational, not code. |
| B10 | Free family communication (Ameelio) | Family Connect is free | Partner instead of building: link to Ameelio from the family screens for letters and video calls where it serves the facility. (S) |
| B11 | Published results (Uptrust, Captira) | None | Published from A7 data after 90 days: appearance rate, reminders sent, opt-out rate. Methods stated, no claim beyond the data. |

---

## Build order and rough timeline (one developer)
| Weeks | Ship | Why first |
|---|---|---|
| 1–2 | A1 Bond Desk court reminders, A6 wording and missed-date text, A7 attendance question | What Tennessee agents need most, and it produces our first outcome data |
| 3 | A2 text-link check-ins, A3 missed-check-in alert, A12 $1 first month and forms setup | Parity with Captira for the sales pitch |
| 4–5 | A5 autopay, A12 CSV import and export, B2 pay link, B6 "Your bail agent" card | Money in, and agencies can move their data over |
| 6–7 | A4 re-arrest alert, B1 location alerts, B4 recovery-agent sharing (after counsel) | Forfeiture prevention, the Captira headline |
| 8–10 | A11 public-defender pilot, A8 court-day plan | County channel and the pilot |
| Later | A9 custody alerts, A10 languages and phone line, B3 background checks, B5 more states | Reach and depth |

Before each switch-on: the docs/LIVE_TEST.md step passes on staging; the counsel item, if any, is answered.
