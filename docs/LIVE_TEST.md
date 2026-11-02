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
- [ ] E17j Staging only (`CUSTODY_ALERTS_ENABLED=true`): signed in as phone A, Family Connect → find a booking from the test feed → **Follow this booking** with alerts + texts (phone A must be verified first: More → Verify my phone; without it the card offers "Verify my number" and no number can be typed) → More → Custody alerts lists it. Change its status in the feed and ingest → push, e-mail and text "As of … shows … status as "…" (before: "…")" once; ingest again → nothing. Remove the row from the feed and ingest → "no longer listed on the … roster as of … Call … to confirm." (never "released"). Reply STOP from phone A → the next change is pushed but not texted. Unfollow → no more alerts.
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
- [ ] E19 **Public defender office** (staging, `PUBLIC_DEFENDER_CHANNEL_ENABLED=true`; docs/PUBLIC_DEFENDER.md): admin account →
  Admin review → Public defender offices → New office (TN, Davidson, 3 seats, your second e-mail as first office admin) → the
  invitation e-mail arrives → open it signed in with that e-mail → Accept → Home shows the office card.
  - [ ] E19a Office → tick the consent statement → "Confirmed by <you> on <time>". Staff → invite a third e-mail as staff → "2 of 3
    seats" (with the pending invitation); a fourth invitation is refused (seats full).
  - [ ] E19b Clients → Upload a CSV list → template → 3 rows, one with a bad phone → preview shows that row's error, Import disabled →
    fix → Import → 3 clients. Upload the same file with one court date changed → "1 updated", the old upcoming date is gone.
  - [ ] E19c A client with your phone (language es) and a court date 8 days out: the 7-day text arrives in Spanish, starting with the
    office name; the client screen shows it "sent" then "delivered". On the court day at 15:00 "¿llegó a la corte hoy?" arrives →
    reply 3 → the "actúe hoy" text arrives at once and the court date shows "Missed (answered by text)".
  - [ ] E19d Text "Can I get a ride?" from that phone → Inbox shows 1 unread, newest first → open it → reply "Call 211" → it arrives
    as "<office>: Call 211" → Mark handled → the conversation leaves "Open". Reply STOP → the client shows "Replied STOP" and
    Send is disabled.
  - [ ] E19e Office → enter the baseline (your test numbers) → it shows next to "Measured since the pilot started" with the rate
    definition. Export → the ZIP has clients, court_dates, appearance, messages (every text), opt_outs, baseline CSV files.
  - [ ] E19f Admin → the office → Preview the invoice for this year → active clients × $2.00 + $20,000 setup (first invoice only) →
    Create annual invoice → Stripe (test mode) → Invoices shows one open invoice e-mailed to the billing address, due in 30 days.
    Create again → no second invoice. Production (setting off): no office card, no admin entry, `/api/pd/*` answers 503.

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

## I. Eight languages (migration 41, 20 min)
- [ ] I1 Settings → Language lists English, Español, Português, Tiếng Việt, Kreyòl ayisyen, 中文, العربية, Tagalog.
  Pick **Kreyòl ayisyen**: Home, Just arrested, the rights card and Court dates are in Haitian Creole; a court date
  reads like "mèkredi 30 septanm 2026".
- [ ] I2 Pick **العربية** on an iPhone and an Android phone: the app restarts once and comes back right to left
  (back arrows point right, the rights-card bars are on the right). Pick English again: it restarts once, left to
  right. On the web (justicegavel.app) the page flips at once, with no reload (`<html dir="rtl">`).
- [ ] I3 Pick **中文** and **Tagalog**: the same screens are in those languages. Signed in, the account's language
  is saved (a court reminder text arrives in that language; Chinese ends "回复 STOP 退订。").
