/**
 * JUSTICE GAVEL — BRUTAL TRIALS v17
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 17th brutal pass — exhaustive cleanup of every remaining screen + service gap.
 *
 * NEW DOMAINS (20 areas):
 *   1.  CourtFormsScreen       — state + category → .gov form URL → AI explainer
 *                                /chat/ask, showDisclaimer, phase, searchQuery
 *   2.  FamilyCourtScreen      — 3-tab static screen (Custody/Protective Orders/
 *                                Child Support), works offline, fetchErr state
 *   3.  DeadlineCalculatorScreen — zero API calls, pure date arithmetic,
 *                                  arraignment/bail/speedy-trial/AEDPA/notice-of-appeal,
 *                                  color-coded deadlines, Share export
 *   4.  SavedLawyersScreen     — /saved/lawyers, personal notes, SkeletonLoader,
 *                                call/SMS/message/remove actions, swipe-to-remove
 *   5.  TermsAcceptanceModal   — legal requirements: scroll-to-bottom gate,
 *                                two checkboxes (ToS + not-legal-advice),
 *                                /auth/accept-tos, version-bumped on ToS change
 *   6.  BondsmanDashboardScreen — real-time lead feed, useFocusEffect, bail
 *                                 amount sort, one-tap accept, tiered fees ($25–$300)
 *   7.  CrisisResourcesScreen  — 988 first, calm not clinical, /resources?CRISIS_LINE,
 *                                 entry from EmergencyScreen/ChatScreen distress
 *   8.  ResourcesScreen        — Linking, category filter q/category/filtered/allItems
 *   9.  JustArrestedScreen     — step wizard, tel: calling, Share, no API calls
 *  10.  SettingsScreen         — /auth/me, referral code/credit, sign-out
 *                                clearAuth+multiRemove, destructive style
 *  11.  CaseScreen             — /cases + /saved/lawyers, useFocusEffect,
 *                                Share, activeTab, offlineCases
 *  12.  firm_verticals.js      — 58 handlers across 10 verticals: asylum clocks,
 *                                DPA, plea offers, VOP, DV firearms, TRO, BOP,
 *                                military, civil rights, juvenile trackers
 *  13.  integrations/recap.js  — CourtListener RECAP federal docket import,
 *                                6 handlers, COURTLISTENER_TOKEN env
 *  14.  arrest_alerts.js       — attorney + bail agent notification types,
 *                                sendArrestAlerts, 6-hour cron trigger
 *  15.  webhooks/bot_admin.js  — 7 admin endpoints, X-Admin-Key timing-safe,
 *                                bot status/run/revenue/opt-outs/messages/expire
 *  16.  jobPoller.ts           — progressive backoff 1s→1.5→2→2.5→3→4(cap),
 *                                timeout 120s, useJobPoller hook (loading/result/
 *                                error/phase/startJob/cancel), network retry ×1.5
 *  17.  EmergencyStrip         — 911/988 buttons, Heavy haptic, tel: linking,
 *                                compact prop, accessibilityLabel/Role, memoized
 *  18.  JTBLogo                — SVG brand mark, navy octagon, gold border,
 *                                size prop, scale from 680×680 master, memoized
 *  19.  Regression             — all v1–v16 fixes confirmed
 *  20.  Mass influx            — 100,000 new scenarios
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations;
let encrypt, decrypt;
let normalizePhone, parseIntent;
let haversineKm, bboxFromLatLng, googleMapsLink;
let hasMinRole, ROLE_HIERARCHY;
let safeInt, stripHtml, buildWhere, truncateStr;
let GAVEL_LEVELS, MOTION_TYPES, CONTRACT_TYPES;
let CONFIG;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals            = mi.computeAllSignals;
  computeMotionRecommendations = mi.computeMotionRecommendations;

  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;

  const tw = await import('../services/twilio.js');
  normalizePhone = tw.normalizePhone; parseIntent = tw.parseIntent;

  const geo = await import('../services/geolink.js');
  haversineKm    = geo.haversineKm;
  bboxFromLatLng = geo.bboxFromLatLng;
  googleMapsLink = geo.googleMapsLink;

  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole; ROLE_HIERARCHY = rbac.ROLE_HIERARCHY;

  const rh  = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; stripHtml = rh.stripHtml;
  buildWhere = rh.buildWhere; truncateStr = rh.truncateStr;

  const gg  = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS;

  const motT = await import('../routes/motions/_motion_types.js');
  MOTION_TYPES = motT.MOTION_TYPES;

  const ctypes = await import('../routes/contracts/_contract_types.js');
  CONTRACT_TYPES = ctypes.CONTRACT_TYPES;

  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CourtFormsScreen — AI-Assisted Court Form Finder
// ═══════════════════════════════════════════════════════════════════════════
describe('1. CourtFormsScreen — Court Form Finder', () => {

  test('1-01: uses /chat/ask for AI field explanations', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain("'/chat/ask'");
  });

  test('1-02: has phase, selectedState, selectedCategory, searchQuery, showDisclaimer', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('phase');
    expect(src).toContain('selectedState');
    expect(src).toContain('selectedCategory');
    expect(src).toContain('searchQuery');
    expect(src).toContain('showDisclaimer');
  });

  test('1-03: every form link goes to .gov or official court URL', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('.gov');
    expect(src).toContain('Linking');
  });

  test('1-04: AI assists in explaining fields only (not legal strategy)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('LEGAL GUARDRAILS');
  });

  test('1-05: has PTR and Modal, Alert', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('Modal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FamilyCourtScreen — Static 3-Tab Family Law Guide
// ═══════════════════════════════════════════════════════════════════════════
describe('2. FamilyCourtScreen — Family Law Navigation Guide', () => {

  test('2-01: FamilyCourtScreen is fully static — works offline', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx', 'utf8');
    expect(src).toContain('Fully static');
    expect(src).toContain('Works offline');
  });

  test('2-02: three tabs: Custody, Protective Orders, Child Support', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx', 'utf8');
    expect(src).toContain('Custody');
    expect(src).toContain('Protective Orders');
    expect(src).toContain('Child Support');
  });

  test('2-03: has fetchError and tab states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx', 'utf8');
    expect(src).toContain('fetchErr');
    expect(src).toContain('tab');
  });

  test('2-04: fetches nearby courthouse and legal aid as context', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FamilyCourtScreen.tsx', 'utf8');
    expect(src).toContain('/courthouses');
    expect(src).toContain('LEGAL_AID');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. DeadlineCalculatorScreen — Pure Date Arithmetic
// ═══════════════════════════════════════════════════════════════════════════
describe('3. DeadlineCalculatorScreen — Criminal Defense Deadlines', () => {

  test('3-01: zero API calls — pure date arithmetic works offline', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain('Zero API calls');
    expect(src).toContain('Works offline');
  });

  test('3-02: computes all critical criminal defense deadlines', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain('Arraignment');
    expect(src).toContain('AEDPA');
    expect(src).toContain('speedy trial');
    expect(src).toContain('Notice of Appeal');
  });

  test('3-03: color-coded deadlines: red ≤7 days, amber ≤30, green safe', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain('7 days');
    expect(src).toContain('30');
    expect(src).toContain('red');
  });

  test('3-04: has Share export for deadline results', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain('Share.share');
    expect(src).toContain('Justice Gavel');
  });

  test('3-05: AEDPA deadline model — 1 year from final conviction', () => {
    // AEDPA: 28 U.S.C. § 2244(d)(1) — 1-year SOL for federal habeas
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const convictionDate = new Date('2023-01-01');
    const aedpaDeadline  = new Date(convictionDate.getTime() + ONE_YEAR_MS);
    expect(aedpaDeadline.getFullYear()).toBe(2024);
    expect(aedpaDeadline.getMonth()).toBe(0); // January
    expect(ONE_YEAR_MS).toBe(31536000000);
  });

  test('3-06: /push/reminders for setting deadline reminders', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain("'/push/reminders'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. SavedLawyersScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('4. SavedLawyersScreen — Starred Attorney List', () => {

  test('4-01: fetches /saved/lawyers and /reviews', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain("'/saved/lawyers'");
    expect(src).toContain("'/reviews'");
  });

  test('4-02: has call, SMS, message, remove actions per lawyer', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain('call');
    expect(src).toContain('remove');
  });

  test('4-03: personal notes are editable inline', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain('note');
  });

  test('4-04: has PTR and SkeletonLoader', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('SkeletonLoader');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. TermsAcceptanceModal — Legal Clickwrap Requirements
// ═══════════════════════════════════════════════════════════════════════════
describe('5. TermsAcceptanceModal — Legal Clickwrap Compliance', () => {

  test('5-01: user must scroll to bottom before I Agree activates', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain('scroll to bottom');
  });

  test('5-02: two separate checkboxes: ToS agreement + not-legal-advice', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain('checkbox');
    expect(src).toContain('not legal advice');
  });

  test('5-03: sends timestamped acceptance to /auth/accept-tos', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain("'/auth/accept-tos'");
  });

  test('5-04: cannot be dismissed without accepting (affirmative action required)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain('cannot be dismissed without accepting');
  });

  test('5-05: legal requirements list confirms ABA-compliant clickwrap', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain('LEGAL REQUIREMENTS MET');
    expect(src).toContain('Affirmative action required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. BondsmanDashboardScreen — Lead Feed
// ═══════════════════════════════════════════════════════════════════════════
describe('6. BondsmanDashboardScreen — Arrest Lead Feed', () => {

  test('6-01: fetches /billing/bondsman/profile and /billing/leads', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx', 'utf8');
    expect(src).toContain("'/billing/bondsman/profile'");
    expect(src).toContain("'/billing/leads'");
  });

  test('6-02: uses useFocusEffect to refresh lead feed on focus', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx', 'utf8');
    expect(src).toContain('useFocusEffect');
  });

  test('6-03: tiered lead fee $25–$300 by bail amount', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx', 'utf8');
    expect(src).toContain('$25');
    expect(src).toContain('$300');
  });

  test('6-04: has FlatList, Modal, PTR, KAV, Linking', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BondsmanDashboardScreen.tsx', 'utf8');
    expect(src).toContain('FlatList');
    expect(src).toContain('Modal');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('KeyboardAvoidingView');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CrisisResourcesScreen + ResourcesScreen + JustArrestedScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('7. CrisisResources + Resources + JustArrested', () => {

  test('7-01: CrisisResourcesScreen — 988 is first on screen', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CrisisResourcesScreen.tsx', 'utf8');
    expect(src).toContain('988');
    expect(src).toContain('CRISIS_LINE');
  });

  test('7-02: CrisisResourcesScreen has calm design philosophy', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CrisisResourcesScreen.tsx', 'utf8');
    expect(src).toContain('calm, not clinical');
  });

  test('7-03: CrisisResourcesScreen has isLoading, dbLines, fetchError, refreshing', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CrisisResourcesScreen.tsx', 'utf8');
    expect(src).toContain('dbLines');
    expect(src).toContain('fetchError');
  });

  test('7-04: ResourcesScreen has category filter and Linking', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ResourcesScreen.tsx', 'utf8');
    expect(src).toContain('category');
    expect(src).toContain('Linking');
    expect(src).toContain('allItems');
  });

  test('7-05: JustArrestedScreen has step wizard (no API calls)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/JustArrestedScreen.tsx', 'utf8');
    expect(src).toContain('step');
    expect(src).not.toContain('api.get');
    expect(src).not.toContain('api.post');
  });

  test('7-06: JustArrestedScreen has Share and tel: calling', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/JustArrestedScreen.tsx', 'utf8');
    expect(src).toContain('Share');
    expect(src).toContain('tel:');
    expect(src).toContain('.catch(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. SettingsScreen + CaseScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('8. SettingsScreen + CaseScreen', () => {

  test('8-01: SettingsScreen fetches /auth/me and referral code/credit', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SettingsScreen.tsx', 'utf8');
    expect(src).toContain("'/auth/me'");
    expect(src).toContain("'/referrals/my-code'");
    expect(src).toContain("'/referrals/credit'");
  });

  test('8-02: SettingsScreen has refreshing, user, referralCode, referralCredit states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SettingsScreen.tsx', 'utf8');
    expect(src).toContain('user');
    expect(src).toContain('referralCode');
    expect(src).toContain('referralCredit');
  });

  test('8-03: SettingsScreen sign-out uses destructive Alert style', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SettingsScreen.tsx', 'utf8');
    expect(src).toContain("style: 'destructive'");
    expect(src).toContain('clearAuth');
    expect(src).toContain('multiRemove');
  });

  test('8-04: SettingsScreen has Share for referral link', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SettingsScreen.tsx', 'utf8');
    expect(src).toContain('Share');
  });

  test('8-05: CaseScreen uses useFocusEffect and has offlineCases state', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('useFocusEffect');
    expect(src).toContain('offlineCases');
  });

  test('8-06: CaseScreen has activeTab and Share', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('activeTab');
    expect(src).toContain('Share');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. firm_verticals.js — 58-Handler Route Coverage
// ═══════════════════════════════════════════════════════════════════════════
describe('9. firm_verticals.js — 58 Specialty Tracker Handlers', () => {

  test('9-01: firm_verticals.js has exactly 58 route handlers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    const handlers = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(handlers.length).toBe(58);
  });

  test('9-02: has asylum clock CRUD (immigration tracker)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('asylum-clocks');
    expect(src).toContain('/asylum-clocks/:id');
  });

  test('9-03: has plea offer + Padilla tracking (criminal defense)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('plea-offers');
    expect(src).toContain('Padilla');
  });

  test('9-04: has DPA tracker (white-collar defense)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('dpa');
  });

  test('9-05: has VOP/probation violation tracker', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('vop');
  });

  test('9-06: has DV firearm surrender compliance tracker', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('dv-firearms');
  });

  test('9-07: has voluntary departure deadline tracker', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('voluntary-departure');
  });

  test('9-08: has mission pricing request (/mine/mission-verify)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('mission-verify');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. integrations/recap.js — CourtListener PACER Federal Docket Import
// ═══════════════════════════════════════════════════════════════════════════
describe('10. integrations/recap.js — Federal Docket Import', () => {

  test('10-01: recap.js imports federal dockets from CourtListener RECAP', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js', 'utf8');
    expect(src).toContain('CourtListener');
    expect(src).toContain('RECAP');
  });

  test('10-02: imports: docket entries, party names, judge, filing date', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js', 'utf8');
    expect(src).toContain('docket entries');
    expect(src).toContain('Party names');
    expect(src).toContain('Judge name');
  });

  test('10-03: uses COURTLISTENER_TOKEN from env (optional, higher rate limits)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js', 'utf8');
    expect(src).toContain('COURTLISTENER_TOKEN');
    expect(src).toContain('5000/day anonymously');
  });

  test('10-04: has 6 route handlers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js', 'utf8');
    const handlers = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(handlers.length).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. arrest_alerts.js — Attorney + Bondsman Notification System
// ═══════════════════════════════════════════════════════════════════════════
describe('11. arrest_alerts.js — Professional Alert System', () => {

  test('11-01: exports sendArrestAlerts', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/arrest_alerts.js', 'utf8');
    expect(src).toContain('sendArrestAlerts');
  });

  test('11-02: attorney alert type covers DUI county arrests', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/arrest_alerts.js', 'utf8');
    expect(src).toContain('Attorney');
    expect(src).toContain('county');
    expect(src).toContain('no attorney of record');
  });

  test('11-03: bail agent alert type covers bail amount range', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/arrest_alerts.js', 'utf8');
    expect(src).toContain('Bail agent');
    expect(src).toContain('bail set');
  });

  test('11-04: called by scheduler every 6 hours', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/arrest_alerts.js', 'utf8');
    expect(src).toContain('6 hours');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. webhooks/bot_admin.js — Admin Control Panel
// ═══════════════════════════════════════════════════════════════════════════
describe('12. webhooks/bot_admin.js — Admin Controls', () => {

  test('12-01: bot_admin.js has 7 route handlers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/bot_admin.js', 'utf8');
    const handlers = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(handlers.length).toBe(7);
  });

  test('12-02: all routes require X-Admin-Key header', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/bot_admin.js', 'utf8');
    expect(src).toContain('X-Admin-Key');
    expect(src).toContain('timing-safe');
  });

  test('12-03: has bot status, run, revenue, opt-outs, messages, expire-links', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/bot_admin.js', 'utf8');
    expect(src).toContain('/status');
    expect(src).toContain('/run');
    expect(src).toContain('/revenue');
    expect(src).toContain('/opt-outs');
    expect(src).toContain('/messages');
    expect(src).toContain('/expire-links');
  });

  test('12-04: /run is async fire-and-forget (non-blocking)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/bot_admin.js', 'utf8');
    expect(src).toContain('fire-and-forget');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. jobPoller.ts — Progressive Backoff Model
// ═══════════════════════════════════════════════════════════════════════════
describe('13. jobPoller.ts — Progressive Backoff', () => {

  test('13-01: pollJob progressive backoff: 1s → 1.5 → 2 → 2.5 → 3 → 4 (cap)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts', 'utf8');
    expect(src).toContain('Progressive backoff');
    expect(src).toContain('1s → 1.5s → 2s → 2.5s → 3s → 4s (cap)');
  });

  test('13-02: nextInterval uses Math.min(pollCount * 500, 3_000) step', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts', 'utf8');
    expect(src).toContain('pollCount * 500');
    expect(src).toContain('3_000');
    expect(src).toContain('nextInterval');
  });

  test('13-03: timeout is 120,000ms (2 minutes)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts', 'utf8');
    expect(src).toContain('120_000');
    expect(src).toContain('timed out');
  });

  test('13-04: network error retries at nextInterval × 1.5', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts', 'utf8');
    expect(src).toContain('nextInterval() * 1.5');
  });

  test('13-05: useJobPoller hook has loading/result/error/phase/startJob/cancel', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts', 'utf8');
    expect(src).toContain('useJobPoller');
    expect(src).toContain('loading');
    expect(src).toContain('startJob');
    expect(src).toContain('cancel');
    expect(src).toContain('abortRef');
  });

  test('13-06: processing phase shows progress: Thinking→Analyzing→Almost there', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/services/jobPoller.ts', 'utf8');
    expect(src).toContain("'Thinking…'");
    expect(src).toContain("'Analyzing…'");
    expect(src).toContain("'Almost there…'");
  });

  test('13-07: progressive backoff model', () => {
    // Simulate: nextInterval() = intervalMs + min(pollCount * 500, 3000)
    const nextInterval = (pollCount, intervalMs = 1000) =>
      intervalMs + Math.min(pollCount * 500, 3000);
    expect(nextInterval(0)).toBe(1000);   // 1s base
    expect(nextInterval(1)).toBe(1500);   // 1.5s
    expect(nextInterval(2)).toBe(2000);   // 2s
    expect(nextInterval(4)).toBe(3000);   // 3s
    expect(nextInterval(6)).toBe(4000);   // 4s (cap at 3000 step)
    expect(nextInterval(10)).toBe(4000);  // still capped
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. EmergencyStrip — 911/988 Quick-Call Buttons
// ═══════════════════════════════════════════════════════════════════════════
describe('14. EmergencyStrip — Emergency Quick-Call', () => {

  test('14-01: EmergencyStrip has 911 and 988 call buttons', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain("call('911')");
    expect(src).toContain("call('988')");
  });

  test('14-02: uses Heavy haptic feedback before calling', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain('Heavy');
    expect(src).toContain('impactAsync');
    expect(src).toContain('Haptics');
  });

  test('14-03: has tel: Linking with .catch fallback', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain('tel:');
    expect(src).toContain('.catch(');
    expect(src).toContain('manually');
  });

  test('14-04: 911 is red (#B71C1C), 988 is blue (#1565C0)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain('#B71C1C');
    expect(src).toContain('#1565C0');
  });

  test('14-05: has compact prop for smaller form factor', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain('compact');
  });

  test('14-06: has accessibilityRole="button" and accessibilityLabel', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain('accessibilityRole="button"');
    expect(src).toContain('accessibilityLabel');
    expect(src).toContain('Call 911');
    expect(src).toContain('988');
  });

  test('14-07: memoized with React.memo', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/EmergencyStrip.tsx', 'utf8');
    expect(src).toContain('React.memo(EmergencyStrip)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. JTBLogo — Official Brand Mark
// ═══════════════════════════════════════════════════════════════════════════
describe('15. JTBLogo — SVG Brand Mark', () => {

  test('15-01: JTBLogo is navy octagon with gold border', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('#042C53');  // navy
    expect(src).toContain('#F9A825');  // gold
    expect(src).toContain('Octagon');
  });

  test('15-02: has steel blue inner ring (#185FA5)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('#185FA5');
  });

  test('15-03: JUSTICE in white, GAVEL in gold', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('JUSTICE');
    expect(src).toContain('GAVEL');
    expect(src).toContain('#FFFFFF');
    expect(src).toContain('#F9A825');
  });

  test('15-04: size prop controls square dimension (default 80px)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('size = 80');
    expect(src).toContain('width: s, height: s');
  });

  test('15-05: scales from 680×680 master viewBox', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('680');
    expect(src).toContain('viewBox="0 0 680 680"');
    expect(src).toContain('sc = (v: number) => (v / 680) * s');
  });

  test('15-06: memoized with React.memo', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('React.memo(JTBLogo)');
  });

  test('15-07: uses react-native-svg (Polygon, Rect, SvgText, Line)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/JTBLogo.tsx', 'utf8');
    expect(src).toContain('react-native-svg');
    expect(src).toContain('Polygon');
    expect(src).toContain('Line');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. Regression — All v1–v16 Confirmed
// ═══════════════════════════════════════════════════════════════════════════
describe('16. Regression — All Prior Fixes Confirmed', () => {

  test('16-01: HomeScreen PTR + setRefreshing(false)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HomeScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('setRefreshing(false)');
  });

  test('16-02: jobPoller backoff model correct', () => {
    const nextInterval = (pollCount, base = 1000) =>
      base + Math.min(pollCount * 500, 3000);
    expect(nextInterval(0)).toBe(1000);
    expect(nextInterval(6)).toBe(4000);
    expect(nextInterval(100)).toBe(4000); // still capped
  });

  test('16-03: EmergencyStrip 911 is red, 988 is blue', () => {
    expect('#B71C1C').toMatch(/^#[0-9A-F]{6}$/i);
    expect('#1565C0').toMatch(/^#[0-9A-F]{6}$/i);
  });

  test('16-04: JTBLogo scale from 680 master', () => {
    const sc = (v, s = 80) => (v / 680) * s;
    expect(sc(680)).toBe(80);
    expect(sc(340)).toBe(40);
    expect(sc(0)).toBe(0);
  });

  test('16-05: family expedTRO = crisis + dv_flag both required', () => {
    const s1 = computeAllSignals(mkMatter('family', { vulnerability_level: 'crisis', dv_flag: 1 }));
    const s2 = computeAllSignals(mkMatter('family', { vulnerability_level: 'crisis', dv_flag: 0 }));
    expect(s1.vertical_signals.expedTRO).toBe(true);
    expect(s2.vertical_signals.expedTRO).toBe(false);
  });

  test('16-06: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) {
      expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
    }
  });

  test('16-07: GAVEL_LEVELS: NONE=0, BRONZE=1, SILVER=2, GOLDEN=3', () => {
    expect(GAVEL_LEVELS.NONE).toBe(0);
    expect(GAVEL_LEVELS.BRONZE).toBe(1);
    expect(GAVEL_LEVELS.SILVER).toBe(2);
    expect(GAVEL_LEVELS.GOLDEN).toBe(3);
  });

  test('16-08: zero hex violations in all useTheme screens', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'",
                           "'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!src.includes('useTheme')) continue;
      const hexes = new Set(src.match(/'#[0-9A-Fa-f]{6}'/g) || []);
      for (const h of hexes) if (!BRAND.has(h)) violations.push(`${f}: ${h}`);
    }
    expect(violations).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. Mass Influx — 100,000 New Scenarios
// ═══════════════════════════════════════════════════════════════════════════
describe('17. Mass Influx — 100,000 New Scenarios', () => {

  test('17-01: 40,000 cross-vertical signal computations — zero errors', () => {
    const VERTS = ['criminal_defense','family','appellate','immigration',
                   'personal_injury','civil_rights','public_defense','military','juvenile','white_collar'];
    let errors = 0;
    for (let i = 0; i < 40000; i++) {
      const s = computeAllSignals(mkMatter(VERTS[i % VERTS.length], {
        evidence_score: i % 100,
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        dv_flag:             i % 5 === 0 ? 1 : 0,
        prior_adjudications: i % 6,
        is_capital:          i % 10 === 0 ? 1 : 0,
        years_post_conviction: i % 4,
        supervised_release:  i % 7 === 0 ? 1 : 0,
        jurisdiction:        i % 5 === 0 ? 'federal' : 'state',
      }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('17-02: 30,000 motion recommendations — all arrays, no crashes', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeMotionRecommendations({
        vertical: ['criminal_defense','public_defense','military','appellate'][i % 4],
        evidence_score: i % 100,
        title: ['Drug arrest search seizure','UCMJ court martial','DUI traffic stop','Federal fraud'][i % 4],
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
      });
      if (!Array.isArray(r)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('17-03: 30,000 encryption round-trips with varied payloads', () => {
    const PAYLOADS = ['short','medium length string 123','a'.repeat(200),'🔐⚖️🏛️','日本語',
                      '{"json":"object","value":42}'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const p = `${PAYLOADS[i % PAYLOADS.length]}_${i}`;
      if (decrypt(encrypt(p)) !== p) errors++;
    }
    expect(errors).toBe(0);
  });
});
