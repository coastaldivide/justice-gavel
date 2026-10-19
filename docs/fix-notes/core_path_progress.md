# Core path build — running progress (survives container restart)

Task: implement every "Build" item of docs/strategy/CORE_PATH_PLAN.md, order 0→1→2→3→4.
Scratch DB: jg_core (create/drop freely). Do NOT commit.

## Design (decided)
- Rights content: backend `services/rightsContent.js` = single structured source (general = the app's
  bundled card text from frontend i18n en.json rc_* minus the unsourced "~10%" bail-fee line; state =
  STATE_RIGHTS moved from routes/lessons.js). Each section carries source + last_reviewed ("2026-04",
  the date the repo content records) + lawyer_reviewed=false. DB rights_cards rows (if any) override.
  Migration 20 adds rights_cards.source_url/reviewed_by/language/sort_order (NULL), unique per state+topic+lang.
- Public routes: GET /api/rights/states, GET /api/rights/:state ; GET /api/help/nearby (combined lawyers+bail,
  filters, open-now/24-7 from stored Google hours in the state's zone, ranking = distance + completeness only);
  POST /api/help/reports (report a listing → listing_reports table, never the provider row); admin list/resolve.
- Court dates: new `court_dates` table (many per case, past archived); cases.next_court_date kept as the
  derived next date; reminders per court date (scheduled_pushes.court_date_id), 7d/3d/1d/morning-of; .ics;
  courthouse link; checklist + missed-date guidance from existing repo content.
- Family follower: extend case_family_access (invite code hash, owner consent, status, revocable); follower
  sees court dates only (no notes/charge); follower reminders = notification_type 'follower_court_reminder'.
- SMS: services/sms.js (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER optional); chain push → email → SMS.
- Frontend: JustArrested = 3-step hub (resumable progress in AsyncStorage), Onboarding/Home entry;
  RightsCard free + sources + offline per state; HelpNow = combined results; CourtDates screen(s).

## Backend DONE (2026-10-19)
- migration 20 (rights_cards cols, listing_reports, court_dates, scheduled_pushes.court_date_id,
  case_family_access consent/follow cols, users.sms_reminders) — applies x2 clean
- services: rightsContent.js, providerHours.js, ics.js, sms.js, courtDayGuidance.js, followers.js;
  courtReminders.js rewritten (per hearing + followers); reminderDispatcher (hearing/follow stale checks, push→email→SMS)
- routes: rights.js, help.js, courtDates.js, following.js; cases.js (legacy date → court_dates, followers);
  admin.js listing-reports; chat grounding (rights_refs); lessons.js legacy card from rightsContent
- tests: __tests__/core_path_units.test.js (20), integration/core_path.int.test.js (19, PG) — all pass;
  integration suite 16/16 pass; smoke-test 39/39 (4 new core-path checks); lint 0; openapi regenerated (597 ops)
- i18n: removed unsourced "~10%" bail fee line from rc_b7 (en/es/pt/vi)

## Frontend DONE (2026-10-19)
- services/corePath.ts (progress, pending route, offline caches), utils/icsExport.ts
- JustArrested = 3-step hub (rewrite); Home "Just arrested?" card + pending route + rights prefetch;
  Onboarding real "Just arrested?" button (dead situation-picker block removed)
- RightsCard rewrite (free, sources, offline per state, notice); HelpNow rewrite (combined results, filters,
  report modal, PD + inmate lookup, offline); BailCalculator (public /help/bail-schedule, ranges only, case link)
- new CourtDatesScreen + CourtDateDetailScreen (registered + deep links court-dates, court-dates/:id)
- CaseScreen: consented invite (code), court dates link, shared-with-me → CourtDates; Chat: rights refs
- i18n 38 new keys ×4 langs; render tests render/corePath.test.tsx (25) + homeChat rights refs; legacy
  backend source-pin tests (45) updated to new truth
- tsc 0, eslint 0, design-audit 0, npm test 49/709 + 9/83

## Status
- [x] 0 Just arrested mode
- [x] 1 Know your rights
- [x] 2 Lawyer + bail
- [x] 3 Court dates
- [x] 4 Family sharing/follower
- [x] journeys, smoke, openapi, ci.yml, CORE_PATH_PLAN ✅, RUNBOOK, ten_of_ten
- [x] Full gate (see ten_of_ten STEP 14)