- [ ] I4 Bond Desk: set a bond's text language to Arabic (the reminder texts come in Arabic) and send yourself the
  signing link; open it on a phone set to Arabic and sign with an Arabic name. The signing page is in Arabic, right to
  left; the signed PDF's certificate is in English and shows the name in Arabic letters, joined and right to
  left ("/s/ محمد علي"), with no "[U+…]" codes and no note; the filled form shows the name right-aligned in its field.
  Same with a Chinese name (王小明). A payment receipt with an Arabic payer and a Chinese name prints both.
- [ ] I5 Pay page `/pay/<slug>` → language chips include the four new languages; Chinese opens Stripe Checkout in
  Chinese, Tagalog in Filipino; Haitian Creole and Arabic open Stripe's English page (Stripe has neither).
- [ ] I6 E-mails (password reset with the app in Arabic): the e-mail reads right to left.

## J. Review fixes (migration 42, 25 min)
- [ ] J1 **Confirm payment, once** (staging, autopay on, card `4000 0027 6000 3184`): open the "confirm the payment" link on two
  tabs and tap **Confirm payment** on both → the same Stripe Checkout page opens in both (Stripe → Checkout sessions shows one
  for that attempt). Pay in one tab, then tap Confirm on the link again before the bond updates → "This payment was already
  made…". The bond shows one payment.
- [ ] J2 **Pay page above the balance**: pay $300 on the pay page for a bond whose balance is $100 → Unassigned payments →
  Attach → it attaches; a notice says "Attached. It was $200.00 more than the bond's balance — check the ledger."; the agent
  gets a push / e-mail "Pay-page payment above the balance"; the bond's balance shows −$200.00.
- [ ] J3 **Phone line without caller ID** (`TELNYX_VOICE_ENABLED=true`): call with caller ID hidden (*67 on most US phones) →
  1 → "Your caller ID is hidden …" and no keypad prompt. From four different phones, enter the same number on the keypad →
  the 4th hears "That phone number has been looked up too many times today" and the call ends.
- [ ] J4 **Phone line texts need consent**: a Bond Desk defendant whose text consent was never confirmed calls → 2 → "We can only
  text a number that agreed…", no text. Confirm the defendant's number for texts in Bond Desk → call again → 2 → the text arrives.
- [ ] J5 **Custody texts at night**: with phone A verified and following a booking, change its status in the test feed after
  9 PM local time and ingest → the push and e-mail arrive at once, no text; after 8 AM the text arrives (job
  `custody-held-texts`, every 15 minutes). Admin diagnostics → jobs lists `custody-held-texts` ok.
- [ ] J6 **Public defender: a number in two offices**: make one test phone a client of two offices → text "hello" from it →
  neither office's inbox shows it; the phone gets "We could not tell which public defender office…"; Admin → Public
  defender offices shows it under "Client texts not delivered to any office".
- [ ] J7 **Telnyx replay**: Telnyx portal → Debugging → resend an inbound STOP webhook after you texted START → the number
  stays opted in (the replay is acknowledged as a duplicate).
- [ ] J8 **Logs**: open a public defender invitation link, a check-in link and a signing link, then search the server logs
  (Render → Logs) for the tokens → only `/api/pd/invite/[link]`, `/api/checkins/link/[link]`, `/api/sign/[link]` appear.
- [ ] J9 **A late reply**: mark today's court date "Attended" in the app, then reply **3** to the "Did you make it?" text →
  the app still shows Attended; the reply text says it was noted.
- [ ] J10 **Check-in time zone**: set a text-link enrollment's time zone to Mountain in the agent app, open the check-in link
  on a phone set to Eastern → the enrollment still shows Mountain.
- [ ] J11 **Texts end with the opt-out line**: the automatic-payment "did not go through", "confirm the payment" and the
  receipt texts end "Reply STOP to opt out." (Spanish "Responda STOP para no recibir más mensajes."); the e-mails do not.

