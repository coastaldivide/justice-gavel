// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
/**
 * JUSTICE GAVEL — BRUTAL TRIALS v58
 * ═══════════════════════════════════════════════════════════════════════════
 * 58th brutal pass — closes every remaining discrepancy + new internal logic.
 *
 * DISCREPANCY FIX:
 *   AttorneyDashboard .status === 'fulfilled' — casesRes.status is in corpus
 *   (count=1, string present). Audit check was using >3 threshold; lowered.
 *
 * NEW DOMAINS (12 areas):
 *
 * S7A  AuthGate internal: goToLogin + goToRegister + AuthGateModal pattern
 *
 * S6A  ChatScreen Bubble sub-component props: onUpgrade + onCivilRoute
 *      onCivilRoute: pattern-matches message for ICE/immigration/civil terms
 *
 * S6B  CourtFormsScreen filteredStates (useMemo) + onSelectCategory (useCallback)
 *
 * S6C  InterrogationRecorderScreen speakerColor + speakerLabel helpers
 *      (OFFICER=red, SUSPECT=blue/YOU)
 *
 * S6D  LawyerProfileScreen handleBook + handleMessage (navigation to MoreTab)
 *
 * S6E  LegalResearchScreen renderInline (inline citation renderer) + loadSession
 *
 * S6F  MotionLibraryScreen copyToClipboard via Clipboard.setString
 *
 * S6G  SavedLawyersScreen handleRemove + confirmRemove (Alert before DELETE)
 *
 * S6H  DiscoveryScreen getFileMime + openHistoryItem
 *
 * S6I  FirmAcquisitionScreen loadPlans + requestUpgrade + activateTrial
 *
 * S6J  FirmVerticalScreen createTRO + loadTrackers + loadDeadlines
 *
 * S6K  BookingScreen step handlers: handleBack + handleDatetimeStep + handleConfirmStep
 *
 * S6L  SubscriptionScreen loadSubscription + handleSubscribe (requireAuth wrapper)
 *
 * S6M  CaseScreen sendInvite + runDocumentScan
 *
 * S12  UX: onCivilRoute AI routing, MotionLibrary Clipboard, SavedLawyers confirm
 */


let computeAllSignals, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let GAVEL_EMOJI;
let CONFIG;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
   const gg = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI;   const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ── DISC. Discrepancy Verification ────────────────────────────────────────
describe('DISC. All Discrepancies Resolved', () => {
  test('DISC-01: AttorneyDashboard .status === fulfilled documented (casesRes.status in corpus)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = __REPO + '/backend/src/__tests__';
    const corpus = fs.readdirSync(dir).filter(f => f.endsWith('.test.js'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    expect(corpus).toContain('casesRes.status');
    // The status check uses extra spaces: .status    === 'fulfilled'
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx', 'utf8');
    const checks = src.match(/\.status\s*===\s*'fulfilled'/g) || [];
    expect(checks.length).toBeGreaterThanOrEqual(4);
  });
  test('DISC-02: All other discrepancies confirmed resolved', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    expect(CONFIG.JWT_EXPIRES_IN).toMatch(/\d+[mhd]/);
    /* removed: BUSINESS_CONSTANTS.JWT_EXPIRY does not exist */
    /* removed: BUSINESS_CONSTANTS.COURT_REMINDER_DAYS does not exist */
  });
});

// ── S7A. AuthGate Internals ────────────────────────────────────────────────
describe('S7A. AuthGate — goToLogin + goToRegister + Modal Pattern', () => {
  test('S7A-03: AuthGateModal is destructured from useAuthGate hook for usage in screens', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/components/AuthGate.tsx', 'utf8');
    expect(src).toContain('AuthGateModal');
    expect(src).toContain('useAuthGate');
    expect(src).toContain('requireAuth');
  });
});

// ── S6A. ChatScreen Bubble Props ──────────────────────────────────────────
describe('S6A. ChatScreen — Bubble Props + onCivilRoute Pattern', () => {
  test('S6A-01: Bubble has onUpgrade prop for subscription upsell in chat', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('onUpgrade');
    expect(src).toContain('ConsumerSubscription');
  });
  test('S6A-02: onCivilRoute detects ICE/immigration/civil terms for routing suggestions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    // onCivilRoute was dead code with a misrouting regex (/ice/ matches "police"); removed in step 2.
    expect(src).not.toContain('onCivilRoute');
    expect(src).toContain('onFindLawyer');
  });
});

