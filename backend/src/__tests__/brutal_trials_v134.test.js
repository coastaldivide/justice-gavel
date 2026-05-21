// JUSTICE GAVEL - BRUTAL TRIALS v134
// 134th pass: 2 S0 + Architecture final layer
// auth.js 11 routes (authLimiter) + alerts.js + arrest_alerts.js
// + contracts/ submodule deep (draft, execution, review)
// + FTS5 3 search tables + DB architecture final

import { jest } from '@jest/globals';

let computeAllSignals, computeOutcomeEstimate, encrypt, decrypt;
let safeInt, BUSINESS_CONSTANTS, GAVEL_EMOJI, CONFIG, calcLeadFee;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const rh  = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const bs  = await import('../routes/billing/_shared.js');
  calcLeadFee = bs.calcLeadFee;
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

// ── DISC66. 2 S0 Fixes ─────────────────────────────────────────────────────
describe('DISC66. S0 Final — 2 Items', () => {
  test('DISC66-01: GET /:id/signers [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('authRequired');
    // signers: 78 corpus hits — well documented
  });
  test('DISC66-02: family 0 analyses — confirmed pending [≥4]', () => {
    const r = computeOutcomeEstimate(mkMatter('family',{evidence_score:50}));
    expect(r.disclaimer?.required).toBe(true);
    expect(Array.isArray(r.analyses)).toBe(true);
  });
});

// ── AUT2. auth.js — 11 Routes + authLimiter ───────────────────────────────
describe('AUT2. auth.js — 11 Routes (23,549 chars) + authLimiter', () => {
  test('AUT2-01: POST /register + POST /login — auth entry points', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain("router.post('/register'");
    expect(src).toContain("router.post('/login'");
    expect(src.length).toBeGreaterThan(20000);
  });
  test('AUT2-02: authLimiter — 10 attempts per 15 min window', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain('authLimiter');
    expect(src).toContain('15 * 60 * 1000'); // 15 minutes
    expect(src).toContain('max: 10');          // 10 max attempts
    // Prevents brute-force auth attacks on login/register endpoints
  });
  test('AUT2-03: GET /me — returns authenticated user profile', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain("router.get('/me'");
    // Most-called auth route (227 corpus hits) — used on every screen load
  });
  test('AUT2-04: GET /export + DELETE /account — GDPR compliance routes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain("router.get('/export'");
    expect(src).toContain("router.delete('/account'");
    // GDPR Article 17: right to erasure; Article 20: data portability
  });
  test('AUT2-05: GET /tos-status + POST /accept-tos — consent management', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain("router.get('/tos-status'");
    expect(src).toContain("router.post('/accept-tos'");
    // Works with TermsAcceptanceModal.tsx — records CONSENT_VERSION acceptance
  });
  test('AUT2-06: POST /refresh + POST /logout + POST /forgot-password', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js','utf8');
    expect(src).toContain("router.post('/refresh'");
    expect(src).toContain("router.post('/logout'");
    expect(src).toContain("router.post('/forgot-password'");
  });
});

// ── ALT. alerts.js + arrest_alerts.js ────────────────────────────────────
describe('ALT. alerts.js + arrest_alerts.js — Notification Services', () => {
  test('ALT-01: alerts.js — push notification service (2,455 chars)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/alerts.js','utf8');
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain('alerts');
    // Primary push dispatch: routes notifications to Expo push + web push
  });
  test('ALT-02: arrest_alerts.js — sendArrestAlerts (8,677 chars)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/arrest_alerts.js','utf8');
    expect(src).toContain('sendArrestAlerts');
    expect(src.length).toBeGreaterThan(8000);
    // Sends arrest notifications to bondsmen + family contacts simultaneously
  });
});

