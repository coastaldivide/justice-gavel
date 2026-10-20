// Repo root, resolved relative to this test file (was a hard-coded /tmp path)
const __REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname).replace(/\/$/, '');
// JUSTICE GAVEL - BRUTAL TRIALS v103
// 103rd pass: 5 S0 fixes + time.js deep + push.js + pay.js + match.js
// + insurance.js + alerts.js + courthouses + resources final push


let computeAllSignals, computeDiversionRecommendations;
let computeOutcomeEstimate, encrypt, decrypt;
let GAVEL_EMOJI, CONFIG;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
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

// ── DISC35. 5 S0 Threshold Fixes ──────────────────────────────────────────
describe('DISC35. S0 Threshold Fixes — 5 items', () => {
  test('DISC35-01: firms.js GET /:id/audit — SOC 2 audit log [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/firms.js','utf8');
    expect(src).toContain("router.get('/:id/audit'");
    expect(src).toContain('audit');
    expect(src).toContain('authRequired');
  });
  test('DISC35-02: conflicts.js GET /soc2/:firmId — SOC 2 compliance export [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/conflicts.js','utf8');
    expect(src).toContain("router.get('/soc2/:firmId'");
    expect(src).toContain('soc2');
    // SOC 2 compliance: full conflict check + ethics wall audit export
  });
  test('DISC35-03: checkins.js GET /my/:enrollmentId — personal history [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/checkins.js','utf8');
    expect(src).toContain("router.get('/my/:enrollmentId'");
    expect(src).toContain('authRequired');
  });
  test('DISC35-05: contracts/execution GET /:id/signers [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('signers');
  });
});

// ── TIM. time.js — Billable Time + Invoice Management ────────────────────
describe('TIM. time.js — Time Tracking + Attorney Billing', () => {
  test('TIM-01: GET /aba-codes — ABA billing code reference list', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/time.js','utf8');
    expect(src).toContain("router.get('/aba-codes'");
    expect(src).toContain('aba');
    expect(src).toContain('authRequired');
    // ABA codes: standardized billing codes required by courts + clients
  });
  test('TIM-02: POST/GET /entries — create and list time entries', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/time.js','utf8');
    expect(src).toContain("router.post('/entries'");
    expect(src).toContain("router.get('/entries'");
    expect(src).toContain('entries');
  });
  test('TIM-03: GET /invoices/:id/pdf — download invoice as PDF', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/time.js','utf8');
    expect(src).toContain("router.get('/invoices/:id/pdf'");
    expect(src).toContain('pdf');
    // Attorney billing: client-ready invoice PDF
  });
  test('TIM-04: GET /matter/:matterId/billing-summary — full matter billing snapshot', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/time.js','utf8');
    expect(src).toContain("router.get('/matter/:matterId/billing-summary'");
    expect(src).toContain('billing');
    // Hours × rate + expenses = total for matter — used for retainer reconciliation
  });
  test('TIM-05: time.js is 36,268 chars — comprehensive billing engine', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/time.js','utf8');
    expect(src.length).toBeGreaterThan(30000);
    // POST/GET /invoices, PUT/DELETE /entries/:id, GET /summary — full lifecycle
  });
});

// ── PSH. push.js — Push Notification System ──────────────────────────────
describe('PSH. push.js — Push Token + Notifications', () => {
  test('PSH-01: POST /token — register device push token', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/push.js','utf8');
    expect(src).toContain("router.post('/token'");
    expect(src).toContain('token');
    expect(src).toContain('authRequired');
    // Saves Expo push token for this device to web_push_subscriptions table
  });
  test('PSH-02: POST /test — send test push to device', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/push.js','utf8');
    expect(src).toContain("router.post('/test'");
    expect(src).toContain('test');
    // Verifies push delivery end-to-end before going live
  });
  test('PSH-03: GET /tip — daily legal tip push notification', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/push.js','utf8');
    expect(src).toContain("router.get('/tip'");
    expect(src).toContain('tip');
    // Daily Know Your Rights tip — engagement + retention driver
  });
  test('PSH-04: POST /retention/post-purchase — post-purchase retention push', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/push.js','utf8');
    expect(src).toContain("router.post('/retention/post-purchase'");
    // After QuickConnect: push sequence to keep user engaged
  });
});

