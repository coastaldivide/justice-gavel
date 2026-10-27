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
- [ ] E17a **Court dates** tab on the bond (status Active): add a hearing **8 days out** at 10:30 with a court name and room. Tick the
  confirmation for the defendant (your phone) and the indemnitor (second phone). The texts list shows, for both numbers, 7 days
  before 9:00 AM, 3 days 9:00 AM, evening before 6:00 PM, morning of 6:30 AM (court's time zone), and for the defendant only
  "Did you make it?" 3:00 PM on the day and "If you missed court" 9:00 AM the next day.
- [ ] E17b Over the next 8 days both phones get all four reminders (the indemnitor's says "You co-signed …"); each shows
  "Sent · Delivered" in the list, and Texts this month counts them at 5¢ each.
- [ ] E17c Add a hearing for **tomorrow** in the evening → a text arrives within a minute on both phones. Delete it → its other texts show Cancelled.
- [ ] E17d On a court day at 3:00 PM the defendant phone gets "Did you make it to court today? Reply 1 …". Reply **3** → within a
  minute: an "act today" text with the missed-court link (it opens the guidance page, no account needed), the hearing shows
  Missed · answered by text, and you get a push / e-mail. Reply **1** → "marked as attended". Reply "hello" → nothing happens.
- [ ] E17e A hearing left Scheduled: the next morning at 9:00 the defendant gets the "act today" text and you get an alert.
  A hearing marked Attended before then gets neither.
- [ ] E17f Turn texts off for the bond → planned texts show Cancelled; on again → planned again. Change the indemnitor's phone →
  that person needs the box ticked again.
- [ ] E17g Reports → Court appearance → this month shows the county with asked / attended / rescheduled / missed / no answer; CSV downloads.
- [ ] E17h App user (phone A, texts on in Court dates): add a court date for today → mark it via the push "Did you make it?" or the
  card on the hearing (I went / It was rescheduled / I missed it). "I missed it" shows the guidance and a text "If you missed court
  …" arrives. Admin: `GET /api/admin/metrics/appearance` (admin account + X-Admin-Key) shows both app users and Bond Desk counts.
- [ ] E17a Check-ins by text (docs/CHECKINS.md): Check-In Manager → Enroll → you, your phone, **Text link**, tick the consent box → a text with a `/c/…` link arrives within a minute; the row says "Text link" and "Last text: delivered".
- [ ] E17b Open the link on the phone (no app, not signed in) → it shows the agency and your first name only → leave "Share my location" unticked → **Check in now** → "Checked in"; the agent's phone gets a push. Check in again → "recorded … not counted again"; the row still shows one check-in for today.
- [ ] E17c Tick "Share my location" → the browser asks for location → allow → check in → the history shows the coordinates. Reopen the page: the box is unticked again.
- [ ] E17d **Reset link** → the old text's link says "expired"; the new text's link works.
- [ ] E17e Enroll a second person (a phone you control) by text and move its start back two days in the database (`UPDATE checkin_enrollments SET active_since = NOW() - INTERVAL '2 days'`) → within an hour the agent gets a push and an e-mail "missed a check-in"; the day shows under "Missed check-ins"; after 09:00 the second phone gets "you missed your check-in … check in now"; it arrives once. Attach that enrollment to a bond → Bond Desk dashboard lists the missed check-in.
- [ ] E17f The second phone replies STOP → "Text the link again" is refused "replied STOP"; no more reminders.
- [ ] E17g Staging only (`CHECKIN_LOCATION_ALERTS_ENABLED=true`): in the history, **Use this location as home**, radius 1 mile → check in by link from more than a mile away with location shared → the agent gets "checked in away from home" and the record is flagged. Production (setting off): the home-point controls are not shown.
- [ ] E17h Phone A signed in with the e-mail of an enrollment attached to a bond with a balance → Home shows "Your bail agent": agency, tap-to-call, next court date, balance, Check in. A different account sees no card.
- [ ] E17i Staging only (`BOND_REARREST_ALERTS_ENABLED=true`, a test feed in `ARREST_FEED_URLS` you control): a bond (Active) for "Test Quill", date of birth 1990-04-05, county = the feed's county. Add "QUILL, TEST" with dob 1990-04-05 to the feed → run `POST /api/arrests/ingest` (admin) → within a minute the agent gets a push and an e-mail "Re-arrest: Test Quill"; the bond's **Alerts** tab shows the match and "Watching the jail rosters we import for: <county>"; the dashboard lists it. Run the ingest again → no second alert. Turn on "Text me too" → a new booking for another bond with a date of birth → a text (5¢ in Texts this month). A name-only booking → "Possible re-arrest" → **Dismiss** removes it from the dashboard. Production (setting off): no Alerts tab.
- [ ] E17j Staging only (`CUSTODY_ALERTS_ENABLED=true`): signed in as phone A, Family Connect → find a booking from the test feed → **Follow this booking** with alerts + texts to phone A → More → Custody alerts lists it. Change its status in the feed and ingest → push, e-mail and text "As of … shows … status as "…" (before: "…")" once; ingest again → nothing. Remove the row from the feed and ingest → "no longer listed on the … roster as of … Call … to confirm." (never "released"). Reply STOP from phone A → the next change is pushed but not texted. Unfollow → no more alerts.
- [ ] E17k Staging only (`BOND_RECOVERY_SHARING_ENABLED=true`): mark a bond Forfeited → **Recovery** tab shows the state's rule and "checked against secondary summaries" → tick it, share with an e-mail you control → the e-mail arrives; open the link on phone B, create an account with that address → the read-only file shows name, deadline, addresses/phones from the questionnaire, check-ins and the agency's phone. On the agent side the share shows "Active" and the view with its time. Signing in with another address → "Sign in with the e-mail address the invitation was sent to". Reinstate the bond (Active) → phone B gets "no longer available". A bond in Illinois → sharing is refused.
- [ ] E17l Reports → **Tennessee quarterly** → last quarter shows bonds issued and liability per county with "Required by … § 40-11-314 … checked 2026-10-27"; **Export CSV** and **Download PDF** open with the same citation; a TN bond without a county is listed under "needs county".
- [ ] E17i **Card payments** (Stripe test mode; Connect set up — EXTERNAL_SERVICES_SETUP.md 3b): Bond Desk → Settings →
  Card payments shows the fee terms; "Set up card payments" stays disabled until the box is ticked → tick → Stripe onboarding
  opens → fill it with Stripe's test data → back in the app the card says **On**; Bond Desk no longer shows "Set up card payments".
  Stripe → Connect → Accounts lists the agency as an Express account.
- [ ] E17j **Pay page**: copy the pay link → open it signed out on the phone → $0.50 is refused, no phone/e-mail is refused →
  $250.00 with your phone, "Text me the receipt", agree → Stripe Checkout (`4242…`) → back on the page "Thank you". Within a
  minute the agent gets a push; Bond Desk → **Unassigned payments** shows $250.00 → Attach to a bond with a balance ≥ $250 →
  receipt **R-…** on the bond, a text with the receipt number on the phone. Stripe: the payment is in the agency's Express
  account, not the platform balance. Resend the `payment_intent.succeeded` event → nothing changes.
- [ ] E17k **Automatic payments** (staging, `BOND_AUTOPAY_ENABLED=true`): a bond with a plan whose first installment is **today** →
  Money → Automatic payments → send the link to your phone by text (tick consent) → open it: the dates, amounts, how to stop and
  "All payments are final" → agree → Checkout saves `4242…` → the page says "on" with the card's last 4. Within the hour after
  08:00 the installment is paid (receipt R-…, payment marked "automatic"); Stripe shows a 99¢ application fee on it. Repeat on a
  second bond with card `4000 0000 0000 0341` (attached, then declined): the payer and you are texted "did not go through", the
  attempt shows "Declined · tried again on …". A third bond with `4000 0027 6000 3184` (3-D Secure): the phone gets "your bank needs
  you to confirm" with a link → Confirm payment → Checkout → paid once. "Stop automatic payments" on the payer page → the agent is
  told. Production (setting off): the card is not shown and the routes answer 503.
- [ ] E17l **Staff seats** (Starter = 3): Settings → invite two e-mails → "3 of 3 seats used" and the invite form is replaced by
  "Move up a plan"; the plans screen shows "Bond Desk seats: 3 of 3 used". Sign in as an invited person (same e-mail) → open the
  e-mailed link → Accept → Bond Desk shows the owner's bonds; Settings shows no set-up, export or invite buttons. Owner removes
  them → their next Bond Desk load says no access.
- [ ] E17m **Forms set up for you**: Forms → "Have us set up your forms" → add a surety PDF → status Requested; the PDF is not in
  the library yet. Admin account → Admin review → Bond Desk forms set-up → Start → Open the forms tool → map the fields → Preview
  with sample data → Hand over with a note → the agent gets a push / e-mail, the form is in the library, status Ready.
- [ ] E17n **Import**: Settings → Import open bonds → download the template → fill 3 rows (one with a bad amount "12.345") → the
  preview shows the row's problem and Import is disabled → fix it → Import → 3 active bonds, each with "imported balance".
  Import the same file again → refused (power numbers already used), nothing added.
- [ ] E17o **Export**: Settings → Export everything → the ZIP opens on the laptop: README.txt, reports/*.csv, records/*.csv,
  receipts/…pdf, signed/…pdf. A fourth export within the hour is refused.
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

## H. Court day, phone verification, phone line, results (migration 40, 25 min)
- [ ] H1 **Verify phone** (phone A): Settings → Verify your phone → enter the phone's number → a text with a 6-digit
  code arrives → a wrong code says "not right, 4 tries left" → the right code → "verified". Change the phone in the
  profile → Settings shows it unverified again.
- [ ] H2 **Nothing by unverified contact**: a bail agent enrolls the number of phone B → on a second account that typed
  phone B's number (never verified) Home shows no "Your bail agent" card → verify on phone B's own account → the card
  appears with the agency and court date.
- [ ] H3 **Plan your court day** (phone A, a court date at a Davidson County courthouse): the court date shows the
  checklist, "Call 211", "Buses and routes: WeGo Public Transit" with "Web address checked …", and "Directions to the
  court". Tick two items, add a note, Save, reopen → kept. A court date in a county with no listed agency shows 211
  and directions only.
- [ ] H4 **Reminder link**: the next court-reminder text ends with `https://justicegavel.app/court-dates/<id>` before
  "Reply STOP"; tapping it opens that court date.
- [ ] H5 **Offer a ride**: share the court date with phone B's account (with reminders) → on phone B, Court dates →
  family section → "Offer a ride" → phone A gets the push "<name> offered a ride to court on <day>" → Accept → phone B
  gets "<name> accepted your ride…". A follower invited without reminders sees no "Offer a ride".
- [ ] H6 **Check-in link page** (a text-link enrollment with a Bond Desk court date): the page shows the court date,
  court and room, 211, the county's transit agency where listed, and directions; no charges or case number.
- [ ] H7 **Phone line** (EXTERNAL_SERVICES_SETUP.md 8b done, `TELNYX_VOICE_ENABLED=true`): call the toll-free number
  from phone B (its number is a Bond Desk defendant's) → "press 1 for English, para español oprima 2" → 2 → Spanish
  menu → 1 → the next court date, time, court and room are read, nothing else → 2 → a text with the date arrives →
  3 → the missed-court guidance. Call from a number not on file → 1 → enter phone B's number on the keypad → the date
  is read. Call 7 times in an hour → the 7th is told to call later. Telnyx → the call shows no recording.
  `TELNYX_VOICE_ENABLED=false` → calls are not answered. A `curl -X POST …/api/webhooks/telnyx-voice` with no
  signature → 401.
- [ ] H8 **Ameelio**: Family Connect shows "Write, send photos or video-call someone in jail or prison — free through
  Ameelio (a nonprofit)…" and the link opens ameelio.org. Custody alerts (with a followed booking) shows the same card.
- [ ] H9 **Results**: open `https://justicegavel.app/results` → "No results have been published yet." Admin account →
  Admin review → Publish results → preview of the last 90 days; with fewer than 100 answered court dates Publish is
  disabled. On a period with ≥ 100 → Publish → the public page shows the numbers, the period and the methods note.
  The snapshot cannot be edited (psql `UPDATE results_snapshots …` fails).
- [ ] H10 **Menu entries**: with `CUSTODY_ALERTS_ENABLED=true` Home shows "Custody alerts"; with
  `BOND_RECOVERY_SHARING_ENABLED=true` and a bond shared with this account, "Bonds shared with me"; off → neither.

## When everything is ticked
Repeat sections A, C (one payment), E5 and E10 on **production** with a real card
and a $1 test product or your own Case Pass, then refund it as "billing error".
