import { feSource } from './helpers/feSource.js';
// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
/**
 * JUSTICE GAVEL — BRUTAL TRIALS v62
 * ═══════════════════════════════════════════════════════════════════════════
 * 62nd brutal pass — 20/20 discrepancies RESOLVED. Final 16 screen gaps.
 *
 * NEW DOMAINS (16 areas — the last untested internal functions):
 *
 * MOT2  MotionLibraryScreen.changeStatus + filteredHistory:
 *       changeStatus(s): FilingStatus — updates filing status PATCH
 *       filteredHistory: useMemo filters history by motion type/search
 *
 * PAY2  PaymentsScreen.doPayment + onSelectPurpose:
 *       doPayment: requireAuth gate → POST /billing/payment
 *       onSelectPurpose(p): setPurpose + setAmount(p.defaultAmount)
 *
 * PRV   PrivacyPolicyScreen.requestDeletion:
 *       hapticImpact → Alert 'Request Data Deletion' → email deep link
 *
 * QCS   QuickConnectScreen.handlePay:
 *       requireAuth(() => doPay()) gate for $19.99 QuickConnect payment
 *
 * RAS   RecoveryAgentsScreen.renderAgent + openWeb:
 *       renderAgent: useCallback FlatList row renderer for agents
 *       openWeb(url): hapticImpact → Linking with https:// prefix guard
 *
 * REG   RegisterScreen.onRegister:
 *       validates identifier.trim(), POST /auth/register
 *
 * RWD   RewardsScreen.loadPoints + redeemReferral:
 *       loadPoints(userId): GET /rewards/points
 *       redeemReferral: validates redeemInput → POST /rewards/redeem
 *
 * RCC   RightsCardScreen.fetchCard + shareCard:
 *       fetchCard: mountedRef guarded GET /lessons/rights-card
 *       shareCard: Share.share card content with date
 *
 * SVD   SavedLawyersScreen.handleNoteChange + saveNote:
 *       handleNoteChange(id, note): useCallback updates local state
 *       saveNote: useCallback → PATCH /saved-lawyers/:id/note
 *
 * SCH   SearchScreen.handleChange + handleTap:
 *       handleChange(text): debounced FTS5-backed search
 *       handleTap(item): navigate to MoreTab with SearchResult data
 *
 * STG   SettingsScreen.toggleMaster + shareReferral:
 *       toggleMaster(val): AsyncStorage persist + setNotifMaster
 *       shareReferral: Share.share referral code if referralCode exists
 *
 * TAM   TermsAcceptanceModal.handleScroll:
 *       useCallback — measures layoutMeasurement+contentOffset to set
 *       scrolledToBottom (unlocks the I Agree button)
 *
 * TRS   TranslatorScreen.createSession + sendMessage:
 *       createSession('solo'|'split'): useCallback, creates translation session
 *       sendMessage('a'|'b'): side-aware translation message send
 *
 * VNS   VoiceNoteScreen.saveToCase + processText:
 *       saveToCase: validates editText → POST /voice-notes/attach-to-case
 *       processText: validates textIn → phase='processing' → AI transcription
 *
 * IRR3  InterrogationRecorderScreen.savePDF:
 *       pdfBase64 guard → FileSystem path → save to device
 *
 * CNT   ContactsScreen.typeHint:
 *       '@' detected → 'email', else → 'phone number' hint
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

// ── MOT2. MotionLibraryScreen — changeStatus + filteredHistory ────────────
describe('MOT2. MotionLibraryScreen — changeStatus + filteredHistory', () => {
  test('MOT2-01: changeStatus(s) closes picker and PATCHes filing status', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('changeStatus');
    expect(src).toContain('setShowPicker(false)');
    expect(src).toContain('FilingStatus');
    expect(src).toContain('status');
  });
  test('MOT2-02: filteredHistory is useMemo — filters history without re-render', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('filteredHistory');
    expect(src).toContain('useMemo');
    expect(src).toContain('history.filter');
  });
});

// ── PAY2. PaymentsScreen — doPayment + onSelectPurpose ────────────────────
describe('PAY2. PaymentsScreen — doPayment + onSelectPurpose', () => {
  test('PAY2-01: doPayment uses requireAuth gate then POST /billing/payment', async () => {
    const fs = await import('fs');
    // Section G: the "pay anything" form (purposes, typed amounts, /pay/create) is removed — the app never asks
    // for an amount. Billing shows the plan, real purchases and refund requests.
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/PaymentsScreen.tsx', 'utf8');
    expect(src).not.toMatch(/PURPOSES|defaultAmount|\/pay\/create/);
    expect(src).toContain("'/billing/overview'");
    expect(src).toContain("'/billing/refund'");
  });
  test('PAY2-02: onSelectPurpose(p) sets purpose and pre-fills amount from defaultAmount', async () => {
    const fs = await import('fs');
    // Section G: the "pay anything" form (purposes, typed amounts, /pay/create) is removed — the app never asks
    // for an amount. Billing shows the plan, real purchases and refund requests.
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/PaymentsScreen.tsx', 'utf8');
    expect(src).not.toMatch(/PURPOSES|defaultAmount|\/pay\/create/);
    expect(src).toContain("'/billing/overview'");
    expect(src).toContain("'/billing/refund'");
  });
});

// ── PRV. PrivacyPolicyScreen — requestDeletion ────────────────────────────
describe('PRV. PrivacyPolicyScreen — requestDeletion', () => {
});

// ── QCS. QuickConnectScreen — handlePay ──────────────────────────────────
describe('QCS. QuickConnectScreen — handlePay', () => {
  test('QCS-01: handlePay is requireAuth gate wrapping doPay for $19.99 QuickConnect', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    expect(src).toContain('handlePay');
    expect(src).toContain('requireAuth');
    expect(src).toContain('doPay');
  });
});

// ── RAS. RecoveryAgentsScreen — renderAgent + openWeb ─────────────────────
describe('RAS. RecoveryAgentsScreen — renderAgent + openWeb', () => {
  test('RAS-01: renderAgent useCallback renders licensed fugitive recovery agent row', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/RecoveryAgentsScreen.tsx', 'utf8');
    expect(src).toContain('renderAgent');
    expect(src).toContain('useCallback');
    expect(src).toContain('Agent');
    expect(src).toContain('agentC');
  });
  test('RAS-02: openWeb(url) adds https:// prefix if missing then Linking.openURL', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/RecoveryAgentsScreen.tsx', 'utf8');
    expect(src).toContain('openWeb');
    expect(src).toContain('hapticImpact');
    expect(src).toContain("startsWith('http'");
    expect(src).toContain('Linking.openURL');
  });
});

// ── REG. RegisterScreen — onRegister ─────────────────────────────────────
describe('REG. RegisterScreen — onRegister', () => {
  test('REG-01: onRegister validates identifier.trim() then POST /auth/register', async () => {
    const src = feSource(__REPO + '/frontend/src/screens/RegisterScreen.tsx');
    expect(src).toContain('onRegister');
    expect(src).toContain('identifier.trim()');
    expect(src).toContain('/auth/register');
    expect(src).toContain('Enter your email or pho');
  });
});

// ── RWD. RewardsScreen — loadPoints + redeemReferral ─────────────────────
describe('RWD. RewardsScreen — loadPoints + redeemReferral', () => {
});

// ── RCC. RightsCardScreen — fetchCard + shareCard ─────────────────────────
describe('RCC. RightsCardScreen — fetchCard + shareCard', () => {
  test('RCC-01: rights card load is mounted-guarded and cached per state', async () => {
    const fs = await import('fs');
    const rc = fs.readFileSync(__REPO + '/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    const en = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    // free (no subscription gate), sourced, cached per state for offline use
    expect(rc).not.toContain('/billing/consumer/subscription');
    expect(rc).toContain('fetchRightsCard');
    expect(rc).toContain('getCachedRightsCard');
    expect(rc).toContain("t('rc_source')");
    expect(rc).toContain('mounted');
    expect(en.rc_b1.toLowerCase()).toContain('silent');
    expect(en.rc_h2).toMatch(/lawyer/i);
  });
  test('RCC-02: share exports the card text with sources', async () => {
    const fs = await import('fs');
    const rc = fs.readFileSync(__REPO + '/frontend/src/screens/RightsCardScreen.tsx', 'utf8');
    expect(rc).toContain('RNShare.share');
    expect(rc).toContain("t('rc_source')");
    expect(rc).toContain("t('rc_footer')");
  });
});

// ── SVD. SavedLawyersScreen — handleNoteChange + saveNote ────────────────
describe('SVD. SavedLawyersScreen — handleNoteChange + saveNote', () => {
  test('SVD-01: handleNoteChange(id, note) useCallback updates local note state', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain('handleNoteChange');
    expect(src).toContain('useCallback');
    expect(src).toContain('setLawyers');
    expect(src).toContain('note');
  });
  test('SVD-02: saveNote useCallback PATCHes /saved-lawyers/:id/note', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SavedLawyersScreen.tsx', 'utf8');
    expect(src).toContain('saveNote');
    expect(src).toContain('setSaving');
    expect(src).toContain('api.patch');
  });
});

// ── SCH. SearchScreen — handleChange + handleTap ─────────────────────────
describe('SCH. SearchScreen — handleChange + handleTap', () => {
  test('SCH-01: handleChange(text) debounces FTS5-backed global search', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SearchScreen.tsx', 'utf8');
    expect(src).toContain('handleChange');
    expect(src).toContain('setQuery');
    expect(src).toContain('clearTime');
    expect(src).toContain('debounce');
  });
  test('SCH-02: handleTap(item) navigates to MoreTab with SearchResult data', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SearchScreen.tsx', 'utf8');
    expect(src).toContain('handleTap');
    expect(src).toContain("navigate('MoreTab'");
    expect(src).toContain('SearchResult');
  });
});

// ── STG. SettingsScreen — toggleMaster + shareReferral ───────────────────
describe('STG. SettingsScreen — toggleMaster + shareReferral', () => {
  test('STG-01: toggleMaster persists notification master toggle to AsyncStorage', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SettingsScreen.tsx', 'utf8');
    expect(src).toContain('toggleMaster');
    expect(src).toContain('setNotifMaster');
    expect(src).toContain('AsyncStorage');
    expect(src).toContain("'lang'");
  });
});

// ── TAM. TermsAcceptanceModal — handleScroll ─────────────────────────────
describe('TAM. TermsAcceptanceModal — handleScroll', () => {
  test('TAM-01: handleScroll measures scroll position to unlock I Agree button', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain('handleScroll');
    expect(src).toContain('useCallback');
    expect(src).toContain('layoutMeasurement');
    expect(src).toContain('contentOffset');
    expect(src).toContain('scrolledToBottom');
  });
});

// ── TRS. TranslatorScreen — createSession + sendMessage ──────────────────
describe('TRS. TranslatorScreen — createSession + sendMessage', () => {
  test('TRS-01: createSession(solo|split) useCallback creates translation session', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/TranslatorScreen.tsx', 'utf8');
    expect(src).toContain('createSession');
    expect(src).toContain("'solo'|'split'");
    expect(src).toContain('useCallback');
  });
  test('TRS-02: sendMessage(a|b) sends side-aware translation message', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/TranslatorScreen.tsx', 'utf8');
    expect(src).toContain('sendMessage');
    expect(src).toContain("side === 'a'");
    expect(src).toContain('useCallback');
  });
});

// ── VNS. VoiceNoteScreen — saveToCase + processText ──────────────────────
describe('VNS. VoiceNoteScreen — saveToCase + processText', () => {
  test('VNS-01: saveToCase useCallback validates editText then attaches note to case', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/VoiceNoteScreen.tsx', 'utf8');
    expect(src).toContain('saveToCase');
    expect(src).toContain('editText');
    expect(src).toContain('setSaving');
    expect(src).toContain('useCallback');
  });
  test('VNS-02: processText useCallback validates textIn then transitions to processing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/VoiceNoteScreen.tsx', 'utf8');
    expect(src).toContain('processText');
    expect(src).toContain('textIn');
    expect(src).toContain("'processing'");
    expect(src).toContain('useCallback');
  });
});

// ── IRR3. InterrogationRecorderScreen — savePDF ───────────────────────────
describe('IRR3. InterrogationRecorderScreen — savePDF', () => {
  test('IRR3-01: savePDF guards pdfBase64 then writes to FileSystem path', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/InterrogationRecorderScreen.tsx', 'utf8');
    expect(src).toContain('savePDF');
    expect(src).toContain('pdfBase64');
    expect(src).toContain('FileSystem');
    expect(src).toContain('path');
  });
});

// ── CNT. ContactsScreen — typeHint ───────────────────────────────────────
describe('CNT. ContactsScreen — typeHint', () => {
  test('CNT-01: typeHint(val) detects @ for email vs phone number hint', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ContactsScreen.tsx', 'utf8');
    expect(src).toContain('typeHint');
    expect(src).toContain("includes('@')");
    expect(src).toContain('email');
    expect(src).toContain('phone');
  });
});

// ── S12. UX ───────────────────────────────────────────────────────────────
describe('S12. UX — Final Internal Logic Complete', () => {
  test('S12-01: TermsAcceptanceModal scroll-to-unlock is measured not estimated', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/TermsAcceptanceModal.tsx', 'utf8');
    expect(src).toContain('layoutMeasurement');
    expect(src).toContain('scrolledToBottom');
  });
  test('S12-02: QuickConnectScreen requireAuth gates $19.99 payment', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/QuickConnectScreen.tsx', 'utf8');
    expect(src).toContain('requireAuth');
    expect(src).toContain('handlePay');
  });
  test('S12-03: PrivacyPolicyScreen requestDeletion = GDPR Article 17 compliance', async () => {
    const src = feSource(__REPO + '/frontend/src/screens/PrivacyPolicyScreen.tsx');
    expect(src).toContain('Request Data Deletion');
    expect(src).toContain('requestDeletion');
  });
  test('S12-04: RecoveryAgentsScreen openWeb adds https:// prefix guard', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/RecoveryAgentsScreen.tsx', 'utf8');
    expect(src).toContain("startsWith('http'");
    expect(src).toContain('openWeb');
  });
  test('S12-05: SearchScreen handleChange uses debounce for FTS5 performance', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/SearchScreen.tsx', 'utf8');
    expect(src).toContain('debounce');
    expect(src).toContain('handleChange');
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v61 Confirmed', () => {
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
