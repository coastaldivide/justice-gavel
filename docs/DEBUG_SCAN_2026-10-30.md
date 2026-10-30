# Final debug scan — October 30, 2026

Scope: branch `consumer-core-path` at 48fdab8 (the Oct 27 competitor-features build and its
review fixes), checked independently. Baseline before any change: backend unit 28,434 passed;
real-Postgres suites 482 of 483 passed (issue 14); frontend 837 + 363 passed, type check clean;
backend and frontend lint failing (issues 1, 2). Every issue below was reproduced or proven from the code;
nothing was changed for style alone.

## Issues found and how each was resolved

| # | Severity | Issue | Evidence | Resolution |
|---|---|---|---|---|
| 1 | High (CI blocked) | Backend lint fails: 20 errors (unused variables in 4 tests, duplicate imports, `async` without `await`, irregular whitespace, a control-character regex). CI runs `npm run lint` first, so every CI run fails. | `npm run lint` | Fixed each error; behavior unchanged. The control-character regex keeps its meaning with an explicit lint exception. |
| 2 | High (CI blocked) | Frontend lint fails: 9 errors (non-null assertions, unused disable comments, promise executor returns). | `npx eslint src App.tsx --max-warnings 0` | Fixed; no behavior change. |
| 3 | High (legal) | The nightly outbound bot runs whenever `LIVE_REFRESH=true`, which the docs say to set at launch. It e-mails paid-lead summaries (arrests with bail set, $100 lead fee) to every lawyer in the scraped directory that has an e-mail address, though the money plan pauses lead sales until counsel clears them. (Its texts are a stub and never go out.) | `services/scheduler.js` step 4, `services/outbound_bot.js` | New counsel flag `OUTBOUND_BOT_ENABLED`: off in production unless set, like the other ⚖ flags; `check-env --launch` warns when it is on. LIVE_REFRESH runs the rest of the nightly pipeline without it. Counsel question 3.2c added; go-live checklist updated. |
| 13 | Medium | The bot's admin "dry run" still sent the lawyer e-mails; it only skipped marking arrests as alerted, so a dry run followed by the real run e-mailed the same leads twice. | `runOutboundBot({ dryRun })` | A dry run counts what it would send (`planned`) and sends nothing. |
| 4 | Medium (legal) | The court-reminder text fallback checked `sms_reminders` but not the STOP list, unlike the main text path. | `services/reminderDispatcher.js` SMS fallback | The fallback uses the same `smsAllowed()` check (opted in, valid number, not on the STOP list). |
| 5 | Medium (legal) | Emergency alerts texted a contact even if that number had replied STOP. | `routes/alerts.js` `deliverAlert` | A contact on the STOP list is reported `opted_out` and not texted; the app then opens the phone's own messages app, as it does when texting is off. |
| 6 | High (launch state) | Lawyers could not get any leads in Tennessee: the dashboard only offered "Buy by card", which the server refuses in credit-pack states, and there was no way to buy credits or answer with credits in the app. | `AttorneyDashboardScreen` Leads | The dashboard shows the credit balance, sells the three packs (sheet or Checkout), and answers a request with credits where the state requires it; card purchase stays for per-lead states. Shows the no-recommendation disclosure. |
| 7 | High (revenue) | The Family Case Pass existed on the server but could not be bought in the app. | `ConsumerSubscriptionScreen` | Added the Family Case Pass button and explanation next to the Case Pass. |
| 8 | Medium | Guest court reminders (no account) were scheduled without an Android channel, so Android filed them under a fallback channel at default importance; tapping one opened Home. | `services/guestCourtDates.ts` | Scheduled on the `court_reminders` channel (max importance); tapping opens Court dates. |
| 9 | Low | Guest morning-of reminder was 07:00; the server's is 06:30 (the code said "the same set"). | `services/courtReminders.js` plan vs guest plan | Guest morning-of at 06:30 (or 1 hour before an earlier hearing). |
| 10 | Medium (deploy) | `render.yaml` did not declare the Stripe Connect webhook secret or the phone-line number, so a Blueprint deploy never prompts for them; Bond Desk card payments would never confirm. | `render.yaml` vs `config.js` | Added `STRIPE_CONNECT_WEBHOOK_SECRET` and `TELNYX_VOICE_NUMBER` (secret, prompted) and `TELNYX_VOICE_ENABLED=false` to production and staging. |
| 11 | Low (docs) | MONETIZATION_PLAN still said card payments and multiple users per agency were "not built", and its "what the code charges" table lacked the Oct 27 prices (99¢ automatic charge, public defender $20,000 + $2 per client, staff seats). | docs vs `plans.js`, `publicDefender/billing.js` | Updated the plan. |
| 14 | Medium (CI flaky) | Five real-Postgres suites cleaned up with `DELETE FROM sms_opt_outs WHERE phone LIKE '+1615555%'`. With two workers sharing the database, that deleted other suites' STOP rows mid-run; the public defender dashboard test failed in this scan's baseline run (expected 1 opt-out, got 0). | `be_int` baseline: PD6 | Each suite now deletes only its own numbers. |
| 15 | High (legal) | The bot's lawyer e-mail promised "a free 30-day trial to receive daily arrest alerts and get top placement in family searches". The app sells lawyers neither, and the money plan says to stop the "top placement" promise (paid placement is a paid recommendation, ABA Rule 7.2). Its "view all leads" and unsubscribe links pointed at pages that do not exist, and the only opt-out endpoint needed the admin key, so recipients could not unsubscribe. | `services/outbound_bot.js` `buildAttorneyEmail`; no `/unsubscribe` route | The e-mail now says only what the app does and links to the attorney dashboard. The link opens `GET /api/bot/unsubscribe` (signed per address, IP rate limit), a page with one button that changes nothing by itself (mail scanners open links); the button's `POST` puts the address on the opt-out list and the bot never e-mails it again. |
| 16 | Low (latent) | The error-shaping middleware looped forever on any `/api` 4xx sent as HTML or text with its Content-Type already set (Express's `res.json` keeps an existing Content-Type, so `send` and `json` called each other). No current route did this, which is why the route sweep was clean; found while adding issue 15's route. | `middleware/errorShape.js` | Sets the JSON type before re-sending; regression test `error_shape_html.test.js`. |
| 12 | Low (bundle) | Four REPORTS copies in the master bundle were older than the docs. | `cmp` | Refreshed at packaging. |

## Checked and left unchanged

- Frontend dependency audit: 4 high findings are in Expo's build tooling (`@expo/cli`, code-signing helpers), not in the shipped app; npm's only "fix" is downgrading Expo six major versions. Accepted.
- New Oct 27 screens (public defender, Bond Desk settings, imports, admin): reached only from screens that are already professional-gated, and every request is checked on the server.
- Public token routes (check-in links, pay page, automatic-payment links): rate-limited, tokens hashed.
- Eight languages: every key present; no untranslated English in the sampled core-path keys.
- App config: location, camera, notification permissions and right-to-left support declared.
- Server memory under the route sweep (37,620 requests in under a minute against one process): the server peaks
  around 520–535 MB, so with `MEMORY_LIMIT_MB=512` (Render starter) its self-heal restarts it partway through and
  the sweep reports "no response". The Oct 29 code (48fdab8) peaks at 521 MB on the same sweep, so this is not
  from these fixes (they add about 15 MB). With the limit raised for the test, both sweeps finish with no findings.
  The restart is the intended safety valve; if real traffic ever triggers it, move to the 1 GB Render plan and set
  `MEMORY_LIMIT_MB=1024`.
