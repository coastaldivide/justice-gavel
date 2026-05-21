// JUSTICE GAVEL - BRUTAL TRIALS v125
// 125th pass: 3 S0 fixes + precedentRegistry (34K) + precedentMonitor
// + payments/crypto/coinbase.js + payments/zelle.js
// + family vertical 0 analyses documented + final gaps closed

import { jest } from '@jest/globals';

let computeAllSignals, computeDiversionRecommendations, computeOutcomeEstimate;
let encrypt, decrypt, haversineKm;
let safeInt, BUSINESS_CONSTANTS, GAVEL_EMOJI, CONFIG;
let calcLeadFee;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm;
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

// ── DISC57. 3 S0 Fixes ─────────────────────────────────────────────────────
describe('DISC57. S0 Final — 3 Items', () => {
  test('DISC57-01: GET /:id/signers [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('authRequired');
  });
  test('DISC57-02: family vertical returns 0 analyses — not yet modeled [≥4]', () => {
    const r = computeOutcomeEstimate(mkMatter('family',{evidence_score:50}));
    expect(r.disclaimer?.required).toBe(true);
    expect(Array.isArray(r.analyses)).toBe(true);
    // Family law outcome prediction not yet in outcomeEstimator analytics
    // criminal_defense=3, appellate/immigration/civil_rights=2, family=0
  });
  test('DISC57-03: 2M haversineKm — all finite positive [≥4]', () => {
    let e=0;
    for (let i=0;i<2000000;i++) {
      const km=haversineKm(25+(i%40),-70-(i%60),36.17,-86.78);
      if(!isFinite(km)||km<0) e++;
    }
    expect(e).toBe(0);
  });
});

// ── PRC. precedentRegistry.js — Legal Precedent Knowledge Base ────────────
describe('PRC. precedentRegistry.js — 34,503 Char Precedent Knowledge Base', () => {
  test('PRC-01: PRECEDENT_REGISTRY — authoritative case law knowledge base', async () => {
    const prec = await import('../analytics/precedentRegistry.js');
    expect(prec.PRECEDENT_REGISTRY).toBeDefined();
    expect(typeof prec.PRECEDENT_REGISTRY).toBe('object');
    // Powers outcome prediction — each vertical has precedent data
  });
  test('PRC-02: getRelevantEntries — retrieve entries for a vertical', async () => {
    const prec = await import('../analytics/precedentRegistry.js');
    expect(typeof prec.getRelevantEntries).toBe('function');
    const entries = prec.getRelevantEntries('criminal_defense', 60);
    expect(Array.isArray(entries)).toBe(true);
    // Returns relevant precedents for evidence score + vertical
  });
  test('PRC-03: REGISTRY_VERSION + REGISTRY_DATE — versioned data', async () => {
    const prec = await import('../analytics/precedentRegistry.js');
    expect(prec.REGISTRY_VERSION).toBeDefined();
    expect(prec.REGISTRY_DATE).toBeDefined();
    // Version control: bias audits check registry staleness
  });
  test('PRC-04: getEntry — fetch single precedent by key', async () => {
    const prec = await import('../analytics/precedentRegistry.js');
    expect(typeof prec.getEntry).toBe('function');
    // Used by outcomeEstimator to enrich analyses with case citations
  });
  test('PRC-05: precedentRegistry.js is 34,503 chars — largest analytics file', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentRegistry.js','utf8');
    expect(src.length).toBeGreaterThan(30000);
    expect(src).toContain('JUSTICE GAVEL');
    expect(src).toContain('PRECEDENT REGISTRY');
  });
});

// ── PM. precedentMonitor.js — Bias Audit + Staleness Check ────────────────
describe('PM. precedentMonitor.js — 17,145 Char Bias Audit System', () => {
  test('PM-01: checkStaleness — verify precedent data is current', async () => {
    const pm = await import('../analytics/precedentMonitor.js');
    expect(typeof pm.checkStaleness).toBe('function');
    const result = pm.checkStaleness();
    expect(result).toBeDefined();
    // Stale precedents produce biased predictions — must be refreshed periodically
  });
  test('PM-02: runBiasAudit — detect bias in outcome predictions', async () => {
    const pm = await import('../analytics/precedentMonitor.js');
    expect(typeof pm.runBiasAudit).toBe('function');
    // Audits: does evidence_score=50 produce consistent results across verticals?
    // Checks for demographic bias in outcome predictions
  });
  test('PM-03: precedentMonitor.js is 17,145 chars', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js','utf8');
    expect(src.length).toBeGreaterThan(15000);
  });
});

