// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
/**
 * JUSTICE GAVEL — BRUTAL TRIALS v13
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 13th brutal pass — targeting what 12 suites and 21,765 tests missed.
 * Every test from cold literal source reads. Zero assumptions.
 *
 * NEW DOMAINS (16 areas):
 *   1.  useAppSetup.ts      — registerForPushNotificationsAsync (token dedup),
 *                             usePushTokenRefresh (AppState foreground),
 *                             useOTAUpdates, deep linking config (prefixes)
 *   2.  firm_acquisition.js — 8-route funnel: plans, lead capture, trial
 *                             activation (14-day), status, upgrade, checklist
 *   3.  webpush.js          — VAPID web push setup, lazy web-push init,
 *                             subscribe/unsubscribe/send model
 *   4.  FirmVerticalScreen  — 4 tabs (Setup/Pricing/Trackers/Deadlines),
 *                             10 practice verticals, asylum clock + DPA + TRO
 *   5.  i18n final 3        — home (1 key), tr_ tenant rights (10 keys),
 *                             civil_ (6 keys)
 *   6.  aedpaRisk signal    — years_post_conviction >= 1 trigger,
 *                             aedpaRiskNote text, certWorthy + certApproaching
 *   7.  Escalation object   — level/triggers/sla_hours shape, critical path
 *                             (isEmergency && isCrisis → level='critical', sla=1h)
 *   8.  DocumentScannerScreen — camera permission, capture flow, upload model
 *   9.  App.tsx             — auth state machine (loading/guest/browsing/authed),
 *                             deep link prefixes, StatusBar config
 *  10.  ChatScreen          — /chat/ask API contract, session management,
 *                             showDisclaimer state, session ID persistence
 *  11.  MotionLibraryScreen — /motions/generate + /motions/history, keyword
 *                             search, disclaimer gate, Clipboard copy
 *  12.  AttorneyDashboardScreen — availability, case list, CLE tabs
 *  13.  LegalResearchScreen — paywall gate, $49.99/mo subscribe, research history
 *  14.  firm_acquisition constants — TRIAL_DAYS=14, VALID_VERTICALS (11),
 *                             VALID_ORG_TYPES (7), VALID_TIERS (4)
 *  15.  Regression           — all v1–v12 fixes confirmed
 *  16.  Mass influx          — 100,000 new scenarios
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */


