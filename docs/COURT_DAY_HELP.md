# Help getting to court, phone verification, Ameelio, published results (migration 40)

Build plan items A8, B10, B11 and a security fix. The phone line (A10) is in docs/PHONE_LINE.md.

## A8 — Plan your court day
On each upcoming court date (CourtDateDetailScreen, `components/CourtDayPlan.tsx`):
- **Checklist saved on the court date** (`court_dates.plan`, owner only): ride, time off work, child care,
  documents, address and room — each "done" plus a note (≤ 200 characters).
  `PUT /api/court-dates/:id/plan { items: { ride: { done, note }, … } }`; `GET /api/court-dates/:id` returns `plan`.
- **Help links** (`help` on `GET /api/court-dates/:id`, services/courtDayHelp.js):
  - 211 — "Call 211" and 211.org, every county.
  - The county's transit agency, only where `backend/src/data/transit_agencies.js` has a row with a cited
    source (the agency's own site or its FTA National Transit Database profile) and the date it was checked.
    Tennessee first: Davidson (WeGo), Shelby (MATA), Knox (KAT), Hamilton (CARTA), Montgomery (CTS),
    Rutherford (Rover), Madison (JTA), Washington (Johnson City Transit), Williamson (Franklin Transit),
    Sullivan (Kingsport Area Transit). Each row says the area it serves (a city system may not cover the county).
    Other counties show 211 and directions only.
  - Map directions to the courthouse address.
  - Public defender phone: **not shown**. The directory's public-defender rows (`resources`) have no cited source;
    the plan says to show only cited rows. When a sourced directory exists, fill `help.public_defender`.
- **Reminder texts link here** (A6 plan prompt): the app's court-reminder text ends with
  `https://justicegavel.app/court-dates/<id>` before "Reply STOP" (fits in 2 segments in English; checked by tests).
  Bond Desk texts are unchanged (no app page for a defendant without an account).
- **Offer a ride**: a family follower who gets reminders for the case sees "Offer a ride" on each upcoming court date
  (Court dates → family section). `POST /api/following/:followId/court-dates/:cdId/ride-offer` (DELETE takes it back).
  The owner gets a push "{name} offered a ride to court on {day}" and answers on the court date
  (`POST /api/court-dates/:id/ride-offers/:offerId { decision: accept|decline }`); the follower gets a push with
  the answer. Table `ride_offers`. Followers without reminders cannot offer.
- **Check-in link page** (`/c/<token>`): the next court date with the same help links (docs/BOND_DESK.md).

## Phone verification (security fix)
Before: an account was linked to a bail agent's enrollment (and the "Your bail agent" card) by the phone or e-mail it
typed — anyone could register with someone else's. Now:
- Settings → Verify your phone (`VerifyPhoneScreen`): `POST /api/me/phone/verify { phone }` texts a 6-digit code
  (Telnyx); `POST /api/me/phone/confirm { code }`. Codes: only an HMAC is stored (`phone_verifications`), 10 minutes,
  5 attempts; limits 5 codes an hour per account, 5 an hour and 10 a day per number, 60 s between codes to a number;
  never to a STOP number; no Telnyx → 503 `sms_unavailable` (nothing sent).
- `users.phone_verified_at` / `phone_verified_phone`; a database trigger clears both whenever `users.phone` changes.
  Verifying a number removes it from any other account's verification.
- Linking (`routes/checkins.js claimMatching`) uses only the verified phone. E-mail never links: the app has no
  e-mail verification.
- Links made before this change were held by migration 40 (`checkin_enrollments.held_user_id`); they return when the
  account verifies the enrollment's number. The "Your bail agent" card says "Verify your phone to see your bail agent's
  details" meanwhile (`verify_prompt`).
- The phone line counts an account's number only when it is verified.

## B10 — Ameelio
`components/AmeelioCard.tsx` on Family Connect and on Custody alerts (when following a booking): "Write, send photos or
video-call someone in jail or prison — free through Ameelio (a nonprofit), where their facility works with Ameelio",
linking to https://www.ameelio.org. Checked Oct 27 2026 against Ameelio's own page title ("Ameelio for Loved Ones: Stay
in touch with your loved ones for free"), Stanford Social Innovation Review (free postcards, letters, photos and video;
access through agreements with states; not nationwide) and Wikipedia (technology nonprofit). ameelio.org itself could not
be fetched from the build machine; re-check the wording against it before launch.

## B11 — Published results
- Admin → Admin review → Publish results (`AdminResultsScreen`): `GET /api/admin/results/preview?from&to` (default the
  last 90 days to yesterday), `POST /api/admin/results/publish { from, to }`, `GET /api/admin/results/snapshots`.
  Admin role only. Refused (409 `sample_too_small`) under 100 answered court dates (attended + rescheduled + missed).
- Numbers (app users and Bond Desk together): court dates, asked, attended / rescheduled / missed, no answer (counted
  separately), appearance rate = attended ÷ (attended + missed), court reminders sent, numbers texted and how many
  replied STOP in the period (opt-out rate). Fixed methods note (self-reported answers, no answer counted separately,
  not a controlled study).
- `results_snapshots`: stored once with its date; a trigger refuses UPDATE and DELETE. Nothing is published
  automatically.
- Public page `https://justicegavel.app/results` (`ResultsScreen`, `GET /api/results`): only the latest published
  snapshot; before one exists it says "No results have been published yet."

## Menu entries
Home (More tab) shows "Custody alerts" only when `GET /api/custody/status` says the feature is on, and "Bonds shared
with me" only when `GET /api/recovery-shares` answers (feature on) with at least one share.
