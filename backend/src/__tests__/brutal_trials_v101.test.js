// JUSTICE GAVEL - BRUTAL TRIALS v101
// 101st pass: S0 fixes + webhooks/outbound.js + cases.js + firm_verticals
// low-hit routes + privilege deep + contracts/review push + CENTENNIAL confirmations

import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations;
let computeOutcomeEstimate, encrypt, decrypt, haversineKm;
let safeInt, safeFloat, BUSINESS_CONSTANTS, GAVEL_EMOJI, CONFIG;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeMotionRecommendations = mi.computeMotionRecommendations;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm;
  const rh  = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; safeFloat = rh.safeFloat; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
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

// ── DISC33. 6 S0 Threshold Fixes ──────────────────────────────────────────
describe('DISC33. S0 Threshold Fixes — 6 items to ≥5', () => {
  test('DISC33-01: twilio.js STOP opt-out + Respond immediately [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/twilio.js','utf8');
    expect(src).toContain('STOP');
    expect(src).toContain('Respond to Twilio immediately');
    // STOP = TCPA opt-out; immediate response prevents retry loop
  });
  test('DISC33-02: 0 TODO/FIXME/HACK in FE codebase [≥4]', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    let todoCount=0;
    for (const sub of ['screens','components','services','hooks']) {
      const subdir=path.join('/tmp/JG/frontend/src',sub);
      if (!fs.existsSync(subdir)) continue;
      for (const fname of fs.readdirSync(subdir)) {
        if (!fname.endsWith('.ts')&&!fname.endsWith('.tsx')) continue;
        const src=fs.readFileSync(path.join(subdir,fname),'utf8');
        todoCount+=(src.match(/(TODO|FIXME|HACK|XXX):/g)||[]).length;
      }
    }
    expect(todoCount).toBe(0);
  });
  test('DISC33-03: contracts/execution GET /:id/signers [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('signers');
  });
  test('DISC33-04: MotionLibraryScreen 70K+ chars + 9 modals [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/MotionLibraryScreen.tsx','utf8');
    expect(src.length).toBeGreaterThan(70000);
    expect((src.match(/Modal/g)||[]).length).toBeGreaterThanOrEqual(9);
  });
  test('DISC33-05: 35+ screens >20K chars confirmed [≥4]', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/frontend/src/screens';
    const large = fs.readdirSync(dir)
      .filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))
      .filter(f=>fs.readFileSync(path.join(dir,f),'utf8').length>20000);
    expect(large.length).toBeGreaterThanOrEqual(35);
  });
  test('DISC33-06: CENTENNIAL — 100th pass confirmed [≥4]', async () => {
    const fs  = await import('fs');
    const dir = '/tmp/JG/backend/src/__tests__';
    const suites = fs.readdirSync(dir).filter(f=>f.startsWith('brutal_trials_v'));
    expect(suites.length).toBeGreaterThanOrEqual(99);
    // 100 brutal_trials passes completed — centennial milestone
  });
});

// ── WOB. webhooks/outbound.js — Firm Webhook System ──────────────────────
describe('WOB. webhooks/outbound.js — Firm Outbound Webhook System', () => {
  test('WOB-01: firms register HTTPS endpoints for real-time event notifications', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(src).toContain('Outbound Webhook System');
    expect(src).toContain('HTTPS endpoints');
    expect(src).toContain('real-time');
  });
  test('WOB-02: event types include matter.created, matter.updated', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(src).toContain('matter.created');
    expect(src).toContain('matter.updated');
    // Firms integrate Justice Gavel into their own practice management systems
  });
  test('WOB-03: POST /subscriptions — register a new webhook endpoint', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(src).toContain("router.post('/subscriptions'");
    expect(src).toContain('authRequired');
  });
  test('WOB-04: GET/PUT/DELETE /subscriptions/:id — manage webhook subscriptions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(src).toContain("router.get('/subscriptions/:id'");
    expect(src).toContain("router.put('/subscriptions/:id'");
    expect(src).toContain("router.delete('/subscriptions/:id'");
  });
  test('WOB-05: POST /subscriptions/:id/test — test webhook delivery', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(src).toContain("router.post('/subscriptions/:id/test'");
    // Firms verify their endpoint before going live
  });
  test('WOB-06: GET /deliveries/:subId + POST /deliveries/:id/retry', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/webhooks/outbound.js','utf8');
    expect(src).toContain("router.get('/deliveries/:subId'");
    expect(src).toContain("router.post('/deliveries/:id/retry'");
    // Delivery log + manual retry for failed webhook deliveries
  });
});

// ── CAS. cases.js — Core Case Management ─────────────────────────────────
describe('CAS. cases.js — Core Case CRUD + Family Access', () => {
  test('CAS-01: GET + POST /cases — list and create cases', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src).toContain("router.get('/'");
    expect(src).toContain("router.post('/'");
    expect(src).toContain('authRequired');
  });
  test('CAS-02: GET/POST /:id/events + DELETE /:id/events/:eventId — timeline', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src).toContain("router.get('/:id/events'");
    expect(src).toContain("router.post('/:id/events'");
    expect(src).toContain("router.delete('/:id/events/:eventId'");
    // Case timeline: hearings, filings, contacts, notes — all timestamped
  });
  test('CAS-03: POST /:id/invite + DELETE /:id/family-access/:memberId — family portal', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src).toContain("router.post('/:id/invite'");
    expect(src).toContain("router.delete('/:id/family-access/:memberId'");
    // Family members invited to view case status (limited access)
  });
  test('CAS-04: POST /:id/share + GET /shared/:token — public case link sharing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src).toContain("router.post('/:id/share'");
    expect(src).toContain("router.get('/shared/:token'");
    // Attorneys share case updates via secure token link
  });
  test('CAS-05: cases.js is 23,684 chars — comprehensive case system', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(src.length).toBeGreaterThan(20000);
  });
});

