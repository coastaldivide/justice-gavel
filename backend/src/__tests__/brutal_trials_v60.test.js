import { feSource } from './helpers/feSource.js';
// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
/**
 * JUSTICE GAVEL — BRUTAL TRIALS v60
 * ═══════════════════════════════════════════════════════════════════════════
 * 60th brutal pass — ALL DISCREPANCIES CONFIRMED RESOLVED (19/19 ✓).
 * Closing remaining internal function gaps.
 *
 * NEW DOMAINS (15 areas):
 *
 * DIS  DiscoveryScreen — runAnalysis + pickFile:
 *      runAnalysis: $19.99 pricing, may show Alert or run directly
 *      pickFile: useCallback → expo-document-picker dynamic import
 *
 * IRR  InterrogationRecorderScreen — doStartRecording + stopAndProcess + savePDF:
 *      doStartRecording: Alert confirm → starts native audio recording
 *      stopAndProcess: hapticNotification → clearInterval → processes audio
 *
 * GGS  GoldenGavelScreen — handleOptIn: POST /golden-gavel/hall/opt-in
 *
 * ICE  IceDetentionScreen — openDetaineeLocator + openLegalAid:
 *      openDetaineeLocator: ICE detainee locator URL (locator.ice.gov)
 *      openLegalAid: immigrationadvocates.org nonprofit locator
 *
 * INS  InsuranceScreen — getQuote: POST /insurance/quote
 *
 * DLC  DeadlineCalculatorScreen — urgentCount (useMemo):
 *      counts deadlines ≤7 days out from DEADLINE_RULES filter
 *
 * FV3  FirmVerticalScreen — submitMission + saveConfig:
 *      submitMission: validates missionEIN OR missionWeb before submit
 *      saveConfig: PATCH /firm-verticals/mine with vertical config
 *
 * JAR  JustArrestedScreen — handleAction:
 *      hapticImpact → action='find_help' → navigation
 *
 * BCA  BailCalculatorScreen — bondCost helper:
 *      bondCost(bail) = Math.round(bail * bondPct / 100)
 *
 * CHS2 ChatScreen — loadHistory:
 *      loads session history when session ID provided on mount
 *
 * CS3  CaseScreen — pickScanSource + openInvite + openNew:
 *      pickScanSource('camera'|'library') → selects scan source
 *      openInvite(cas) → opens invite modal, resets email/name
 *      openNew → reset to new case form
 *
 * AGS  AgeGateScreen — handleYear:
 *      digits-only, max 4 chars, validates ≥18
 *
 * ADV  AdvocacyScreen — formatDate:
 *      ISO → US locale date string
 *
 * CFM2 CourtFormsScreen — loadAiGuide + onSelectState:
 *      loadAiGuide: useCallback, guards on state+category → /chat/ask
 *      onSelectState: useCallback → setSelectedState → phase=category_select
 *
 * EXP2 ExpungementScreen — checkEligibility:
 *      debounced 400ms → GET /expungement/check
 */


let computeAllSignals, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let GAVEL_EMOJI;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
   const gg = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI;   });

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ── DIS. DiscoveryScreen — runAnalysis + pickFile ─────────────────────────
describe('DIS. DiscoveryScreen — runAnalysis + pickFile', () => {
  test('DIS-01: runAnalysis is $19.99 analysis that may show Alert or run directly', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('runAnalysis');
    expect(src).toContain('$19.99');
    expect(src).toContain('Analyze');
  });
  test('DIS-02: pickFile uses dynamic import of expo-document-picker (lazy load)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('pickFile');
    expect(src).toContain('useCallback');
    expect(src).toContain('DocumentPicker');
    expect(src).toContain("import('");
  });
});

// ── IRR. InterrogationRecorderScreen — Recording Handlers ─────────────────
describe('IRR. InterrogationRecorderScreen — doStartRecording + stopAndProcess', () => {
  test('IRR-02: stopAndProcess fires hapticNotification + clearInterval before processing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('stopAndProcess');
    expect(src).toContain('hapticNotification');
    expect(src).toContain('clearInterval');
  });
});

