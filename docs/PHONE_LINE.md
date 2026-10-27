# Court-date phone line (build plan A10, phone line only)

A toll-free number anyone can call to hear their next court date — for people without a smartphone or
data. English and Spanish. Built on Telnyx Call Control (Voice API v2); setup in
EXTERNAL_SERVICES_SETUP.md section 8b; test in docs/LIVE_TEST.md step H7.

## Settings
| Variable | Meaning |
|---|---|
| `TELNYX_VOICE_ENABLED` | `true` answers calls. Default off: the webhook answers 503 and no call is answered. |
| `TELNYX_VOICE_NUMBER` | The line's number (E.164). Calls to other numbers on the account are ignored. Shown in the app (court date screen, `GET /api/court-dates/guidance` `phone_line`) only while the line is on. |
| `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` | Shared with texts. Every webhook is checked with the Ed25519 signature (`telnyx-signature-ed25519`, `telnyx-timestamp`, at most 5 minutes old); unsigned or badly signed → 401. |
| `TELNYX_VOICE_EN` / `TELNYX_VOICE_ES` | Optional voices (default `Polly.Joanna` / `Polly.Lupe`). |
| `PHONE_LINE_TIME_ZONE` | What "today" is for "next court date" (default America/Chicago). |

## The call
1. `call.initiated` → per-caller limit (6 calls an hour, 20 a day, by an HMAC of the caller's number) → `answer`.
   Over the limit: "please call again later", then hang up.
2. `call.answered` → "Justice Gavel court date line. To continue in English, press 1. … Para español, oprima 2."
   (SSML; the Spanish sentence is spoken in Spanish). No key → English.
3. Caller ID is matched to a number on file:
   - an account's **verified** phone (services/phoneVerification.js) — an unverified number on an account never counts;
   - a Bond Desk defendant's phone on an open bond (prospect, active, forfeited);
   - an active check-in enrollment's phone.
   There are no guest (no-account) reminders in the app, so there is nothing else to match.
4. Menu: **1** hear your next court date · **2** get it by text · **3** what to do if you missed court.
   - No match: 1 or 2 asks for the 10-digit number on file on the keypad (3 numbers per call, 10 per caller a day).
   - 1 reads only: day, time, court name, room ("Your next court date is Tuesday, November 3, at 9:30 AM. General
     Sessions Court. Room 5C."). Never case numbers, charges, names, balances or anything else.
   - 2 texts the same to the number on file (never to the caller's number if it differs), never to a number that
     replied STOP (`sms_opt_outs`), at most once an hour per number; the Telnyx message id is kept for `sms_delivery`.
   - 3 reads the app's existing missed-court guidance (services/courtDayGuidance.js), then the menu again.
   - No key at the menu → goodbye and hang up.
5. `call.hangup` → the log row is closed.

## Call log (`voice_calls`)
No recordings (recording is never requested). No full numbers: an HMAC of the caller (for the limit) and its last 4
digits; language, how the caller was matched, whether the date was read, the text result, keypad tries, refusals.

## Cost
Telnyx bills the number and the minutes to the platform (not to bail agents). Watch usage in Telnyx → Reporting.

## Code
`services/phoneLine.js` (flow, lookup, limits), `services/phoneLineText.js` (the words, English and Spanish),
`routes/webhooks/telnyxVoice.js` (signature, on/off). Inbound text messages stay on `routes/webhooks/telnyx.js`.
Tests: `__tests__/integration/court_day_phone_line.int.test.js` (A10a–c, signed fake webhooks and a fake Telnyx),
`__tests__/court_day_phone_line_units.test.js`.