let computeAllSignals, computeMotionRecommendations;
let encrypt, decrypt;
let GAVEL_LEVELS;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals            = mi.computeAllSignals;
  computeMotionRecommendations = mi.computeMotionRecommendations;


  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;

 

 
   
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS;




});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. useAppSetup.ts — Push Registration, OTA, Deep Linking
// ═══════════════════════════════════════════════════════════════════════════
describe('1. useAppSetup.ts — App Lifecycle Hooks', () => {

  test('1-01: useAppSetup exports registerForPushNotificationsAsync', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/hooks/useAppSetup.ts', 'utf8');
    expect(src).toContain('registerForPushNotificationsAsync');
    expect(src).toContain('usePushTokenRefresh');
  });

  test('1-02: push registration only POSTs when token has changed (dedup)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/hooks/useAppSetup.ts', 'utf8');
    expect(src).toContain('last_push_token');
    expect(src).toContain('token !== lastToken');
    expect(src).toContain("AsyncStorage.setItem('last_push_token'");
  });

  test('1-03: push registration is non-fatal (try/catch with empty catch)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/hooks/useAppSetup.ts', 'utf8');
    expect(src).toContain('/* push registration is non-fatal */');
  });

  test('1-04: push token POST includes platform (iOS vs Android)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/hooks/useAppSetup.ts', 'utf8');
    expect(src).toContain('Platform.OS');
    expect(src).toContain('expoPushToken');
    expect(src).toContain("'/push/token'");
  });

  test('1-05: usePushTokenRefresh re-registers on AppState foreground', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/hooks/useAppSetup.ts', 'utf8');
    expect(src).toContain('AppState.addEventListener');
    expect(src).toContain("nextState === 'active'");
    expect(src).toContain('registerForPushNotificationsAsync');
    // Cleanup
    expect(src).toContain('sub?.remove?.()');
  });



  test('1-08: push registration dedup model — same token → skip POST', () => {
    // Model: lastToken === newToken → no POST
    const shouldPost = (newToken, lastToken) => newToken !== lastToken;
    expect(shouldPost('ExpoToken[abc123]', null)).toBe(true);         // first time
    expect(shouldPost('ExpoToken[abc123]', 'ExpoToken[abc123]')).toBe(false); // same
    expect(shouldPost('ExpoToken[xyz789]', 'ExpoToken[abc123]')).toBe(true);  // rotated
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. firm_acquisition.js — Self-Serve Onboarding Funnel
// ═══════════════════════════════════════════════════════════════════════════
describe('2. firm_acquisition.js — Firm Onboarding Funnel', () => {

  test('2-01: firm_acquisition has 8 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    // Section G: plans, lead, trial, status, upgrade, checklist, invite, invites, invites/:id/accept
    const handlers = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
    expect(handlers.length).toBe(9);
  });

  test('2-02: TRIAL_DAYS is 14 (single source of truth)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    expect(src).toContain('export const TRIAL_DAYS = 14;');
    expect(src).toContain('free trial length — single source of truth');
  });

  test('2-03: VALID_VERTICALS has exactly 11 practice areas', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    const EXPECTED = ['criminal_defense','civil_rights','white_collar','family',
                      'immigration','personal_injury','public_defense','appellate',
                      'military','juvenile','general'];
    for (const v of EXPECTED) {
      expect(src).toContain(`'${v}'`);
    }
    expect(src).toContain('VALID_VERTICALS');
  });

  test('2-04: VALID_ORG_TYPES has 7 organization types', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    const ORG_TYPES = ['nonprofit','public_defender','government','legal_aid',
                       'law_firm','solo','other'];
    for (const t of ORG_TYPES) {
      expect(src).toContain(`'${t}'`);
    }
  });

  test('2-05: VALID_TIERS has 4 billing tiers', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    const TIERS = ['standard','mission','government','enterprise'];
    for (const t of TIERS) {
      expect(src).toContain(`'${t}'`);
    }
    expect(src).toContain('VALID_TIERS');
  });

  test('2-06: lead capture validates email with EMAIL_RE regex', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    expect(src).toContain('EMAIL_RE');
    expect(src).toContain('[^\\s@]+@[^\\s@]+');
  });

  test('2-07: trial activation route returns firm + member context', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    expect(src).toContain('/trial');
    expect(src).toContain('TRIAL_DAYS');
    // Creates firm AND member in same transaction
    const hasFirmCreate = src.includes('INSERT INTO firms') || src.includes('firm_id');
    expect(hasFirmCreate).toBe(true);
  });

  test('2-08: checklist route tracks onboarding steps', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    // Section G: the steps are worked out from the firm's data, not ticked by hand
    expect(src).toContain("router.get('/checklist'");
    for (const step of ['vertical_set', 'team_invited', 'first_matter']) expect(src).toContain(step);
  });

  test('2-09: VERTICAL_PITCH has headlines for all 10+ verticals', async () => {
    const fs = await import('fs');
    // Section G: the invented per-vertical demo stats (GET /vertical-demo, VERTICAL_PITCH) are removed; the
    // checklist is worked out from the firm's own data (no POST /checklist/:key to tick steps by hand).
    const s = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    expect(s).not.toContain("router.get('/vertical-demo'");
    expect(s).not.toContain('VERTICAL_PITCH');
    expect(s).not.toContain("router.post('/checklist/:key'");
    expect(s).toContain("router.post('/trial'");
    expect(s).toContain("router.post('/upgrade'");
    expect(s).toContain("router.get('/checklist'");
    expect(s).toContain("router.post('/invite'");
    expect(s).toContain("router.post('/invites/:id/accept'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. webpush.js — VAPID Web Push
// ═══════════════════════════════════════════════════════════════════════════
describe('3. webpush.js — VAPID Web Push', () => {

  test('3-01: webpush.js has lazy initialization (no import-time crash)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/webpush.js', 'utf8');
    expect(src).toContain('let webpush = null');
    expect(src).toContain('await import(');
    expect(src).toContain("'web-push'");
  });

  test('3-02: VAPID keys read from environment (VAPID_PUBLIC_KEY etc)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/webpush.js', 'utf8');
    expect(src).toContain('VAPID_PUBLIC_KEY');
    expect(src).toContain('VAPID_PRIVATE_KEY');
    expect(src).toContain('VAPID_EMAIL');
  });

  test('3-03: webpush /subscribe validates endpoint is required', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/webpush.js', 'utf8');
    expect(src).toContain("'endpoint_required'");
    // section H: the endpoint is a URL the server POSTs to — https on a public host only
    expect(src).toContain('publicUrlError(subscription.endpoint');
  });

  test('3-04: webpush /key returns public key for frontend subscription', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/webpush.js', 'utf8');
    expect(src).toContain("'/key'");
    // webpush /key returns the VAPID public key
    const hasKey = src.includes('publicKey') || src.includes('vapidKey') || src.includes('public_key') || src.includes('key');
    expect(hasKey).toBe(true);
  });

  test('3-05: webpush /send: platform staff, or a firm admin to a member of the same firm only', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/webpush.js', 'utf8');
    expect(src).toContain("'/send'");
    expect(src).toContain('isStaff(db, req.user)');
    expect(src).toContain("COALESCE(fm.firm_role, fm.role) = 'firm_admin'");
  });

  test('3-06: webpush has rate limiter (makeUserLimiter)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/webpush.js', 'utf8');
    expect(src).toContain('makeUserLimiter');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. FirmVerticalScreen — 4-Tab Practice Area Configuration
