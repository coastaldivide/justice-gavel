# Court date reminders — what works, what was fixed, what is left (Oct 26, 2026)

Goal: every person who saves a court date gets reminded on time, on at least one channel
that reaches them, and the app never claims a reminder went out when it did not.

Evidence behind the feature: in a New York City study, text-message reminders cut missed
court dates from 38% to as low as 28% — 21% fewer for any reminder set, 26% for the best one
(J-PAL / ideas42, povertyactionlab.org). That evidence is for **text messages**. App push
and e-mail reminders are useful, but that study does not measure them, so the 21–26% figure
should only be used in marketing once texts (Telnyx) are live.

## 1. How it works (verified by reading the code)

| Step | Where | Status |
|---|---|---|
| Person saves a court date (date, optional time, courthouse) | `routes/courtDates.js` | Works. Needs an account (step 3 of the core path). |
| Four reminders are planned: 7 days 9:00, 3 days 9:00, day before 18:00, day of 6:30 — in the person's time zone and language | `services/courtReminders.js` | Works. A date added late gets one reminder right away. Moving/deleting a hearing re-plans or cancels. Duplicate plans are prevented by a per-hearing lock. |
| Family followers (with the owner's consent) get the same set | `services/courtReminders.js` | Works. |
| Every minute, due reminders are claimed and sent; the hearing is re-checked first (still scheduled, case open) | `services/reminderDispatcher.js` | Works. Safe with several servers (row locks). |
| Channels, in order | dispatcher | **App push → browser push (new) → e-mail → text message via Telnyx (new)** |
| A reminder that reached no channel is marked `undeliverable`, never `sent`; the court-date screen asks the person to fix it | dispatcher + `GET /api/court-dates` | Works. |
| Every 6 hours, any upcoming hearing without reminders gets them (self-healing) | dispatcher | Works. |

## 2. Fixed in this pass (code changes, with tests)

| # | Problem found | Fix |
|---|---|---|
| R1 | **Android never showed court reminders.** The server sends them on Android channel `court_reminders`, but the app never created that channel. On Android 8+, a push for a channel that does not exist on the phone is not displayed. | `services/push.ts` `ensureNotificationChannels()` creates `court_reminders` (max importance, sound) and `default`; called on every app start from `hooks/useAppSetup.ts`. |
| R2 | **A push Expo accepted but that never arrived counted as "sent".** Expo's first answer only means "queued". The real result (e.g. missing APNs/FCM credentials, dead device) comes back in a receipt 15+ minutes later, and nothing acted on it — no e-mail, no text. | `checkPushReceipts` now hands failed receipts to `requeueAfterPushReceiptFailure()`: the reminder goes back to pending with `skip_push`, and the dispatcher tries the next channel. Test added (`core_path.int.test.js`). |
| R3 | **Web / PWA users got no notification at all** (web push existed as an admin tool only; the app never subscribed; the service worker had no push handler). | `services/webPush.js` (server), dispatcher channel `web_push`, `frontend/src/services/webPush.ts` (subscribe when the person turns reminders on), `public/sw.js` `push` + `notificationclick` handlers, delivery status counts browser subscriptions. |
| R4 | **Twilio was back in the code** against the July 2026 owner decision. | Twilio removed everywhere (code, config, env examples, docs, tests). |
| R5 | **No texting provider.** | Telnyx Messaging API v2 in `services/sms.js` (`TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, optional `TELNYX_MESSAGING_PROFILE_ID`). Off until the keys are set; nothing else changes. Tests converted to a Telnyx mock. |
| R6 | **Texts had no carrier-required wording.** | Each text starts "Justice Gavel:" and ends "Msg & data rates may apply. Reply STOP to opt out, HELP for help." (4 languages). |
| R7 | **No consent disclosure at opt-in and no proof of consent** (both required for TCPA and for 10DLC campaign approval). | Opt-in screen shows the consent text (`cdd_sms_consent`, 4 languages). Migration 31 records when, which number, which wording version and language; opt-out time too. |
| R8 | **A STOP reply was not reflected in the app**, which would keep trying. | `POST /api/webhooks/telnyx` (Ed25519 signature verified with `TELNYX_PUBLIC_KEY`): STOP / UNSUBSCRIBE / CANCEL / END / QUIT turn text reminders off for that number. |
| R9 | Court-date screen said "push, then e-mail" | Now names every channel in order (4 languages). |

## 2a. Added Oct 27, 2026 (build plan A6 / A7; Bond Desk A1 in docs/BOND_DESK.md)

| What | Where |
|---|---|
| Reminder wording (push, e-mail and text, 4 languages) now says what can happen ("If you miss court, a warrant can be issued"), what to expect (security line, bring ID and court papers) and asks for a plan ("How will you get there? Make a plan now."). No statistic, no other legal claim. | `i18n/messages` `reminder.body.*`, `reminder.follower.body.*` |
| English texts stay within 2 segments (GSM-7); es / pt / vi / zh / ar keep their own letters (owner decision Oct 27 2026) and may use up to 6 Unicode segments; ht / tl (usually GSM-7) up to 3 GSM-7 segments. Texts are built from the hearing at send time and long case / court names are shortened beyond those limits. A test checks every text in every language with long values. **Changed:** recurring reminder texts now end "Reply STOP to opt out." — "Msg & data rates may apply" and "HELP for help" were dropped from each reminder to keep texts short. | `services/smsText.js`, `reminderDispatcher.courtSmsText`, `__tests__/court_reminder_wording.test.js` |
| "Did you make it to court today?" at 15:00 on the court day: a push that opens the hearing with one tap (I went / It was rescheduled / I missed it) and, for people who turned texts on, a text "Reply 1 = I went, 2 = it was rescheduled, 3 = I missed it". Replies within 48 hours set the hearing's status (`court_dates.status_source = 'reply'`). | `courtReminders.planAttendanceSteps` (`court_checkin`), `services/courtReplies.js`, `routes/webhooks/telnyx.js` |
| The morning after (09:00) a hearing not marked attended / rescheduled / cancelled: "If you missed court, act today: call the court clerk, your lawyer, or your bail agent" with a link to the missed-court guide (`/missed-court`, works without an account) — push and, when texts are on, a text. Marked missed (in the app or by replying 3) → sent at once, never twice. | `court_missed_followup` rows, `queueMissedFollowupNow` |
| Counts per county (or state) and month: asked / attended / rescheduled / missed / no answer, app users and Bond Desk separately. | `GET /api/admin/metrics/appearance`, `services/appearanceMetrics.js` |

## 3. What the OWNER must do before reminders reach anyone (no code can do these)

Today, with no keys set, **no reminder can reach anyone**: there is no EAS project (so no
push tokens), no VAPID keys, no Resend key, no Telnyx account. Every reminder would be marked
`undeliverable` (honestly). In order of impact:

1. **Create the EAS project** — `cd frontend && eas init` replaces `PENDING_EAS_INIT` in
   `app.json`. Without it the app never gets a push token. Then upload the **APNs key** (iOS)
   and **FCM v1 service-account key** (Android) in EAS credentials. Without them every push
   fails at the receipt (now caught by R2 and sent on to e-mail/text).
2. **Resend**: set `RESEND_API_KEY` and verify the sending domain (SPF/DKIM DNS records).
   E-mail is the backstop for everyone who has an account.
3. **Telnyx** (texts — the channel the 21–26% evidence is about):
   - Create the account, buy a local number, create a messaging profile, and turn on its
     opt-out (STOP/HELP) handling.
   - Register the **10DLC brand and campaign**. US carriers block unregistered app-to-person
     texts. Approval takes days to weeks. Use the in-app consent text (R7) as the opt-in
     description and a sample reminder as the sample message.
   - Set `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, `TELNYX_MESSAGING_PROFILE_ID` and
     `TELNYX_PUBLIC_KEY` on Render.
   - Point the profile's webhook at `https://<api>/api/webhooks/telnyx`.
4. **VAPID keys** for browser push: `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.
5. **Real-device test** (docs/REAL_DEVICE_TEST_SCRIPT.md): save a court date 8 days out on an
   iPhone and an Android phone, move `deliver_at` to now on staging, and confirm each phone
   shows it — locked, unlocked, app closed. Repeat with notifications turned off (should
   arrive by e-mail/text) and from the web app.

## 4. Remaining code work (not done in this pass)

| # | Item | Why it matters |
|---|---|---|
| N1 | Multi-device push: `push_tokens` keeps one token per user (`ON CONFLICT (user_id)`), so a second phone replaces the first. | Families often share one account on two phones. Change the unique key to (user_id, token). |
| N2 | On-device scheduled notifications as a backup (expo-notifications `scheduleNotificationAsync`) for saved court dates. | Fires even with no signal or if the server is down. Needs de-duplication with server push (e.g. the app reports which hearings it scheduled locally). |
| N3 | Telnyx delivery receipts (`message.finalized` webhook) → mark a text `undeliverable` when the carrier rejects it and try e-mail. | Same honesty rule as R2, for texts. |
| N4 | Admin view of `undeliverable` reminders per day (the count already exists in `/metrics`). | So the owner sees delivery problems without reading logs. |
| N5 | Measure it: compare missed vs attended court dates (`court_dates.status`) by channel once live. | The only way to claim a reduction for this app specifically. |