## K. Going to court guide + Your case, step by step (migration 43, 20 min)
- [ ] K1 **Guide, signed out** (phone A, logged out): Just arrested → step 3 → "Going to court: how to dress and act" →
  eight parts (What to wear … After your hearing), each with "Sources" links and "checked November 1, 2026"; the yellow
  label "General information — not legal advice — not reviewed by a lawyer…". Tap a source → the official page opens.
  Tap a chip ("Inside the courtroom") → the page scrolls there. Airplane mode → the guide still opens.
- [ ] K2 **Court date** (signed in, a court date at the A.A. Birch building, Davidson County): the checklist's
  "What to wear" line says clean, neat clothes are enough (no "orange") with a button to the guide; the box "This
  court's posted rules" lists the General Sessions dress code and security pages and the Trial Courts dress code with
  "We checked this page on …"; each opens the court's page. Plan your court day → "Clothes ready" → tick, Save, reopen →
  kept. A court date at the Shelby County courthouse (or with no courthouse) shows no posted-rules box; its guide says
  "We don't have this court's own posted rules."
- [ ] K3 **Day-before push**: add a court date for tomorrow evening + 1 day (or wait for one) → the 6 PM push "Court
  date TOMORROW" ends "Open Justice Gavel to see what to wear and what to expect in court." → tap it → the guide opens
  for that court date ("Back to my court date"). The reminder TEXT is unchanged (still ends with the court-date link and
  "Reply STOP to opt out.").
- [ ] K4 **Case steps, guest** (logged out): Home → "Your Case, Step by Step" → "You are not signed in: … saved on this
  phone only"; tick two items in Arrest, open Before trial → "I'm at this stage" → the badge "You are here"; close and
  reopen the app → kept. Save a court date on the phone (guest court dates) → "I know my next court date" is ticked
  "From your court dates" and cannot be unticked.
- [ ] K5 **Case steps, signed in**: My Cases → a case → "Step by step" → pick a stage, tick items → sign in on another
  phone → same progress for that case. With two cases, the chips switch between them. Clearing your record (case state
  TN) → "What we have checked for Tennessee" shows only verdicts with a citation; others "Not checked yet — ask legal
  aid". The buttons open the rights card, Help Now, Court dates, Check-in, the record-clearing check; Custody alerts
  appears only with `CUSTODY_ALERTS_ENABLED=true`.
- [ ] K6 **Family sees the stage only when shared**: phone B follows the case (invite code) → Court dates → family
  section shows no stage → on phone A turn on "Let family who follow this case see which stage I'm in" → phone B (pull
  to refresh) shows "Stage: Before trial", never the checklist → turn it off → gone.
- [ ] K7 **Only the owner**: `curl -H "Authorization: Bearer <phone B token>" …/api/case-steps/<phone A's case id>` → 404.
  Delete the case → its progress is gone (`SELECT * FROM case_steps WHERE case_id = …` → 0 rows). Settings → Export my
  data → the file has `case_steps`.
- [ ] K8 **Arabic**: Settings → Language → العربية → both screens read right to left (checkboxes and bullets on the
  right), all text in Arabic except court and publisher names (shown as published).

## L. AI gateway with a real key (migration 44, 25 min)
Staging with a real `ANTHROPIC_API_KEY`, `AI_TRACE_PROPAGATION=on`. After each step check the newest
row: `SELECT task, task_class, model, requested_model, status, stop_reason, refusal, fallback_model, input_tokens,
output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cost_usd, request_id FROM ai_usage_log
ORDER BY id DESC LIMIT 3;`
- [ ] L1 **Chat, cached**: ask a question in the app (consumer) → answer streams, no thinking text anywhere. Row:
  task `chat`, class `standard`, model `claude-sonnet-5-5`, `cache_write_1h_tokens` > 0, `request_id` filled. Ask a
  follow-up within 5 minutes → `cache_read_tokens` ≥ the first row's 1h write, `cost_usd` lower. A new chat 10 minutes
  later → still a cache read (1-hour entry).