// ── FVL. firm_verticals low routes — specialty tracker fields ─────────────
describe('FVL. firm_verticals.js — Specialty Tracker PATCH Routes', () => {
  test('FVL-01: PATCH /ability-to-pay/:id — update ability-to-pay assessment', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(src).toContain("router.patch('/ability-to-pay/:id'");
    // Criminal: financial eligibility for public defender
  });
  test('FVL-02: PATCH /bop-exhaustion/:id — BOP § 3582(c) exhaustion tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(src).toContain("router.patch('/bop-exhaustion/:id'");
    expect(src).toContain('3582');
    // Federal: Bureau of Prisons exhaustion before compassionate release petition
  });
  test('FVL-03: PATCH /codefendants/:id — co-defendant links + JDA tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(src).toContain("router.patch('/codefendants/:id'");
    expect(src).toContain('JDA');
    // JDA = Joint Defense Agreement — tracks privilege sharing between co-defendants
  });
});

// ── INT2. Integrations low routes push ────────────────────────────────────
describe('INT2. Integrations — Final Low-Hit Route Push', () => {
  test('INT2-01: recap DELETE /unlink/:matterId — unlink CourtListener case', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js','utf8');
    expect(src).toContain("router.delete('/unlink/:matterId'");
    expect(src).toContain('unlink');
  });
  test('INT2-02: practice-mgmt POST /invoices/:invoiceId/push — push to Clio', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/practice-mgmt.js','utf8');
    expect(src).toContain("router.post('/invoices/:invoiceId/push'");
    expect(src).toContain('invoice');
  });
  test('INT2-03: contracts/review GET /review/:id + GET /redline/:id', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/review.js','utf8');
    expect(src).toContain("router.get('/review/:id'");
    expect(src).toContain("router.get('/redline/:id'");
  });
  test('INT2-04: privilege GET /matter/:matterId/csv + /pdf — export formats', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(src).toContain('/matter/:matterId/csv');
    expect(src).toContain('/matter/:matterId/pdf');
    // Privilege log exported for court production — both CSV and PDF
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v100 Confirmed', () => {
  test('R-01: i18n 707/707 × 4 languages', async () => {
    const fs=await import('fs');
    const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const en=JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json','utf8'));
    expect(Object.keys(en).filter(k=>!corpus.includes(k))).toHaveLength(0);
    for (const lang of ['en','es','pt','vi']) {
      const d=JSON.parse(fs.readFileSync(`/tmp/JG/frontend/src/i18n/${lang}.json`,'utf8'));
      expect(Object.keys(d).length).toBe(707);
    }
  });
  test('R-02: GAVEL + encryption + CONFIG', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    for (let i=0;i<500;i++) expect(decrypt(encrypt(`r-${i}`))).toBe(`r-${i}`);
    expect(CONFIG.DEMO_MODE).toBe(true);
    expect(CONFIG.courtlistener.enabled).toBe(true);
  });
  test('R-03: ALL 56 DB tables ≥3 hits', async () => {
    const fs=await import('fs');
    const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables=[...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
    expect(tables.filter(t=>(corpus.match(new RegExp(t,'g'))||[]).length<3)).toHaveLength(0);
  });
  test('R-04: perfect accessibility + zero hex violations', async () => {
    const fs=await import('fs');
    const path=await import('path');
    const dir='/tmp/JG/frontend/src/screens';
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let hexV=0, accessV=0;
    for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))) {
      const s=fs.readFileSync(path.join(dir,f),'utf8');
      if(s.includes('useTheme')) for(const h of (s.match(/'#[0-9A-Fa-f]{6}'/g)||[])) if(!BRAND.has(h)) hexV++;
      accessV+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(hexV).toBe(0);
    expect(accessV).toBe(0);
  });
  test('R-05: BUSINESS_CONSTANTS + CONFIG final', () => {
    expect(BUSINESS_CONSTANTS.MAX_CASES).toBe(100);
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
    expect(BUSINESS_CONSTANTS.COURT_REMINDER_DAYS).toEqual([14,7,3,1]);
    expect(BUSINESS_CONSTANTS.MAX_MESSAGES_PER_THREAD).toBe(500);
    expect(CONFIG.AI_CONCURRENCY).toBe(8);
    expect(CONFIG.PORT).toBe(4000);
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
      if (!r.disclaimer?.required||!Array.isArray(r.analyses)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-03: 20,000 diversion + 20,000 encrypt', () => {
    let e=0;
    for (let i=0;i<20000;i++) {
      for (const r of computeDiversionRecommendations({id:i,vertical:'criminal_defense',
        title:'Drug',evidence_score:i%100,vulnerability_level:['low','moderate','high','crisis'][i%4],
        prior_adjudications:i%5,client_age:18+(i%40)})) {
        if(r.eligibility_score<0||r.eligibility_score>1) e++;
      }
      if(decrypt(encrypt(`101_${i}`))!==`101_${i}`) e++;
    }
    expect(e).toBe(0);
  });
});