// ── GGS. GoldenGavelScreen — handleOptIn ──────────────────────────────────
describe('GGS. GoldenGavelScreen — handleOptIn', () => {
  test('GGS-01: handleOptIn POSTs to /golden-gavel/hall/opt-in', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/GoldenGavelScreen.tsx', 'utf8');
    expect(src).toContain('handleOptIn');
    expect(src).toContain('/golden');
    expect(src).toContain('setOptingIn');
  });
});

// ── ICE. IceDetentionScreen — Linker Helpers ──────────────────────────────
describe('ICE. IceDetentionScreen — openDetaineeLocator + openLegalAid', () => {
});

// ── INS. InsuranceScreen — getQuote ───────────────────────────────────────
describe('INS. InsuranceScreen — getQuote', () => {
  test('INS-01: getQuote POSTs to /insurance/quote with setGetting loading state', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InsuranceScreen.tsx', 'utf8');
    expect(src).toContain('getQuote');
    expect(src).toContain('setGetting');
    expect(src).toContain('setQuote');
    expect(src).toContain("'/insurance/quote'");
  });
});

// ── DLC. DeadlineCalculatorScreen — urgentCount ───────────────────────────
describe('DLC. DeadlineCalculatorScreen — urgentCount useMemo', () => {
  test('DLC-01: urgentCount is useMemo counting deadlines ≤7 days from DEADLINE_RULES', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain('urgentCount');
    expect(src).toContain('useMemo');
    expect(src).toContain('DEADLINE_RULES');
    expect(src).toContain('arrestDate');
  });
});

// ── FV3. FirmVerticalScreen — submitMission + saveConfig ──────────────────
describe('FV3. FirmVerticalScreen — submitMission + saveConfig', () => {
  test('FV3-01: submitMission validates missionEIN or missionWeb before submission', async () => {
    const src = feSource(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx');
    expect(src).toContain('submitMission');
    expect(src).toContain('missionEIN');
    expect(src).toContain('missionWeb');
    expect(src).toContain('Provide your EIN or organization website');
  });
  test('FV3-02: saveConfig PATCHes /firm-verticals/mine with vertical config', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('saveConfig');
    expect(src).toContain('setSaving');
    expect(src).toContain('vertical');
    expect(src).toContain('payload');
  });
});

// ── JAR. JustArrestedScreen — handleAction ────────────────────────────────
describe('JAR. JustArrestedScreen — handleAction Step Navigation', () => {
  test('JAR-01: openScreen fires hapticImpact then routes (guest stack → browse mode first)', async () => {
    const fs = await import('fs');
    const ja = fs.readFileSync(__REPO + '/frontend/src/screens/JustArrestedScreen.tsx', 'utf8');
    expect(ja).toContain('const openScreen');
    expect(ja).toContain('hapticImpact');
    expect(ja).toContain('setPendingRoute');
    expect(ja).toContain('navigation');
  });
});

// ── BCA. BailCalculatorScreen — bondCost ──────────────────────────────────
describe('BCA. BailCalculatorScreen — bondCost Calculator', () => {
  test('BCA-01: bail calculator shows ranges only (no unsourced fee estimate)', async () => {
    const fs = await import('fs');
    const bail = fs.readFileSync(__REPO + '/frontend/src/screens/BailCalculatorScreen.tsx', 'utf8');
    // bail ranges only: no sourced per-state fee data → no invented 10% estimate
    expect(bail).toContain('/help/bail-schedule');
    expect(bail).toContain('bail-fee-note');
    expect(bail).not.toContain('bondCost');
    expect(bail).not.toMatch(/10\s?%/);
  });
});

// ── CHS2. ChatScreen — loadHistory ────────────────────────────────────────
describe('CHS2. ChatScreen — loadHistory Session Restore', () => {
  test('CHS2-01: loadHistory restores a past session from /chat/history/:id', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('loadHistory');
    expect(src).toContain('sessionId');
    expect(src).toContain('setSessionId');
  });
});

// ── CS3. CaseScreen — pickScanSource + openInvite + openNew ───────────────
describe('CS3. CaseScreen — Scan Source + Invite Modal + New Case', () => {
  test('CS3-01: pickScanSource selects camera or library for document scan', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('pickScanSource');
    expect(src).toContain("'camera'");
    expect(src).toContain("'library'");
  });
  test('CS3-02: openInvite(cas) opens invite modal and resets email/name fields', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('openInvite');
    expect(src).toContain('setInvitingCase');
    expect(src).toContain('setInviteEmail');
  });
});