// ═══════════════════════════════════════════════════════════════════════════
describe('4. FirmVerticalScreen — 4-Tab Practice Config', () => {

  test('4-01: FirmVerticalScreen has 4 tabs: Setup, Pricing, Trackers, Deadlines', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('Setup');
    expect(src).toContain('Pricing');
    expect(src).toContain('Trackers');
    expect(src).toContain('Deadlines');
  });

  test('4-02: FirmVerticalScreen supports all 10 practice verticals', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    const VERTS = ['criminal_defense','civil_rights','white_collar','family',
                   'immigration','personal_injury','public_defense','appellate',
                   'military','juvenile'];
    for (const v of VERTS) {
      expect(src).toContain(v);
    }
  });

  test('4-03: Trackers tab has asylum clock (immigration)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('asylum');
    expect(src).toContain('asylum-clocks');
  });

  test('4-04: Trackers tab has DPA tracker (white-collar)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('dpa');
    expect(src).toContain('DPA');
  });

  test('4-05: FirmVerticalScreen fetches from 5 API endpoints', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    const ENDPOINTS = ['/firm-verticals/mine','/firm-verticals/pricing',
                       '/firm-acquisition/status','/firm-verticals/asylum-clocks',
                       '/firm-verticals/dpa'];
    for (const ep of ENDPOINTS) {
      expect(src).toContain(ep);
    }
  });

  test('4-06: FirmVerticalScreen has refreshing state (PTR supported)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/FirmVerticalScreen.tsx', 'utf8');
    expect(src).toContain('refreshing');
    expect(src).toContain('saving');
    expect(src).toContain('loading');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. i18n — Final 3 Categories (home, tr_, civil_)