- [ ] L2 **Structured output, each class**: Motion review (attorney) → score / issues shown; row model
  `claude-opus-5-5`, `stop_reason` `end_turn`. Voice note typed in → summary / next steps (class `quick`,
  `claude-haiku-5-5`). Discovery analysis of a 3-page PDF → key facts and questions; a `preflight` = `counted` row and
  `input_tokens_estimated` close to `input_tokens + cache_*`.
- [ ] L3 **Settings accepted**: no 400 in the server log (`[ai] upstream error`) for any of the above — confirms
  `output_config.effort`, `thinking: adaptive/omitted`, Haiku `disabled` + effort `low`, `fallbacks: "default"` with
  the beta header `server-side-fallback-2026-07-01`, and every schema. Set `AI_THINKING_STANDARD=disabled` → chat
  still works (sent as `between_tools` on Sonnet 5.5) → unset it.
- [ ] L4 **Refusal wording**: if a question is ever declined (or force one with `AI_MODEL_STANDARD` set to a model
  and a prompt the classifier declines) → the app shows "This request can't be answered here…", the partial text
  disappears, no retry button, nothing in chat history; row `status` `refused`, `refusal` true, cost $0 for
  `general_harms` / `cyber`. A declined chat answered by the fallback model shows `fallback_model` set and
  `refusal` true with status `completed`.
- [ ] L5 **Too large**: upload a 400-page PDF to Discovery analysis → "This request is too large…", and no new
  `/v1/messages` call in the Anthropic console for it (only the free count).
- [ ] L6 **Metrics + alert**: `GET /api/admin/metrics/ai?days=1` (admin + X-Admin-Key) lists chat / motions_review /
  discovery rows with p50 / p95 and cost matching the console's usage page within a few cents.
  `GET /api/admin/diagnostics/ai` shows the hour. Set `AI_ALERT_MIN_CALLS=1 AI_ALERT_ERROR_PCT=0.01`, cause one error
  (bad key for a minute) → the next hourly watchdog sends "AI errors: …" to ONCALL_EMAIL / ALERT_WEBHOOK_URL. Reset.
- [ ] L7 **Budget**: `AI_DAILY_BUDGET_USD` just above today's spend → the next large request (contract review) is
  refused before sending ("too large … try again tomorrow"); a short chat still works until the cap.

