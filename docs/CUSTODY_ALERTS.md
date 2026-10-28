# Custody alerts — release / transfer alerts for families (A9)

⚖ Counsel question 6.3. Behind `CUSTODY_ALERTS_ENABLED` (unset = **off in production**, on elsewhere). Off: the
routes answer 503 `feature_unavailable`, `GET /api/custody/status` says `enabled: false`, and the app hides the
"Follow this booking" card and the Custody alerts screen.

## What the person does

- On an arrest record (Family Connect → find the person → the record), a signed-in person taps **Follow this
  booking** after ticking "Send me alerts about this booking". Optional: link it to one of their own cases, and
  **texts**, with a second tick ("I agree to receive texts about this booking at this number"). Texts go **only to the
  account's verified mobile number** (More → Verify my phone, services/phoneVerification.js) — no number is typed in.
  Without a verified number the card says "Texts go only to a mobile number you have verified" and offers "Verify my
  number". Up to 10 follows.
- **Custody alerts** (More → Custody alerts, `/custody-alerts`) lists each followed booking as the roster shows it
  now (status, facility, listed or not, the jail's phone) and the changes since they followed it. Unfollow any time.
- Only bookings from a roster feed we re-read can be followed (`ARREST_FEED_URLS`, source `feed_*`). Sample / seed
  rows and records taken down cannot be followed.

## What we detect (services/custodyAlerts.js, during roster ingest)

For followed bookings only, each time the feed is read (nightly, and every two hours with `LIVE_REFRESH`):

| Event | When | Alert (English) |
|---|---|---|
| `status_changed` | the roster's status differs from the last one it showed | As of {time}, the {county} County roster shows {name}'s status as "{new}" (before: "{old}"). This is what the roster says. Call {jail phone} to confirm. |
| `facility_changed` | the roster's facility differs | As of {time}, the {county} County roster lists {name} at "{new}" (before: "{old}"). … |
| `not_listed` | the booking is missing from a **complete** roster | {name} is no longer listed on the {county} County roster as of {time}. Call {jail phone} to confirm. |
| `listed_again` | it appears again after that | {name} is listed again on the {county} County roster as of {time}. … |

- We never say "released" unless the roster's own status says it, and then we quote it. A missing row is only
  "no longer listed — call the jail".
- "Complete" roster: the fetch succeeded, returned at least one valid row, was not cut at 1,000 rows, and every
  row was stored. Otherwise nobody is marked "no longer listed".
- The jail's phone comes from the record (`jail_phone`) or the feed's `jail_phone`; without one the alert says
  "Call the jail to confirm."
- **Never twice**: an event is recorded only by the run that changes the stored value (compare-and-set), and each
  (follow, event) pair is claimed once in `custody_alerts`. Changes from before someone followed are not alerted.
- **Takedowns**: a record taken down (`arrest_records.suppressed`) produces no events and no alerts, and the follow
  shows "This record is no longer available" without details.

## How we tell them

Push, e-mail (when the account has one) and — if they opted in — a text through Telnyx (`services/sms.js`):
only to the account's verified phone (checked again at send time: a phone changed since gets nothing, `text_status`
`skipped`), never to a number that replied STOP (`sms_opt_outs`), recorded with the provider id
(`custody_alerts.provider_id`) so `sms_delivery` gets the carrier's status. Texts end "Reply STOP to opt out"; English
stays within 2 segments. These texts are a platform cost (not billed to anyone). The person's language and time zone
are used.

**Night hours:** no text between 21:00 and 08:00 in the person's time zone (`users.timezone`, default
America/Chicago). Push and e-mail still go at once; the text is held (`custody_alerts.text_status = 'held'`) and the job
**`custody-held-texts`** (every 15 minutes, services/scheduler.js; monitored in monitoring/jobHealth.js while
`CUSTODY_ALERTS_ENABLED` is on) sends it from 08:00, once (claimed before sending). A follow ended, a record taken down
or texts turned off before the morning → the held text is dropped (`cancelled`).

## Data and deletion

`booking_follows` (consent time and version, text number and consent time), `custody_events`, `custody_alerts`
(migration 38). Deleting the account deletes the follows and their alerts; a case deleted while linked leaves the
follow unlinked.

## API

- `GET /api/custody/status` → `{ enabled, max_follows, texts_live, verified_phone_last4 }`
- `GET /api/custody/follows` → `{ verified_phone_last4, follows: [{ id, arrest_id, available, case_id, case_title, text_opt_in, text_phone_last4,
  booking: { name, county, state, facility, status, jail_phone, booking_date, listed, not_listed_since, last_seen_at },
  events: [{ kind, old_value, new_value, observed_at }] }] }`
- `POST /api/custody/follows` `{ arrest_id, consent: true, case_id?, text_opt_in?, text_consent?, phone? }` → 201
- `PATCH /api/custody/follows/:id` `{ case_id?, text_opt_in?, text_consent?, phone? }`
  With `text_opt_in: true`: 400 `text_consent_required` without the second tick; 409 `phone_not_verified` when the account
  has no verified phone or `phone` (optional) is another number. Texts go to the verified phone.
- `DELETE /api/custody/follows/:id`
- `GET /api/custody/arrest/:arrestId` → `{ follow_id, trackable }`