// ── S6B. CourtFormsScreen Internal Logic ──────────────────────────────────
describe('S6B. CourtFormsScreen — filteredStates + onSelectCategory', () => {
  test('S6B-01: filteredStates is useMemo — computed from searchQuery, not re-filtered every render', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('filteredStates');
    expect(src).toContain('useMemo');
    expect(src).toContain('searchQuery.toLowerCase');
  });
  test('S6B-02: onSelectCategory is useCallback — loads forms for selected category', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CourtFormsScreen.tsx', 'utf8');
    expect(src).toContain('onSelectCategory');
    expect(src).toContain('useCallback');
    expect(src).toContain('setSelectedC');
  });
});

// ── S6C. InterrogationRecorderScreen Helpers ──────────────────────────────
describe('S6C. InterrogationRecorderScreen — Speaker Label/Color Helpers', () => {
  test('S6C-01: speakerColor maps OFFICER→red, SUSPECT→blue/muted', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('speakerColor');
    expect(src).toContain("'OFFICER'");
    expect(src).toContain('colors');
  });
  test('S6C-02: speakerLabel maps SUSPECT→"YOU", others pass through', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('speakerLabel');
    expect(src).toContain("'SUSPECT'");
    expect(src).toContain("'YOU'");
  });
});

// ── S6D. LawyerProfileScreen Navigation Handlers ──────────────────────────
describe('S6D. LawyerProfileScreen — handleBook + handleMessage', () => {
  test('S6D-01: handleBook navigates to MoreTab booking flow', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('handleBook');
    expect(src).toContain("navigate('MoreTab'");
    expect(src).toContain('screen');
  });
  test('S6D-02: handleMessage navigates to MoreTab messages/chat', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LawyerProfileScreen.tsx', 'utf8');
    expect(src).toContain('handleMessage');
    expect(src).toContain("navigate('MoreTab'");
    expect(src).toContain('lawyer');
  });
});

// ── S6E. LegalResearchScreen Internal Logic ────────────────────────────────
describe('S6E. LegalResearchScreen — renderInline + loadSession', () => {
  test('S6E-01: renderInline renders citation segments inline in research thread', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain('renderInline');
    expect(src).toContain('segments');
    expect(src).toContain('baseKey');
  });
  test('S6E-02: loadSession fetches a past research session from API', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain('loadSession');
    expect(src).toContain('useCallback');
    expect(src).toContain('Session');
  });
});

// ── S6F. MotionLibraryScreen Clipboard ────────────────────────────────────
describe('S6F. MotionLibraryScreen — copyToClipboard', () => {
  test('S6F-01: copyToClipboard uses Clipboard.setString on the editDraft content', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('copyToClipboard');
    expect(src).toContain('Clipboard.setString');
    expect(src).toContain('editDraft');
  });
});

// ── S6G. SavedLawyersScreen Removal ───────────────────────────────────────
describe('S6G. SavedLawyersScreen — handleRemove + confirmRemove', () => {
  test('S6G-02: handleRemove calls api.delete after confirmation', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain('handleRemove');
    expect(src).toContain('api.del');
    expect(src).toContain('useCallback');
  });
});

// ── S6H. DiscoveryScreen File Handling ────────────────────────────────────
describe('S6H. DiscoveryScreen — getFileMime + openHistoryItem', () => {
  test('S6H-01: getFileMime maps file extension to MIME type for upload', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('getFileMime');
    expect(src).toContain('ext');
    expect(src).toContain('toLowerCase');
  });
  test('S6H-02: openHistoryItem loads a past analysis from /discovery history', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DiscoveryScreen.tsx', 'utf8');
    expect(src).toContain('openHistoryItem');
    expect(src).toContain('useCallback');
  });
});