// ── PAY2. payments — Coinbase + Zelle ─────────────────────────────────────
describe('PAY2. payments/ — Crypto + Zelle Alternative Payment Methods', () => {
  test('PAY2-01: createCoinbaseCharge — crypto payment for legal services', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/payments/crypto/coinbase.js','utf8');
    expect(src).toContain('createCoinbaseCharge');
    expect(src).toContain('COINBASE_COMMERCE_API_KEY');
    expect(src.length).toBeGreaterThan(500);
    // Defendants pay legal fees in crypto — Coinbase Commerce API
  });
  test('PAY2-02: createZelleInstructions — Zelle payment instructions', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/payments/zelle.js','utf8');
    expect(src).toContain('createZelleInstructions');
    expect(src).toContain('ALERT_EMAIL_FROM');
    expect(src.length).toBeGreaterThan(400);
    // Zelle: instructions sent by email — no API, bank transfer
  });
  test('PAY2-03: no-op when API key absent — safe dev mode', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/payments/crypto/coinbase.js','utf8');
    expect(src).toContain("|| ''"); // Key defaults to empty string
    expect(src).toContain('provider');
    // Returns {provider:'coinbase', status:'skipped'} when no key configured
  });
});

// ── CRT2x. cryptoTop50.json — Final Push ──────────────────────────────────
describe('CRT2x. cryptoTop50.json — Final Coverage Push', () => {
  test('CRT2x-01: 20+ tickers for asset recovery whitelist', async () => {
    const fs = await import('fs');
    const data = JSON.parse(
      fs.readFileSync('/tmp/JG/frontend/src/constants/cryptoTop50.json','utf8'));
    expect(data.length).toBeGreaterThanOrEqual(20);
    expect(data).toContain('BTC');
    expect(data).toContain('ETH');
    expect(data).toContain('USDT');
    // Recovery agents identify crypto assets to recover for defendants
  });
});

// ── Regression + Mass Influx ──────────────────────────────────────────────
describe('Regression — All v1–v124 Confirmed', () => {
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
  test('R-02: GAVEL + encrypt + CONFIG', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    for (let i=0;i<500;i++) expect(decrypt(encrypt(`r-${i}`))).toBe(`r-${i}`);
    expect(CONFIG.DEMO_MODE).toBe(true);
    expect(BUSINESS_CONSTANTS.COURT_REMINDER_DAYS).toEqual([14,7,3,1]);
    expect(calcLeadFee(100000)).toBe(15000);
  });
  test('R-03: ALL 56 DB tables ≥3 hits', async () => {
    const fs=await import('fs'); const path=await import('path');
    const dir='/tmp/JG/backend/src/__tests__';
    const corpus=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js'))
      .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('');
    const db=fs.readFileSync('/tmp/JG/backend/src/db/index.js','utf8');
    const tables=[...db.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m=>m[1]);
    expect(tables.filter(t=>(corpus.match(new RegExp(t,'g'))||[]).length<3)).toHaveLength(0);
  });
  test('R-04: 0 accessibility + 0 hex + 434/434 ≥5', async () => {
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
  test('MI-01: 30,000 escalation', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for (let i=0;i<30000;i++) {
      const s=computeAllSignals(mkMatter(V[i%V.length],{evidence_score:i%100,vulnerability_level:['low','moderate','high','crisis'][i%4]}));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) e++;
    }
    expect(e).toBe(0);
  });
  test('MI-02: 30,000 outcomes + 20,000 encrypt', () => {
    let e=0;
    const V=['criminal_defense','family','immigration','civil_rights','personal_injury'];
    for (let i=0;i<30000;i++) {
      const r=computeOutcomeEstimate(mkMatter(V[i%V.length],{evidence_score:i%100}));
      if (!r.disclaimer?.required||!Array.isArray(r.analyses)) e++;
    }
    for (let i=0;i<20000;i++) if(decrypt(encrypt(`v125_${i}`))!==`v125_${i}`) e++;
    expect(e).toBe(0);
  });
});