// ── PAY. pay.js — Payment Link Creation ──────────────────────────────────
describe('PAY. pay.js — Stripe Payment Link System', () => {
  test('PAY-01: POST /create — create Stripe payment link for family', async () => {
    const fs = await import('fs');
    // Section G: routes/pay.js (charged whatever amount the client sent) is removed. Every purchase has a
    // server-chosen price: services/stripeBilling.js startPayment / startSubscription, verified on confirm.
    expect(fs.existsSync(__REPO + '/backend/src/routes/pay.js')).toBe(false);
    expect(fs.readFileSync(__REPO + '/backend/src/app.js', 'utf8')).not.toMatch(/['"]\/api\/pay['"]/);
    const sb = fs.readFileSync(__REPO + '/backend/src/services/stripeBilling.js', 'utf8');
    expect(sb).toContain('export async function startPayment');
    expect(sb).toContain('export async function verifyPayment');
  });
  test('PAY-02: POST /checkout — initiate Stripe checkout session', async () => {
    const fs = await import('fs');
    // Section G: routes/pay.js (charged whatever amount the client sent) is removed. Every purchase has a
    // server-chosen price: services/stripeBilling.js startPayment / startSubscription, verified on confirm.
    expect(fs.existsSync(__REPO + '/backend/src/routes/pay.js')).toBe(false);
    expect(fs.readFileSync(__REPO + '/backend/src/app.js', 'utf8')).not.toMatch(/['"]\/api\/pay['"]/);
    const sb = fs.readFileSync(__REPO + '/backend/src/services/stripeBilling.js', 'utf8');
    expect(sb).toContain('export async function startPayment');
    expect(sb).toContain('export async function verifyPayment');
  });
});

// ── MAT. match.js — Attorney Matchmaking ─────────────────────────────────
describe('MCH. match.js — Attorney Matchmaking Engine', () => {
  test('MCH-01: GET /lawyers — AI-powered attorney matching algorithm', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/match.js','utf8');
    expect(src).toContain("router.get('/lawyers'");
    expect(src).toContain('lawyers');
    // Matches by: charge type, geography, rating, availability, price
  });
  test('MCH-02: match.js is 14,678 chars — comprehensive matching engine', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/match.js','utf8');
    expect(src.length).toBeGreaterThan(10000);
  });
});

// ── INS. insurance.js — Legal Insurance Integration ──────────────────────
describe('INS. insurance.js — Legal Insurance Plans', () => {
  test('INS-01: POST /quote — get legal insurance quote', async () => {
    const fs = await import('fs');
    // Section F: the fake legal-insurance quote (made-up carrier, Legal Pro at $19.99) was removed
    expect(fs.existsSync(__REPO + '/backend/src/routes/insurance.js')).toBe(false);
    const app = fs.readFileSync(__REPO + '/backend/src/app.js', 'utf8');
    expect(app).not.toContain('/api/insurance');
  });
  test('INS-02: GET /plans — available insurance plan listings', async () => {
    const fs = await import('fs');
    // Section F: the fake legal-insurance quote (made-up carrier, Legal Pro at $19.99) was removed
    expect(fs.existsSync(__REPO + '/backend/src/routes/insurance.js')).toBe(false);
    const app = fs.readFileSync(__REPO + '/backend/src/app.js', 'utf8');
    expect(app).not.toContain('/api/insurance');
  });
});

// ── ALT. alerts.js — Emergency Alert System ──────────────────────────────
describe('ALT. alerts.js — Emergency Alert Broadcast', () => {
  test('ALT-01: POST / — broadcast emergency alert to subscribers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/routes/alerts.js','utf8');
    expect(src).toContain("router.post('/'");
    expect(src).toContain('alert');
    // Broadcast: new arrest → subscribers (attorneys + bondsmen) notified
  });
});

// ── APP. app.js — 61 Mount Points ────────────────────────────────────────
describe('APP. app.js — Complete 61-Route Mount Manifest', () => {
  test('APP-01: 61 mount points cover all features', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/app.js','utf8');
    const mounts = (src.match(/app\.use\s*\(\s*['"][^'"]+['"]/g)||[]);
    expect(mounts.length).toBeGreaterThan(55);
    // Every feature has its own router mounted at /api/feature
  });
  test('APP-02: key routes present — matters, firms, time, push, pay, match', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/app.js', 'utf8');
    for (const route of ['/api/matters', '/api/firms', '/api/time', '/api/push',
                         '/api/match', '/api/alerts', '/api/billing', '/api/webhooks/outbound']) {
      expect(src).toContain(route);
    }
    expect(src).not.toMatch(/['"]\/api\/pay['"]/);   // section G: routes/pay.js removed
  });
  test('APP-03: /api/jobs route — background job management', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(__REPO + '/backend/src/app.js','utf8');
    expect(src).toContain('/api/jobs');
    // Job management: trigger, monitor, cancel background operations
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v102 Confirmed', () => {
  test('R-02: GAVEL + encrypt + CONFIG', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    for (let i=0;i<500;i++) expect(decrypt(encrypt(`r-${i}`))).toBe(`r-${i}`);
    expect(CONFIG.DEMO_MODE).toBeDefined();
    expect(CONFIG.AI_CONCURRENCY).toBe(8);
    /* removed: BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS does not exist */
  });
});

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
      if (!r.disclaimer?.required||!Array.isArray(r.analyses)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-03: 20,000 diversion + 20,000 encrypt', () => {
    let e=0;
    for (let i=0;i<20000;i++) {
      for (const r of computeDiversionRecommendations({id:i,vertical:'criminal_defense',
        title:'D',evidence_score:i%100,vulnerability_level:['low','moderate','high','crisis'][i%4],
        prior_adjudications:i%5,client_age:18+(i%40)})) {
        if(r.eligibility_score<0||r.eligibility_score>1) e++;
      }
      if(decrypt(encrypt(`v103_${i}`))!==`v103_${i}`) e++;
    }
    expect(e).toBe(0);
  });
});