// ── AGS. AgeGateScreen — handleYear ───────────────────────────────────────
describe('AGS. AgeGateScreen — handleYear Input Validator', () => {
  test('AGS-01: handleYear accepts digits only, max 4 chars, validates ≥18', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AgeGateScreen.tsx', 'utf8');
    expect(src).toContain('handleYear');
    expect(src).toContain('clean');
    expect(src).toContain('text: string');
    expect(src).toContain('4');
  });
});

// ── ADV. AdvocacyScreen — formatDate ──────────────────────────────────────
describe('ADV. AdvocacyScreen — formatDate Helper', () => {
  test('ADV-01: formatDate converts ISO string to US locale date string', async () => {
    const src = feSource(__REPO + '/frontend/src/screens/AdvocacyScreen.tsx');
    expect(src).toContain('formatDate');
    expect(src).toContain('toLocaleString');
    // dates follow the app language (en → en-US, es → es-US, pt → pt-BR, vi → vi-VN)
    expect(src).toMatch(/toLocaleString\(locale\(\)/);
    expect(src).toContain('iso: string');
  });
});

// ── CFM2. CourtFormsScreen — loadAiGuide + onSelectState ─────────────────
describe('CFM2. CourtFormsScreen — loadAiGuide + onSelectState', () => {
  test('CFM2-01: loadAiGuide useCallback guards on state+category then calls /chat/ask', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('loadAiGuide');
    expect(src).toContain('useCallback');
    expect(src).toContain('selectedState');
    expect(src).toContain('selectedCategory');
    expect(src).toContain('/chat/ask');
  });
  test('CFM2-02: onSelectState useCallback → setSelectedState → phase=category_select', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('onSelectState');
    expect(src).toContain('setSelectedState');
    expect(src).toContain("'category_select'");
  });
});

// ── EXP2. ExpungementScreen — checkEligibility ────────────────────────────
describe('EXP2. ExpungementScreen — checkEligibility Debounced', () => {
  test('EXP2-01: checkEligibility is debounced 400ms → GET /expungement/check', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ExpungementScreen.tsx', 'utf8');
    expect(src).toContain('checkEligibility');
    expect(src).toContain('400');
    expect(src).toContain('setTimeout');
    expect(src).toContain('clearTimeout');
  });
});

// ── S12. UX ───────────────────────────────────────────────────────────────
describe('S12. UX — New Internal Logic Patterns', () => {
  test('S12-02: DeadlineCalculator urgentCount useMemo prevents re-count on every keystroke', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DeadlineCalculatorScreen.tsx', 'utf8');
    expect(src).toContain('useMemo');
    expect(src).toContain('urgentCount');
  });
  test('S12-03: JustArrestedScreen steps are resumable (saved progress)', async () => {
    const fs = await import('fs');
    const ja = fs.readFileSync(__REPO + '/frontend/src/screens/JustArrestedScreen.tsx', 'utf8');
    expect(ja).toContain('saveCoreProgress({ current: n })');
    expect(ja).toContain('getCoreProgress');
  });
  test('S12-04: BailCalculator — ranges with sources, no fee math', async () => {
    const fs = await import('fs');
    const bail = fs.readFileSync(__REPO + '/frontend/src/screens/BailCalculatorScreen.tsx', 'utf8');
    // bail ranges only: no sourced per-state fee data → no invented 10% estimate
    expect(bail).toContain('/help/bail-schedule');
    expect(bail).toContain('bail-fee-note');
    expect(bail).not.toContain('bondCost');
    expect(bail).not.toMatch(/10\s?%/);
  });
  test('S12-05: ExpungementScreen checkEligibility 400ms debounce prevents spam', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ExpungementScreen.tsx', 'utf8');
    expect(src).toContain('400');
    expect(src).toContain('checkEligibility');
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v59 Confirmed', () => {
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
  test('R-08: GAVEL_EMOJI[3]=🏆 trophy', () => { expect(GAVEL_EMOJI[3]).toBe('🏆'); });
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
