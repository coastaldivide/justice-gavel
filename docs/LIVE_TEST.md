# Live test — staging, end to end (about 90 minutes)

Run this on **staging** with Stripe in **test mode**, real Telnyx texts to your own
phone, real e-mail to your own inbox, on a real iPhone and a real Android phone.
Every step says what must happen. Anything else is a bug: note the step number,
the time, and a screenshot, and send it to the developer.

Before you start: staging is deployed (backend/scripts/go-live-checklist.md steps 1–10),
and on the staging server `node scripts/check-env.js --launch` ends "Environment OK"
(it will warn that the Stripe key is a test key — expected on staging).

Stripe test cards (any future expiry, any CVC, any ZIP):
`4242 4242 4242 4242` succeeds · `4000 0000 0000 0002` is declined ·
`4000 0025 0000 3155` asks for 3-D Secure.

Accounts you need: a consumer account (phone A), a bail-agent account (laptop),
an attorney account with bar verification approved by an admin, an admin account.

---

## A. Health (5 min)
- [ ] A1 `GET https://<staging-api>/health` → `"db":"ok"`, the expected version, `features` shows payments, texts, e-mail, storage on.
- [ ] A2 Admin: `GET /api/admin/diagnostics/client-ip` from phone A → set `TRUST_PROXY` as RUNBOOK says.
- [ ] A3 Admin: `GET /api/admin/diagnostics/jobs` → every job `ok` or `not_expected` (check again the next day: all `ok`).

## B. Person in crisis — free path (phone A, 10 min)
- [ ] B1 Install the staging build, open it signed out → "Just arrested?" → rights card for your state shows, with its sources.
- [ ] B2 Search lawyers and bail agents near you → results with phone numbers; tapping a number starts a call.
- [ ] B3 Sign up. Add a court date 2 days from now at 9:00. Turn on text reminders (tick the consent box).
- [ ] B4 Within the next minute: nothing yet. The reminders are planned for 1 day before (18:00) and the morning of (6:30) in your time zone — check "Reminders" on the case shows them.
- [ ] B5 Admin shortcut to test now: set a court date for **today** at least 2 hours ahead → a push arrives and a **text** arrives ending "Reply STOP to opt out". The e-mail arrives too if e-mail reminders are on.
- [ ] B6 Reply **STOP** to that text → Settings in the app shows text reminders off. Reply **START**, then turn texts on again in the app (it asks for consent again).
- [ ] B7 Family Connect: enter a name and phone → contacts appear at once, labelled free; no card screen.

## C. Consumer payments (phone A + laptop browser, 15 min)
- [ ] C1 Plans screen shows only **Legal Pro $19.99/mo · $149/yr** and the **Case Pass $29** card (no Legal Radar, no 24 Hour Advisor).
- [ ] C2 Android: buy the Case Pass with `4000 0000 0000 0002` → "declined", nothing unlocked.
- [ ] C3 Buy it with `4242…` → "Case Pass active until <date 90 days out>. It does not renew." Unlimited AI chat now works.
- [ ] C4 The Case Pass card now offers "Add 90 days for $19" → buy → the end date moves exactly 90 days later.
- [ ] C5 Stripe dashboard (test): two payments, $29.00 and $19.00, metadata `package=case_pass`.
- [ ] C6 iPhone: tapping buy opens the website (Apple rule); buy there in the browser with `4000 0025 0000 3155`, complete 3-D Secure → back in the app the pass shows.
- [ ] C7 Laptop browser: subscribe to Legal Pro monthly (7-day trial, card required) → "trial started". Stripe shows a trialing subscription at $19.99.
- [ ] C8 Cancel → "ends on <date>"; access stays until then.
- [ ] C9 Refund request "changed my mind" → refused (all sales final). During the free trial a "billing error" request says nothing was charged; after a paid invoice it refunds that invoice and ends the plan (test that once, later).

## D. Attorney (laptop, 10 min)
- [ ] D1 Consumer (phone A) submits a personal-injury request.
- [ ] D2 Attorney sees it with no name/contact, fee **$250** → buy with `4242…` → contact details appear; a second attorney can no longer see it.
- [ ] D3 Esquire plan subscribe → $49.00/mo.

