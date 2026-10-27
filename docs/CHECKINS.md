# Check-ins (bail agent ↔ defendant)

Post-release check-ins for bail agents: the agent enrolls a defendant, the defendant checks in daily
or weekly, the agent sees the history and is told when a check-in is missed. Check-ins are included in
every bail-agent plan (no per-defendant fee). Code: `backend/src/routes/checkins.js`,
`services/checkinReminders.js` (the defendant's day, push reminders), `services/checkinTexts.js`
(text links, missed alerts, location alerts), `routes/me.js` (the "Your bail agent" card). Screens:
`CheckInManagerScreen` (agent), `CheckInScreen` (defendant in the app), `CheckInLinkScreen` (defendant
by text link, no account), `components/BailAgentCard` (Home). Migration `00000000000036`.

"Today" is always the defendant's local calendar day: the zone of their account, else the zone stored
on the enrollment (the agent's choice or the defendant's browser on the link page), else the agent's.

## Two ways to check in (`checkin_enrollments.channel`)

| | `app` (default) | `sms` — text link, no app |
|---|---|---|
| Who | The defendant signs in to Justice Gavel and VERIFIES (texted code) the phone the agent enrolled | Anyone with a phone that gets texts |
| Reminders | Push at 10:00 local on the due day (`scheduled_pushes`) | A text with a personal link, the first run of `checkin-texts` at or after 10:00 local, never before 09:00 or after 21:00 |
| Cost | Free | 5¢ per text, billed with the other Bond Desk texts (below); check-ins themselves are free |
| Needs | — | A mobile number, the agent's tick "the person gave me this number for texts" (recorded with the number: `sms_consent_at`, `sms_consent_phone`), and a paid bail-agent plan |

**Text billing.** Every text for a check-in goes through `services/bondDesk/core.js`
`sendAgentTextDetailed` — never to a number in `sms_opt_outs` (STOP wins), logged in `bd_texts`
(purposes `checkin_link`, `checkin_reminder`, `checkin_missed`, `checkin_alert`) with the carrier's
message id, so `sms_delivery` reports delivered / failed and `services/bondDesk/textBilling.js` puts the
text on the agent's plan invoice at 5¢ exactly once. When the enrollment is attached to a Bond Desk bond
(`bd_bonds.checkin_enrollment_id`) the text is filed under that bond. An agent without a paid plan
cannot choose the text channel (403 `plan_required`); if the plan lapses, texts are not sent
(`no_plan`) rather than piling up unbilled.

**The link.** `https://<APP_URL>/c/<token>`: 32 random bytes (base64url). Only the SHA-256 is stored
(`checkin_link_tokens`); each text carries its own token, valid 30 days. "Reset link" revokes every
earlier token of the enrollment. A stopped enrollment's links answer 410 `enrollment_stopped`. Tokens
are redacted from request logs like signing links.

## Agent routes (sign-in required; only the enrolling agent)

- `POST /api/checkins/enroll` `{ defendant_name, defendant_phone?, defendant_email?, case_number?, court_date?, check_in_freq: daily|weekly, channel: app|sms, consent_confirmed (sms), missed_text_defendant?, time_zone?, lang? }`
  → `{ enrollment, checkin_link, share_message, text_status }`. For `sms` the link is texted now and returned once (it cannot be shown again — the server keeps only its hash).
- `GET /api/checkins/enrollments` → each row adds `channel`, `text_consent`, `text_ready`, `missed_text_defendant`, `home`, `recent_missed` (days, last 14), `last_text { kind, status, at, delivery_status }`; plus `can_text`, `text_cents`, `location_alerts_enabled`, `agent_settings`.
- `POST /api/checkins/enrollments/:id/link` `{ rotate? }` → text the link again (`rotate: true` = reset). 409 `opted_out` when the number replied STOP, 409 `not_text_channel`, 403 `plan_required`.
- `PATCH /api/checkins/enrollments/:id/settings` `{ channel?, consent_confirmed?, defendant_phone?, missed_text_defendant?, time_zone?, lang? }` — switching to text texts the link; a new phone number needs the consent tick again.
- `PUT /api/checkins/enrollments/:id` `{ active }` — stop / restart. A restart starts a new monitoring period (`active_since`), so the paused days are never "missed".
- `GET /api/checkins/history/:id` → records (with `via`, `counted`, `distance_miles`, `outside_radius`), compliance, `missed`, `texts` (with delivery status).
- `GET /api/checkins/missed` → missed check-ins of the last 30 days.
- `PUT /api/checkins/agent-settings` `{ missed_alert_text, alert_phone }` — also text me when a check-in is missed (5¢, needs a plan).
- `PUT|DELETE /api/checkins/enrollments/:id/home` — location alerts (below).

## Defendant without an account (public, the link is the credential)

- `GET /api/checkins/link/:token` → `{ agency: { name, phone }, first_name, frequency, checked_in_today, done_for_period, next_due, today, time_zone, location: { optional, distance_alerts } }`. Nothing else about the person (no last name, case, phone).
- `POST /api/checkins/link/:token` `{ lat?, lng?, note? }` → 201 `{ counted, location_shared, … }`.
  The first check-in of the period counts; another on a day already done is recorded (`counted = false`,
  status `extra`) and is not counted twice. Location is stored only when the person ticked "share my
  location for this check-in" — the box is off every time the page opens and after each check-in, and
  the position is read once (browser geolocation) at the moment of checking in, never in the background.
- Rate limits: 60 requests a minute per IP; 10 check-ins an hour per link.
- Errors: 404 `link_invalid`, 410 `link_expired` (expired or reset), 410 `enrollment_stopped`, 400 `bad_location`.

## Missed check-ins (A3) — job `checkin-missed`, hourly

For each active enrollment, each local day that has **ended** in the defendant's zone on which a
check-in was expected and none came gets one `checkin_missed` row — unique on (enrollment, day), so a
second run or a second server instance never alerts twice. Daily: every day. Weekly: the day 7, 14, …
days after the last check-in (or after monitoring started). The day monitoring started or restarted is
never missed. The job looks back two days to cover a short outage. Daylight saving needs nothing
special: days are calendar dates in the zone, and a day ends at local midnight whether it had 23, 24 or
25 hours.

The agent gets a push and an e-mail (in their language), and a text when they turned that on. The
defendant gets a gentle text with a fresh link ("you missed your check-in for <day> — check in now")
when the enrollment says so (default on for the text channel): sent by `checkin-texts` the next day
inside 09:00–21:00 local, once, and not at all if they have already checked in that day. Missed days show
on Check-In Manager (top list and each row), in the history, and on the Bond Desk dashboard for bonds
linked to an enrollment (`missed_checkins`).

## Location alerts (B1) — ⚖ counsel question 2.4

Behind `CHECKIN_LOCATION_ALERTS_ENABLED` (unset = **off in production**, on elsewhere). Off: the
home-point routes answer 503 `feature_unavailable`, nothing is compared, and the app hides the controls.

- `PUT /api/checkins/enrollments/:id/home` `{ lat, lng, radius_miles }` or `{ record_id, radius_miles }`
  (the location of one of the person's check-ins). Radius 0–500 miles. There is no address geocoding:
  the app has no geocoding service, so the point is entered or taken from a check-in.
- On each check-in that shares a location, the great-circle (haversine) distance from the home point is
  stored on the record; outside the radius the agent gets a push and an e-mail and the record is flagged
  in the history. When the feature is on and a home point is set, the link page tells the person that
  the agent is told when a shared location is far from the address on file.

## "Your bail agent" card (B6)

`GET /api/me/bail-agent` (sign-in required) → `{ agents: [{ enrollment_id, agency: { name, phone },
next_court_date, check_in: { frequency, next_due, checked_in_today, done_for_period, today, time_zone },
bond: { status, balance_cents, next_payment } | null }], phone_verified, verify_prompt }`.

Only enrollments linked to the caller's account. Since migration 40 (security fix) an enrollment is
linked ONLY through a phone number the account verified with a texted 6-digit code (Settings → Verify your
phone; `POST /api/me/phone/verify` + `/confirm`; codes stored as an HMAC, 10 minutes, 5 tries). E-mail never
links: the app does not verify e-mail addresses. Links made before migration 40 were held
(`checkin_enrollments.held_user_id`): they come back when that account verifies the enrollment's number, and
the card says "Verify your phone to see your bail agent's details" until then (`verify_prompt`). An account
whose verification of a number is gone (the number was verified by another account) loses its link to it.
A bond's balance is shown only for a Bond Desk bond the same agent attached to that enrollment
(`bd_bonds.checkin_enrollment_id`); a bond is never matched to an account by contact details alone. The balance is read
from the bond's ledger; nothing can be paid or changed from the card.

## Jobs

| Job | When | What | jobHealth |
|---|---|---|---|
| `checkin-texts` | every 15 minutes | reminder texts, the gentle missed-check-in text, expired-token clean-up | expected every 15 min while `REMINDERS_ENABLED` |
| `checkin-missed` | hourly (minute 4) | missed-check-in rows and the agent's alerts | expected hourly while `REMINDERS_ENABLED` |
