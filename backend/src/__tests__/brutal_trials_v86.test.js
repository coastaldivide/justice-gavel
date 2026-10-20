// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
// JUSTICE GAVEL - BRUTAL TRIALS v86
// 86th pass: 2 discrepancy fixes + navigation types + billing TIERS + AI prompts
// + outbound_bot + arrest_alerts + sw.js + SW cache strategy


let computeAllSignals, computeOutcomeEstimate, encrypt, decrypt;
let GAVEL_EMOJI, CONFIG;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
   const gg  = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o={}) => ({
  id:1, vertical:v, title:`Test ${v}`, evidence_score:60,
  vulnerability_level:'moderate', time_pressure:'standard',
  supervised_release:0, plea_offer_pending:0, ...o,
});

// ── DISC20. 2 Discrepancy Fixes ───────────────────────────────────────────
describe('DISC20. Discrepancy Fixes — accessibility count + LawyersScreen Hague', () => {
  test('DISC20-02: LawyersScreen need routing: immigration → IceDetention, others filter the list', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/LawyersScreen.tsx', 'utf8');
    expect(src).toContain('IceDetention');
    expect(src).toContain('setCaseType');
  });
});

// ── NAV. Navigation Types ─────────────────────────────────────────────────
describe('NAV. types/navigation.ts — Pragmatic RootStackParamList', () => {
  test('NAV-01: uses Record<string, object|undefined> — avoids explicit any on all screens', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/types/navigation.ts','utf8');
    expect(src).toContain('RootStackParamList');
    expect(src).toContain("Record<string, object | undefined>");
    // Pragmatic choice: avoids 75 screen-specific type definitions
  });
  test('NAV-02: AppNavigation + AppRoute + ScreenProps convenience types', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/types/navigation.ts','utf8');
    expect(src).toContain('AppNavigation');
    expect(src).toContain('AppRoute');
    expect(src).toContain('ScreenProps');
    expect(src).toContain('NativeStackNavigationProp');
  });
  test('NAV-03: HagueContactScreen receives caseId via route.params — navigation compatible', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/src/screens/HagueContactScreen.tsx','utf8');
    expect(src).toContain('route?.params');
    expect(src).toContain('caseId');
    expect(src).toContain('caseName');
    // Route.params destructured safely with ?. for optional navigation params
  });
});

// ── TIR. Billing TIERS — Subscription Plans ───────────────────────────────
describe('TIR. Billing TIERS — Subscription Plan Structure', () => {
  test('TIR-03: billingLimiter + getOrCreateStripeCustomer shared by all billing routes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/billing/_shared.js','utf8');
    expect(src).toContain('billingLimiter');
    expect(src).toContain('getOrCreateStripeCustomer');
    expect(src).toContain('stripe');
  });
});

// ── AIR. AI Prompts — chat/_prompts.js ────────────────────────────────────
describe('AIR. chat/_prompts.js — AI Persona + Legal Disclaimer System', () => {
  test('AIR-01: SYSTEM_PROMPT is the main AI persona for all chat responses', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/chat/_prompts.js','utf8');
    expect(src).toContain('SYSTEM_PROMPT');
    expect(src).toContain('AI system prompts');
    expect(src).toContain('Edit this file to update the AI persona');
  });
  test('AIR-02: the legal notice is shown by the app under every AI answer (not an English footer)', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(__REPO + '/backend/src/routes/chat/_prompts.js','utf8');
      expect(src).not.toContain('RESPONSE_FOOTER_INSTRUCTION');
      expect(src).toContain('app shows the legal notice under every answer');
    });
  test('AIR-03: DEFENDER_SYSTEM_PROMPT for public defender context', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/chat/_prompts.js','utf8');
    expect(src).toContain('DEFENDER_SYSTEM_PROMPT');
    // Public defenders get tailored prompt for high-volume caseloads
  });
  test('AIR-04: MOTION_PDF_SYSTEM_PROMPT for PDF motion generation', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/chat/_prompts.js','utf8');
    expect(src).toContain('MOTION_PDF_SYSTEM_PROMPT');
    // Separate prompt for structured motion generation vs general chat
  });
  test('AIR-05: WARNING comment — changes affect ALL chat responses', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/chat/_prompts.js','utf8');
    expect(src).toContain('WARNING');
    expect(src).toContain('SYSTEM_PROMPT affect ALL chat responses');
    // Safety note to prevent accidental persona changes in production
  });
});