## M. Verified citations with a real key (migration 45, 20 min)
Staging with a real `ANTHROPIC_API_KEY` (the mock follows the search-results / citations docs; these checks
confirm the real API). Newest rows: `SELECT role, content, ai_answer, ai_sent FROM chat_sessions ORDER BY created_at
DESC LIMIT 2;`
- [ ] M1 **Chat, cited** (consumer, state Tennessee): "Can police search my car without a warrant?" → the answer
  arrives in parts with [1] [2]; "Sources" lists the rights card (checked April 2026); tapping [1] shows the passage
  word for word; "Open in the app" opens the rights card. No 400 in the log (`search_result` blocks accepted, no beta
  header). In `ai_answer`: `dropped` 0; note how many parts were `withheld` (the real model's uncited sentences).
- [ ] M2 **Citation shape**: with `LOG_LEVEL=debug` temporarily, or in the Anthropic console's request log, confirm
  the response text blocks carry `citations[].type = "search_result_location"` with `source` = `jg:…`, `title`,
  `cited_text` (equal to the passage blocks), `search_result_index`, `start_block_index`, `end_block_index`; and that
  the stream sends `citations_delta` inside the cited block. If the real field names differ, `ai_answer.dropped` > 0
  on every answer — stop and fix `ai/citations.js verifyCitation`.
- [ ] M3 **Follow-up cached**: a follow-up within 5 minutes → `ai_usage_log.cache_read_tokens` ≥ the first question's
  input (the earlier turn with its search results is read from cache).
- [ ] M4 **Nothing found**: "Is quuxification lawful?" → "We couldn't find this in Justice Gavel's checked legal
  information…" with the rights card / legal help buttons, and **no** new `/v1/messages` row in `ai_usage_log`.
- [ ] M5 **Other languages + RTL**: ask M1 in Spanish and in Arabic → passages in that language, the marker and
  labels translated, the Arabic bubble mirrored.
- [ ] M6 **Research** (attorney): "Can a DUI conviction be expunged in Tennessee?" → sources include the Tennessee
  record-clearing row with its statute citation and source URL; reopen the session from History → same citations.
  With the research library configured (`SUPABASE_URL`), a case-law question cites library rows (title = citation).
- [ ] M7 **400 kept away**: confirm no request ever combined citations with `output_config.format` (grep the server
  log for `citations cannot be combined` — expected: none).

## N. Source re-checks and batches with a real key (migration 46, 30 min + up to 1 h waiting)
Staging with a real `ANTHROPIC_API_KEY`, signed in as an admin. The mock follows the batch-processing and
web-fetch docs; these checks confirm the real API.
- [ ] N1 **Run a small check**: `SOURCE_CHECK_MAX_ROWS=5`, Admin → Source checks → "Run a check now" → 201; within
  an hour (Batch tools → "Check batches now") the batch is `processed`. In the server log: no 400 for the batch create,
  and no `invalid_request_error` result lines (the `web_fetch_20250910` tool, `allowed_domains` with a bare host,
  `output_config.format` and the 1-hour cache_control are accepted inside a batch).
- [ ] N2 **Result shapes**: `SELECT status, error_type, stop_reason, result FROM ai_batch_items ORDER BY id DESC LIMIT 5;`
  → `succeeded` items have the parsed verdict JSON (the final text block after the tool result held the JSON — if
  every item is `invalid`, the JSON is elsewhere: fix `finalText()` in services/aiClient.js). An errored line, if any,
  has `error.error.type` (nested) — compare with the docs.
- [ ] N3 **Fetched text**: for one verified row, the court-rules or .gov page came back as `source.type: "text"` and
  the quote was found (`legal_source_checks.last_outcome = 'verified'`); a PDF source (e.g. a transit FTA profile)
  arrived as `base64` → queued `pdf_not_verifiable`.
- [ ] N4 **Allow-list holds**: temporarily add a row-free test (node REPL): a batch request whose user turn names
  `https://law.justia.com/…` with `allowed_domains: ['tn.gov']` → the result holds a
  `web_fetch_tool_result_error` with `url_not_allowed` (the API never fetched it).
- [ ] N5 **Cost**: `SELECT SUM(cost_usd) FROM ai_usage_log WHERE batch_id = <id>;` matches the console's usage for the
  batch (50 % of standard); `usage.server_tool_use.web_fetch_requests` ≤ `SOURCE_CHECK_MAX_FETCHES` per item.
- [ ] N6 **Queue**: approve one item, withhold one, edit one database row → `audit_log` has
  `admin.source_check_*` rows; the withheld row disappears from its screen; restore brings it back.
- [ ] N7 **Evaluation**: Batch tools → "Run the evaluation (10 questions)" → after both batches end the list shows
  "Score x/10 on 10 questions"; `GET /api/admin/ai-batches/<id>/eval` has per-question scores.
- [ ] N8 **Translation drafts**: add one English key to `backend/src/i18n/messages/en.js` on staging, "Draft
  translations for new text" → download the review file → 7 drafts, each passing
  `node backend/scripts/apply-translation-drafts.mjs <file>` (dry run). Do not apply on staging.
- [ ] N9 **pause_turn**: count `error_type = 'pause_turn'` items over a few runs (they are retried; many would mean
  `max_uses` is too low).

## O. Court papers, surety-form suggestions, Files API with a real key (migration 47, 30 min)
Staging with a real `ANTHROPIC_API_KEY`, `AI_FILES_API=on`, a consumer test account (disclaimer accepted) and an
admin. The mock follows the vision, PDF-support, Files and structured-outputs pages (read 2026-11-02); these checks
confirm the real API. Use made-up papers only (a printed sample notice with a fake name), never a real person's.
- [ ] O1 **Photo**: Court dates → "Read it from my court paper" → take a photo of a sample hearing notice → the review
  screen shows the date, time, court, address, courtroom, case number, each with "On the paper: “…”" matching the
  printed words, and a confidence pill. In the server log: one `court_paper_read` call, no 400; `ai_usage_log` row with
  `preflight = 'counted'` (count_tokens accepted the image).
- [ ] O2 **Nothing saved before confirm**: `SELECT COUNT(*) FROM court_dates WHERE user_id = <id>` is unchanged after
  O1; tap "Save court date" → one row with `source = 'paper'`, courtroom / case number / bring set, reminders planned.
- [ ] O3 **PDF**: the same notice as a 2-page PDF → read; a 15-page PDF → "too many pages (10)"; a password-protected
  PDF → the password message; a photo of a grocery receipt → "does not look like a court paper", nothing saved.
- [ ] O4 **Accuracy spot check** (10 sample papers, mixed English / Spanish): count lines where the value differs from
  the paper. Any wrong value with confidence "high" is a finding — note it in docs/AI_PLATFORM.md §11.
- [ ] O5 **Files API**: attach a sample PDF to a case (Case → documents), then "Or use a document already in this case"
  twice → `SELECT file_id, expires_at, uses FROM ai_files ORDER BY id DESC LIMIT 1;` → one row, `uses = 2`; in the
  console (Files) the file exists with `expires_at` ≈ 30 days ahead. The second Messages request carried
  `{ type: 'document', source: { type: 'file', file_id } }` and was accepted **with** the `anthropic-beta:
  files-api-2025-04-14` header (the Files page says the header is optional now; the vision page still lists it —
  if the API rejects the header on Messages, drop FILES_BETA in services/aiClient.js).
- [ ] O6 **Upload shape**: `POST /v1/files` without a beta header was accepted (multipart `file` + `expires_in_seconds`)
  and the response had `id`, `mime_type`, `size_bytes`, `expires_at` (compare with services/aiFiles.js).
- [ ] O7 **Deletion**: delete that case message → within a minute the console no longer lists the file and
  `ai_files.deleted_at` is set; delete a test account that had a read case document → its file is gone too;
  run the clean-up by hand: `cd backend && node --input-type=module -e "const { getDb } = await import('./src/db/index.js'); const m = await import('./src/services/aiFiles.js'); console.log(await m.cleanupFiles(await getDb())); process.exit(0)"`
  → `failed: 0`; `GET /api/admin/diagnostics/jobs` shows `ai-files-cleanup` ok after 05:20.
- [ ] O8 **Expired file**: set `AI_FILES_TTL_DAYS=0.05` (≈ 1 h 12 min), read a case document, wait until it expires,
  read it again → the read still works (the server logs the 4xx and resends the bytes inline) and a new `ai_files` row
  is created — confirm the real status code the API returns for an expired file_id (404 or 400).
- [ ] O9 **Surety-form suggestions**: Admin → Forms set-up → a request in progress → open a sample fillable surety PDF
  → "Suggest fields with AI" → every text field listed with a suggestion and the printed label as the reason; the
  form's field map is unchanged until "Accept"; Preview shows the accepted fields filled with sample data; a flat
  (scanned) PDF says it has no fillable fields and makes no AI call (`ai_usage_log` has no new `bd_form_map` row).
- [ ] O10 **Signatures**: no suggestion ever names `signature.name` / `signature.date`; the preview / signed copy never
  shows a drawn signature.
- [ ] O11 **Cost**: a 1-page photo read ≈ 1.6k image tokens + ~1.5k prompt ≈ $0.01 on Sonnet 5.5; a 2-page PDF
  ≈ 5–8k tokens ≈ $0.02; compare `ai_usage_log.cost_usd` with the console.

## P. Long chats (recap) and Word / PDF drafts with a real key (migration 48, 30 min)
Staging with a real `ANTHROPIC_API_KEY`, a consumer test account with unlimited chat (or an attorney account in defender
mode), a research account, and `AI_MEMORY_THRESHOLD_TOKENS=6000` so a recap happens within a few questions. Use made-up
facts only. The recap is our own summariser (docs/AI_PLATFORM.md §12.1 — the API's compaction and context editing were
evaluated and not used); the documents are written by the server (§13 — no Agent Skills). These checks confirm the real
model and real Word / PDF readers.
- [ ] P1 **Recap made**: in one chat ask 6–8 long questions that mention a county, a date ("my court date is March 3")
  and your stage ("I was arrested last week") → the server log shows `[memory] older turns summarised` with
  `method: 'counted'` (count_tokens decided), one `chat_memory` row in `ai_usage_log` on `claude-haiku-5-5`, status
  `completed`, no 400. `SELECT recap, covered_rows FROM ai_conversation_memory ORDER BY id DESC LIMIT 1;` → the county,
  the date and the stage in your words; no statute, no advice, no phone number / e-mail even if you typed one.
- [ ] P2 **Quality check** (5 long chats, two in Spanish, one in Chinese): any recap item that you did not say, or that
  states a legal rule, is a finding — note it in docs/AI_PLATFORM.md §12 (the server drops places / dates you never
  wrote and anything naming a law; anything else that slips through is what this check is for).
- [ ] P3 **The chat continues**: ask "what did I say my county was?" → the answer uses the recap; the next request's
  `system` has the cached prompt (1h breakpoint) then the recap block; `ai_usage_log.cache_read_tokens > 0` on the
  question after the recap (the system prefix is still cached; the conversation prefix restarts once).
- [ ] P4 **See and forget**: Chat → "What the assistant remembers" shows the recap (case stage, places, dates, what you
  told us, what you asked, "Replaces your first N questions"); "Forget this" → the forgotten message; the row has
  `recap = NULL, forgotten = true`; further questions make no `chat_memory` call. Clear the chat → the row is gone.
  Another account opening the same session id sees nothing. Repeat in Legal research (session screen).
- [ ] P5 **Off**: `AI_MEMORY=off` → no `chat_memory` calls; the screen says recaps are off; answers still work.
- [ ] P6 **Petition download**: Record clearing → a state with a checked rule → "Generate petition draft" → the draft
  shows the checked statute only (other laws replaced by "No source found for this part — not shown") → "Download as
  Word (.docx)" opens in **Microsoft Word, Google Docs and LibreOffice** without a repair prompt; header and footer on
  every page carry the notice in the app's language; "Page X of Y" updates; your typed name / county appear exactly as
  typed; the signature line is blank. "Download as PDF" → same content; open in Acrobat / Preview / Chrome.
- [ ] P7 **Scripts**: switch the app to Arabic and to Chinese and download again → in the PDF the Arabic notice reads
  right to left with joined letters and the Chinese characters show (no empty boxes); in Word the Arabic paragraphs are
  right-to-left. Vietnamese accents are intact in both.
- [ ] P8 **Motions**: Motion library → generate a motion (attorney account) → "Download as Word" / "PDF" → paragraphs that
  cite a case or statute are replaced by the not-shown marker (the app has no checked source for case law — expected),
  the case details are as typed, no "/s/" signature.
- [ ] P9 **Cost**: a recap ≈ 3–8k input + ~300 output tokens on Haiku 5.5 ≈ $0.001; compare `ai_usage_log.cost_usd` with
  the console. Downloads make no AI call.

## When everything is ticked
Repeat sections A, C (one payment), E5 and E10 on **production** with a real card
and a $1 test product or your own Case Pass, then refund it as "billing error".
