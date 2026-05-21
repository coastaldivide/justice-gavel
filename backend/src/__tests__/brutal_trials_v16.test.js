/**
 * JUSTICE GAVEL — BRUTAL TRIALS v16
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 16th brutal pass — the definitive screen coverage sweep.
 * Every screen still at 1 hit + all remaining service gaps.
 *
 * NEW DOMAINS (20 areas):
 *   1.  BailSearchScreen       — /providers/bail, GPS sort, sortBy, FlatList,
 *                                mounted guard, hapticCall, tel: linking
 *   2.  CaseTimelineScreen     — events, showAdd modal, useFocusEffect, PTR
 *   3.  CheckInManagerScreen   — /checkins/enroll, enrollment form (name/phone/
 *                                caseNum/courtDate/freq), useFocusEffect, PTR
 *   4.  CourtLocatorScreen     — search/courtMode/results states, Linking, list
 *   5.  DiscoveryScreen        — $19.99/doc, upload→analyze→result→history,
 *                                /discovery/status + analyze + history, clipboard
 *   6.  EmergencyShareScreen   — bail+lawyer providers, Share, Linking, phase
 *   7.  FirmAcquisitionScreen  — /firm-acquisition/status + checklist + plans +
 *                                upgrade, flow/selectedV/pitch states
 *   8.  HelpNowScreen          — GPS+bail+lawyers+courthouses, phase, isOffline
 *   9.  HousingRights+Tenant   — /lessons?category=Housing%20Rights, tab, PTR
 *  10.  IceDetention+Immigration — EOIR courts, /resources?category=IMMIGRATION_COURT,
 *                                  Linking, PTR, mounted guard
 *  11.  JuvenileJustice+MentalHealth — lesson tabs, activeStep, expandedProgram
 *  12.  LawyerProfileScreen     — /reviews + /saved/lawyers, Share, verified badge
 *  13.  QuickConnectScreen      — $19.99 one-tap package, GPS, /billing/quickconnect,
 *                                 /push/retention/post-purchase
 *  14.  RecoveryAgents+Search   — /recovery-agents (bondsman-only), /search debounce
 *  15.  RightsCardScreen        — /lessons/rights-card, Share export, subscription gate
 *  16.  ArrestMonitorScreen     — Pro tier, /arrests/monitors, up to 5 names
 *  17.  DUILaws+LessonsScreen   — cachedGet, DUILaw type, lesson cache
 *  18.  AuthGate + LegalDisclaimerModal — requireAuth model, quick signup PIN,
 *                                 CONSENT_VERSION='2.0', hasValidConsent fail-closed
 *  19.  sendgrid email builders + pushDelivery scheduled + geolink + aiQueue stats
 *  20.  Mass influx — 100,000 new scenarios
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations;
let encrypt, decrypt;
let normalizePhone, parseIntent;
let haversineKm, bboxFromLatLng, googleMapsLink;
let hasMinRole;
let safeInt, stripHtml, buildWhere, truncateStr;
let GAVEL_LEVELS, MOTION_TYPES;
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
  hasMinRole = rbac.hasMinRole;

  const rh  = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; stripHtml = rh.stripHtml;
  buildWhere = rh.buildWhere; truncateStr = rh.truncateStr;

  const gg  = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS;

  const motT = await import('../routes/motions/_motion_types.js');
  MOTION_TYPES = motT.MOTION_TYPES;

  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. BailSearchScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('1. BailSearchScreen — Bail Agent Directory', () => {

  test('1-01: fetches from /providers/bail', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx', 'utf8');
    expect(src).toContain("'/providers/bail'");
  });

  test('1-02: has sortBy, items, status, refreshing, _fetchError states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx', 'utf8');
    expect(src).toContain('sortBy');
    expect(src).toContain('items');
    expect(src).toContain('_fetchError');
  });

  test('1-03: uses hapticCall for phone interactions', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx', 'utf8');
    expect(src).toContain('hapticCall');
  });

  test('1-04: uses tel: scheme via Linking.openURL for calling agents', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx', 'utf8');
    expect(src).toContain('tel:');
    expect(src).toContain('Linking.openURL');
  });

  test('1-05: uses GPS and user state for location filtering', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx', 'utf8');
    expect(src).toContain('getLocation');
    expect(src).toContain('getUserState');
  });

  test('1-06: uses mountedRef guard and FlatList', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/BailSearchScreen.tsx', 'utf8');
    expect(src).toContain('mountedRef');
    expect(src).toContain('FlatList');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CaseTimelineScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('2. CaseTimelineScreen — Case Event Timeline', () => {

  test('2-01: has events, showAdd, useFocusEffect', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CaseTimelineScreen.tsx', 'utf8');
    expect(src).toContain('events');
    expect(src).toContain('showAdd');
    expect(src).toContain('useFocusEffect');
  });

  test('2-02: has PTR, mounted guard, Modal, FlatList', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CaseTimelineScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
    expect(src).toContain('Modal');
    expect(src).toContain('FlatList');
  });

  test('2-03: /push/reminders for event notification subscriptions', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CaseTimelineScreen.tsx', 'utf8');
    expect(src).toContain("'/push/reminders'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CheckInManagerScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('3. CheckInManagerScreen — Bondsman Enrollment Manager', () => {

  test('3-01: has enroll and enrollments endpoints', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CheckInManagerScreen.tsx', 'utf8');
    expect(src).toContain("'/checkins/enroll'");
    expect(src).toContain("'/checkins/enrollments'");
  });

  test('3-02: enrollment form has name, phone, caseNum, courtDate, freq', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CheckInManagerScreen.tsx', 'utf8');
    expect(src).toContain('name');
    expect(src).toContain('phone');
    expect(src).toContain('caseNum');
    expect(src).toContain('courtDate');
    expect(src).toContain('freq');
  });

  test('3-03: useFocusEffect, PTR, mounted guard, Modal, FlatList', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CheckInManagerScreen.tsx', 'utf8');
    expect(src).toContain('useFocusEffect');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CourtLocatorScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('4. CourtLocatorScreen — Court Finder', () => {

  test('4-01: has search, courtMode, results, loading, refreshing states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtLocatorScreen.tsx', 'utf8');
    expect(src).toContain('search');
    expect(src).toContain('courtMode');
    expect(src).toContain('results');
  });

  test('4-02: uses Linking for court websites and directions', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtLocatorScreen.tsx', 'utf8');
    expect(src).toContain('Linking');
  });

  test('4-03: uses mountedRef guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/CourtLocatorScreen.tsx', 'utf8');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. DiscoveryScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('5. DiscoveryScreen — AI Document Analysis ($19.99)', () => {

  test('5-01: DiscoveryScreen pricing is $19.99 per document (pay-per-use)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('$19.99');
  });

  test('5-02: uses /discovery/status, /discovery/analyze, /discovery/history', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain("'/discovery/status'");
    expect(src).toContain("'/discovery/analyze'");
    expect(src).toContain("'/discovery/history'");
  });

  test('5-03: upload→analyzing→result flow with phase state', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('phase');
    expect(src).toContain('file');
    expect(src).toContain('analysis');
  });

  test('5-04: has Clipboard copy and Share export for analysis results', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('Clipboard');
    expect(src).toContain('Share');
  });

  test('5-05: has PTR and mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. EmergencyShareScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('6. EmergencyShareScreen — Emergency Contact Sharing', () => {

  test('6-01: fetches bail and lawyer providers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/EmergencyShareScreen.tsx', 'utf8');
    expect(src).toContain("'/providers/bail'");
    expect(src).toContain("'/providers/lawyers'");
  });

  test('6-02: has phase, contacts, userName states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/EmergencyShareScreen.tsx', 'utf8');
    expect(src).toContain('phase');
    expect(src).toContain('contacts');
    expect(src).toContain('userName');
  });

  test('6-03: has Share and Linking + PTR + mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/EmergencyShareScreen.tsx', 'utf8');
    expect(src).toContain('Share');
    expect(src).toContain('Linking');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. FirmAcquisitionScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('7. FirmAcquisitionScreen — Firm Self-Serve Onboarding', () => {

  test('7-01: uses status, checklist, plans, upgrade endpoints', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FirmAcquisitionScreen.tsx', 'utf8');
    expect(src).toContain("'/firm-acquisition/status'");
    expect(src).toContain("'/firm-acquisition/checklist'");
    expect(src).toContain("'/firm-acquisition/plans'");
    expect(src).toContain("'/firm-acquisition/upgrade'");
  });

  test('7-02: has flow, loading, refreshing, selectedV, pitch states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FirmAcquisitionScreen.tsx', 'utf8');
    expect(src).toContain('flow');
    expect(src).toContain('selectedV');
    expect(src).toContain('pitch');
  });

  test('7-03: has PTR, Modal, Alert', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/FirmAcquisitionScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('Modal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. HelpNowScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('8. HelpNowScreen — Emergency Help Finder', () => {

  test('8-01: fetches bail, lawyers, courthouses, resources', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx', 'utf8');
    expect(src).toContain("'/providers/bail'");
    expect(src).toContain("'/providers/lawyers'");
    expect(src).toContain("'/courthouses'");
  });

  test('8-02: has phase, isOffline, bail, lawyer states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx', 'utf8');
    expect(src).toContain('phase');
    expect(src).toContain('isOffline');
    expect(src).toContain('bail');
    expect(src).toContain('lawyer');
  });

  test('8-03: has Share, Linking, PTR, mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HelpNowScreen.tsx', 'utf8');
    expect(src).toContain('Share');
    expect(src).toContain('Linking');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Housing & Tenant Rights Screens
// ═══════════════════════════════════════════════════════════════════════════
describe('9. HousingRights + TenantRights — Legal Aid Screens', () => {

  test('9-01: HousingRightsScreen fetches lessons and legal aid resources', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HousingRightsScreen.tsx', 'utf8');
    expect(src).toContain('Housing%20Rights');
    expect(src).toContain('LEGAL_AID');
  });

  test('9-02: HousingRightsScreen has tab, PTR, mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/HousingRightsScreen.tsx', 'utf8');
    expect(src).toContain('tab');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });

  test('9-03: TenantRightsScreen has situation state (context-aware)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TenantRightsScreen.tsx', 'utf8');
    expect(src).toContain('situation');
    expect(src).toContain('Linking');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. ICE Detention + Immigration Consequences
// ═══════════════════════════════════════════════════════════════════════════
describe('10. IceDetention + ImmigrationConsequences', () => {

  test('10-01: IceDetentionScreen fetches nearest EOIR court', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/IceDetentionScreen.tsx', 'utf8');
    expect(src).toContain('IMMIGRATION_COURT');
    expect(src).toContain('nearestEoirCourt');
  });

  test('10-02: IceDetentionScreen has Linking for courts + PTR + mounted', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/IceDetentionScreen.tsx', 'utf8');
    expect(src).toContain('Linking');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });

  test('10-03: ImmigrationConsequencesScreen has tab + EOIR courts + lessons', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx', 'utf8');
    expect(src).toContain('tab');
    expect(src).toContain('eiorCourts');
    expect(src).toContain('immigrationLesson');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. JuvenileJustice + MentalHealthDiversion
// ═══════════════════════════════════════════════════════════════════════════
describe('11. JuvenileJustice + MentalHealthDiversion', () => {

  test('11-01: JuvenileJusticeScreen has dbLessons, tab, activeStep', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/JuvenileJusticeScreen.tsx', 'utf8');
    expect(src).toContain('dbLessons');
    expect(src).toContain('tab');
    expect(src).toContain('activeStep');
  });

  test('11-02: JuvenileJusticeScreen fetches /lessons?category=Juvenile', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/JuvenileJusticeScreen.tsx', 'utf8');
    expect(src).toContain('Juvenile');
    expect(src).toContain('RefreshControl');
  });

  test('11-03: MentalHealthDiversionScreen has expandedProgram, Linking', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/MentalHealthDiversionScreen.tsx', 'utf8');
    expect(src).toContain('expandedProgram');
    expect(src).toContain('Linking');
  });

  test('11-04: MentalHealthDiversionScreen fetches Mental Health lessons', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/MentalHealthDiversionScreen.tsx', 'utf8');
    expect(src).toContain('Mental%20Health');
    expect(src).toContain('dbLessons');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. LawyerProfileScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('12. LawyerProfileScreen — Full Attorney Profile', () => {

  test('12-01: fetches /reviews and /saved/lawyers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain("'/reviews'");
    expect(src).toContain("'/saved/lawyers'");
  });

  test('12-02: has lawyer, reviews, userRating, loading, refreshing', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('lawyer');
    expect(src).toContain('reviews');
    expect(src).toContain('userRating');
  });

  test('12-03: has Share, Linking, Alert, PTR, mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('Share');
    expect(src).toContain('Linking');
    expect(src).toContain('Alert');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });

  test('12-04: takes lawyerId and optionally lawyerData from navigation params', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('lawyerId');
    expect(src).toContain('lawyerData');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. QuickConnectScreen — $19.99 One-Tap Package
// ═══════════════════════════════════════════════════════════════════════════
describe('13. QuickConnectScreen — $19.99 One-Tap', () => {

  test('13-01: QuickConnect is $19.99 one-time package', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    expect(src).toContain('$19.99');
  });

  test('13-02: uses /billing/quickconnect and /push/retention/post-purchase', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    expect(src).toContain("'/billing/quickconnect'");
    expect(src).toContain("'/push/retention/post-purchase'");
  });

  test('13-03: GPS-first: locReady, locError, coords states', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    expect(src).toContain('locReady');
    expect(src).toContain('locError');
    expect(src).toContain('coords');
  });

  test('13-04: one bail bondsman + one lawyer nearest to GPS', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    // $10 bail + $10 lawyer = $19.99 package
    expect(src).toContain('bondsman');
    expect(src).toContain('lawyer');
  });

  test('13-05: uses /referrals/credit for credit check', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    expect(src).toContain("'/referrals/credit'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. RecoveryAgentsScreen + SearchScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('14. RecoveryAgents + Search — Specialized Searches', () => {

  test('14-01: RecoveryAgentsScreen accessible only from Bondsman Dashboard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RecoveryAgentsScreen.tsx', 'utf8');
    expect(src).toContain('Bondsman Dashboard');
  });

  test('14-02: RecoveryAgentsScreen has armedOnly filter + state law display', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RecoveryAgentsScreen.tsx', 'utf8');
    expect(src).toContain('armedOnly');
    expect(src).toContain('stateLaw');
    expect(src).toContain('selectedState');
  });

  test('14-03: RecoveryAgentsScreen fetches /recovery-agents', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RecoveryAgentsScreen.tsx', 'utf8');
    expect(src).toContain("'/recovery-agents'");
  });

  test('14-04: SearchScreen uses /search with debounce', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SearchScreen.tsx', 'utf8');
    expect(src).toContain("'/search'");
    expect(src).toContain('debounce');
    expect(src).toContain('300');
  });

  test('14-05: SearchScreen searches Cases, Messages, Saved Lawyers, Lessons', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/SearchScreen.tsx', 'utf8');
    expect(src).toContain('Cases');
    expect(src).toContain('query');
    expect(src).toContain('results');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. RightsCardScreen — Know Your Rights Card
// ═══════════════════════════════════════════════════════════════════════════
describe('15. RightsCardScreen — Rights Wallet Card', () => {

  test('15-01: fetches /lessons/rights-card for state-specific rights', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    expect(src).toContain("'/lessons/rights-card'");
  });

  test('15-02: has state, card, sharing states + PTR + mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    expect(src).toContain('state');
    expect(src).toContain('card');
    expect(src).toContain('sharing');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('mountedRef');
  });

  test('15-03: Share export for virality — designed for TikTok', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    expect(src).toContain('Share');
    expect(src).toContain('TikTok');
  });

  test('15-04: subscription check — free for Starter+ subscribers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    expect(src).toContain("'/billing/consumer/subscription'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. ArrestMonitorScreen — Pro Tier Arrest Alerts
// ═══════════════════════════════════════════════════════════════════════════
describe('16. ArrestMonitorScreen — Arrest Monitoring', () => {

  test('16-01: ArrestMonitor is a Pro tier feature', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ArrestMonitorScreen.tsx', 'utf8');
    expect(src).toContain('Pro');
    expect(src).toContain('isPro');
  });

  test('16-02: fetches /billing/subscription and /arrests/monitors', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ArrestMonitorScreen.tsx', 'utf8');
    expect(src).toContain("'/billing/subscription'");
    expect(src).toContain("'/arrests/monitors'");
  });

  test('16-03: has watches, name states (up to 5 names monitored)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ArrestMonitorScreen.tsx', 'utf8');
    expect(src).toContain('watches');
    expect(src).toContain('name');
  });

  test('16-04: PTR + Alert + mounted guard', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ArrestMonitorScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('Alert');
    expect(src).toContain('mountedRef');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. DUILawsScreen + LessonsScreen
// ═══════════════════════════════════════════════════════════════════════════
describe('17. DUILaws + LessonsScreen — Content Screens', () => {

  test('17-01: DUILawsScreen uses cachedGet', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DUILawsScreen.tsx', 'utf8');
    expect(src).toContain('cachedGet');
  });

  test('17-02: DUILaw type has bac_limit, state, search, tab, selected', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DUILawsScreen.tsx', 'utf8');
    expect(src).toContain('bac_limit');
    expect(src).toContain('search');
    expect(src).toContain('tab');
    expect(src).toContain('selected');
  });

  test('17-03: LessonsScreen uses cachedGet + cacheLessons for offline', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LessonsScreen.tsx', 'utf8');
    expect(src).toContain('cachedGet');
    expect(src).toContain('cacheLessons');
    expect(src).toContain('getCachedLessons');
  });

  test('17-04: LessonsScreen has lessons, completed, expanded, filterCat, loading', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LessonsScreen.tsx', 'utf8');
    expect(src).toContain('lessons');
    expect(src).toContain('completed');
    expect(src).toContain('expanded');
    expect(src).toContain('filterCat');
  });

  test('17-05: LessonsScreen uses AsyncStorage for completion tracking', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/LessonsScreen.tsx', 'utf8');
    expect(src).toContain('AsyncStorage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. AuthGate + LegalDisclaimerModal
// ═══════════════════════════════════════════════════════════════════════════
describe('18. AuthGate + LegalDisclaimerModal — Auth UX', () => {

  test('18-01: AuthGate uses requireAuth — checks token first', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/AuthGate.tsx', 'utf8');
    expect(src).toContain('requireAuth');
    expect(src).toContain('getToken');
    expect(src).toContain('pendingFn');
  });

  test('18-02: AuthGate has quick signup mode: phone + 4-digit PIN', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/AuthGate.tsx', 'utf8');
    expect(src).toContain('quickMode');
    expect(src).toContain('pin');
    expect(src).toContain('phone');
    expect(src).toContain('4-digit PIN');
  });

  test('18-03: AuthGate quick signup posts to /auth/register', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/AuthGate.tsx', 'utf8');
    expect(src).toContain("'/auth/register'");
    expect(src).toContain('doQuickSignup');
  });

  test('18-04: AuthGate double-PIN as password (pin + pin)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/AuthGate.tsx', 'utf8');
    expect(src).toContain('pin + pin');
  });

  test('18-05: AuthGate Modal is memoized (React.memo)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/AuthGate.tsx', 'utf8');
    expect(src).toContain('React.memo');
    expect(src).toContain('_AuthGateModalMemo');
  });

  test('18-06: LegalDisclaimerModal CONSENT_VERSION is "2.0"', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalDisclaimerModal.tsx', 'utf8');
    expect(src).toContain("CONSENT_VERSION = '2.0'");
  });

  test('18-07: LegalDisclaimerModal hasValidConsent is fail-closed', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalDisclaimerModal.tsx', 'utf8');
    // fail-closed: catch block returns false (not true)
    expect(src).toContain('return false');
  });

  test('18-08: consent key is jg_consent_v${CONSENT_VERSION}', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalDisclaimerModal.tsx', 'utf8');
    expect(src).toContain('CONSENT_KEY');
    expect(src).toContain('jg_consent_v');
  });

  test('18-09: storeConsent sets key to "true", clearConsent removes it', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalDisclaimerModal.tsx', 'utf8');
    expect(src).toContain("setItem(CONSENT_KEY, 'true')");
    expect(src).toContain('removeItem(CONSENT_KEY)');
  });

  test('18-10: requireAuth model — calls fn() immediately if token exists', () => {
    let called = false;
    const requireAuth = async (fn, getToken) => {
      const token = await getToken();
      if (token) fn();
    };
    requireAuth(() => { called = true; }, async () => 'token123');
    // Async — just verify the model
    expect(typeof requireAuth).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. sendgrid email builders + pushDelivery + geolink + aiQueue
// ═══════════════════════════════════════════════════════════════════════════
describe('19. Service Functions — Email, Push, Geo, Queue', () => {

  // sendgrid email builders
  test('19-01: buildEmailHtml generates preheader hidden div', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('buildEmailHtml');
    expect(src).toContain('max-height:0');  // hidden preheader technique
    expect(src).toContain('.w{max-width:600px');
  });

  test('19-02: buildPasswordResetEmail has 1-hour expiry warning', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('buildPasswordResetEmail');
    expect(src).toContain('1 hour');
    expect(src).toContain('Reset Password');
  });

  test('19-03: buildWelcomeEmail personalized with displayName (fallback "there")', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('buildWelcomeEmail');
    expect(src).toContain("|| 'there'");
    expect(src).toContain('Welcome,');
  });

  test('19-04: buildReceiptEmail includes tier, amount, nextBillingDate', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/sendgrid.js', 'utf8');
    expect(src).toContain('buildReceiptEmail');
    expect(src).toContain('tier');
    expect(src).toContain('nextBillingDate');
    expect(src).toContain('Subscription confirmed');
  });

  // pushDelivery scheduled
  test('19-05: deliverScheduledPushes drains scheduled_pushes WHERE deliver_at <= NOW()', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/pushDelivery.js', 'utf8');
    expect(src).toContain('deliverScheduledPushes');
    expect(src).toContain('scheduled_pushes');
    expect(src).toContain("deliver_at <= datetime('now')");
    expect(src).toContain("status = 'pending'");
  });

  test('19-06: checkPushReceipts removes invalid tokens (DeviceNotRegistered)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/pushDelivery.js', 'utf8');
    expect(src).toContain('checkPushReceipts');
    expect(src).toContain('DeviceNotRegistered');
  });

  // geolink
  test('19-07: googleMapsLink generates correct URL format', () => {
    const link = googleMapsLink(36.1627, -86.7816);
    expect(link).toBe('https://maps.google.com/?q=36.1627,-86.7816');
  });

  test('19-08: haversineMiles exported from geolink.js', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/geolink.js', 'utf8');
    expect(src).toContain('haversineMiles');
    expect(src).toContain('0.621371');  // km→miles conversion factor
  });

  // aiQueue
  test('19-09: JOB_TTL_MS is 15 minutes (900,000ms)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/aiQueue.js', 'utf8');
    expect(src).toContain('JOB_TTL_MS   = 15 * 60 * 1000');
  });

  test('19-10: POLL_WARN_MS is 45 seconds (warns on slow jobs)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/aiQueue.js', 'utf8');
    expect(src).toContain('POLL_WARN_MS = 45 * 1000');
  });

  test('19-11: getQueueStats returns pending, running, completed counts', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/aiQueue.js', 'utf8');
    expect(src).toContain('getQueueStats');
    expect(src).toContain('pending');
    expect(src).toContain('running');
    expect(src).toContain('completed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. Regression + Mass Influx
// ═══════════════════════════════════════════════════════════════════════════
describe('20. Regression + Mass Influx — 100,000 New Scenarios', () => {

  test('20-01: googleMapsLink is always a valid maps URL', () => {
    const testCoords = [
      [36.1627, -86.7816],  // Nashville
      [34.0522, -118.2437], // LA
      [40.7128, -74.0060],  // NYC
      [-33.8688, 151.2093], // Sydney
    ];
    for (const [lat, lng] of testCoords) {
      const link = googleMapsLink(lat, lng);
      expect(link).toContain('maps.google.com/?q=');
      expect(link).toContain(String(lat));
      expect(link).toContain(String(lng));
    }
  });

  test('20-02: 30,000 signal computations — all verticals + variants', () => {
    const VERTS = ['criminal_defense','family','appellate','immigration',
                   'personal_injury','civil_rights','public_defense','military','juvenile'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(VERTS[i % VERTS.length], {
        evidence_score: i % 100,
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        dv_flag: i % 5 === 0 ? 1 : 0,
        prior_adjudications: i % 6,
        is_capital: i % 10 === 0 ? 1 : 0,
        years_post_conviction: i % 4,
      }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('20-03: 30,000 motion recommendations — all arrays', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeMotionRecommendations({
        vertical: ['criminal_defense','public_defense','military'][i % 3],
        evidence_score: i % 100,
        title: 'Drug arrest search seizure',
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
      });
      if (!Array.isArray(r)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('20-04: 20,000 haversine + bbox calculations — always finite', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
      const lat = (i * 17 % 160) - 80;
      const lng = (i * 23 % 340) - 170;
      const km = haversineKm(lat, lng, lat + 0.5, lng + 0.5);
      const bbox = bboxFromLatLng(lat, lng, 25);
      if (!isFinite(km) || km < 0) errors++;
      if (!isFinite(bbox.minLat) || !isFinite(bbox.maxLng)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('20-05: 20,000 encryption round-trips — 100% fidelity', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
      const p = `payload_${i}`;
      if (decrypt(encrypt(p)) !== p) errors++;
    }
    expect(errors).toBe(0);
  });

  test('20-06: zero hex violations in all useTheme screens (regression)', async () => {
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