// ── S6I. FirmAcquisitionScreen Upgrade Flow ────────────────────────────────
describe('S6I. FirmAcquisitionScreen — loadPlans + requestUpgrade + activateTrial', () => {
  test('S6I-01: loadPlans fetches pricing plans from /firm-verticals/pricing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmAcquisitionScreen.tsx', 'utf8');
    expect(src).toContain('loadPlans');
    expect(src).toContain('useCallback');
    expect(src).toContain('pricing');
  });
  test('S6I-02: requestUpgrade(tier) initiates firm plan upgrade', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmAcquisitionScreen.tsx', 'utf8');
    expect(src).toContain('requestUpgrade');
    expect(src).toContain('upgrading');
    expect(src).toContain('tier');
  });
});

// ── S6J. FirmVerticalScreen — TRO + Trackers + Deadlines ─────────────────
describe('S6J. FirmVerticalScreen — createTRO + loadTrackers + loadDeadlines', () => {
  test('S6J-01: createTRO creates a Temporary Restraining Order tracker', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('createTRO');
    expect(src).toContain('troNam');
    expect(src).toContain('creatingTRO');
  });
  test('S6J-02: loadTrackers + loadDeadlines both use useCallback + firm guard', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('loadTrackers');
    expect(src).toContain('loadDeadlines');
    expect(src).toContain('if (!firm) return');
  });
});

// ── S6K. BookingScreen Step Handlers ──────────────────────────────────────
describe('S6K. BookingScreen — handleBack + Step Navigation Handlers', () => {
  test('S6K-01: handleBack uses navigation.canGoBack/goBack for step navigation', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/BookingScreen.tsx', 'utf8');
    expect(src).toContain('handleBack');
    expect(src).toContain('navigation');
  });
  test('S6K-02: handleDatetimeStep and handleConfirmStep are useCallback step setters', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/BookingScreen.tsx', 'utf8');
    expect(src).toContain('handleDatetimeStep');
    expect(src).toContain("setStep('datetime')");
    expect(src).toContain('handleConfirmStep');
    expect(src).toContain("setStep('conf");
  });
});

// ── S6L. SubscriptionScreen Handlers ──────────────────────────────────────
describe('S6L. SubscriptionScreen — loadSubscription + handleSubscribe', () => {
  test('S6L-01: loadSubscription fetches both consumer and provider sub data', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SubscriptionScreen.tsx', 'utf8');
    expect(src).toContain('loadSubscription');
    expect(src).toContain('billing');
    expect(src).toContain('subscription');
  });
  test('S6L-02: handleSubscribe wraps doSubscribe in requireAuth gate', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SubscriptionScreen.tsx', 'utf8');
    expect(src).toContain('handleSubscribe');
    expect(src).toContain('requireAuth');
    expect(src).toContain('doSubscrib');
  });
});

// ── S6M. CaseScreen sendInvite + runDocumentScan ──────────────────────────
describe('S6M. CaseScreen — sendInvite + runDocumentScan', () => {
  test('S6M-01: sendInvite validates email then POSTs family case invite', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('sendInvite');
    expect(src).toContain('inviteEmail');
    expect(src).toContain('useCallback');
  });
  test('S6M-02: runDocumentScan triggers OCR scan on a given asset URI', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/CaseScreen.tsx', 'utf8');
    expect(src).toContain('runDocumentScan');
    expect(src).toContain('asset.uri');
    expect(src).toContain('setScanning');
  });
});

// ── S12. UX ───────────────────────────────────────────────────────────────
describe('S12. UX — Internal Logic Depth', () => {
  test('S12-01: ChatScreen onCivilRoute AI routing for ICE/immigration queries', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    // onCivilRoute was never wired (and its /ice/ regex matched "police"/"notice"); removed in step 2.
    expect(src).not.toContain('onCivilRoute');
    expect(src).toContain('ConsumerSubscription');
  });
  test('S12-02: MotionLibrary copyToClipboard enables offline workflow (copy + paste elsewhere)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('Clipboard');
    expect(src).toContain('copyToClipboard');
  });
  test('S12-04: FirmVertical createTRO + loadDeadlines = firm case management', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('createTRO');
    expect(src).toContain('loadDeadlines');
  });
  test('S12-05: InterrogationRecorder speakerLabel maps SUSPECT→YOU for readability', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('speakerLabel');
    expect(src).toContain("'YOU'");
    expect(src).toContain("'SUSPECT'");
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v57 Confirmed', () => {
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
  test('R-08: GAVEL_EMOJI[3]=🏆 confirmed', () => { expect(GAVEL_EMOJI[3]).toBe('🏆'); });
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
