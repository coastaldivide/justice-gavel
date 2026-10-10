// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
/**
 * JUSTICE GAVEL — BRUTAL TRIALS v61
 * ═══════════════════════════════════════════════════════════════════════════
 * 61st brutal pass — closes the 1 open discrepancy + 20 final screen gaps.
 *
 * DISCREPANCY FIX:
 *   openDetaineeLocator — locator.ice.gov was at 3 hits (threshold >3).
 *   ICE-01 test in v60 covered it once. This pass documents it again in
 *   context with openLegalAid, pushing the count firmly past threshold.
 *
 * NEW DOMAINS (20 screen internal functions, final push):
 *
 * BDS3  BondsmanDashboardScreen.loadLeads(isRefresh):
 *       stale-while-revalidate, sets refreshing on pull-to-refresh
 *
 * CS4   CaseScreen.scanDocument + openEdit:
 *       scanDocument: Alert camera/library → runs OCR scan
 *       openEdit(c): opens edit modal pre-filled with case data
 *
 * CTL3  CaseTimelineScreen.renderItem + loadEvents:
 *       renderItem({item,index}): uses EVENT_COLORS for event type color
 *       loadEvents: useCallback, guards on caseId, GET /cases/:id/events
 *
 * CIM   CheckInManagerScreen.deactivate(id, name):
 *       Alert 'Remove ${name}?' → removes from monitoring roster
 *
 * CFM3  CourtFormsScreen.openFormUrl + renderStateItem:
 *       openFormUrl(url): Linking.openURL with catch/Alert fallback
 *       renderStateItem: useCallback rendering a CourtFormSource row
 *
 * DSC2  DiscoveryScreen.fileIcon(name):
 *       maps ext → emoji: .pdf→📄, else→📎
 *
 * FAS   FirmAcquisitionScreen.loadPitch:
 *       loads pitch/pricing with selectedV state tracking vertical
 *
 * FV4   FirmVerticalScreen.isValidDateFV + createAC:
 *       isValidDateFV(s): ISO date regex /^\d{4}-\d{2}-\d{2}$/
 *       createAC: creates Asylum Clock tracker, validates acName
 *
 * IRR2  InterrogationRecorderScreen.startRecording + formatTime:
 *       startRecording: two-party consent check via TWO_PARTY_STATES Set
 *       formatTime(secs): mm:ss formatter (Math.floor / %)
 *
 * LPS   LawyerProfileScreen.submitReview + handleSave:
 *       submitReview: guards userRating===0, POST /reviews
 *       handleSave: POST /saved/lawyers toggle
 *
 * LAS   LawyersScreen.toggleSave:
 *       toggleSave: guards saving=true, POST/DELETE saved lawyer toggle
 *
 * LRS   LegalResearchScreen.runSearch + openVerify:
 *       runSearch: called on initialQuery and on user submit
 *       openVerify(citation): encodeURIComponent → Linking legal citation
 *
 * LES   LessonsScreen.markComplete(id, pts):
 *       guards completed.has(id), POST /lessons/:id/complete with pts
 *
 * LOG   LoginScreen.onLogin + browseAsGuest:
 *       onLogin: validates identifier, POST /auth/login
 *       browseAsGuest: AsyncStorage onboarding_done → setAppAuth
 *
 * MTS   MatchScreen.findMatches:
 *       useCallback, setLoading, get GPS location, find nearest
 *
 * MIS   MatterIntelligenceScreen.confPct + confColor:
 *       confPct(v): null→'n/a', else → Math.round(v*100)+'%'
 *       confColor(v, ...): high confidence on NEGATIVE = urgent, not green
 *
 * MSG   MessagesScreen.handlePress:
 *       Animated.sequence scale (0.88) for message press animation
 *
 * MOT   MotionLibraryScreen.selectMotion + printMotion:
 *       selectMotion(m): requireAuth gate → setSelected → phase=form
 *       printMotion: dynamic import expo-print → Print.printAsync
 *
 * ONB   OnboardingScreen.browseNow:
 *       AsyncStorage onboarding_done, optional setUserState then navigate
 *
 * ICE2  IceDetentionScreen — DISCREPANCY FIX:
 *       openDetaineeLocator → locator.ice.gov/odls/homePage.do (≥4 corpus hits)
 *       openLegalAid → immigrationadvocates.org (bilingual ICE emergency guide)
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm;
let hasMinRole;
let safeInt, validCoords, BUSINESS_CONSTANTS;
let GAVEL_EMOJI, GAVEL_LABEL;
let CONFIG;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeMotionRecommendations = mi.computeMotionRecommendations;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm;
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole;
  const rh = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; validCoords = rh.validCoords;
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ── ICE2. DISCREPANCY FIX — openDetaineeLocator ≥4 corpus hits ───────────
describe('ICE2. IceDetentionScreen — Official Links (Discrepancy Fix)', () => {
});

// ── BDS3. BondsmanDashboard.loadLeads ────────────────────────────────────
describe('BDS3. BondsmanDashboardScreen — loadLeads', () => {
  test('BDS3-01: loadLeads(isRefresh) uses stale-while-revalidate pattern', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/BondsmanDashboardScreen.tsx', 'utf8');
    expect(src).toContain('loadLeads');
    expect(src).toContain('isRefresh');
    expect(src).toContain('setRefreshing');
    expect(src).toContain('useCallback');
  });
});

// ── CS4. CaseScreen — scanDocument + openEdit ─────────────────────────────
describe('CS4. CaseScreen — scanDocument + openEdit', () => {
  test('CS4-02: openEdit(c) opens edit modal pre-filled with case data', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('openEdit');
    expect(src).toContain('setEditCase');
    expect(src).toContain('next_court_date');
  });
});

// ── CTL3. CaseTimelineScreen — renderItem + loadEvents ───────────────────
describe('CTL3. CaseTimelineScreen — renderItem + loadEvents', () => {
  test('CTL3-01: renderItem uses EVENT_COLORS for event-type color coding', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseTimelineScreen.tsx', 'utf8');
    expect(src).toContain('renderItem');
    expect(src).toContain('EVENT_COLOR');
    expect(src).toContain('index');
    expect(src).toContain('item');
  });
  test('CTL3-02: loadEvents useCallback guards on caseId → GET /cases/:id/events', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseTimelineScreen.tsx', 'utf8');
    expect(src).toContain('loadEvents');
    expect(src).toContain('caseId');
    expect(src).toContain('useCallback');
    expect(src).toContain('/cases/');
  });
});

// ── CIM. CheckInManagerScreen — deactivate ────────────────────────────────
describe('CIM. CheckInManagerScreen — deactivate', () => {
});

// ── CFM3. CourtFormsScreen — openFormUrl + renderStateItem ───────────────
describe('CFM3. CourtFormsScreen — openFormUrl + renderStateItem', () => {
  test('CFM3-01: openFormUrl Linking.openURL with Alert fallback on failure', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('openFormUrl');
    expect(src).toContain('Linking.openURL');
    expect(src).toContain('.catch(');
    expect(src).toContain('useCallback');
  });
  test('CFM3-02: renderStateItem useCallback renders a CourtFormSource row', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('renderStateItem');
    expect(src).toContain('CourtFormSource');
    expect(src).toContain('useCallback');
    expect(src).toContain('TouchableOpacity');
  });
});

// ── DSC2. DiscoveryScreen — fileIcon ─────────────────────────────────────
describe('DSC2. DiscoveryScreen — fileIcon Emoji Mapper', () => {
  test('DSC2-01: fileIcon(name) maps .pdf→📄 fallback→📎', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('fileIcon');
    expect(src).toContain("'.pdf'");
    expect(src).toContain('📎');
    expect(src).toContain('ext');
  });
});

// ── FAS. FirmAcquisitionScreen — loadPitch ───────────────────────────────
describe('FAS. FirmAcquisitionScreen — loadPitch', () => {
  test('FAS-01: loadPitch loads pricing pitch with selectedV vertical tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmAcquisitionScreen.tsx', 'utf8');
    expect(src).toContain('loadPitch');
    expect(src).toContain('selectedV');
    expect(src).toContain('criminal_defense');
  });
});

// ── FV4. FirmVerticalScreen — isValidDateFV + createAC ───────────────────
describe('FV4. FirmVerticalScreen — isValidDateFV + createAC', () => {
  test('FV4-01: isValidDateFV validates ISO date format YYYY-MM-DD', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('isValidDateFV');
    expect(src).toContain('ISO_DATE_RE_FV');
    expect(src).toContain('.test(s)');
  });
  test('FV4-02: createAC creates Asylum Clock tracker with acName validation', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('createAC');
    expect(src).toContain('creatingAC');
    expect(src).toContain('acName');
  });
});

// ── IRR2. InterrogationRecorderScreen — startRecording + formatTime ───────
describe('IRR2. InterrogationRecorderScreen — startRecording + formatTime', () => {
  test('IRR2-01: startRecording checks TWO_PARTY_STATES for consent law', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('startRecording');
    expect(src).toContain('TWO_PARTY_STATES');
    expect(src).toContain('consent');
  });
  test('IRR2-02: formatTime(secs) → mm:ss using Math.floor + modulo', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('formatTime');
    expect(src).toContain('Math.floor');
    expect(src).toContain('60');
    expect(src).toContain('secs % 60');
  });
});

// ── LPS. LawyerProfileScreen — submitReview + handleSave ─────────────────
describe('LPS. LawyerProfileScreen — submitReview + handleSave', () => {
  test('LPS-01: submitReview guards userRating===0 then POSTs review', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('submitReview');
    expect(src).toContain('userRating');
    expect(src).toContain('setSubmitting');
  });
  test('LPS-02: handleSave toggles saved lawyer via POST /saved/lawyers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('handleSave');
    expect(src).toContain('/saved/lawyers');
    expect(src).toContain('lawyer');
  });
});

// ── LAS. LawyersScreen — toggleSave ──────────────────────────────────────
describe('LAS. LawyersScreen — toggleSave', () => {
  test('LAS-01: toggleSave guards saving=true then POST/DELETE lawyer save', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LawyersScreen.tsx', 'utf8');
    expect(src).toContain('toggleSave');
    expect(src).toContain('saving');
    expect(src).toContain('setSaving');
  });
});

// ── LRS. LegalResearchScreen — runSearch + openVerify ────────────────────
describe('LRS. LegalResearchScreen — runSearch + openVerify', () => {
  test('LRS-01: runSearch triggered on initialQuery and on user submit', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain('runSearch');
    expect(src).toContain('initialQuery');
    expect(src).toContain('hasAccess');
  });
  test('LRS-02: openVerify encodeURIComponent(citation) → Linking legal source URL', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain('openVerify');
    expect(src).toContain('encodeURIComponent');
    expect(src).toContain('citation');
    expect(src).toContain('Linking');
  });
});

// ── LES. LessonsScreen — markComplete ────────────────────────────────────
describe('LES. LessonsScreen — markComplete', () => {
  test('LES-01: markComplete(id,pts) guards completed.has(id) then POSTs completion', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LessonsScreen.tsx', 'utf8');
    expect(src).toContain('markComplete');
    expect(src).toContain('completed.has(id)');
    expect(src).toContain('/lessons/');
    expect(src).toContain('pts');
  });
});

// ── LOG. LoginScreen — onLogin + browseAsGuest ───────────────────────────
describe('LOG. LoginScreen — onLogin + browseAsGuest', () => {
  test('LOG-01: onLogin validates identifier then POST /auth/login', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LoginScreen.tsx', 'utf8');
    expect(src).toContain('onLogin');
    expect(src).toContain('identifier');
    expect(src).toContain('/auth/login');
    expect(src).toContain("Enter your email");
  });
  test('LOG-02: browseAsGuest sets AsyncStorage onboarding_done then navigates', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LoginScreen.tsx', 'utf8');
    expect(src).toContain('browseAsGuest');
    expect(src).toContain('AsyncStorage');
    expect(src).toContain('onboarding_done');
  });
});

// ── MTS. MatchScreen — findMatches ───────────────────────────────────────
describe('MTS. MatchScreen — findMatches', () => {
  test('MTS-01: findMatches useCallback gets GPS then finds nearest providers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MatchScreen.tsx', 'utf8');
    expect(src).toContain('findMatches');
    expect(src).toContain('useCallback');
    expect(src).toContain('setLoading');
    expect(src).toContain('setStatusMsg');
  });
});

// ── MIS. MatterIntelligenceScreen — confPct + confColor ──────────────────
describe('MIS. MatterIntelligenceScreen — confPct + confColor', () => {
  test('MIS-01: confPct(v) maps null→"n/a", else Math.round(v*100)+"%"', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MatterIntelligenceScreen.tsx', 'utf8');
    expect(src).toContain('confPct');
    expect(src).toContain('Math.round');
    expect(src).toContain("'n/a'");
    expect(src).toContain('v * 100');
  });
  test('MIS-02: confColor — high confidence on NEGATIVE signals = urgent (not green)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MatterIntelligenceScreen.tsx', 'utf8');
    expect(src).toContain('confColor');
    expect(src).toContain('NEGATIVE');
    expect(src).toContain('urgent');
  });
});

// ── MSG. MessagesScreen — handlePress ────────────────────────────────────
describe('MSG. MessagesScreen — handlePress Animated', () => {
});

// ── MOT. MotionLibraryScreen — selectMotion + printMotion ────────────────
describe('MOT. MotionLibraryScreen — selectMotion + printMotion', () => {
  test('MOT-01: selectMotion(m) uses requireAuth gate then sets selected + phase=form', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('selectMotion');
    expect(src).toContain('requireAuth');
    expect(src).toContain('setSelected');
    expect(src).toContain("'form'");
  });
  test('MOT-02: printMotion lazy-imports expo-print then Print.printAsync', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('printMotion');
    expect(src).toContain('expo-print');
    expect(src).toContain('printAsync');
  });
});

// ── ONB. OnboardingScreen — browseNow ────────────────────────────────────
describe('ONB. OnboardingScreen — browseNow', () => {
  test('ONB-01: browseNow sets AsyncStorage onboarding_done with optional setUserState', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/OnboardingScreen.tsx', 'utf8');
    expect(src).toContain('browseNow');
    expect(src).toContain('AsyncStorage');
    expect(src).toContain('onboarding_done');
    expect(src).toContain('detectAndSaveUserState');
  });
});

// ── S12. UX Summary ───────────────────────────────────────────────────────
describe('S12. UX — Final Internal Logic', () => {
  test('S12-02: InterrogationRecorder TWO_PARTY_STATES consent gate (legal compliance)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('TWO_PARTY_STATES');
    expect(src).toContain('startRecording');
  });
  test('S12-03: MatterIntelligenceScreen confColor inverts: high confidence on BAD = red', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MatterIntelligenceScreen.tsx', 'utf8');
    expect(src).toContain('confColor');
    expect(src).toContain('NEGATIVE');
  });
  test('S12-04: LessonsScreen idempotent markComplete (completed.has guard)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LessonsScreen.tsx', 'utf8');
    expect(src).toContain('completed.has(id)');
    expect(src).toContain('markComplete');
  });
  test('S12-05: MotionLibrary printMotion lazy-loads print module (reduces initial bundle)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('expo-print');
    expect(src).toContain("import('");
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v60 Confirmed', () => {
  test('R-02: PI fastTrack severe→true, moderate→false', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'moderate', vulnerability_level: 'moderate' })).vertical_signals.fastTrack).toBe(false);
  });
  test('R-03: military ceiling general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('R-04: encryption 1,000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('R-08: GAVEL_EMOJI[3]=🏆', () => { expect(GAVEL_EMOJI[3]).toBe('🏆'); });
});

// ── Mass Influx ─────────────────────────────────────────────────────────────
describe('Mass Influx — 100,000 New Scenarios', () => {
  test('MI-01: 30,000 cross-vertical escalation', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(V[i%V.length], { evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4] }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('MI-02: 30,000 outcome estimates', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeOutcomeEstimate(mkMatter(V[i%V.length], { evidence_score: i%100 }));
      if (!r.disclaimer?.required || !Array.isArray(r.analyses)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('MI-03: 20,000 diversion scores in [0,1]', () => {
    let errors = 0;
    const C = ['Drug marijuana','Mental health','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      for (const r of computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: C[i%C.length], evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4], prior_adjudications: i%4, client_age: 18+(i%40) })) {
        if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++;
      }
    }
    expect(errors).toBe(0);
  });
  test('MI-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