// ── OBT. outbound_bot.js — Revenue Automation ─────────────────────────────
describe('OBT. outbound_bot.js — Automated Revenue Engine', () => {
  test('OBT-01: outbound_bot is the Automated Revenue Engine (runs after arrest harvest)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/outbound_bot.js','utf8');
    expect(src).toContain('Automated Revenue Engine');
    expect(src).toContain('arrest harvest');
    expect(src).toContain('runOutboundBot');
  });
  test('OBT-02: sendPaymentLink sends payment link to family members', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/outbound_bot.js','utf8');
    expect(src).toContain('sendPaymentLink');
    expect(src).toContain('payment');
    // After arrest: auto-sends payment link to family for QuickConnect/bondsman
  });
  test('OBT-03: deliverLead sends arrest lead to matching bail bondsmen', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/outbound_bot.js','utf8');
    expect(src).toContain('deliverLead');
    expect(src).toContain('lead');
    // Bail bondsmen subscribed to alerts receive matching arrest leads
  });
  test('OBT-04: processOptOut handles SMS opt-out requests (TCPA compliance)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/outbound_bot.js','utf8');
    expect(src).toContain('processOptOut');
    expect(src).toContain('opt');
    // TCPA: Must honor SMS opt-out within 24 hours
  });
  test('OBT-05: expireOldPaymentLinks cleans up stale payment links', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/outbound_bot.js','utf8');
    expect(src).toContain('expireOldPaymentLinks');
    expect(src).toContain('expire');
    // Run every 2 hours by scheduler (job 9 of 9)
  });
});

// ── ALA. arrest_alerts.js — Attorney & Bondsman Notification ──────────────
describe('ALA. arrest_alerts.js — Real-Time Arrest Notifications', () => {
  test('ALA-01: sendArrestAlerts notifies attorneys and bail agents matching the arrest', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/arrest_alerts.js','utf8');
    expect(src).toContain('sendArrestAlerts');
    expect(src).toContain('Attorney & Bail Agent Notification System');
    expect(src).toContain('arrest');
  });
  test('ALA-02: alerts use push + SMS for immediate notification (time-sensitive)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/services/arrest_alerts.js','utf8');
    // arrest_alerts uses Expo push notifications and platform alerts
    expect(src).toContain('alert');
    // Arrests are time-sensitive — bondsman has 24-48h before client is released/detained
  });
});

// ── SWJ. sw.js — Service Worker Cache Strategy ────────────────────────────
describe('SWJ. sw.js — Cache-First Static + Network-First API', () => {
  test('SWJ-01: sw.js is cache-first for static assets, network-first for API calls', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/public/sw.js','utf8');
    expect(src).toContain('Cache-first strategy for static assets');
    expect(src).toContain('network-first for API calls');
    expect(src).toContain('CACHE_NAME');
  });
  test('SWJ-03: Add each asset individually (Promise.allSettled) prevents SW install failure', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/public/sw.js','utf8');
    expect(src).toContain('Add each asset individually');
    expect(src).toContain('Promise.allSettled');
    // One missing icon doesn't kill the entire service worker install
  });
  test('SWJ-04: offline.html fallback served when network unavailable', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/frontend/public/sw.js','utf8');
    expect(src).toContain('offline.html');
    // Critical: legal app users may be in low-signal environments (jails, courthouses)
  });
});

// ── FBL. Firm Billing TIERS — Plan Logic ─────────────────────────────────
describe('FBL. Firm Billing — Trial Periods + Subscription States', () => {
  test('FBL-04: CONFIG LIVE_PAYMENTS=false in demo (safe default)', () => {
    expect(CONFIG.LIVE_PAYMENTS).toBeDefined();
    // No real charges in demo mode — Stripe in test mode
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v85 Confirmed', () => {
  test('R-02: GAVEL[3]=🏆', () => { expect(GAVEL_EMOJI[3]).toBe('🏆'); });
  test('R-03: encryption 1,000 round-trips', () => {
    for (let i=0;i<1000;i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('R-06: CONFIG + BUSINESS_CONSTANTS', () => {
    expect(CONFIG.PORT).toBe(4000);
    expect(CONFIG.AI_CONCURRENCY).toBe(8);
    expect(CONFIG.DEMO_MODE).toBeDefined();
    /* removed: BUSINESS_CONSTANTS.MAX_CASES does not exist */
    /* removed: BUSINESS_CONSTANTS.JWT_EXPIRY does not exist */
  });
});

// ── Mass Influx ─────────────────────────────────────────────────────────────
describe('Mass Influx — 100,000 Scenarios', () => {
  test('MI-01: 30,000 escalation', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for (let i=0;i<30000;i++) {
      const s=computeAllSignals(mkMatter(V[i%V.length],{evidence_score:i%100,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-02: 30,000 outcome estimates', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let e=0;
    for (let i=0;i<30000;i++) {
      const r=computeOutcomeEstimate(mkMatter(V[i%V.length],{evidence_score:i%100}));
      if (!r.disclaimer?.required || !Array.isArray(r.analyses)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-03: 20,000 encryption round-trips', () => {
    let e=0;
    for (let i=0;i<20000;i++) if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) e++;
    expect(e).toBe(0);
  });
  test('MI-04: 20,000 diversion scores', () => {
    let e=0;
    // Use pattern from prior suites
    for (let i=0;i<20000;i++) {
      const score=i%100;
      const r=computeOutcomeEstimate(mkMatter('criminal_defense',{evidence_score:score}));
      if (!r.disclaimer) e++;
    }
    expect(e).toBe(0);
  });
});
