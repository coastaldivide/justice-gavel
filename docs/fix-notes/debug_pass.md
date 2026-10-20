# Debug pass

## A · Core path & safety

Scope: Home, JustArrested, RightsCard, HelpNow, Emergency, EmergencyShare, CrisisResources, OfflineStatus,
InterrogationRecorder (+web), VoiceNote (+web), ArrestMonitor, QuickConnect; routes /alerts, /rights, /help,
/interrogation, /transcribe, /arrests/monitors, /billing/quickconnect, /push/tip, /providers; corePath.ts,
offlineSync(.web).ts. Method: fresh migrated `jg_dbg`, production boot (no SMS / e-mail / Whisper / Stripe keys),
curl sweep of every endpoint (bad input, wrong user, guest, ?lang), web export driven in headless Chromium
(guest + signed in, en/es/pt/vi, 390×844 + 1280×900, offline), every Home tile clicked.
Screenshots: notes/debug/A/ (explore passes) and notes/debug/A/journeys/.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | POST /api/alerts (Home SOS, Emergency) | "Alert sent" / "contacts notified" while **no text was ever sent**; 3rd contact ignored; SOS failed (400) when location was denied; English text for every language | SMS sender was a stub (`() => Promise.resolve(null)`), result list only counted successes, `contacts.slice(0,2)`, lat/lng required, hard-coded English → real `services/sms.js` (Twilio, still optional) + e-mail only when live; per-contact `{delivered, reason}`, `sent/total`, up to 3 contacts deduped, location optional, text from server catalogs. App (new `services/sos.ts`): success only when everyone was reached; otherwise "could not be sent … open messages?" → messages app pre-filled for **all** phone contacts; offline → same text built on the phone | core_safety.int 1a–c; coreSafety SOS ×3; journey A3/A4 |
| 2 | GET /interrogation/recording-law | iOS reports "California" → app showed "✅ One-party consent — recording is legal" | lookup only matched 2-letter codes → full names resolved via STATE_NAMES; notes moved to catalogs (es/pt/vi) | core_safety.int 2; A8 |
| 3 | Recorder (native) | In an all-party-consent state, "I understand — start recording" did nothing | `.then(ok => { if (ok) startRecording; })` (no call) → `doStartRecording()`; mic denied no longer continues; unmount cleanup actually runs; pull-to-refresh kept the state; 401/503 messages + "Save the recording" | code (native; can't run here) |
| 4 | Recorder (web) | No consent law / warning at all; numeric keypad for "Officer name"; on failure "your recording was not lost" but it was discarded; officer name silently dropped | web screen rewritten: law box + confirm in two-party states, recording kept (retry upload, download .webm, PDF download), guest → sign in; backend prints officer in the PDF | A8 |
| 5 | VoiceNote (native) | Saving a note from a case card / tool card **erased the case's existing notes**; "Copy note" did nothing; save error said "Check your connection" | `PUT notes: existingNotes('')+new` → new `services/caseNotes.ts` re-reads notes and appends; copy → clipboard; proper messages | coreSafety caseNotes; A9 (closed-case path) |
| 6 | VoiceNote (web) | Free users always "Transcription failed" (paid-only /transcribe/audio, 403); no save to case; no typing fallback; Spanish speech forced to English | web screen rewritten on /transcribe/note + /transcribe/text, save-to-case append, copy; `/audio` no longer pins `language: en`; `/text` non-string → 400 | coreSafety VoiceNote web; core_safety.int 5; A9 |
| 7 | Home "Cases" tile, court countdown | Both did nothing (navigated to Home itself) | `nav: 'HomeTab'` → Cases / CourtDateDetail | coreSafety Home; A1/A2 |
| 8 | Home countdown | Off by one in US evenings; never shown on web | UTC-midnight `new Date('YYYY-MM-DD')` → calendar-day diff against server `today` from /court-dates; **Home's data never loaded on web** (no tip, no countdown, no nearby counts) because the SOS pulse loop held an interaction handle forever → `isInteraction:false` on FloatingSOSButton / SkeletonLoader / LawyerSkeletonCard loops, Home loads directly | homeChat countdown test; A2 |
| 9 | Home "Attorney dashboard" tile | Consumers tapped it and bounced back | tile shown to everyone → attorney/defender/admin only | coreSafety Home |
| 10 | Home header es/pt/vi 390px | "Help Now" cut off, Settings gone | header text not shrinkable → flex/minWidth, 2-line subtitle | A1b |
| 11 | Shared: stored user | After a real login, name missing in greetings/alerts ("User"/"Someone" sent to family), attorney/admin screens bounced their own users | login stores `user` in SecureStore/sessionStorage, 12 places read AsyncStorage → all read through secureStorage (AuthGate writes there too) | A3 ("Good to see you, Casey a3") |
| 12 | Contacts screen | "Your name (shown in alerts)" never saved | not persisted → saved; used by SOS / emergency share | A4 |
| 13 | Emergency screen | After adding contacts, SOS still disabled ("no contacts") until restart; countdown could double-send in StrictMode; "Just arrested?" opened Help Now | reload on focus; side-effect-free countdown; → JustArrested | A4 |
| 14 | Emergency share | Message to family in English for es/pt/vi; texted only the first contact while saying "handed to 3 contacts"; dead "Add contacts"/quick exit in the signed-out stack | translated message, all phone contacts in one composer, honest done text; route-aware links | A5 |
| 15 | Crisis lines | Veterans dialed **9881**; Crisis Text Line *dialed* 741741; English names; duplicate Veterans entry; Android `sms:…&body` | dial/sms targets per line, `sms:741741?body=HOME` per platform, names translated, one Veterans entry (988 → 1) | coreSafety Crisis; A6 |
| 16 | Arrest monitor | Paying Legal Pro users always got the upsell; "$14.99/mo" (plan is $34.99); adding a name without a state → "Validation failed"; "ALL" monitors could never match; match push in English | read `subscription.tier/status`; price from server tiers (localized); no state = any (schema + matcher); push from catalogs; DELETE missing/other → 404 | coreSafety ×3; core_safety.int 3; A10 |
| 17 | Quick Connect | "$10 + $10 = $19.99" (charge is $20); with Stripe keys it could never work (no payment method sent → 400; price constant undefined → NaN); credit display read a field that doesn't exist; English labels/receipt | quote endpoint, PaymentIntent → app payment sheet → `/confirm` (verifies user + package + succeeded, books credit/revenue once, retry after a lost connection never re-charges); localized prices/receipt. No keys → still 503 everywhere | quickconnect_payment (5); core_safety.int 4; coreSafety QC ×2; A11 |
| 18 | Offline (web) | Two banners, one in English; Offline-mode screen itself crashed offline with "Loading module …OfflineStatusScreen….js failed" | one translated tappable banner; offline-promised screens bundled eagerly; ErrorBoundary never shows raw errors (chunk error → "needs a connection", reload) | coreSafety shell ×3; A12 |
| 19 | Offline list | Promised the bail calculator offline (it isn't); court dates / emergency share missing | list matches reality | A12 |
| 20 | Offline case queue | A case saved offline whose first sync hit a blip was never sent again; App + Case screen could post it twice; queue never sent on app start | retryable vs final errors, single in-flight run, resume "syncing", sync on start | coreSafety offline ×3 |
| 21 | Just arrested (guest) | "Missed a court date?" lost its guidance after entering browse mode; "Alert family" on web tried `whatsapp://` | pending route keeps params; web → share sheet / copy with toast | corePath test; A7 |
| 22 | Help Now pt/vi 390px | City "Search" button pushed off screen | input `minWidth:0` | A13 |
| 23 | Guest screens | 401 console errors on Crisis / Quick Connect / Arrest monitor | no signed-in-only calls for guests (public tiers for the price) | coreSafety; explore passes clean |
| 24 | Shared analytics | Every event POSTed to `/api/analytics/event` → 404 (endpoint never existed) | fallback POST removed (Mixpanel only when configured) | explore passes |
| 25 | App shell | Lock screen in English | translated | i18n parity |
| 26 | Shared share shim (web) | "Shared" reported when it only copied (or failed) | returns `copiedAction`; screens toast "copied" | A7 |

Shared-code fixes (outside the section's screens): secureStorage user reads in Settings/Lessons/Messages/
AttorneyDashboard/AdminVerification/AuthGate/storage.ts; ErrorBoundary; animation loops in SkeletonLoader /
LawyerSkeletonCard; analytics.ts; webCompat RNShare; AppNavigator eager screens; App.tsx banner + lock screen;
arrest_alerts.js matcher/push; schemas create_monitor.

### Not fixed / for the owner or other sections
- **Legal content to review (not changed):** IL note cites "People v. ACLU of Ill." (no such case — likely
  *ACLU v. Alvarez*, 7th Cir. 2012); the two-party list and the "one-party everywhere else" default are
  unreviewed (e.g. MI participant-recording, NV, OR nuances). Recorder PDF is English-only.
- **Needs a key/device:** SOS texts need TWILIO_* (e-mail needs RESEND); until then the app hands the alert to
  the phone's messages app. iOS multi-recipient `sms:/open?addresses=` and native recorder/voice-note audio
  paths were reviewed in code only. Quick Connect payment sheet needs Stripe keys + a native build (web shows
  "payments not available").
- **Owner/pricing:** Home "Unlock county analytics — Intel tier $19.99/mo" names a tier that doesn't exist
  (legal_radar is $19.99); retention push says "Pro … $14.99/mo … 24/7" (Legal Pro is $34.99, monitors run nightly).
- **Other sections:** Cases — case editor is laid out off-screen at 390px on web; its "Voice note" chip is
  navy-on-dark and opens the voice note *under* the still-open modal; tapping the middle of a case card hits
  "Share link". Billing FamilyConnect still uses the confirm-with-payment_method flow the app never feeds.
  BailSearch / Lawyers / CheckIn endless Animated.loops still default to `isInteraction:true`.
  FloatingSOSButton says "HOLD" but a tap triggers it (confirm dialog follows).

### Gates
- Frontend: `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0 · `npm test` 739/739 (52 suites) +
  render 159/159 (12 suites, new coreSafety 19) · design-audit 0 contrast/hex/a11y/touch · i18n-scan 0 ·
  nav-targets 0 problems · 59 new keys × 4 languages.
- Backend: migrations ×2 clean on fresh jg_dbg · lint 0 · 189 touched/new suites 5867/5867 (incl. new
  core_safety.int 7, quickconnect_payment 5, core_path.int, i18n_core_path.int, openapi drift; 22 legacy
  source-pin tests updated to the fixed code) · openapi regenerated (606 ops) · fresh prod boot →
  smoke-test **40/40**.
- Live browser: new `frontend/scripts/web-journeys-core-safety.cjs` **15/0**; existing web-journeys.cjs (CORE +
  I18N + rest) **37/0**; exploratory sweep 13 screens × 4 languages × 2 widths × guest/signed-in: 0 page
  errors, 0 failed requests, 0 raw keys, no English except provider names (data).
- Servers stopped, jg_dbg dropped.

## B · Sign-up, sign-in & account

Scope: AgeGate, Onboarding, Login, Register, TermsAcceptanceModal, LegalDisclaimer, Settings, PrivacyPolicy,
TermsOfService, AttorneyPrivacy, new ResetPassword; /auth/* (register, login, me, update-profile, refresh, logout,
forgot/reset-password, account delete, export, tos-status/accept-tos, disclaimer), /push/preferences|language|token,
firm trial path (/firm-acquisition/trial). Method: fresh migrated `jg_dbg`, production boot (no e-mail / SMS /
Stripe keys), curl sweep (bad input, wrong user, guest, Accept-Language es/pt/vi), web export driven in headless
Chromium (first launch, guest, signed in; en/es/pt/vi; 390×844 + 1280×900). Screenshots: notes/debug/B/explore/
(exploratory sweep) and notes/debug/B/journeys/. No e-mail verification, 2FA or SSO is exposed in the UI (sso.js
routes exist, no screen uses them) — nothing added.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | All /auth errors | English only in es/pt/vi, plus developer text ("identifier must be a valid email or phone number", "Validation failed"); lockout and rate-limit messages English | hard-coded strings → server catalogs (`auth.*`, `validation.failed`, ×4 languages), `code` on every error, rate-limit messages per request language, `validate()` adds a localized `message`; Register checks the identifier itself (translated) | account_b.int 1; B2, B3 |
| 2 | Forgot password → e-mail link | Link `…/reset-password?token=` opened nothing (no screen, no route) | new ResetPasswordScreen in the ROOT stack (works signed out / browsing / signed in) + `reset-password` link; reset e-mail written in the person's language | B9; account_b.int 4b/4c |
| 3 | Forgot password | "Reset link sent! Check your inbox" while no e-mail provider exists (nothing sent); a phone number → generic "could not send" | 503 `email_unavailable` (same answer for every address — no enumeration) with a support path; app says reset links go by e-mail. Smoke test now accepts both modes (email on/off from /health) | B2; account_b.int 4; smoke |
| 4 | Settings › Delete account | A wrong password **signed the person out** | 401 "Incorrect password" hit the client's auto-logout → 403 `incorrect_password` | account_b.int 3; B8; coreStates |
| 5 | Register / sign-in routing | No bail-agent account type; every role landed on Home | `accountType` consumer / attorney / bail_agent (users.user_type), returned in `user` (also from login/me/refresh, bail agent = type or bondsman profile); app opens Attorney dashboard / Lead dashboard **after** the Terms gate (it first opened under the Terms modal, whose boxes could not be ticked) | B4, B5, B13; account_b.int 2; session.test |
| 6 | Session expiry | Refresh token never stored; after 30 days (or a failed proactive refresh) people were thrown out | refresh token saved; renewal in the last 5 days of the access token + once on 401 `token_expired`, rotated token stored | B10; session.test (tokenExpiry) |
| 7 | Sign out | Server never told (refresh token still valid; push token kept → the previous user's notifications kept coming to the phone); emergency contacts, typed name, arrest info, offline cases/queue, cached court dates, timelines, lesson points… left for the next person; returning users dropped back into the intro slides | `services/session.ts signOut()`: /auth/logout with refresh + push token (server now deletes that device token), all personal keys + offline data removed, device settings kept (language, theme, age check, app lock, state); warns when offline cases are unsynced; next start = Sign in. Terms "Decline", account deletion use the same path | B7, B11; session.test; account_b.int 5 |
| 8 | Signed-out deep links | /login, /register, /terms, /privacy did nothing signed out (only mapped under MoreTab) | per-state linking config (`linkingFor`) | B3, B4, B12 |
| 9 | Settings | Pull-to-refresh never updated (read `r.data.user`); Feedback / Instagram / Website rows did nothing; Golden Gavel "Check eligibility ›" not tappable; guests saw "Sign out" and caused 401s; "Send test notification" on web (always 400); "Push notifications" switch only stored a local flag; "Daily legal tip" switch controls nothing (no such notification exists); "Rate" does nothing on web; firm/attorney tools shown to consumers; export "shared" a giant text (copied on web); still guest view after signing in from it | read the body; links open; row tappable; guest: "Sign in or create an account" + no account calls; test-push/master switch phone-only, master switch registers / removes this device's push token; legal-tip switch removed; Rate hidden on web; pro tools for professionals; export = JSON file (download / share sheet); account state re-read on focus | B6, B8, B13; coreStates section B |
| 10 | Notification switches (server) | Turning off Arrest alerts / Check-in reminders changed nothing | monitor-match push and check-in reminder now filter on them | account_b.int 6 (fails without the fix) |
| 11 | Language | Signing up didn't save the language; signing in on a new device ignored the profile language | register stores Accept-Language as preferred_language; sign-in adopts it unless a language was picked on this device | B3; account_b.int 2; session.test |
| 12 | Onboarding | "Next" never advanced on web (labels/dots stuck); es/pt/vi 390 px: facts row clipped both sides, slide text cut off | index from scroll + Next; equal-width wrapping columns; slide scrolls | B1, B1b |
| 13 | Register | Attorney fields dark-on-dark; Terms link left the app; in-app Register stayed on the form after success | styled inputs; in-app Terms; goes back | B12 screenshot; code |
| 14 | Age gate / app lock / legal pages | Year placeholder "e.g. 1990", lock "Use Passcode" in English; Privacy/ToS effective date "May 1, 2026" in every language; LegalDisclaimer swallowed API errors and did nothing when opened from a link | catalog strings; locale dates; guests continue, signed-in errors shown | B1; explore screenshots |
| 15 | App lock (native) | Only asked at cold start; never after returning from the background | re-lock after 60 s away, as a modal **over** the app (navigation kept) | code review (native only) |

Shared-code changes: services/api.ts (refresh), services/session.ts (new, sign-in/out), services/auth.ts (guest
start route), services/push.ts (currentPushToken / unregisterPush), offlineSync(.web).ts (clearOfflineData),
linking.ts + App.tsx (root ResetPassword, per-state linking, lock modal, role home after Terms), validation/schemas.js
(localized `message` on every 400), services/email.js (localized reset e-mail), services/arrest_alerts.js,
routes/checkins.js. Legacy source-pin tests updated to the new structure (brutal_trials v12/14/17/20/45/54/174/181/192,
nav_scan, auth.int); smoke-test reset check made e-mail-aware.

### Not fixed / for the owner or other sections
- **Legal content (not changed):** ToS screen says effective **May 25, 2026**, the Terms modal says **May 1, 2026**.
  Onboarding had a footer (invisible — clipped inside the 54 px logo box) "Public Defender Project: 1-800-341-0059 ·
  ACLU: 1-212-549-2500"; no source for the first number → footer removed, not re-added. Privacy Policy shows
  "✓ GDPR ✓ CCPA ✓ Apple ✓ Google Play" compliance badges with no source.
- **Needs keys/features:** reset e-mails need RESEND_API_KEY (flow proven with a DB-inserted token); phone-only
  accounts cannot reset at all (no SMS reset) — the app points them to support@justicegavel.app.
- **Native-only, code-reviewed:** biometric re-lock, push token register/unregister, SecureStore, share-sheet export.
- **By design:** web session is sessionStorage — survives reload, not a new tab / browser restart.
- **Other sections:** firm-acquisition server messages are English; check-in reminder push text is English;
  Terms modal: tapping the middle of the first checkbox row in es hits the "Términos de servicio" link instead of
  ticking (box itself works).

### Gates
- Frontend: `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0 · `npm test` 749/749 (53 suites, new
  session.test 10) + render 161/161 (12 suites; coreStates +2) · design-audit 0 · nav-targets 0 problems ·
  24 new keys × 4 languages, 4 dead keys removed.
- Backend: migrations ×2 clean on fresh jg_dbg (2046 lawyers / 1262 bail agents untouched) · lint 0 · 162 touched /
  pinning suites 4867/4867 (incl. new account_b.int 8, openapi drift/spec) · fresh prod boot → smoke **40/40**.
- Live browser: new `frontend/scripts/web-journeys-account.cjs` **15/0** (needs JWT_SECRET of the server for B10);
  web-journeys-core-safety.cjs **15/0**; web-journeys.cjs **37/0** (with an Anthropic mock on 4399); exploratory
  sweep 10+ screens × 4 languages × 2 widths: 0 page errors, 0 raw keys, 0 English lines in es/pt/vi, only failed
  request = the deliberate wrong-password login.
- Servers stopped, jg_dbg dropped.

## C · Lawyers, bail & firms

Scope: Lawyers, LawyerProfile, SavedLawyers, Search, Match, BailSearch, BailCalculator, FirmDiscovery,
FirmPublicProfile, FirmVertical, GoldenGavel, Booking, VideoConsultation, PILead (RecoveryAgents is still
unregistered on purpose, item 5.5, and was not touched). Routes: /providers/* (lawyers, bail, :id, nearest-city,
coverage), /reviews/*, /saved/*, /match/*, /consultations/*, /video/*, /billing/pi-lead/*, /search, /firms/*,
/golden-gavel/*, /bail/*, /admin/reviews. Method: fresh migrated `jg_dbg` with the real 2,046 lawyers and 1,262 bail
agents (read only; md5 of both tables identical before and after every suite and journey), production boot (no
Stripe / Daily / e-mail keys), curl sweep (bad input, wrong user, guest, es/pt/vi), web export driven in headless
Chromium in America/Chicago, with and without location permission. Screenshots are in notes/debug/C/journeys/,
notes/debug/C/sweep/, notes/debug/C/sweep-nogeo/ and notes/debug/C/sweep-guest/.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | Lawyers / Bail / Match / Saved / Firm cards | No Call / Text / Directions / Website on Lawyers cards; elsewhere raw E.164 numbers ("+16152074174") and hand-built links | new `utils/contact.ts` + `ContactActions` everywhere: (615) 207-4174, `tel:+1…`, `sms:+1…`, Apple Maps on iOS and Google https elsewhere, http(s)-only websites; "No phone number listed" instead of a dead button | providerScreens (cards, no-phone); journeys C1, C5, C7 |
| 2 | Lawyers (distance) | Nearest-first order destroyed: the client re-sorted by rating | sort kept on the server: 5 km distance bucket → charge match → listing completeness → distance (never paid / badge flags) | providerScreens "SERVER order"; directory_c C1; C1 |
| 3 | Lawyers / Bail paging | "Load more" read the wrong shape (never loaded page 2); Bail stopped at 20 | array body + `X-Total-Count` (CORS-exposed), infinite scroll, "N found · end of the list" footer | providerScreens page 2; directory_c C2; C1, C7 scroll to the end |
| 4 | Lawyers search | Only a fixed 19-city picker; no ZIP / state / name search; Brooklyn etc. not found | `services/providerDirectory.js`: one `q` for ZIP (centroid), "City, ST", state, address city, name; radius steps 50→∞ km to fill a page | directory_c C1; C2 |
| 5 | Location denied | Silently showed results "near you" from a fake Nashville point | says location is off; uses the person's state or the whole directory and the search box | providerScreens; C2; GEO=0 sweep |
| 6 | Filters | Filters silently dropped at large radius; case type could not match the real data; "Available now", "Verified" always empty; "Low rate" sort had no data | strict server filters (criminal specialty + charge ranking, keyword match for other types, language, `open24` from stored hours, `paymentPlans`); fake filters and sort removed; an empty filtered result names the filters and offers "Clear" | directory_c C3; providerScreens; C3 (es), C7 (pt) |
| 7 | Lawyer profile | Stray "000" (a crash on native), `["English"]`, internal columns (email, user_id…) in the payload, action bar over the content, review count based only on the 5 loaded reviews, English weekdays | new `/providers/lawyers/:id` and `/bail/:id` with a public shape (booleans, arrays); localized hours; plural-aware counts; `!!` conditions | directory_c C4; C5 (15 profiles in vi incl. no phone / website / hours) |
| 8 | Save / unsave | No saved state on the profile; a pending save ran once per card; Saved asked to confirm twice; DELETE silently "removed" other users' rows; guests got a 401 | saved state from /saved/lawyers on focus (list ↔ profile ↔ Saved in sync); a ref-guarded toggle; one confirm; 404 for another user's row; snapshot always taken from the listing; guest → sign in with the save kept | providerScreens save; saved_reviews.int; C4 |
| 9 | Reviews | No moderation; reviews for listings that do not exist; English errors; legacy `/providers/:id/reviews` returned 500 | 201 / 404 / self-review blocked / 409 one per person (also on the unique-index race); comments with contact details or links stored as `pending`; report with a reason (one per person, 3 reporters → held); `GET/POST /api/admin/reviews` to publish or hide; summary counts published reviews only; migration 024 (status, moderation columns, `review_reports`) | directory_c C5; C6 |
| 10 | Booking prices | Showed $9.99 / $14.99 / $24.99 while $10 / $15 / $25 was charged; refund copy said 24 h, code used 2 h | prices, refund window and slots all come from the server (`GET /consultations/pricing`, `/slots/:id`) | directoryFlows Booking; C8 |
| 11 | Booking time zones | Fake availability (a seed formula); dates and labels built from the server's UTC clock in English; no zone stored; reminder and refund timing used UTC | `services/consultationSlots.js`: slots in the lawyer's zone (from the state) with an exact `starts_at`; `starts_at` and `time_zone` stored; the phone shows its own zone and names it, plus "That is 9:00 AM EDT for the lawyer" when the zones differ; reminder and refund use `starts_at` | directory_c C6; directoryFlows; C8 (TX 9:00 AM → 9:00 AM CDT; NY 9:00 AM → 8:00 AM CDT + note) |
| 12 | Booking flow | Booking confirmed before payment; lawyers not on the app could be booked and paid with nobody notified; meeting links made up; callback requests read by nobody | `pending_payment` → PaymentIntent → `POST /:id/confirm` verifies, confirms and notifies the attorney; lawyers without a linked account → "call or text the office" with the phone; no invented links; callbacks only for lawyers on the app, pushed to their account | directory_c C6 (fake Stripe); billing_consultations.int; C8 |
| 13 | Payments off | — (verified) | Booking → 503 `payments_unavailable` with a localized message, nothing stored; works automatically once keys are set (C6 runs the paid path with a fake Stripe client) | directory_c C6; directoryFlows; C8 (0 rows) |
| 14 | AI match | Never showed results (the job envelope was read as a list); used the national top three instead of nearby; results had no id / location; job not tied to the user; English reports; "Message securely, end-to-end encrypted" (false); dead callback modal; typed text invisible | job polled; candidates from `searchDirectory` near the person or a typed place; quality-only scoring; job enqueued with the user id; reports keyed by listing id in the request language; false claim and dead modal removed | directory_c C7; directoryFlows Match; C9 |
| 15 | Search | English subtitles; guests got 401; lawyer results opened the Saved list | localized; sign-in prompt for guests; results open the profile | directoryFlows guests; C11 |
| 16 | Bail calculator | `POST /bail/calculate` used invented multipliers / percentages | endpoint removed (404); the screen uses the recorded schedule with its sources and "agents set their own fees"; smoke and verify-deployment check the schedule and the 404 | directory_c C10; bail_legaldata_expungement.int; smoke |
| 17 | Video consultation | English 503; any signed-in user could open or end anyone's room (IDOR); a matter title leaked | localized 503 `video_unavailable` / 403 `upgrade_required`; owner check on GET / DELETE; the caller must own a linked matter; DELETE sets `ended_at`; "end-to-end encrypted" copy → "encrypted in transit"; privilege claim → "join from a private place" | directory_c C8; C12 (es) |
| 18 | PI lead | Fee always $200 (employment is $100); no state / city collected; privacy copy did not match the behaviour | public `GET /billing/pi-lead/fees` (PI / civil rights $200, employment $100, ICE $75, bail-agent lead $100 flat, matching code and lead_fee_consistency); type, ≥20-character description and state validated; city accepted; honest privacy copy; no consumer contact details before a purchase | directory_c C9; lead_fee_consistency; directoryFlows PILead; C10 (es) |
| 19 | Firms | `page=abc` → 500; count did not match the filters; light-blue page (`colors.primary` as background); inputs overflowed; "Find attorneys" button went to an unrelated list; English errors | parsing fixed; themed background; overflow fixed; misleading button removed; localized errors | directory_c C10; C12 |
| 20 | Golden Gavel | Stray "0"s; English missing-criteria text; guests fired 2 × 401 (status, eligibility) on every focus | `!!` conditions; `gavel.missing.*` in the request language; guests load only the public hall | directory_c C10; directoryFlows guest; C11, C12 |
| 21 | Booking (guest) | 401 `/consultations/prefill` on every open | prefill only when signed in | directoryFlows guest; C11 |
| 22 | Handoff: Lawyers / Bail animations | Skeleton shimmer loops held InteractionManager, blocking deferred loading | `isInteraction: false`, stopped on unmount | providerScreens (both screens) |
| 23 | Deep links | PILead and VideoConsultation unreachable by link | `case-review`, `video-consult` in linking.ts | check-nav-targets; C10, C12 |
| 24 | Bail search (offline) | — | cached results shown with a "last saved results" label | C13 |

Shared-code changes: services/api.ts (`ApiResponse<T>` with headers), app.js (CORS `exposedHeaders`),
navigation/linking.ts, utils/icsExport.ts (`buildEventIcs` / `saveIcs`), constants/leadFee.ts (attorney fee table),
services/email.js (no null meeting link or cancel URL), services/scheduler.js (reminder from `starts_at`, zone
labelled), services/accountDeletion.js (`review_reports`, `reviews.moderated_by`), validation/schemas.js, openapi.json
regenerated (609 operations). Translations: 88 new frontend keys × 4 languages, 4 existing copy fixes (above), 108
dead keys from the rewritten screens removed (5,025 keys in each catalog); about 113 backend catalog keys × 4. About 30
legacy source-pin tests (brutal_trials v10/12/17/28/40/41/52/54/55/57/58/61/71/73/83/84/86/170/187, public_routes,
review_followups.int and others) were rewritten to pin the new behaviour.

### Not fixed / for the owner or other sections
- **Legal content (not changed):** bail schedule sources are vague labels ("NIJ_Vera_state_court_data",
  "state_criminal_code_public", "public_court_schedule") with no URL and no review date. `/bail/immigration`
  "redetermination within 10 days" has no source (the app does not use it). The old Lawyers Pro banner ("verified
  credentials, response time…") was not brought back: nothing verifies credentials.
- **Data (read only, not edited):** some `available_24_7` flags contradict the stored hours; the display and the
  24/7 filter use the hours. The coverage endpoint's state list comes from the seed and may be stale.
- **Needs keys:** video needs DAILY_API_KEY (the attorney never gets a Daily token; untested). The paid booking
  path is proven only with a fake Stripe client. Booking e-mails (RESEND) and the reminder push text are English only.
- **Not used by the app:** `pi_leads.js /submit` legacy schema mismatch.
- **Other sections / coordinator:** the CheckIn shimmer loop belongs to D. Two backend tests are flaky and
  not caused by this work: `duplicates_bounds_ai.int` "a failed request releases its key" (about 1 run in 3) and
  `realworld_simulation` "switches to Spanish" (a `< 5 ms` timing assertion; failed once under the full parallel
  run, 52/52 alone).

### Gates
- Frontend: `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0 · `npm test` 749/749 (53 suites) + render
  180/180 (13 suites; providerScreens 17, directoryFlows 10 new, coreStates 13) · design-audit 0 contrast / hex /
  a11y / touch (17 touch targets and 11 dark-contrast sites from the new screens were fixed) · nav-targets 0
  problems · expo web export OK.
- Backend: migrations ×2 clean on fresh jg_dbg (2,046 / 1,262, table md5 unchanged) · lint 0 · 150 touched /
  pinning suites 4535/4536 (the one miss is the timing flake above, which passes alone) incl. new
  directory_c.int 11/11 · fresh production boot → smoke **40/40**.
- Live browser on the final build: new `frontend/scripts/web-journeys-directory.cjs` **15/0** (C1–C13 + page
  errors + failed requests; green on 4 consecutive runs) · web-journeys-core-safety.cjs **15/0** ·
  web-journeys-account.cjs **15/0** (JWT_SECRET = the server's value, without the `JWT_SECRET=` prefix) ·
  web-journeys.cjs **37/0** (streaming Anthropic mock on 4399) · exploratory sweep 12 screens × 4 languages × 390 /
  1280 × guest / signed in = 192 pages, plus 48 with location off and 32 guest re-checks: 0 page errors, 0 raw keys,
  0 English lines in es/pt/vi, 0 horizontal overflow, 0 failed requests after the guest fixes.
- Servers stopped by PID, jg_dbg dropped. Nothing committed.

## D · Cases & court

Scope: Cases, CaseTimeline, CourtDates, CourtDateDetail, CourtLocator, CourtForms, DeadlineCalculator, Discovery,
DocumentScanner (+ .web), CheckIn, CheckInManager, Contacts, FamilyConnect, Messages, Matter, MatterIntelligence.
Routes: cases, caseLifecycle, caseCounsel, courtDates, courthouses, docket, discovery, checkins, family,
following, messages, matters, matter_intelligence, privilege, pretrial, and attachments (local + Supabase).
Reused from A–C: stored-user helper, `session.ts` signOut, the A animation fix, the Quick Connect payment pattern,
translated server errors and `utils/timezone.js`. Run on a fresh jg_dbg (migrations ×2; 2,046 lawyers / 1,262 bail
agents, read only), a production boot on 4300, the web export on 8300 and the Anthropic mock on 4399, with Chromium
in America/Chicago (D3 in Asia/Tokyo, D5 in America/Los_Angeles). Screenshots: notes/debug/D/journeys/,
notes/debug/D/explore-final/ (final sweep), notes/debug/D/explore*/ (before the fixes). Note: the coordinator's
WIP commit 90767f5 holds part of this work; everything after it is uncommitted.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | Handoff A→D: case editor | At 390 px the editor modal was off-screen, and "Voice note" opened under the still-open modal | CaseScreen rewritten: a themed sheet inside the viewport; Voice note only for a saved case, and it closes the editor first | D1 (all fields inside 390 px, voice note on top); A9 moved to the new entry point |
| 2 | Cases tabs / card | The Messages tab showed the case list; Tools stacked under the cases; a tap on the middle of a card hit a random action | Real tabs: Messages = threads with unread counts (new `GET /messages/threads`), Tools = tools only; the card is a View with labelled buttons | casesCourt render 3; D2 |
| 3 | Case editor | State dropped on save; impossible dates (2027-02-30) sent to the server; a bad event date gave a 500; no delete | State saved; `validCourtDate` in the app; `safeCourtDate` on the server → 400; "Delete case" with a confirm | casesCourt render 2; cases_court_d D3; D1 |
| 4 | Case delete | A deleted case was still reachable through its share link, family follows, messages and attachments | `ownedCase()` and `deleted_at IS NULL` on every case route. Delete clears the share token, revokes follows, cancels reminders and writes an audit row. The fake `share_url` is removed | cases_court_d D3 |
| 5 | Offline case | A case saved offline lost its court date and state, and on web the queue was never sent | The payload keeps both. Cases sends the queue whenever the server answers (on web NetInfo never reports a request blip) | casesCourt render 2; D8 |
| 6 | Push taps | Court, check-in, follower and message pushes opened nothing or the wrong screen; App.tsx and useAppSetup each had a tap handler | New `services/notificationRoute.ts`: `data.screen` checked against the linking config, then the type. A court reminder opens its hearing, a check-in its enrollment, a message its thread. One handler, run only when navigation is ready | casesCourt render 1; brutal_trials v178/182/185 |
| 7 | Reminder scheduler | Court reminders across zones and DST were unverified, and the push text was English | 7d / 3d / 1d / morning-of verified for 6 zones including a DST change. Push and e-mail go out in the user's language. A date added late plans only the reminders still ahead | cases_court_d D1 |
| 8 | .ics / calendar day | Timed .ics events used the phone's zone, so the hearing moved for people elsewhere; the alarm text was English | The court's zone (courthouse state → case state → user) with `TZID`; localized alarms. The same calendar day shows in list and detail from Asia/Tokyo | cases_court_d D2; D3 |
| 9 | Court date detail | No way to move a hearing | "Change date or time" (PATCH); the reminders are re-planned | D3 |
| 10 | Court dates (family) | A follower could not stop following; the list ignored the case it was opened from | "Stop following" (`DELETE /following/:id`); `caseId` filter with "Show all". Followers see dates, never notes | D4 |
| 11 | Handoffs A/C→D, B→D/H: CheckIn | An endless `Animated.loop` blocked deferred loading. Without the link the defendant found nothing. "Today" was the server's UTC day. The screen said the agent was notified when no push went out. The reminder push was English only | Rewritten with no loop. `GET /checkins/mine` links enrollments by account e-mail / phone. Day, streak and next due are in the defendant's zone (`services/checkinReminders.js`). "Notified" shows only when `agent_notified`. Location is sent only when the person turns it on. Reminders at 10:00 / 18:00 local in the person's language; dropped once checked in; skipped when the setting is off | cases_court_d D4; casesCourt render 4; D5 |
| 12 | Check-in enrollment | Any account could enroll anyone. No e-mail field. A fake Stripe subscription id made $9.99 look billed. The same day could be checked in twice. remind-all pushed English to everyone | Enrolling is for bail agents / staff only (403). Phone or e-mail required. The link and share text are returned, and `billing_active: false` is said honestly. One check-in per local day (advisory lock → 409). remind-all only plans missing reminders. `GET /checkins/status` (no id) and `/family-contacts` (no caller) removed | cases_court_d D4; security/h1h2_checkins; D5 |
| 13 | CheckInManager | No e-mail field; raw frequency values; no link to send; history in UTC days; no stop / restart; broken form for non-agents | Rewritten: e-mail, labels, share link, local-day history with 30-day compliance, stop / restart, and a notice for non-agents | D5, D9 |
| 14 | Handoff A→D: FamilyConnect | A "demo" mode returned contacts with `pi_mock_family`. The receipt read "$28.99.00". Typed text was invisible. The copy said "verified" and "they are expecting your call" | Quick Connect pattern: `GET /billing/family/quote` → `POST /family/connect` (PaymentIntent; 3 lawyers + 2 agents from the directory) → sheet → `POST /family/confirm` (verified once, revenue booked once). The price comes from the server. Without keys: 503 `payments_unavailable` + friendly message. With keys it works unchanged (proved with a fake Stripe client). Honest copy | cases_court_d D6; D7; brutal_trials v57/v171 |
| 15 | Discovery | Without Stripe a "paid" analysis ran free while a $19.99 charge was recorded. The upload passed a base64 string and crashed. The job was never polled | Case-intake scan is free (a job, nothing stored). A paid analysis is 503 without keys. With keys: 402 + client_secret, then a re-POST with the PaymentIntent, verified (user, package, file hash, succeeded, unused). The file object is passed; case ownership checked; the screen polls the job | brutal_trials v174; API sweep |
| 16 | Messages | Unstable order within one second. Unread counts missed counsel cases. Deleting another user's message got 403, which confirmed the id. English errors. No counsel controls; attachments could not be opened | `ORDER BY sent_at DESC, id DESC`. Unread includes counsel cases. Only the sender may delete; others get 404. Translated errors and pushes. A counsel bar (invite a saved lawyer, remove); tap downloads an attachment; long-press deletes your own message; 📎 opens Documents | cases_court_d D5; messages.int; D6 |
| 17 | Attachments / docket | A case document stayed downloadable after its message or case was deleted. Docket upload ran without Supabase and took any type or an empty file | Download needs case access and a live message (404 otherwise). Docket: 503 without Supabase, type allowlist, empty check, matter ownership, firm context on download-url | cases_court_d D3/D5; messages_bulk_attachment; D6 (11 MB refused, stranger 404, counsel 200) |
| 18 | Documents (web, native) | Web claimed "extracting text", had no case picker and no document list. Native had a dead `onCapture` param and was stuck when the camera was denied | Case picker; 10 MB / type limits before upload; the case's documents; "Open thread". Native: "Choose a file" (expo-document-picker) when the camera is denied; Settings when the OS will not ask again | D6; brutal_trials v13/v63 |
| 19 | Case timeline | Event dates shifted one day west of UTC. Fetch errors were hidden. It loaded twice per open, and the mounted guard never reset | `formatEventDate` via dateUtils (no UTC shift); errors shown; one load on focus; the guard fixed | casesCourt render 6; sweep (one request per visit) |
| 20 | Court locator / courthouses | Defaulted to Nashville; "City, ST" found nothing; invented federal hours were shown; guests got 401 | Public `GET /courthouses`: q also searches city, parses "City, ST", sorted, translated errors. The screen starts from the person's state; the invented hours are removed | public_routes; API sweep |
| 21 | Deadline calculator | The federal habeas (AEDPA) year used a state table (10 years for Maryland); judgment-based rules demanded an arrest date; no weekend warning | AEDPA is a fixed one year (28 U.S.C. § 2244(d)). Judgment-based rules need only the judgment date. A weekend / holiday caution. Unsourced state tables flagged below, not changed | casesCourt render 5 |
| 22 | Court forms | The AI guide never showed (the job was not polled); guests got a raw 401 | Polls the job; a sign-in message for guests | API sweep; sweep |
| 23 | Matter Intelligence / Matter | Opened without a matter it was a dead end. Tab labels were English. `/:id/analytics` returned a made-up risk score for any matter id (IDOR) | Matter picker (`GET /matters`); translated tabs; analytics checks access and returns real counts only | cases_court_d D7 |
| 24 | Case lifecycle | Close wrote lowercase "closed", so court reminders kept firing. Next steps assumed a state, a charge and a waiting period | "Closed" + history + reminders cancelled; unknown values stay null | API sweep |
| 25 | Emergency contacts | "Remove" deleted the slot, so the other contacts shifted | The slot is emptied in place | API sweep |
| 26 | Family / following routes | Unvalidated input; English errors; a non-numeric id gave a 500; `SELECT *` | Validated, translated, 404, explicit columns | cases_court_d D3/D4 |
| 27 | Signed out | Cases showed "No cases yet / Create first case", which ended in "Authentication required.". Timeline, court date and Documents showed the raw "Authentication required." with a "Try again" that could never work. Every visit fired 401s | New `components/SignInNeeded` (+ `useHasSession`): Cases, its Messages and Saved-lawyers tabs, timeline, court date and Documents say what the screen is for and offer Sign in (the AuthGate sheet). Nothing is requested while signed out; Discovery skips its status call | casesCourt render 7; D10 (en, es; 8 pages, 0 failing requests) |
| 28 | Someone else's case link | The timeline said "case not found" but still offered "Add event". Messages said "No messages yet — start the conversation below" with a composer, and kept polling the 404 | `useCaseMessages` returns `unavailable` on 403 / 404 and stops polling. Messages and the timeline say "This case is not available" with no composer and no Add event | D11 (en, vi) |
| 29 | Contrast / touch | The unread pill was white on #EF5350 in dark mode (3.5:1). Counsel buttons were 40 pt. "Choose a file" over the camera was 3.95:1 | Pill text uses `emergencyBg` (≥ 4.9:1 in both themes); buttons are 44 pt; a darker scrim | design-audit 0 / 0 / 0 |

Shared-code changes: `billing/_shared.js` `stripeClient()` (a key set after boot is picked up); `services/ics.js`
(localized alarms); `services/reminderDispatcher.js` (check-in reminders; the preference is enforced at send time);
`attorney/inbox.js` (localized accept push); `hooks/useAppSetup.ts` + `App.tsx` (one push-tap handler);
`hooks/useCaseMessages.ts` (`unavailable`); `navigation/linking.ts` (emergency-contacts, matter-intelligence,
matters/:id); `utils/dateUtils.ts` (`validCourtDate`). New: `services/notificationRoute.ts`, `services/attachments.ts`,
`components/CaseDocuments.tsx`, `components/SignInNeeded.tsx`. `openapi.json` regenerated (611 operations: added
/messages/threads, /checkins/mine, /billing/family/quote and /billing/family/confirm; removed /checkins/status
and /checkins/family-contacts). Translations: 170 new frontend keys × 4 languages; 100 dead keys removed (89 from the
rewritten screens + 11 false family claims); 5,095 keys in each catalog; 123 backend catalog keys × 4. Legacy
source-pin tests were rewritten to pin the new behaviour:
- brutal_trials v11/13/16/17/25/30/33/35/45/51/52/54/56/57/58/59/60/61/63/85/99/159/171/174/178/182/185/192
- public_routes (3 public routes with reasons)
- quickconnect_payment (mock: `optionalAuth`, `stripeClient`)
- messages_bulk_attachment (fake DB)
- account_b.int (the check-in preference lives in the dispatcher)
- messages.int (stranger delete → 404)
- security/h1h2_checkins (the bondsman is a bail-agent account; enroll → 201; remind-all → `{planned}`)

### Not fixed / for the owner or other sections
- **Legal content (flagged, not changed):**
  - The deadline calculator's state tables (DMV / DUI days, arraignment hours, speedy-trial days) have no source.
  - The AEDPA note says "final conviction". The statute runs from the date the judgment became final, so a lawyer should word it.
  - Courthouse rows have no `source_url`.
  - The court-forms registry URLs are not verified.
  - Matter-intelligence "signals" are unsourced English heuristics.
  - The case-lifecycle retention next-steps copy is unsourced.
- **Billing (owner):** check-in monitoring shows $9.99 per defendant per month, but no Stripe product exists, so nothing is charged. The screen and API say so (`billing_active: false`).
- **Identity (owner / product):**
  - Enrollments link to the account whose e-mail or phone matches, and neither is verified at sign-up. Someone who registers first with the defendant's contact could claim the enrollment (the agent sees who is linked).
  - This is the existing audit11 H2 design; fixing it needs a verification step.
- **Other sections:**
  - Bulk direct messages to attorneys are stored, but no screen shows them (attorney section).
  - 12 legacy source pins fail on section C's screens, which D did not touch (`git diff 4bc7934` is empty for BailSearch / LawyerProfile / Match / Booking / Lawyers):
    - brutal_trials v14 6-03/6-05 and v16 1-02/1-03/1-04/12-03/12-04
    - v44 S6e-01, v53 HAP-01, v139 SCR3-02, v159 FALLBACK-02 and v165 F2-03
  - The known `duplicates_bounds_ai.int` flake failed once in the parallel run and passes alone.
- **Device / keys:**
  - Native-only paths (camera, document picker, share sheet, expo-file-system writes, push delivery) were reviewed in code only.
  - SMS and e-mail fallbacks need Twilio / Resend keys.
  - The paid Discovery and Family paths are proven only with a fake Stripe client.

### Gates
- **Frontend:**
  - `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0
  - `npm test`: 749/749 (53 suites) + render 191/191 (14 suites, incl. the new casesCourt 11)
  - i18n-scan 0 · design-audit 0 contrast / hex / a11y / touch · nav-targets 0 problems · expo web export OK
- **Backend:**
  - Migrations ×2 clean on a fresh jg_dbg · lint 0 · openapi drift + spec 17/17
  - The 219 touched / pinning suites + quickconnect_payment: 7,364/7,377. The 13 misses are the 12 section-C pins and the 1 known flake above; the flake passes alone.
  - New cases_court_d.int: 14/14
  - Fresh production boot → smoke **40/40**
- **Live browser on the final build:**
  - New `frontend/scripts/web-journeys-cases.cjs`: **13/0** (D1–D11 + page errors + failed requests)
  - web-journeys-core-safety **15/0** (A9 moved to Edit → Voice note) · web-journeys-account **15/0** · web-journeys-directory **15/0** · web-journeys.cjs **37/0**
  - Exploratory sweep: 14 screens × 4 languages × 390 / 1280 × signed in / guest / bail agent = 336 pages. Results: 0 page errors, 0 raw keys, 0 English in es/pt/vi, 0 horizontal overflow. The only failed requests are the deliberate 404s when the agent opens another person's case, which now show "not available".
- Servers stopped by PID and jg_dbg dropped. Nothing committed by this section.

## E · AI, research & learning

Scope: Chat, Translator, LegalResearch, MotionLibrary, LegalPenalties (+ DUI laws), Resources, Lessons,
BarPrepHome / Quiz / Results / Progress / Schedule / Explanation, Advocacy. Routes: chat (ask, stream, history),
translate, transcribe, research, legaldata, motions, resources, lessons, barPrep, advocacy, impact, jobs (+ the
in-process AI queue and `jobPoller`), the Anthropic client / config, AI rate limits and idempotency keys.
Reused from A–D: stored-user helper, `session.ts` signOut, `components/SignInNeeded.tsx`, the A animation fix,
translated server errors. Run on a fresh jg_dbg (migrations ×2; 2,046 lawyers / 1,262 bail agents, read only), a
production boot on 4300, the web export on 8300 and a scriptable Anthropic mock on 4399 (ok / slow / long / 429 /
500 / 529 / 401 / dropped stream / error event / hang), Chromium in America/Chicago (E15 in Asia/Tokyo).
Model check against the current Anthropic docs: `claude-sonnet-4-6` is active and stays the default; Claude 4.7+
models reject `temperature` / `top_p` / `top_k` (400), so no call sends them any more. Screenshots:
notes/debug/E/journeys/, notes/debug/E/explore-final/ (final sweep), notes/debug/E/explore-*/ (before the fixes),
notes/debug/E/regress/ (A–D journeys on the final build). Nothing committed by this section.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | Chat streaming | The answer arrived all at once after a long wait; on web the stream path was effectively unused | New `services/chatStream.ts`: web reads `/chat/stream` SSE with `fetch` + a reader (tokens batched every 60 ms so long answers don't freeze), native / no-stream falls back to `/chat/ask` + job polling | E1, E7 (3,000 words, worst frame wait 18 ms); aiLearning.test |
| 2 | Chat Stop | No way to stop; leaving the screen kept the model call running | Stop button (`chat-stop`) aborts the request. Shared bug: `utils/http.js` removed the caller's abort listener for streams, so an abort never reached Anthropic — fixed. The server saves the part already shown with status `stopped` | E2; render homeChat |
| 3 | Chat network drop / retry | A dropped connection showed "Sorry, I had trouble responding" and a resend asked (and billed) twice and stored the question twice | Every question carries a `clientMessageId`. "Try again" re-sends the same id: a finished answer is replayed (no model call), a partial one is replaced. Migration 25: `chat_sessions.client_msg_id` / `status` + index | E3, E3b; ai_learning_e.int |
| 4 | Chat errors | 429 / 500 / 529 / 401 / no key / an `error` SSE event left a spinner or English upstream text ("Anthropic API error: 529") | Coded errors (`ai_unavailable` / `ai_busy` / `ai_timeout` / `ai_failed`) worded by the server in the request language; jobs store the code and `/api/jobs` words it; upstream text only in the log. `legalAccuracy` middleware no longer appended an English disclaimer to error messages (shared) | E4 (each ≈2 s, no hang); chat_jobs.int; ai_learning_e.int |
| 5 | Chat free limit | The limit counted UTC days and the 402 was English; defender mode was available to anyone who sent `mode: defender` | 3 questions per local day (X-Timezone), localized 402 with the reset time, replays still allowed; defender prompt only for attorney / defender / admin roles | E8; ai_learning_e.int |
| 6 | Chat language / grounding | Spanish questions got English answers and an English legal footer the model was told to append | The prompt names the answer language; the footer instruction is removed (the app shows the legal notice under every answer); "laws vary by state", "never guess at a law, deadline, fee or penalty", talk to a lawyer / public defender, 988 and DV hotline lines kept; rights-card references (heading + source) localized | E1; brutal_trials v7/v8/v18/v86 |
| 7 | Chat markdown | Answers showed raw `**`, `#`, `-` | `components/MarkdownText.tsx`: headings, lists, bold / italic / code, http(s) links only, rendered as `<Text>`; HTML stays literal text | E5; render homeChat; aiLearning.test |
| 8 | Crisis / DV detection | Spanish, Portuguese and Vietnamese crisis words were missed; "spend it all" matched "end it all"; "abuso" fired on ordinary legal questions | `utils/crisisDetect.ts`: accent-insensitive whole-word match over every language's list, whatever the app language; DV words reworded ("me abusa", "sofro abuso"). The crisis card (call + all lines) comes first, also offline | E6 (4 languages); render homeChat; aiLearning.test |
| 9 | Chat guest / history | Guests got raw 401s; a question typed while history was loading was wiped when it arrived | SignInNeeded card with the crisis lines for guests; the first history load keeps anything sent meanwhile; stopped answers come back labelled | E8; render homeChat |
| 10 | Interpreter | The guest's messages failed (no session token), a failed translation showed the original as if translated, the send button stuck after an error, duplicates on poll | Session token header (`X-Translate-Token`), merge by id, `sending` reset in `finally`, untranslated messages stored with `translated = NULL` + `translation_error` and labelled "not translated"; localized errors; same-language sessions refused | E9; ai_learning_e.int |
| 11 | Legal research access | The paywall showed a made-up "Westlaw $100–500/mo" comparison and a "Subscribe" that called an unpaid `/research/subscribe`; status errors opened the paid screen (fail-open) | Access = attorney role or an active plan that includes research (`canAccessFeature`); `/status` returns the real plans and the paywall lists them → ConsumerSubscription; `/subscribe` removed; errors show an error state | E10; brutal_trials v27/v40/v41 |
| 12 | Legal research data | Any account could delete another's session; a failed first question left an empty session in history; answers ignored the app language | DELETE / GET scoped to the owner (404 otherwise), messages saved only on success, history lists sessions with messages, language + case context sent, `/rag` gated like `/ask` | E10; ai_learning_e.int |
| 13 | Motion library | A "$9.99 per motion" price that is never charged; drafts saved to a table history / PDF did not read, so they vanished; a fake demo motion without a key; a duplicate POST /review | Price copy removed; drafts go to `motion_history`; the demo branch is removed (`requireAi` refuses); one review route with validation; status PATCH 404 for strangers; layout gaps fixed | E11; ai_learning_e.int; brutal_trials v8/v72/v73 |
| 14 | Penalties / DUI laws | The screen showed hard-coded, unsourced penalty text; "DUI Laws" opened the drug tab; guests got 401 | Reads `/legaldata/drugs` and `/dui` per state (+ federal) with each row's source line and last-verified date; route picks the tab; state picker; legaldata is public (rate limited) | E12; bail_legaldata_expungement.int; public_routes |
| 15 | Resources | Only 500 of 631 rows; "Text HOME to 741741" and "988 then press 1" dialed garbage; guests got 401 | `limit=1000`, public route, `helpLine()` (sms body, "then …" note, short codes), website / directions helpers, layout gap fixed | E13; aiLearning.test |
| 16 | Lessons | Completion was kept only on the device (user id defaulted to 1), points were added on every tap, migration 22's reworded content did not render (read `body` only) | Public list with `COALESCE(content, body)`; completion via `/lessons/:id/complete` (unique index, points once); `/progress/me`; another user's streak is 403; categories from data | E14; ai_learning_e.int |
| 17 | Bar prep scoring | Answers to questions outside the session counted, a repeat answer counted twice, the score divided by answered (not all) questions, and the results screen recomputed its own score | Only the session's questions, each once (unique index, first answer stands), letters A–D validated, score = correct / all questions, completes when all answered or submitted; the app shows the server score | E15; ai_learning_e.int |
| 18 | Bar prep sessions / review | "Retry wrong" started a random set; empty sessions were left behind; the 402 paywall was a dead end | Review sessions from `question_ids`; empty sessions deleted (404 `no_questions`); 402 → plans | E15; ai_learning_e.int |
| 19 | Bar prep progress / schedule | Dates in UTC (wrong day in Tokyo), an invented "pass probability", impossible exam dates accepted, raw category codes | Schedule (14 days) and daily progress in the user's zone; pass probability removed; `parseDateOnly` → 400; shared category labels; explanation screen reads the new shape and matches its question | E15; ai_learning_e.int |
| 20 | Advocacy | Guests got 401; blank cities in the coverage list | Public `/advocacy/stats` (rate limited), grouped by city + state, blank cities excluded | E16; public_routes |
| 21 | Impact report | Any signed-in user could read platform counts, including invented equity claims | Staff only; real counts only, a failed count is `null` | ai_learning_e.int |
| 22 | AI rate limits | The 429 body was English with a duplicate `retry_after_seconds` | Localized message, `Retry-After` header, one field | brutal_trials v3 |
| 23 | Idempotency | Motion generate, research ask and interpreter messages were not covered | Added to both the backend and the app lists (parity) | idempotency parity test |
| 24 | Contrast / touch | Design audit: light-mode text on the user-bubble colour, the avatar label, subject cards under 44 pt | User and assistant bubbles are separate; white avatar label; `minHeight: 44` | design-audit 0 / 0 / 0 / 0 |

Shared-code changes: `utils/http.js` (stream abort reaches the upstream call), `services/api.ts` (honours
`signal`; no retry after cancel), `middleware/legalAccuracy.js`, `middleware/sharedAiLimiter.js`,
`services/aiClient.js` (`aiErrorCode`, `aiHttpError`), `services/aiQueue.js` + `routes/jobs.js` (codes, per-type
timeouts), `temperature` removed from every Anthropic call (chat, contracts, discovery, expungement petition,
interrogation, match, motions, privilege, research, transcribe, translate), idempotency lists, `public_routes`,
`i18n/index.ts` (`tIn`), `utils/contact.ts` (`helpLine`), `navigation/linking.ts` (bar-prep, progress, schedule,
advocacy). New: `services/chatStream.ts`, `utils/crisisDetect.ts`, `components/MarkdownText.tsx`,
`constants/barPrepCategories.ts`, migration `00000000000025_ai_learning.sql`, `frontend/scripts/web-journeys-ai.cjs`,
`backend/src/__tests__/integration/ai_learning_e.int.test.js`, `frontend/src/__tests__/aiLearning.test.ts`.
`openapi.json` regenerated (611 operations; `/research/subscribe` gone; legaldata, lessons, resources, advocacy
stats public). Translations: 5,123 keys in each frontend catalog; 74 new backend keys × 4. Legacy source pins
rewritten to the new design: ai_prompt_safety, gap_and_error_discovery, brutal_trials
v3/5/7/8/13/15/17/18/26/27/31/32/40/41/43/52/54/56/69/71/72/73/79/86/87/97/113/131/143/161/165/169/170/171/173/178/181/185/189/192,
integration chat_jobs and bail_legaldata_expungement, render homeChat.

### Not fixed / for the owner or other sections
- **Legal content (flagged, not changed):**
  - Lessons are English only and have no source or reviewer; the app says so.
  - Drug / DUI rows have vague sources ("state statute") and some rows contradict themselves (e.g. TN meth notes vs. jail days).
  - Push tips without a source: "DUI checkpoint announced", "30 days to respond to a traffic citation".
  - Bar-prep answers are skewed towards B; the questions have no `reviewed_by` / source.
  - Motion library "1–3 hours saved" claim is unsourced.
  - Database text is English only in every language: resource descriptions, drug / DUI row notes, bar-prep subject names and questions. The screens around them are translated.
- **Billing (owner):** per-motion pricing does not exist; the screen no longer shows a price.
- **Other sections:** `list_bounds` fails on C/D files only (billing/connections, match, messages, providers, checkins: 7 unbounded + 4 stale exceptions). The known `duplicates_bounds_ai.int` flake (C→H) failed once in the parallel run and passes alone; review_regressions R2/R4 and security c1 / c3c4 time out only under the parallel run and pass alone.
- **Device / keys:** `tel:` links are page navigations on web, so only the `sms:` link is journey-checked; native audio (transcribe) and the native job path were reviewed in code only.

### Gates
- **Frontend:**
  - `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0
  - `npm test`: 775/775 (54 suites, incl. the new aiLearning 26) + render 194/194 (14 suites; homeChat 12 incl. 4 new)
  - i18n-scan 0 · design-audit `--ci` 0 (contrast / hex / a11y / role / touch all 0) · nav-targets 0 problems · expo web export OK
- **Backend:**
  - Migrations ×2 clean on a fresh jg_dbg (incl. the new 25) · lint 0 · openapi regenerated; openapi spec / drift suites pass
  - The 205 touched / pinning suites (every file that reads my routes or screens) + the new tests: 25,292/25,295. The 3 misses: list_bounds ×2 (C/D files only, listed above) and the known duplicates_bounds_ai flake, which passes alone (6/6)
  - New ai_learning_e.int: 13/13
  - Fresh production boot → smoke **40/40**
- **Live browser:**
  - New `frontend/scripts/web-journeys-ai.cjs` on the final build: **19/0** (E1–E16, E3b, page errors, failed requests)
  - A–D journeys (on the build before the last bubble / touch-target change): web-journeys-core-safety **15/0** · web-journeys-account **15/0** · web-journeys-directory **15/0** · web-journeys-cases **13/0** · web-journeys.cjs **37/0**
  - Exploratory sweep on the final build: 12 screens × 4 languages × 390 / 1280 × guest / signed in = 192 pages. Results: 0 page errors, 0 failed requests, 0 raw keys, 0 English UI in es/pt/vi, 0 horizontal overflow, 0 error boundaries
- Servers stopped by PID and jg_dbg dropped. Nothing committed by this section.

## F · Specialized legal guides

Scope: ChildSupport, Diversion (+ MentalHealthDiversion), Expungement, FamilyCourt, HagueContact, HousingRights,
TenantRights, IceDetention, ImmigrationConsequences, Insurance, JuvenileJustice, SpecialtyCourts. Routes: expungement
(check, attorneys, eligibility, petition-checklist, petition, log-visit), hague_contacts, immigration, insurance,
legaldata (specialty-courts), plus a sweep of family / legalAid / resources (no screen of this section calls them; no
500 found). Reused from A–E: stored-user helper, `SignInNeeded`/`useHasSession`, the AuthGate sheet, `utils/contact`
+ `ContactActions` (C), translated server errors, and E's source pattern (`pen_source` / `pen_not_reviewed` /
`pen_notes_english`). Run on a fresh jg_dbg (migrations ×2, 2,046 lawyers / 1,262 bail agents read only), production
boot on 4300, web export on 8300, Anthropic mock on 4399, Chromium in America/Chicago. Screenshots:
notes/debug/F/before/ (bugs live), notes/debug/F/explore1/ (208-page sweep), notes/debug/F/journeys/. Per-rule
lawyer-review list: notes/debug/F/expungement_rules_review.txt. ICE lead fee checked: $75 (`ice_detention: 7500`
in both `constants/leadFee.ts` and `GET /billing/pi-lead/fees`) — unchanged. Nothing committed by this section.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | Expungement check | Every check answered "❌ Not Eligible · Tennessee · unknown", whatever state / outcome / charge was chosen (seen live: CA + Dismissed) | the query went in `cachedGet`'s TTL argument, so no params were sent and the server defaulted to TN; the server also silently defaulted a missing/invalid state to TN → `api.get(..., { params })`; server 400 `invalid_state` / `invalid_status` / `invalid_type` in the request language | render guides 1; F1, F2; int F |
| 2 | Expungement verdicts | "Still open" was checked as a closed case; "Other / not sure", theft, assault … got a misdemeanor verdict (and "likely eligible" in CA); an unknown charge showed "Not eligible" | status normalized (Dismissed / Convicted=Closed / Open → `case_open`, no verdict); `classifyCharge` returns `unknown` for text with no stated level (its own comment said so; "driving under the influence" now → dui); the form asks the kind of charge (misdemeanor / felony / DUI / DV / sex offense / not sure); `eligibility.result` drives the screen | int F; F1; expungement / crash_proof / new_brutal_trials pins |
| 3 | Expungement content | Verdicts and waiting periods shown as fact, no source | A verdict (and a waiting period) only when the rule's note names a statute (`citationOf`, 147 of 306 rules); the statute is the source line, with the recorded date (2026-08-09) and "not reviewed by a lawyer"; 155 rules naming no statute → "No sourced rule … ask a lawyer" with the note shown as unreviewed text; 4 self-contradictory rules (`REVIEW_FLAGS`) → no verdict; notes labelled "in English" | int F (all 51 states × 8 combos, en/es); F1–F3; render guides 1 |
| 4 | Expungement extras | Countdown to an "eligibility date" counted from a date the API never sent (dead); "$179–$399" partner price; juvenile link to an unverified external page; guest visit fired a 401 (`log-visit`); petition errors said "SOS failed"; "AI-generated" banner on a rule check | countdown removed; partner shown without the price; juvenile link → in-app Juvenile sealing tab; log-visit only with a session; draft needs a session (AuthGate) with E's AI error codes; banner removed; "Check another record" added (there was no way back) | F1, F3, F10; render guides 2 |
| 5 | Expungement attorneys | CA listed Chicago lawyers (`LOWER(city) LIKE '%ca%'`), `state IS NULL` rows, `limit=abc` → none; raw phone, "Book free consultation" with wrong params | same-state listings only, C's `formatLawyer` public shape, completeness → rating order; cards open the lawyer profile and use `ContactActions` | int F; F1 |
| 6 | `/expungement/eligibility`, `/petition-checklist` | 500 for a string charge, a bad date, or `?state=a&state=b` | validated (400), never 500, verdict rules as in #3 | int F |
| 7 | Child support | A dollar "estimate" from an invented national table with an invented 30 % shared-custody cut; payer chosen by custody, amount = difference of shares | no sourced formula exists for any state → state picker + "No official formula is recorded for {state}" + where the official calculation comes from; no number | render guides 3; F4 |
| 8 | Diversion | "✅ You may qualify for diversion" from counting yes answers; Mental-health tile opened the drug tab; double header; tab state not exposed | neutral "You answered yes to n of m" + "the app has no recorded rules"; `tab` param and `MentalHealthDiversion` → mental tab; own header removed; "Find specialty courts" on the matching type | render guides 4; F5 |
| 9 | Hague | Country list hard-coded (English names), authorities hard-coded on the server, no sources; "FBI IC3" (internet-crime portal) offered for parental kidnapping; screen unreachable (no entry point); guests got 401 on every lookup; intake 500 on a non-numeric case id; no way to pick a case | migration 26 `hague_central_authorities` / `hague_resources`: the recorded rows copied as they were (2026-05-30) with `source`, `source_url`, `recorded_at`, `last_verified_at` (null); every card shows its source line; names via `Intl.DisplayNames`; info routes public (rate limited), 404 for a country not stored; FBI page instead of IC3; intake validated (case, country, name, age 0–17, real past date), owner-only (404), localized next steps flagged `next_steps_reviewed:false`; case picker; entry from Family court › Custody; deep link `/hague` | int F; render guides 5; F7 |
| 10 | ICE detention | Locator link not the address ICE publishes; numbers dialed raw; share failure silent | `https://www.ice.gov/locator` (ICE ODLS brochure, checked 2026-10-20) with that source line, also in the share text (4 languages); `telUrl`/`formatPhone`; copy toast; notice + sources in the page language | F8 |
| 11 | Legal insurance | Fake quotes from "Justice Gavel Insurance Partners" (Legal Pro $19.99 vs the real $34.99); "Enroll now" broke the payments screen (`setPurpose('insurance')`) | `/api/insurance/*` removed (404); screen says there is no insurance product and lists the real plans from `/billing/tiers` → plans screen; Settings hint reworded | int F; F9 |
| 12 | Specialty courts | State filter fired on each keystroke with a 1-letter state; English court types / counts in es/pt/vi; Apple Maps on every platform; DB text English; no source | StatePicker (+ All states), translated types, ContactActions, a source line per card; `content_translations` (migration 26, md5 of the English kept, a stale translation falls back to English) for the 30 rows × eligibility / notes × es/pt/vi; `?lang` in the request | int F (edit → English); F6 |
| 13 | Unsourced guides | Family court, Housing, Tenant, Immigration, Juvenile, Diversion, ICE showed legal statements with no source or review label | `components/LegalSource` (`UnreviewedNotice`, `SourceLine`) on every guide in 4 languages; Juvenile sealing rows each say "Source: none recorded" and filter by state | F12; sweep |
| 14 | Immigration / ICE wording | Outcome predictions: "Deportable — almost always triggers removal", "Deportation is virtually automatic …", "A felony is almost always disqualifying", "… mandatory detention and removal with very limited relief", "… immediate deportation with no appeal" | headings → neutral categories, those sentences removed in all 4 languages (nothing else changed) | i18n parity; F12 |
| 15 | Reachability | Tenant rights, Hague had no entry point; 10 screens had no deep link; route params ignored | Housing › Eviction → Tenant rights; Family court → Hague / child support (support tab); `tab` params for Family court / Juvenile / Diversion; 10 deep links | F10; nav-targets 0 |
| 16 | Immigration calculators | `/asylum-clock`, `/voluntary-departure` 500 on bad dates | 400 in the request language | int F |
| 17 | Shared: selected state on web | RN-web 0.21 ignores `accessibilityState`, so tabs / chips never exposed selected | `aria-selected` / `aria-checked` / `aria-expanded` (InfoTabs is shared) | F5, F6 |
| 18 | Shared: plans screen as guest | `GET /billing/consumer/subscription` 401 on every guest visit | only with a session | F9 (no failed request) |
| 19 | Layout | Guide cards edge to edge at 390 px (Family court, Housing, Immigration) | 12 px gutters | sweep 0 overflow |

Shared-code changes: `components/LegalSource.tsx`, `components/StatePicker.tsx` (new), `components/InfoTabs.tsx`
(aria-selected), `ConsumerSubscriptionScreen` (guest call), `CaseScreen` (expungement params), `navigation/linking.ts`
+ `NavigationTypes.ts`, `services/offlineCache.ts` (dead per-state expungement cache removed), `routes/legaldata.js`
(`text_lang` + stored translations for any table), `app.js` (insurance unmounted). New: migration
`00000000000026_specialized_guides.sql`, `backend/src/__tests__/integration/specialized_guides_f.int.test.js`,
`frontend/src/__tests__/render/guides.test.tsx`, `frontend/scripts/web-journeys-guides.cjs`. `openapi.json` regenerated
(609 operations: insurance quote / plans gone). Translations: 82 new frontend keys × 4, 125 dead keys removed (5,080 per
catalog), 9 existing values reworded (5 outcome sentences, 2 headings, share-text URL, insurance hint); 34 backend keys × 4;
180 DB-text translations. Legacy source pins rewritten to the new design: brutal_trials
v6/15/19/26/28/30/31/36/43/54/57/60/73/82/83/84/85/94/96/103/104/131/177/190, new_brutal_trials, crash_proof,
expungement.test (inline copy: classification table), law_firm_simulation + grand_simulation_100k (accept `unknown`),
public_routes (3 Hague info routes public, insurance gone).

### Not fixed — legal content for the owner's lawyer (all still visible, labelled "general information, not reviewed by a lawyer" in 4 languages)
- **Expungement rules** (rules.js; `reviewed_by: "Pending attorney review"` for every state): 147 rules cite a statute (shown with it), 155 cite none (no verdict), 4 contradict themselves — CT.dismissed (wait 0 vs "after 13 months"), TX.dismissed (wait 0 vs "after the statute of limitations"), NV.domestic (not eligible vs "extended waiting periods"), AZ.domestic (not eligible vs "restricted"). Full list: notes/debug/F/expungement_rules_review.txt. Also: the "What does expungement do?" claims ("employers, landlords and lenders cannot see it", "you can legally say 'I was not arrested'"), the "What you can still do" list, `/petition-checklist` "filing fee typically $50–$250", the petition prompt's "TCA §37-1-153 allows automatic sealing of most juvenile records", the RecordSeal.com referral (no agreement on record; price removed).
- **Child support**: no state guideline is stored, so the screen is "unavailable" for all 51; owner to supply sourced guidelines / official calculator links. Family court text ("most states use income shares", "15–25 % income change", "EPO 3–7 days", "TRO 20–25 days", "permanent = 1–5 years", "no filing fee for DV protective orders in any state", "no presumption favoring mothers in any state", "child's preference at 12–14") has no source.
- **Housing / Tenant**: self-contradictory across screens — Housing says self-help eviction is "illegal in every state", Tenant says "illegal in most states". Unsourced: HUD 2016 guidance (current status to check), "a single arrest cannot be used", "eviction judgment shows for 7 years", "pay or quit 3–5 days", ERA programs "in most states" (may have ended), the Fair Chance city list, "emergency orders within hours", "restore access same day", "notice 24–48 hours".
- **ICE / immigration**: self-contradictory — the ICE card says you have a right to a lawyer "even if you cannot afford one" while `/immigration/rights` says there is no right to a free government-appointed attorney in immigration proceedings. No source for the five help-line numbers (RAICES 210-787-3745, NILC 213-639-3900, ACLU 212-549-2660, ILRC 415-255-9499, CLINIC 301-587-7993; the first two are also in the share text); the rights text names ACLU / NILC / ILRC without links or dates. Remaining unsourced statements: "$500+ more likely a CIMT", the 30 g marijuana "discretionary waiver", "DACA termination is automatic for …", Padilla v. Kentucky summary. API-only (no screen): `/voluntary-departure` "10-year bar and $1,000–$5,000 penalty", `/relief-options` summaries (U-visa cap, DACA dates), "ICE Detention Hotline 1-888-385-0355".
- **Juvenile sealing**: 51 rows, no source; LA row contradicts itself ("Age 17 (in LA, adulthood)" vs "Louisiana raised the adult age to 18 in 2020"); CA cites AB 1076 for juvenile sealing; process timelines ("24–72 hours", "notify parents within a few hours") unsourced.
- **Specialty courts**: 30 rows, `source_url` NULL and `verified = 1` with no `verified_by` on every row (not shown as verified); Broward's "partners with James A. Haley Veterans Hospital" (Haley is in Tampa) looks wrong; several phones are county main numbers.
- **Hague**: stored as recorded 2026-05-30, never re-checked: Pakistan recorded as "not a contracting state" (it acceded — whether the U.S. accepted the accession must be checked), China (Hong Kong / Macau), India; Russia's authority "Ministry of Education", generic ministry home pages as "websites"; next step "Central Authorities must respond within 6 weeks under Article 11" (Article 11 is about the authorities acting expeditiously / a statement of reasons after 6 weeks) — kept, flagged.
- **Diversion**: the checklist questions are general and unsourced (no verdict any more).

### Not fixed — other
- **Owner / product:** there is no legal-insurance product (screen says so); the Home tile / Settings row still lead to it. ICE detention is not on the offline list and is lazily bundled (no offline promise exists; making it work offline would be a new feature).
- **Not run here:** native `tel:` dialing (web journeys capture the `tel:+1…` URL), native share sheet, `Intl.DisplayNames` on Hermes (falls back to the stored English country name).
- Expungement notes, juvenile rows and the static guides stay English-sourced text translated in the catalogs; expungement notes (server data) are English and labelled — translating 306 legal notes was left to the owner with the lawyer review.

### Gates
- **Frontend:**
  - `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0
  - `npm test`: 775/775 (54 suites) + render 201/201 (15 suites, incl. the new guides 7)
  - i18n-scan 0 · i18n parity green (5,080 keys × 4) · design-audit `--ci` 0 / 0 / 0 / 0 / 0 / 0 · nav-targets 0 problems · expo web export OK
- **Backend:**
  - Fresh jg_dbg, migrations 00–26 ×2 clean (2,046 lawyers / 1,262 bail agents untouched; 28 Hague authorities, 4 resources, 180 translations) · lint 0 · openapi regenerated (609 operations)
  - The 168 touched / pinning suites (every test file that reads these routes, screens, linking, offlineCache, openapi, public routes, server i18n) + the new tests: **24,551/24,551**
  - New `integration/specialized_guides_f.int.test.js`: 11/11 (incl. all 51 states × 8 status/charge combos)
  - API loop: 816 expungement checks (51 states × 8 combos × en/es) + 51 attorney lookups: 0 non-200, no verdict or waiting period without a statute
  - Fresh production boot → smoke **40/40** (shared fix: the smoke script and web-journeys-ai E1 still expected `claude-sonnet-4-6`; both now read the server default `claude-sonnet-5-5` / `CLAUDE_MODEL`)
- **Live browser (final build):**
  - New `frontend/scripts/web-journeys-guides.cjs`: **14/0** (F1–F12, page errors, failed requests)
  - Exploratory sweep 13 routes × 4 languages × 390 / 1280 × guest / signed in = 208 pages: 0 page errors, 0 failed requests, 0 raw keys, 0 English UI lines in es/pt/vi, 0 horizontal overflow, 0 error boundaries (notes/debug/F/explore-final/)
  - Regression on the same build: web-journeys-core-safety **15/0** · account **15/0** · directory **15/0** · cases **13/0** · ai **19/0** · web-journeys.cjs **37/0** (needs `--db-url`; reset the Anthropic mock's `/__mode` between scripts)
- Servers stopped by PID, jg_dbg dropped. Nothing committed by this section.

## G · Pro dashboards, payments & admin

Scope: AttorneyDashboard, AttorneyInbox, BondsmanDashboard, ConflictCheck, FirmAcquisition, AdminVerification, Payments,
Subscription, ConsumerSubscription (plus Home's plans card, ArrestMonitor's plan check and the Settings pro rows). Routes:
attorney/*, bondsmanCRM, conflicts, firm_acquisition, firms, firm_verticals, admin + admin/*, audit, billing/*, webhooks/stripe,
contracts/draft, integrations/recap, and the lead-fee code. I reused the earlier sections' work: A's purchase pattern (the server picks the
amount, then payment sheet or Stripe Checkout, then a confirm the server checks with Stripe), `SignInNeeded`/`useHasSession`, `services/session.ts`,
the stored-user helpers, `StatePicker` and server i18n.

How it was run:
- Fresh jg_dbg: migrations 00–27 applied twice, the 2,046 lawyers and 1,262 bail agents only read.
- Production boot on 4300, web export on 8300, Anthropic mock on 4399, Chromium in America/Chicago.
- Earlier in the section: a live sweep of 311 routes × 5 identities (guest, consumer, attorney, bail agent, admin), plus a cross-firm and cross-user IDOR probe.
- Payments with keys were proved with a fake Stripe client in `integration/pro_billing_g.int.test.js`.
- Screenshots are in notes/debug/G/.
- Nothing was committed. The three removed files (`routes/pay.js`, `routes/pi_leads.js`, `routes/billing/webhooks.js`) were deleted with `git rm`.

### Bugs found and fixed

| # | Where | What the user saw | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | Prices, everywhere | Home: "Intel tier $19.99/mo" (no such tier). Retention push: "Legal Pro $14.99/mo, 24/7" (the plan is $34.99 and monitors run nightly). Chat: "$9.99/mo". Research: "$49.99/mo add-on", "$374.99/yr". Case tools: "motions $9.99 each" (never charged). Discovery: "Discovery Pro $149.99/mo" (no such tier). Quick Connect $19.99 (it costs $20). Esquire was written as $49.99 in one place | Prices were typed in many places → one price list in `routes/billing/plans.js` (TIERS, BONDSMAN_TIERS, PLAN_FEATURES). Everything reads from it: `/billing/tiers`, the plan screens, the Home card ("Plans from $19.99/mo", the cheapest real plan), the retention push (price from TIERS, "nightly", 4 languages) and `BUSINESS_CONSTANTS`. The wrong copy was removed or reworded with no price in 4 languages, and unused priced keys were deleted | G1–G3 journeys; render proDashboards; int G2; brutal_trials v26/27 |
| 2 | Stripe price ids | `scripts/setup-stripe-products.js` would have created Advisor at $29.99, Legal Pro at $29.00/$249 and a $199 Legal Radar annual plan. With those ids set, the app would charge a different price from the one it shows | The script now builds its list from plans.js (`--dry-run` prints it). Each configured price id is also checked against the plan at run time (`stripeBilling.chargeItem`: amount, interval, USD, active). If it differs, the plan's price is charged inline and the mismatch is logged | int G13 |
| 3 | Money paths | `POST /api/pay/create` charged whatever amount the client sent. Plans could become "active" before any payment. Lead purchases took a raw `payment_method_id` | `routes/pay.js` removed. Subscriptions start `default_incomplete` and count only once Stripe confirms the card (trial) or the first invoice is paid. Every buy follows the same path: server amount → sheet/Checkout → `/confirm`, verified with Stripe for this user, package and amount. Without keys, every POST is 503 `payments_unavailable` and the app shows the friendly message | int G1–G5; G1/G3/G5 journeys; billing_consultations.int |
| 4 | Webhooks | Two handlers (`billing/webhooks.js` and `webhooks/stripe.js`) with different behaviour. A replayed event could credit twice | One handler, `services/stripeWebhook.js`, behind all three paths. It verifies the signature over the raw body, claims each event once in `stripe_event_log` (the claim is released if processing fails, so Stripe retries) and uses unique payment / subscription ids. It handles subscription created/updated/deleted, checkout completed, invoice paid / failed (past_due + a push in the person's language), payment_intent.succeeded (leads, family, outbound bot) and charge.refunded | int G6 (replays change nothing); webhooks.test; webhook_signature |
| 5 | Plan change / cancel / refund | Change and cancel took effect without Stripe. Refunds were not offered | Change is prorated (`always_invoice`, `pending_if_incomplete`): a declined card keeps the old plan (402). Cancel takes effect at the end of the period. Refunds: automatic within 7 days or for a billing error, otherwise sent for review; 409 when nothing was charged. The Billing screen shows the plan, purchases and refund requests | int G5, G7 |
| 6 | Leads | Bail leads showed full names before purchase; the same agent could be charged twice. Case leads: the legacy `/api/pi-leads` revealed contact details from unpaid "charged" rows | Bail: initials only until a verified purchase; one purchase per agent (a duplicate payment is refunded); $100 flat. Case leads: one buyer with a 30-minute hold (a late payer is refunded); $200 PI / civil rights / medical, $100 employment, $75 ICE. Contact details only in `/pi-leads/mine` for the buyer, and only with a Stripe PaymentIntent (demo / mock / NULL rows reveal nothing). Legacy routes removed | int G8, G9; c2_leads (rewritten); G5 journey |
| 7 | Attorney inbox (handoff D→G) | Direct and bulk messages were stored but never shown | Inbox shows direct threads; `DirectConversation` (reply only to someone who wrote first; marks read); the reply push opens Messages `?directWith=`; Cases › Messages lists direct threads | int G12; render proDashboards; G6 journey |
| 8 | Attorney dashboard | Invented stats. PATCH /profile let an attorney edit verified bar fields. The case list leaked the client's AI chat (`ai_intake_context`). The CLE "credit earned" claim | Real counts. Bar number only through `POST /verify-bar` → admin review (a changed number resets verification; audit entry). Overview / Cases / Leads / Templates / CLE / Profile tabs. `ai_intake_context` removed. CLE marked "your own record" | G4 journey; int G11 |
| 9 | Bondsman dashboard / CRM | Fake "Verified by Justice Gavel" badge ($49/mo, nobody verified anything). Any account could create a bail-agent profile. Saving gave no feedback | Badge product removed. Bail-agent plans are new-arrest alert coverage (1 / 3 / all counties; `services/leadAlerts.js`, one alert per arrest). Profile is for bail-agent accounts only. Tabs Leads / My leads (status + notes) / Clients / Profile with real counts. "Profile saved." notice | int G10; c2; G5 journey |
| 10 | Conflict check | Exact-string matching (accents and case missed). Another firm's `firm_id` was accepted. Index insert errors were swallowed | NFKD-normalized token matching: exact vs possible (an extra "Jr" is a possible match, for review). Firm membership required (another firm → 403). Searches the index, matter parties and matters. Matter ownership checked on `/index` | int G12; G7 journey |
| 11 | Firm trial (handoff B→G) | English-only server messages. Invented per-vertical demo stats. The trial insert failed (500, generated columns). Firm invites auto-added existing users with no seat check | All messages localized (`firm.*`). `/vertical-demo` and VERTICAL_PITCH removed. Trial for attorney accounts only, created in a transaction: 14 days, 10 seats, at most 3 trials, terms sent by the server. Checklist computed from data. Invites need acceptance, with seats checked before the invite is stored and again on accept. Upgrade is a request (no paid firm plan exists) | int G12; G7 journey (es error in Spanish) |
| 12 | Admin | One queue (bar numbers) with no audit. Duplicate `/attorney/pending-verification` route | `/api/admin/queue` (admin / super_admin live role): bar numbers (a reason is required to reject), listing claims (links via attorney_profiles / bondsman_profiles; listing rows untouched), listing reports, reviews. Every decision is audit-logged and validated (400). The screen has four tabs and refuses non-admins without calling the API | int G11; h3h4; G8 journey (9 routes × 3 roles → 403, no token → 401) |
| 13 | Entitlements | Video read a table that doesn't exist; transcription checked `req.user.tier` (never set); research / bar prep / interpreter each had their own tier lists; arrest monitors were free while being sold as a Legal Pro feature | `services/entitlements.hasFeature` driven by the one PLAN_FEATURES matrix. Monitors → 402 without the arrest_monitor feature. ArrestMonitor reads `subscription.features` | core_safety.int; render coreSafety |
| 14 | IDOR / 500s | Audit log: a firm admin could read another firm's matter log. Collateral-consequences insert 500. RECAP status 500 without a firm. Bondsman subscribe 500 (CHECK constraint) | Scoped to the firm; columns fixed; 403; migration 27 widens the CHECK | API sweep; int G10 |
| 15 | Copy promises | "We usually answer within 1–2 business days" (bar review), "within 2 business days" (refunds), "1–3 business days" (firm verification), research "Billed immediately" (plans have trials) | Reworded with no unbacked promise, in 4 languages; the unused key was removed | i18n parity |
| 16 | Contracts | 402 pointed at `/billing/contract-pro`, which doesn't exist | 402 `plan_not_available` (no Contract Pro tier exists) | — |
| 17 | Layout / a11y | 8 dark-mode contrast failures on the new screens; FirmAcq tile shown to everyone; no deep links for Conflict check, Firm trial, Admin review | `colors.legal` / `textBrand`; tile limited to attorney roles; `conflict-check`, `firm-trial` and `admin-review` deep links added; the admin screen is titled "Admin review" | design-audit 0; nav-targets 0; G9/G10 |

Shared fixes:
- **Validation / list bounds:** `routes/firms.js` checks seats before storing an invite. `attorney/inbox.js` bounds today's hearings. `routes/video.js` no longer swallows an error. `admin/queue.js`, `billing/consumer.js` and `webhooks/stripe.js` validate input explicitly (400).
- **Accounts:** `accountDeletion` now classifies `lead_alert_log`.
- **Config / docs:** Stripe price env vars are read as `process.env.X` (env docs stay consistent).
- **Leftover legacy:** `utils/subscriptionStateMachine.js` is labelled as not gating anything.
- **Tests and lint:** `list_bounds` now lists section F's unbounded lists, which were missing. Backend lint is back to 0: pre-existing errors in brutal_trials v82–85/96 were fixed.

New files:
- **Migration:** `00000000000027_pro_billing.sql` (idempotent).
- **Billing:** `routes/billing/plans.js`, `services/{stripeBilling,stripeWebhook,subscriptionStore,leadPurchases,leadAlerts,entitlements,adminQueues}.js`.
- **Admin:** `routes/admin/queue.js`.
- **Frontend:** `services/{purchase,plans}.ts`, `hooks/useStoredUser.ts`, `components/DirectConversation.tsx`.
- **Tests and journeys:** `integration/pro_billing_g.int.test.js` (13), `render/proDashboards.test.tsx` (6), `scripts/web-journeys-g.cjs`.

Other changes:
- `openapi.json` regenerated (618 operations).
- Translations: 313 new frontend keys × 4; 339 dead keys removed (5,054 per catalog); 108 backend keys × 4 (+3 reworded).
- Legacy source pins rewritten to the new design: 199 tests in brutal_trials (86 files), plus webhooks, webhook_signature, subscription_state_machine, error_message_quality, gap_and_error_discovery_v2, lead_fee_consistency, public_routes, list_bounds, env-docs, c2_leads, c3c4 (via `_world.addToFirm`: invite → accept), h3h4, billing_consultations, core_safety, directory_c (one attorney_profiles row per account), and the directory journey.

### Not fixed — for the owner
- **Pricing / products:**
  - There are no paid firm plans (`firm_pricing_configs` is empty), so "upgrade" is a request.
  - Bail-agent plan features were invented before this pass; I defined them as new-arrest alert coverage, so please confirm.
  - The contract_pro / discovery_pro tiers don't exist, so those gates can never open.
  - The Insurance tile and Settings row still lead to "no insurance product".
- **Terms of Service** say "refunds within 48 hours … upon request". The app's refund policy (automatic within 7 days or for a billing error, otherwise reviewed) differs. This is legal text, so I left it unchanged.
- **Legal / unsourced content:**
  - The bar-lookup URLs shown to admins are not verified.
  - CLE completion is self-reported.
  - The PI lead copy "More serious cases connect with more experienced lawyers" (section C) has no source.
  - The free AI chat limit is 3/day in code, but `BUSINESS_CONSTANTS.MAX_FREE_AI_MSGS` is 5 (section E area).
- **Dead code:** `utils/subscriptionStateMachine.js` (its own feature table) is used only by simulation tests. It can be removed together with them.
- **Not proven here:**
  - Native payment sheet: the Stripe paths were run with a fake client.
  - Bail-lead buy in the browser: no arrest feed is configured on a fresh DB. It is covered by the API (503) and by int G8.
  - Real Stripe keys.

### Gates
- **Frontend:**
  - `tsc --noEmit` 0 · `eslint src App.tsx --max-warnings 0` 0
  - `npm test` 775/775 (54 suites) + render 206/206 (16 suites, incl. the new proDashboards 6)
  - i18n-scan 0 · i18n parity green (5,054 keys × 4) · design-audit 0 / 0 / 0 / 0 / 0 / 0 · nav-targets 0 problems · expo web export OK
- **Backend:**
  - Fresh jg_dbg with migrations 00–27 applied twice (2,046 / 1,262 untouched)
  - lint 0 · openapi regenerated
  - Fresh production boot → smoke **40/40**
  - New int test G1–G13 13/13
  - Full backend jest run as a check (the coordinator runs the official one): 28,432 / 28,435 passed. The 3 failures were re-run alone and all pass:
    - core_path.int ×2: a lawyer-row checksum read while messages.int's own temporary lawyer row existed (a parallel-suite race; existing before G);
    - duplicates_bounds_ai.int: the known flaky test (handoff C→H).
    - resources.test: its worker was killed (SIGTERM), so it did not run; re-run alone, it passes.
  - Suites changed in G re-run after the last edits: all pass.
- **Live browser (final build):**
  - New `web-journeys-g.cjs`: **13/0** (G1–G11, page errors, failed requests)
  - Regression on the same build: core-safety **15/0** · account **15/0** · directory **15/0** · cases **13/0** · guides **14/0** · ai **19/0** · web-journeys.cjs **37/0**
- Servers stopped by PID, jg_dbg dropped. Nothing committed by this section.

## H · Server-wide sweep

Scope: every mounted route (614 operations), the background jobs, the four notification channels, the video handoff, security headers / limits / logging, Render readiness, and the flaky tests and CI. I reused earlier sections' pieces: server i18n (`msg` / `resolveLang`), the `_harness` integration world, A's sign-in helpers, E's AI error codes (`aiErrorCode`, `ai.job.*`), and G's single price list and payments gate (Stripe stays 503 `payments_unavailable` without keys).

How it was run:
- Fresh jg_dbg with migrations 00–28 applied twice. The 2,046 lawyers and 1,262 bail agents were only read; md5 is unchanged before and after every sweep and journey run.
- Production boot on 4300, web export on 8300, scriptable Anthropic mock on 4399, Chromium in America/Chicago.
- Fake Daily, Expo push and Supabase Storage servers on 127.0.0.1.
- Two instances on one DB to test double sends.
- A Render-like boot: an emulated image tree (no Docker daemon available here; files copied per `.dockerignore`, then `npm ci --omit=dev`), PORT=10000, only the render.yaml variables.
- Nothing committed. Deleted with `git rm`: `routes/pretrial.js`, `utils/subscriptionStateMachine.js` and `__tests__/subscription_state_machine.test.js`.

### Bugs found and fixed

| # | Where | What happened | Root cause → fix | Guard |
|---|---|---|---|---|
| 1 | Error format, all routes | Errors came in at least five shapes (bare strings, `{error:"English sentence"}`, `{message}` only, HTML from Express defaults). Most were English whatever the request language. Outside production, library text (pg / multer / body-parser) reached `message` | `middleware/errorShape.js`, installed once after the request id. Every /api error leaves as `{error, code, message}`. A catalog sentence in any language is re-rendered in the request language, and a missing message gets the text for its code / status. In production a 500 carries only `server_error` + the generic text. Library text goes to `detail` outside production only. The global handler has codes for invalid_json, payload_too_large (413) and 415 | route sweep (shape + es/vi language check on every error); int H1, H1b |
| 2 | Bad input → 500 | Out-of-range ids, junk dates, unknown foreign keys and duplicates answered 500. `!x?.trim()` threw on numbers and objects (16 sites in firm_verticals and more in matters, firms, dms, docket, conflicts, outbound webhooks, time, privilege). `safeInt` accepted unsafe integers | `db/index.js` records the SQLSTATE of the request's last failed query. errorShape turns that 500 into the 400 `invalid_input` / `invalid_reference` or 409 `conflict` it is. `isText` / `asText` / a safe-integer `safeInt` in routeHelpers, used at every site | sweep (junk params/bodies/queries × 6 callers); int H1 |
| 3 | Motion PDF export | A long motion made the server die mid-request: endless page-footer recursion, then a native zlib assertion | `bufferPages: true`. Page numbers are written at the end with the bottom margin at 0. MAX_MOTION_CHARS 100,000 | int H11 |
| 4 | IDOR / access | Matter time and docket lookups: a stranger got 200 plus firm-less docket entries. AI job status was readable by anyone with the id. `POST /webpush/send` would push to any user. `/push/token` could not move a device to its new account. `/push/send` and `/push/receipts` were open helpers. The docket upload path used the raw `matterId` | `requireMatterAccess('matterId')` on matter routes; uploads use the validated numeric id. A strict owner check on jobs (owners now passed by contracts/draft, contracts/review ×3 and privilege). Web push send is for staff, or a firm admin sending to a member of their own firm. Tokens are validated with `isExpoPushToken` and taken away from the previous account. `/push/send` and `/push/receipts` removed | sweep IDOR phase (owned resources × 5 other callers); int H2, H4, H7 |
| 5 | Video handoff | With DAILY_API_KEY set, the invited attorney never got a join token, and the invite push was English | `POST /video/session/:name/join`. The attorney must be invitable (case assignment or confirmed booking) and gets an owner token. An ended session answers 410 `session_ended`. `sessions/me` lists invitations. The invite push is in the attorney's language. `DAILY_API_BASE` and the key are read at call time. Frontend: the `room` param joins, and the push opens VideoConsultation | int H3 (fake Daily) |
| 6 | Two instances | Every instance ran every cron fire: nightly jobs, health scan, consultation reminders and a second `deliverScheduledPushes` loop in server.js, so pushes went out twice. AI job status lived in one instance's memory, so polling another instance gave 404 | `utils/jobLock.js`: `runScheduled` / `runOnce` claim each fire in `job_runs`, keyed by node-cron's scheduled time, and record ok/failed. The duplicate loop is removed. Per-row claims for consultation reminders. A partial unique index on live `scheduled_pushes(dedupe_key)`. `ai_job_state` lets any instance answer, and a job left by a dead instance reads as `ai_timeout`. Bar re-verification runs once per quarter (`quarterKey`) | int H4, H5, H5b; live two-instance run (one reminder, one nightly run each) |
| 7 | Notifications in one language | Booking confirmation / attorney alert e-mails, welcome e-mail, booking reminder push (handoff), docket deadline push, expungement trigger push, push test, web push and upload errors were English-only | All are rendered with the recipient's stored language (`email.*`, `push.consult_reminder.*`, `push.docket.*`, `push.expunge.*`, `video.push.*`, `webpush.*`, `upload.err.*`) in en / es / pt-BR / vi. The unused `sendSubscriptionConfirm` / `sendPaymentFailed` were removed | int H5b, H6, H8, H10; m4_email_escaping |
| 8 | Expo push hygiene | Receipts were never checked, so dead tokens stayed forever. Two cleanup paths disagreed, and tickets were not matched to their messages | One client in `services/expoPush.js`. One ticket per message, in order. `DeviceNotRegistered` tokens are removed from tickets at once and from receipts (`push_tickets` + `checkPushReceipts` every 30 min). The duplicate cleanup in reminderDispatcher was removed. Every channel without its key (Expo, VAPID, Resend, Twilio, Daily) degrades to a logged skip or a 503 `*_unavailable` | int H7; push.test |
| 9 | Schema | `docket_entries.due_time` was timestamptz, so a "17:00" deadline failed. Cases closed through the attorney outcome were stored as `closed`, while the app reads `Closed`, so court reminders kept firing for closed cases | Migration 28: `due_time` becomes TEXT `HH24:MI` (validated by `TIME_RE`), and existing `closed` rows become `Closed`. The outcome route sets `Closed`, writes history and cancels the case's court reminders. Legal-aid counts Closed / Dismissed as closed | int H8, H12 |
| 10 | Security | Production CORS allowed localhost origins. `/metrics` was public. The ICS feed token was compared with `===`, so timing leaked. `encryption.js` fell back to a built-in key. Logs and Sentry could carry case notes, charges, transcripts and Postgres error values | localhost origins only outside production. `/metrics` needs `Bearer METRICS_TOKEN` (or ADMIN_KEY) in production (timingSafeEqual, localized 401); render.yaml generates METRICS_TOKEN. `timingSafeEqual` on ICS. No fallback key: boot fails with a clear message. `redact.js` masks private-text keys and quoted Postgres values, and caps strings at 2,000 chars | observability_redaction; Render boot (fail-fast ×3, /metrics 401/200, CORS refusal) |
| 11 | Payments gate order | A guest calling billing writes got 503 `payments_unavailable` instead of "sign in" | `authRequired` runs before the payments gate | int H9 |
| 12 | Unavailable services → 500 | Research `/index` without Supabase gave 500. Legal-aid `/petition` and `/intake` gave 500 "Connection error." when the AI service could not be reached (found by the final sweep) | `/index` checks field types and answers 503 `unavailable`. Legal-aid uses E's coded AI errors in the caller's language. `aiErrorCode` maps a connection failure (APIConnectionError, ECONNREFUSED / RESET / ENOTFOUND, "fetch failed") to `ai_busy` (503) | sweep with the AI mock down (intake → 503) and up (→ 202); int H13 |
| 13 | Subscription screen (frontend) | A bail agent could see attorney plans: a slow attorney-plans response overwrote the newer bail-agent one | A `shownType` ref ignores stale responses | render proDashboards race test (fails without the fix); G3 journey |
| 14 | Flaky tests | `duplicates_bounds_ai` raced the key release. realworld "switches to Spanish" asserted < 5 ms. Lawyer checksums in core_path / directory_c / account_lifecycle / security counted another suite's temporary lawyer rows | The test waits until the key is released, then proves a retry runs. `expectInstant` replaces the timing assertion. `_harness.providerChecksum` excludes fixture rows (`FIXTURE_MARK`; messages.int tags its rows) | two full jest runs, 0 failures each |
| 15 | Flaky tests (found in the final gate) | `stress_simulation` / `stress_simulation_2` failed when one of 50,000 samples took 325 ms (`max < 50`). Jest workers were "terminated by another process" (SIGTERM) late in every full run (also seen in G: resources.test) | The stress tests keep their p50/p95/p99 bounds and cap p99.9 instead of the single max, since one GC pause or preemption is not a regression. Workers: under `--experimental-vm-modules` each one keeps every suite's module graph and grew to about 2.4 GB (measured; the machine reached 5.7 GB used of 7 GB). `workerIdleMemoryLimit: '800MB'` in jest.config.js recycles a worker between suites. GitHub runners also have 7 GB, so CI was exposed too | two full runs after the change, 0 failures; RSS sampled during them |
| 16 | Court / check-in reminder re-plan (found by a full-run flake) | Saving a court date with a new phone time zone answered **409** when one of the user's reminders was being sent at that moment, and the whole re-plan failed. Before migration 28 the same race sent that reminder twice | A re-plan cancels only *pending* rows, but the live-dedupe index also covers *sending*. Court, follower and check-in inserts now use `ON CONFLICT … DO NOTHING` on that index: a step already going out is skipped, not duplicated and not an error. Test-side: c3c4's `setval` moved the shared cases sequence backwards (re-issuing ids other suites held); it is now forward-only | int H14 (409 before the fix); full runs |
| 17 | Dead code | `subscriptionStateMachine.js` (its own feature table) was used only by simulation tests. The pretrial router was mounted with no client. `cleanStaleLocks` was never called. `expo-server-sdk` was used only by removed routes | Removed. The simulation tests lost only the parts that exercised it | lint 0; openapi parity in the sweep |

Shared changes:
- **Sweep tooling:** `backend/scripts/route-sweep.mjs` checks openapi parity and that every router file is mounted. It runs 6 callers, seeds owned resources, runs owner-read and IDOR phases, and sends junk params / bodies / broken JSON / queries. It checks for 5xx and hangs over 10 s, the error shape, the language (es / vi) and stack or SQL leaks, guards the provider tables, and exits 1 on any finding.
- **Anthropic mock:** `backend/scripts/anthropic-mock.mjs` is scriptable (`/__mode` ok / slow / long / 429 / 500 / 529 / 401 / drop / error_event / hang).
- **Journeys:** `frontend/scripts/run-all-journeys.sh` runs all eight journey scripts in turn.
- **CI:** ci.yml gets a route-sweep step after smoke, plus a `journeys` job (Postgres, migrate.sh, mock, expo export, Playwright Chromium, all journeys, artifacts on failure).
- **Config:** `DAILY_API_BASE` and `METRICS_TOKEN` added to config / .env.example / DEPLOY_ENV_SETUP.md; RUNBOOK and UPTIME_MONITORING note the metrics token.
- **Translations:** new backend keys × 4. Frontend: `x_video_consultation_join_video_call` × 4.
- **Account deletion:** `ai_job_state` and `push_tickets` registered with accountDeletion.
- **Retention:** token cleanup also purges finished AI jobs and old job runs.
- **Test pins:** brutal_trials v12, v13, v16, v22, v30, v77, v116, v149, v152, v153, v185 and v186 rewritten to the new design.
- `openapi.json` regenerated (614 operations).

New files:
- `supabase/migrations/00000000000028_server_jobs.sql` (idempotent): job_runs, ai_job_state, push_tickets, the live-dedupe unique index, `Closed` status and due_time as TEXT.
- `backend/src/middleware/errorShape.js`, `backend/src/utils/jobLock.js`, `backend/src/services/consultationSlots.js`.
- `backend/scripts/route-sweep.mjs`, `backend/scripts/anthropic-mock.mjs`, `frontend/scripts/run-all-journeys.sh`.
- `backend/src/__tests__/integration/server_h.int.test.js` (H1–H14 + H1b, H5b: 16 tests).

Render readiness, verified live:
- **migrate.sh:** a fresh DB applies 29 migrations and a rerun applies 0. Baseline mode works, and preDeploy runs it.
- **Boot:** on PORT=10000 with only the render.yaml variables, smoke is 40/40 (Supabase put / get / remove exercised against the fake).
- **Fail-fast:** a missing JWT_SECRET, ENCRYPTION_KEY or DATABASE_URL exits 1 with a clear message.
- **/health** shows status, db, timings and version only. No env, keys or hostnames.
- **SIGTERM:** the in-flight stream finishes, new connections are refused, "Shutdown complete" is logged and the pool closes.
- **npm audit:** backend 0.

### Not fixed — for the owner
- **Frontend npm audit:** 29 high, all in build tooling (braces 3.0.3, node-forge 1.4.0 are already the latest releases; no upstream fix). None ships in the app bundle.
- **Video and Legal Pro:** video needs Legal Pro even for a paid consultation booking. This is a product decision, so I left it.
- **API CSP:** the header keeps `'unsafe-inline'`. The API serves no HTML, and existing tests pin it.
- **TRUST_PROXY:** the value must be measured on Render after deploy (check that `req.ip` is the client, not the proxy).
- **Docker:** not run here (no daemon). The image was emulated file-for-file.
- **Removed routes:** the pretrial routes and `/push/send` are gone. Web push has no client in the app.
- **Push tokens:** `push_tokens` keeps one device per user (unique user_id), so a second device replaces the first.
- **Consultation reminder push:** it no longer deep-links into video, because the join now needs the room from the invite.
- **Not proven here:** real Expo, VAPID, Resend, Twilio and Daily keys (each was run against a fake or without its key).

### Gates
- **Backend:**
  - `eslint . --max-warnings 0` 0 · openapi 614 operations
  - Fresh jg_dbg with migrations 00–28 applied twice (lawyers 2,046 md5 1d3268289ea4e3e0a079bc3a5b311934 · bail agents 1,262 md5 28745e29c43a8eea129a7bc43f4a3ca5, unchanged after everything below)
  - Production boot on the final tree → smoke **40/40**
  - Full jest with TEST_DATABASE_URL, twice in a row after the last source change: **383/383 suites, 28,412/28,412 tests, 0 failures** both times (530 s / 532 s, `--maxWorkers=2`, peak machine memory 2.9 GB). Earlier full runs that failed are rows 15–16 above; they were fixed, not re-run until green
  - Route sweep (614 routes × 6 callers, 27,408 requests): **No findings** on the final tree; also no findings with the AI mock down (legal-aid intake → 503)
  - int server_h **16/16**
- **Frontend:**
  - tsc 0 · eslint 0
  - npm test 775/775 + render 207/207
  - i18n-scan 0 · design-audit 0 · nav-targets 0
- **Journeys** (final build and final tree, `run-all-journeys.sh`): core-safety **15/0** · account **15/0** · directory **15/0** · cases **13/0** · ai **19/0** · guides **14/0** · g **13/0** · web-journeys.cjs **37/0** (141 checks, 0 failed)
- Servers stopped by PID; jg_dbg, jg_test, jg_render and jg_render_base dropped. Nothing committed by this section.
