# Independent review: findings and fixes (October 27, 2026)

A reviewer who had not seen the build read all new code, then verified each finding by reproducing
it or tracing the code end to end. Every finding was fixed with a regression test. Migration:
`00000000000042_review_fixes.sql`.

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | High | Tapping "Confirm payment" twice on an automatic payment could charge the payer twice; only one charge was recorded | One Checkout session per attempt, reused on repeat clicks and expired if the amount changes. Confirming after payment returns 409. A second payment that still arrives is posted to the bond and the agent is alerted, never dropped. | RF1, RF1b |
| 2 | Medium-high | A public defender invoice retried after Stripe's 24-hour idempotency window got duplicate lines | A retry reads the invoice's existing lines and skips any already there | RF2 |
| 3 | Medium | Phone line: with caller ID hidden, anyone could key in phone numbers without limit and hear court dates | No keypad lookups without caller ID, and each typed number can be looked up 3 times a day whoever calls | RF3 |
| 4 | Medium | Phone line option 2 texted numbers with no recorded consent | Texts only numbers with recorded consent | RF4 |
| 5 | Medium | Custody alerts could be texted to any typed number | Texts go only to the account's verified phone and are held 21:00–08:00 local time (job `custody-held-texts`) | RF5 |
| 6 | Medium | Public defender invitation tokens were written to the logs | One shared rule removes every token path from request logs, error logs and Sentry | RF6 |
| 7 | Low-medium | Telnyx retries of an incoming text were handled twice | Each event is handled once (by its id); slow work runs after the reply to Telnyx | RF7 |
| 8 | Low | A pay-page payment larger than the bond balance couldn't be attached | Attached anyway; the overpayment is flagged and the agent is alerted | RF8 |
| 9 | Low | One office could capture text replies meant for another office | A number that belongs to clients of several offices is routed to no office: Justice Gavel admins see it, and the sender is asked to call their office | PD5 |
| 10 | Low | Some Mountain-time counties in SD and NE were missing | Added (each checked against its county page) | RF10 |
| 11 | Low | A late text reply could overwrite a status the person set in the app | A text reply no longer overwrites a status set in the app | RF11 |
| 12 | Low | A check-in link could change the time zone the agent set | The link only fills the time zone when none is set | RF12 |
| 13 | Low | The autopay webhook didn't check which Stripe account the event came from | Payment is posted only when the event's account is the plan's and the status is "succeeded" | RF13 |
| 14 | Low | Phone verification guesses could race past the 5-try limit | Each guess claims an attempt atomically before comparing | RF14 |
| 15 | Low | Three new texts lacked "Reply STOP to opt out" | Added in all 8 languages | RF15 |

The reviewer found these areas clean:
- Stripe and Telnyx signature checks.
- Per-agency and per-office access checks on every route with an id.
- Link tokens: hashed, expiring and rate-limited.
- CSV formula escaping and ZIP entry names.
- Parameterized SQL.
- Receipt numbering inside transactions.
- The autopay job: never charges twice or more than the balance.
- ⚖ features: off in production.
- Account deletion: covers the new tables.