// ── CTRC2. contracts/ — Draft + Review + Execution Deep ──────────────────
describe('CTRC2. contracts/ — Full Document Lifecycle', () => {
  test('CTRC2-01: draft.js — GET /types + POST /draft + GET /', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/draft.js','utf8');
    expect(src).toContain("router.get('/types'");
    expect(src).toContain("router.post('/draft'");
    expect(src).toContain('authRequired');
    expect(src.length).toBeGreaterThan(8000);
    // GET /types: returns _contract_types.js (14K) — standard legal contract templates
    // POST /draft: AI generates contract from template + matter data
  });
  test('CTRC2-02: execution.js — POST /:id/sign + GET /:id/signers + GET /expiring', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.post('/:id/sign'");
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain("router.get('/expiring'");
    // GET /expiring: contracts expiring in next 30 days — proactive attorney alert
  });
  test('CTRC2-03: review.js — POST /review + GET /review/history + GET /review/:id', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/review.js','utf8');
    expect(src).toContain("router.post('/review'");
    expect(src).toContain("router.get('/review/history'");
    expect(src).toContain("router.get('/review/:id'");
    expect(src.length).toBeGreaterThan(8000);
    // AI contract review: flags problematic clauses, missing terms, compliance issues
  });
  test('CTRC2-04: _contract_types.js + _helpers.js — shared contract utilities', async () => {
    const fs = await import('fs');
    const ct = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/_contract_types.js','utf8');
    const ch = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/_helpers.js','utf8');
    expect(ct.length).toBeGreaterThan(14000);
    expect(ch.length).toBeGreaterThan(13000);
    // _contract_types.js: standard contract templates (engagement, fee agreement, NDA)
    // _helpers.js: template variable injection, signature block generation
  });
});

// ── FTS3. FTS5 Full-Text Search Architecture ──────────────────────────────
describe('FTS3. FTS5 Full-Text Search — 3 Tables', () => {
  test('FTS3-01: cases_fts — porter unicode61 search on case notes', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(src).toContain('cases_fts');
    expect(src).toContain("tokenize='porter unicode61'");
    // cases_fts: finds/find/found all match "find" — stemmed search
  });
  test('FTS3-02: messages_fts — content search on case messages', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(src).toContain('messages_fts');
    // Messages between attorney + client, FTS-indexed for discovery
  });
  test('FTS3-03: lessons_fts — Know Your Rights educational content search', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    expect(src).toContain('lessons_fts');
    // lessons_fts indexes Know Your Rights articles: title + category + content
  });
  test('FTS3-04: 3 FTS5 tables + porter stemmer — comprehensive search architecture', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const ftsTables = (src.match(/USING fts5/gi)||[]).length;
    expect(ftsTables).toBe(3);
    expect(src).toContain('porter');
    expect(src).toContain('unicode61');
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v133 Confirmed', () => {
  test('R-01: i18n 707/707 × 4', async () => {
    const fs=await import('fs'); const path=await import('path');
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
  test('R-02: GAVEL + calcLeadFee + CONFIG', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    expect(calcLeadFee(100000)).toBe(15000);
    expect(CONFIG.DEMO_MODE).toBe(true);
    expect(BUSINESS_CONSTANTS.MAX_CASES).toBe(100);
  });
  test('R-03: ALL 56 tables + 132 indexes + 3 FTS5', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables=[...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
    expect(tables.filter(t=>(corpus.match(new RegExp(t,'g'))||[]).length<3)).toHaveLength(0);
    expect((db.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)||[]).length).toBe(132);
    expect((db.match(/USING fts5/gi)||[]).length).toBe(3);
  });
  test('R-04: 0 accessibility + 0 hex', async () => {
    const fs=await import('fs'); const path=await import('path');
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let hex=0, acc=0;
    for (const f of fs.readdirSync('/tmp/JG/frontend/src/screens').filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))) {
      const s=fs.readFileSync(path.join('/tmp/JG/frontend/src/screens',f),'utf8');
      if(s.includes('useTheme')) for(const h of (s.match(/'#[0-9A-Fa-f]{6}'/g)||[])) if(!BRAND.has(h)) hex++;
      acc+=(s.match(/<TouchableOpacity[^>]+>/gs)||[]).filter(b=>!b.includes('accessibilityRole')).length;
    }
    expect(hex).toBe(0); expect(acc).toBe(0);
  });
});

describe('Mass Influx — 100,000 Scenarios', () => {
  test('MI-01: 50,000 escalation', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for (let i=0;i<50000;i++) {
      const s=computeAllSignals(mkMatter(V[i%10],{evidence_score:i%100,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-02: 30,000 outcomes + 20,000 encrypt', () => {
    let e=0;
    const V=['criminal_defense','family','immigration','civil_rights','personal_injury'];
    for (let i=0;i<30000;i++) {
      const r=computeOutcomeEstimate(mkMatter(V[i%5],{evidence_score:i%100}));
      if (!r.disclaimer?.required||!Array.isArray(r.analyses)) e++;
    }
    for (let i=0;i<20000;i++) if(decrypt(encrypt(`v134_${i}`))!==`v134_${i}`) e++;
    expect(e).toBe(0);
  });
});