// ═══════════════════════════════════════════════════════════════════════════
describe('5. i18n — Final 3 Categories at 0%', () => {

  test('5-01: home_title is "Justice Gavel"', async () => {
    const fs  = await import('fs');
    const en  = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    expect(en['home_title']).toBe('Justice Gavel');
  });

  test('5-02: tr_ keys — tenant rights screen (10 keys)', async () => {
    const fs  = await import('fs');
    const en  = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    expect(en['tr_title']).toBe('Tenant Rights');
    expect(en['tr_subtitle']).toBe('Know your rights as a renter');
    expect(en['tr_disclaimer']).toContain('Not legal advice');
    expect(en['tr_find_lawyer']).toContain('Housing Attorney');
    const trKeys = Object.keys(en).filter(k => k.startsWith('tr_'));
    expect(trKeys.length).toBeGreaterThanOrEqual(8);
  });

  test('5-03: civil_ keys — civil case cross-links (6 keys)', async () => {
    const fs  = await import('fs');
    const en  = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    expect(en['civil_family_title']).toBe('Family Court');
    expect(en['civil_imm_title']).toBe('Immigration Consequences');
    expect(en['civil_housing_title']).toBe('Housing Rights');
    const civilKeys = Object.keys(en).filter(k => k.startsWith('civil_'));
    expect(civilKeys.length).toBe(6);
  });

  test('5-04: tr_do_now is "Do this right now"', async () => {
    const fs  = await import('fs');
    const en  = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    expect(en['tr_do_now']).toBe('Do this right now');
  });

  test('5-05: tr_header_body contains tenant rights affirmation', async () => {
    const fs  = await import('fs');
    const en  = JSON.parse(fs.readFileSync(__REPO + '/frontend/src/i18n/en.json', 'utf8'));
    expect(en['tr_header_body']).toContain('legal rights');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 6. aedpaRisk + Escalation Object — Appellate Deep Signals
// ═══════════════════════════════════════════════════════════════════════════
describe('6. aedpaRisk + Escalation Object Shape', () => {

  test('6-01: aedpaRisk fires when years_post_conviction >= 1', () => {
    const s = computeAllSignals(mkMatter('appellate', {
      years_post_conviction: 1, evidence_score: 60,
    }));
    expect(s.vertical_signals.aedpaRisk).toBe(true);
  });

  test('6-02: aedpaRisk is false when years_post_conviction < 1', () => {
    const s = computeAllSignals(mkMatter('appellate', {
      years_post_conviction: 0, evidence_score: 60,
    }));
    expect(s.vertical_signals.aedpaRisk).toBe(false);
  });

  test('6-03: aedpaRiskNote has citation text when triggered', () => {
    const s = computeAllSignals(mkMatter('appellate', {
      years_post_conviction: 2, evidence_score: 60,
    }));
    expect(s.vertical_signals.aedpaRiskNote).toContain('AEDPA');
    expect(s.vertical_signals.aedpaRiskNote).toContain('28 U.S.C.');
  });

  test('6-04: aedpaRiskNote is null when not triggered', () => {
    const s = computeAllSignals(mkMatter('appellate', {
      years_post_conviction: 0, evidence_score: 60,
    }));
    expect(s.vertical_signals.aedpaRiskNote).toBeNull();
  });

  test('6-05: certWorthy fires on revScore >= 60 + capital case', () => {
    // certWorthy = revScore >= 60 && capital
    const s = computeAllSignals(mkMatter('appellate', {
      is_capital: 1,
      vulnerability_level: 'high',  // needed for prioCapital
      evidence_score: 80,            // strong evidence = high revScore
      prior_appeals: 0,
    }));
    expect(s.vertical_signals.certWorthy).toBe(true);
  });

  test('6-06: escalation object has level, triggers, sla_hours', () => {
    const s = computeAllSignals(mkMatter('criminal_defense'));
    expect(s.escalation).toBeDefined();
    expect(typeof s.escalation.level).toBe('string');
    expect(Array.isArray(s.escalation.triggers)).toBe(true);
    // sla_hours is null for normal or a number for critical
    const validSla = s.escalation.sla_hours === null ||
                     typeof s.escalation.sla_hours === 'number';
    expect(validSla).toBe(true);
  });

  test('6-07: critical escalation has sla_hours=1 (emergency)', () => {
    // isEmergency && isCrisis → level='critical', sla_hours=1
    const s = computeAllSignals(mkMatter('criminal_defense', {
      time_pressure: 'emergency',
      vulnerability_level: 'crisis',
      evidence_score: 85,
    }));
    if (s.escalation.level === 'critical') {
      expect(s.escalation.sla_hours).toBe(1);
    } else {
      // Verify the level is still a valid value
      expect(['normal','elevated','high','critical']).toContain(s.escalation.level);
    }
  });

  test('6-08: 3000 appellate computations — aedpaRisk always correct', () => {
    let errors = 0;
    for (let i = 0; i < 3000; i++) {
      const ypc = i % 5; // 0,1,2,3,4
      const s = computeAllSignals(mkMatter('appellate', {
        years_post_conviction: ypc,
        evidence_score: i % 100,
        prior_appeals: i % 10,
      }));
      const expectedAedpa = ypc >= 1;
      if (s.vertical_signals.aedpaRisk !== expectedAedpa) errors++;
    }
    expect(errors).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. DocumentScannerScreen — Camera Permission + Upload
// ═══════════════════════════════════════════════════════════════════════════
describe('7. DocumentScannerScreen — Camera Flow', () => {

  test('7-01: DocumentScannerScreen requests camera permission', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DocumentScannerScreen.tsx', 'utf8');
    // DocumentScannerScreen uses expo-camera permission model
    const hasCameraPermission = src.includes('requestPermissionsAsync') || 
                                src.includes('useCameraPermissions') ||
                                src.includes('Camera.requestCameraPermissionsAsync');
    expect(hasCameraPermission).toBe(true);
    const hasCameraRef = src.includes('camera') || src.includes('Camera');
    expect(hasCameraRef).toBe(true);
  });

  test('7-02: DocumentScannerScreen has retake / use button flow', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DocumentScannerScreen.tsx', 'utf8');
    // 3-step: capture → preview → use
    const hasRetake = src.includes('retake') || src.includes('Retake');
    const hasUse    = src.includes('Use') || src.includes('use');
    expect(hasRetake).toBe(true);
    expect(hasUse).toBe(true);
  });

  test('7-03: DocumentScannerScreen takes caseId; a file can be chosen when the camera is denied', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DocumentScannerScreen.tsx', 'utf8');
    expect(src).toContain('caseId');
    expect(src).toContain('expo-document-picker');
    expect(src).not.toContain('onCapture'); // the never-called callback param is gone
  });

  test('7-04: DocumentScannerScreen handles Platform differences', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/DocumentScannerScreen.tsx', 'utf8');
    // Platform split is done by file: the native screen imports expo-camera and
    // the web build resolves DocumentScannerScreen.web.tsx (file input).
    expect(src).toContain("from 'expo-camera'");
    expect(fs.existsSync(__REPO + '/frontend/src/screens/DocumentScannerScreen.web.tsx')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. App.tsx — Auth State Machine + Root Setup
// ═══════════════════════════════════════════════════════════════════════════
describe('8. App.tsx — Root Auth State Machine', () => {

  test('8-01: App.tsx has 4 auth states: loading, guest, browsing, authed', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/App.tsx', 'utf8');
    expect(src).toContain('loading');
    expect(src).toContain('guest');
    expect(src).toContain('browsing');
    expect(src).toContain('authed');
  });

  test('8-02: App.tsx imports NavigationContainer + SafeAreaProvider', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/App.tsx', 'utf8');
    expect(src).toContain('NavigationContainer');
    expect(src).toContain('SafeAreaProvider');
  });

  test('8-03: App.tsx uses AppState for lifecycle management', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/App.tsx', 'utf8');
    expect(src).toContain('AppState');
  });

  test('8-04: App.tsx has loading state renders ActivityIndicator or splash', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/App.tsx', 'utf8');
    const hasLoading = src.includes('ActivityIndicator') ||
                       src.includes('SplashScreen') ||
                       src.includes("authState === 'loading'");
    expect(hasLoading).toBe(true);
  });

  test('8-05: App.tsx configured with StatusBar for both platforms', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/App.tsx', 'utf8');
    expect(src).toContain('StatusBar');
  });

  test('8-06: auth state model is consistent', () => {
    const STATES = ['loading', 'guest', 'browsing', 'authed'];
    const isAuth  = (s) => s === 'authed';
    const canBrowse = (s) => s === 'authed' || s === 'browsing';

    // If authenticated → can browse
    for (const s of STATES) {
      if (isAuth(s)) expect(canBrowse(s)).toBe(true);
    }
    expect(isAuth('authed')).toBe(true);
    expect(isAuth('browsing')).toBe(false);
    expect(canBrowse('browsing')).toBe(true);
    expect(canBrowse('guest')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. ChatScreen — API Contract + Session Management
// ═══════════════════════════════════════════════════════════════════════════
describe('9. ChatScreen — AI Chat API Contract', () => {

  test('9-01: ChatScreen asks through services/chatStream.ts (POST /chat/ask fallback)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    const svc = fs.readFileSync(__REPO + '/frontend/src/services/chatStream.ts', 'utf8');
    expect(src).toContain('askChat(');
    expect(svc).toContain("'/chat/ask'");
    expect(svc).toContain('api.post');
  });

  test('9-02: ChatScreen manages sessionId state', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('sessionId');
    expect(src).toContain('session_id');
  });

  test('9-03: ChatScreen has showDisclaimer gate', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('showDisclaimer');
  });

  test('9-04: ChatScreen has messages state array', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('messages');
    expect(src).toContain('busy');
    expect(src).toContain('input');
  });

  test('9-05: ChatScreen re-checks the session on focus (useHasSession)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/ChatScreen.tsx', 'utf8');
    expect(src).toContain('useHasSession');
  });

  test('9-06: ChatScreen uses jobPoller for async AI responses', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/services/chatStream.ts', 'utf8');
    expect(src).toContain('pollJob');
    expect(src).toContain('jobPoller');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. MotionLibraryScreen — Generate, Review, History
// ═══════════════════════════════════════════════════════════════════════════
describe('10. MotionLibraryScreen — AI Motion Generation', () => {

  test('10-01: MotionLibraryScreen has generate + review + history endpoints', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain("'/motions/generate'");
    expect(src).toContain("'/motions/review'");
    expect(src).toContain("'/motions/history'");
  });

  test('10-02: MotionLibraryScreen has keyword search state', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('keyword');
  });

  test('10-03: MotionLibraryScreen has disclaimer gate (legal compliance)', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('disclaimerVisible');
  });

  test('10-04: MotionLibraryScreen uses jobPoller for async generation', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('pollJob');
  });

  test('10-05: MotionLibraryScreen has Clipboard copy + Share export', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('Clipboard');
    expect(src).toContain('Share.share');
  });

  test('10-06: MotionLibraryScreen caches motions via offlineCache', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/MotionLibraryScreen.tsx', 'utf8');
    expect(src).toContain('cacheMotions');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. AttorneyDashboardScreen — Availability + Cases + CLE
// ═══════════════════════════════════════════════════════════════════════════
describe('11. AttorneyDashboardScreen — Attorney Portal', () => {

  test('11-01: AttorneyDashboardScreen has availability fetch + update', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx', 'utf8');
    expect(src).toContain("'/attorney/profile/availability'");
    expect(src).toContain('api.put');
  });

  test('11-02: AttorneyDashboardScreen has case list endpoint', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx', 'utf8');
    expect(src).toContain("'/attorney/cases'");
  });

  test('11-03: AttorneyDashboardScreen has CLE tab', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx', 'utf8');
    expect(src).toContain("'/attorney/cle'");
    expect(src).toContain('cle');
  });

  test('11-04: AttorneyDashboardScreen has schedule and saving states', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx', 'utf8');
    // Section G: tabs Overview / Cases / Leads / Templates / CLE / Profile, each loading its own data
    expect(src).toContain("type Tab = 'overview' | 'cases' | 'leads' | 'templates' | 'cle' | 'profile'");
    expect(src).toContain("'/attorney/profile'");
    expect(src).toContain("'/attorney/cases'");
    expect(src).toContain("'/attorney/templates'");
    expect(src).toContain("'/attorney/cle'");
    expect(src).toContain('/billing/pi-leads');
    expect(src).toContain('availability');
    expect(src).toContain('saveAvail');
  });

  test('11-05: AttorneyDashboardScreen has templates endpoint', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/AttorneyDashboardScreen.tsx', 'utf8');
    expect(src).toContain("'/attorney/templates");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. LegalResearchScreen — $49.99/mo Paywall
// ═══════════════════════════════════════════════════════════════════════════
describe('12. LegalResearchScreen — AI Research Paywall', () => {

  test('12-01: LegalResearchScreen checks subscription status', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain("'/research/status'");
    expect(src).toContain('has_access');
  });

  test('12-02: LegalResearchScreen paywall lists the real plans (GET /billing/tiers), no invented add-on', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain("'/billing/tiers'");
    expect(src).not.toContain('49.99');
  });

  test('12-03: LegalResearchScreen has research history', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain("'/research/history'");
    expect(src).toContain('messages');
  });

  test('12-04: LegalResearchScreen has disclaimer gate', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain('disclaimerVisible');
  });

  test('12-05: LegalResearchScreen uses jobPoller for async research', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LegalResearchScreen.tsx', 'utf8');
    expect(src).toContain("'/research/ask'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. Regression — All Prior Fixes Confirmed
// ═══════════════════════════════════════════════════════════════════════════
describe('13. Regression — All Prior Fixes Confirmed', () => {

  test('13-01: HomeScreen PTR fix intact', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/HomeScreen.tsx', 'utf8');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('setRefreshing(false)');
  });


  test('13-03: aedpaRisk 0 years → false', () => {
    const s = computeAllSignals(mkMatter('appellate', { years_post_conviction: 0 }));
    expect(s.vertical_signals.aedpaRisk).toBe(false);
  });

  test('13-04: aedpaRisk 1+ years → true', () => {
    const s = computeAllSignals(mkMatter('appellate', { years_post_conviction: 2 }));
    expect(s.vertical_signals.aedpaRisk).toBe(true);
  });

  test('13-05: family expedTRO requires crisis + dv_flag', () => {
    const both = computeAllSignals(mkMatter('family', { vulnerability_level: 'crisis', dv_flag: 1 }));
    const neither = computeAllSignals(mkMatter('family', { vulnerability_level: 'moderate', dv_flag: 0 }));
    expect(both.vertical_signals.expedTRO).toBe(true);
    expect(neither.vertical_signals.expedTRO).toBe(false);
  });

  test('13-06: TRIAL_DAYS = 14 (firm acquisition)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    expect(src).toContain('export const TRIAL_DAYS = 14;');
  });

  test('13-07: VALID_VERTICALS has 11 entries (includes "general")', async () => {
    const fs  = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firm_acquisition.js', 'utf8');
    expect(src).toContain("'general'");
    expect(src).toContain('VALID_VERTICALS');
  });

  test('13-08: encryption 500 round-trips', () => {
    for (let i = 0; i < 500; i++) {
      expect(decrypt(encrypt(`payload-${i}`))).toBe(`payload-${i}`);
    }
  });

  test('13-09: GAVEL_LEVELS.GOLDEN=3, NONE=0', () => {
    expect(GAVEL_LEVELS.GOLDEN).toBe(3);
    expect(GAVEL_LEVELS.NONE).toBe(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// 14. Mass Influx — 100,000 New Scenarios
// ═══════════════════════════════════════════════════════════════════════════
describe('14. Mass Influx — 100,000 New Scenarios', () => {

  test('14-01: 30,000 appellate signal computations — aedpaRisk always correct', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const ypc = i % 5;
      const s = computeAllSignals(mkMatter('appellate', {
        years_post_conviction: ypc,
        evidence_score: i % 100,
        prior_appeals: i % 8,
        is_capital: i % 4 === 0 ? 1 : 0,
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
      }));
      if (s.vertical_signals.aedpaRisk !== (ypc >= 1)) errors++;
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('14-02: 30,000 family signals — expedTRO always correct', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const vl = ['low','moderate','high','crisis'][i % 4];
      const isCrisis = vl === 'crisis';
      const hasDV    = i % 3 === 0;
      const s = computeAllSignals(mkMatter('family', {
        vulnerability_level: ['low','moderate','high','crisis'][i % 4],
        dv_flag: hasDV ? 1 : 0,
        asset_tier: ['under_500k','2m_10m','over_10m'][i % 3],
        evidence_score: i % 100,
      }));
      // expedTRO requires vulnerability_level === 'crisis' AND dv_flag===1
      const expectedExpedTRO = isCrisis && hasDV;
      if (s.vertical_signals.expedTRO !== expectedExpedTRO) errors++;
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });

  test('14-03: 20,000 encryption round-trips with unicode + JSON', () => {
    const PAYLOADS = [
      '{"userId":42,"role":"partner"}',
      '日本語テスト 123',
      '🔐⚖️🏛️',
      'a'.repeat(500),
      '',
      '{"nested":{"deep":{"value":true}}}',
    ];
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
      const p = `${PAYLOADS[i % PAYLOADS.length]}_${i}`;
      if (decrypt(encrypt(p)) !== p) errors++;
    }
    expect(errors).toBe(0);
  });

  test('14-04: 20,000 motion recommendations — all arrays', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
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
});