## E. Bail agent plan + Bond Desk (laptop + your phone, 30 min)
- [ ] E1 Bail-agent account → plans show **$99 / $199 / $349** with "Bond Desk", "check-ins … no per-client fee", "texts 5¢ each". Subscribe Starter with `4242…`.
- [ ] E2 Bondsman dashboard → **Open Bond Desk** → empty dashboard.
- [ ] E3 Forms: upload a **real surety form PDF** you use. The fillable fields are listed. Map defendant name, bond amount, signer name/address, signature → `signature.name`, date → `signature.date`. Preview with a bond → the PDF shows the values in the right boxes. *(If the form has no fillable fields, nothing is filled; signing still works with the certificate page — tell the developer which form.)*
- [ ] E4 New bond: defendant = you, your phone, bond $5,000 → status Prospect.
- [ ] E5 Charges: premium $500, fee $25. Payment $100 cash → receipt **R-000001**; download the receipt PDF; balance $425.00.
- [ ] E6 Try a $1,000 payment → refused "more than the balance".
- [ ] E7 Payment plan: $125 today + $300 next month → saved; a plan that doesn't add to $525 is refused.
- [ ] E8 Add an indemnitor (a second phone you control). Send a packet: the form, defendant + indemnitor, questions "basic", ID front + selfie with ID requested, deliver by text, tick the consent box.
- [ ] E9 Both phones get a text with a link within a minute. Bond Desk shows "Text message: sent" on the timeline.
- [ ] E10 Phone: open the link (no account) → answer the questions → upload ID front and a selfie holding it (camera opens) → "Prepare documents" → open the document (it shows your answers) → type your full name exactly → tick both boxes → **Sign**. Download the signed copy: the form with "/s/ Your Name" and today's date, then a certificate page listing the timeline, your IP and browser, and "text to •••-•••-1234".
- [ ] E11 Typing your name differently is refused; signing before opening the document is refused.
- [ ] E12 Second phone signs too → packet **completed**; download the merged signed PDF from Bond Desk.
- [ ] E13 Send a payment reminder by text → it arrives; the second phone replies STOP → a second reminder is refused "replied STOP".
- [ ] E14 Powers: add range prefix `S25-`, `000101` to `000105`, limit $10,000 → five powers `S25-000101`…; assign one to the bond; post the bond (status Active, today) → liability report shows $5,000 under that surety; surety report shows the power, bond and premium.
- [ ] E15 Collateral: add "2015 Honda Civic" → receipt **C-000001** PDF. Return it → shows returned.
- [ ] E16 Forfeit the bond with a deadline in 30 days → dashboard lists it with 30 days left; reinstate it.
- [ ] E17 Reports: each opens and downloads as CSV; totals match the screens.
- [ ] E17a Check-ins by text (docs/CHECKINS.md): Check-In Manager → Enroll → you, your phone, **Text link**, tick the consent box → a text with a `/c/…` link arrives within a minute; the row says "Text link" and "Last text: delivered".
- [ ] E17b Open the link on the phone (no app, not signed in) → it shows the agency and your first name only → leave "Share my location" unticked → **Check in now** → "Checked in"; the agent's phone gets a push. Check in again → "recorded … not counted again"; the row still shows one check-in for today.
- [ ] E17c Tick "Share my location" → the browser asks for location → allow → check in → the history shows the coordinates. Reopen the page: the box is unticked again.
- [ ] E17d **Reset link** → the old text's link says "expired"; the new text's link works.
- [ ] E17e Enroll a second person (a phone you control) by text and move its start back two days in the database (`UPDATE checkin_enrollments SET active_since = NOW() - INTERVAL '2 days'`) → within an hour the agent gets a push and an e-mail "missed a check-in"; the day shows under "Missed check-ins"; after 09:00 the second phone gets "you missed your check-in … check in now"; it arrives once. Attach that enrollment to a bond → Bond Desk dashboard lists the missed check-in.
- [ ] E17f The second phone replies STOP → "Text the link again" is refused "replied STOP"; no more reminders.
- [ ] E17g Staging only (`CHECKIN_LOCATION_ALERTS_ENABLED=true`): in the history, **Use this location as home**, radius 1 mile → check in by link from more than a mile away with location shared → the agent gets "checked in away from home" and the record is flagged. Production (setting off): the home-point controls are not shown.
- [ ] E17h Phone A signed in with the e-mail of an enrollment attached to a bond with a balance → Home shows "Your bail agent": agency, tap-to-call, next court date, balance, Check in. A different account sees no card.
- [ ] E18 **Next day**: Stripe → the agent's subscription → upcoming invoice has a line "Texts sent for you: N × 5¢" matching Bond Desk → Texts this month. Running the billing job again adds nothing.

## F. Webhooks and recovery (10 min)
- [ ] F1 Stripe → Webhooks → endpoint → recent deliveries all 200.
- [ ] F2 Buy a Case Pass, and close the app the moment the card succeeds → reopen: the pass is active anyway (the webhook finished it).
- [ ] F3 Stripe → Resend a delivered `payment_intent.succeeded` → nothing changes (no second pass).
- [ ] F4 Telnyx → Messaging → the messages show "delivered"; Bond Desk texts list shows the same.

## G. Data safety (10 min)
- [ ] G1 GitHub → Actions → "Nightly database backup + restore drill" → Run → green, "row counts and provider checksums match".
- [ ] G2 Download the artifact and decrypt it with the passphrase (command in the workflow file header) → it opens.
- [ ] G3 Delete the consumer account from phone A → it is gone; data export before deleting downloads a file.

## When everything is ticked
Repeat sections A, C (one payment), E5 and E10 on **production** with a real card
and a $1 test product or your own Case Pass, then refund it as "billing error".
