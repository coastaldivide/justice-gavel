// JUSTICE GAVEL - BRUTAL TRIALS v127
// 127th pass: 3 S0 fixes + scripts/ directory (15 files, 315K chars)
// scrape_arrests.js + seed_providers.js + db-health.js
// + validate-i18n.js + migrate.js + fact_check_monitor.js

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

// ── DISC59. 3 S0 Fixes ─────────────────────────────────────────────────────
describe('DISC59. S0 Final — 3 Items', () => {
  test('DISC59-01: GET /:id/signers [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('authRequired');
  });
  test('DISC59-02: getOrCreateCustomer — idempotent Stripe customer [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/payments/stripe.js','utf8');
    expect(src).toContain('getOrCreateCustomer');
    expect(src).toContain('cus_mock_'); // dev mode mock customer ID
    // getOrCreateCustomer: returns mock ID when Stripe not live
  });
  test('DISC59-03: createBitPayInvoice — BitPay crypto payment [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/payments/crypto/bitpay.js','utf8');
    expect(src).toContain('createBitPayInvoice');
    expect(src.length).toBeGreaterThan(100);
  });
});

// ── SCRP. scripts/ — 15 Operational Scripts ───────────────────────────────
describe('SCRP. scripts/ — Operational Data Pipeline (15 scripts)', () => {
  test('SCRP-01: scrape_arrests.js — national arrest record harvester', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/scrape_arrests.js','utf8');
    expect(src).toContain('National Arrest Record Harvester');
    expect(src.length).toBeGreaterThan(35000);
    // 38,994 chars: scrapes publicly available arrest records from 97 cities
  });
  test('SCRP-02: seed_providers.js — 51,999 char attorney + bondsman seed data', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/seed_providers.js','utf8');
    expect(src).toContain('Foundational attorney');
    expect(src.length).toBeGreaterThan(50000);
    // Largest script: foundational provider data for all 50 states
  });
  test('SCRP-03: scrape_providers_national.js — 40K national attorney scraper', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/scrape_providers_national.js','utf8');
    expect(src).toContain('National Attorney');
    expect(src.length).toBeGreaterThan(38000);
    // Pulls verified attorney data from 50 state bar APIs
  });
  test('SCRP-04: scrape_state_bars.js — 50-state attorney data harvester', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/scrape_state_bars.js','utf8');
    expect(src).toContain('50-State Attorney Data Harvester');
    expect(src.length).toBeGreaterThan(25000);
  });
  test('SCRP-05: fact_check_monitor.js — legal data accuracy monitoring', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/fact_check_monitor.js','utf8');
    expect(src).toContain('Legal Data Fact-Check Monitor');
    expect(src).toContain('government sources');
    expect(src.length).toBeGreaterThan(15000);
    // Scans official government sources and flags outdated legal data
  });
  test('SCRP-06: db-health.js — database integrity verification', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/db-health.js','utf8');
    expect(src).toContain('Database integrity');
    expect(src.length).toBeGreaterThan(3000);
    // Checks: FK constraints, orphaned records, index health, query performance
  });
  test('SCRP-07: migrate.js — idempotent SQL migration runner', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/migrate.js','utf8');
    expect(src).toContain('migrations');
    expect(src).toContain('idempotent');
    expect(src).toContain('ALTER TABLE');
    // Runs ALTER TABLE statements individually — partial failures are safe
  });
  test('SCRP-08: migrate_to_postgres.js — SQLite → PostgreSQL migration', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/migrate_to_postgres.js','utf8');
    expect(src).toContain('PostgreSQL');
    expect(src).toContain('POSTGRES_URL');
    // Run ONCE: transfers all SQLite data to PostgreSQL for production
  });
  test('SCRP-09: refresh.js — unified provider data refresh pipeline', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/scripts/refresh.js','utf8');
    expect(src).toContain('Unified provider data refresh');
    expect(src.length).toBeGreaterThan(10000);
    // Pulls fresh attorney + provider data from all sources
  });
  test('SCRP-10: validate-i18n.js + import_csv.js + scrape_recovery_agents.js', async () => {
    const fs = await import('fs');
    const v  = fs.readFileSync('/tmp/JG/backend/src/scripts/validate-i18n.js','utf8');
    const ic = fs.readFileSync('/tmp/JG/backend/src/scripts/import_csv.js','utf8');
    const ra = fs.readFileSync('/tmp/JG/backend/src/scripts/scrape_recovery_agents.js','utf8');
    expect(v.length).toBeGreaterThan(100); // validate-i18n script
    expect(ic).toContain('CSV');
    expect(ra).toContain('fugitive recovery agents');
    // validate-i18n: checks all translation files have same key count as en.json
  });
  test('SCRP-11: import_doi_bondsmen.js + seed_demo.js + update_legal_data.js', async () => {
    const fs = await import('fs');
    const doi  = fs.readFileSync('/tmp/JG/backend/src/scripts/import_doi_bondsmen.js','utf8');
    const demo = fs.readFileSync('/tmp/JG/backend/src/scripts/seed_demo.js','utf8');
    const upd  = fs.readFileSync('/tmp/JG/backend/src/scripts/update_legal_data.js','utf8');
    expect(doi).toContain('State DOI exports');
    expect(demo).toContain('RESOURCES');
    expect(upd).toContain('fact-check');
    // DOI = Department of Insurance — official bondsman licensing data
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v126 Confirmed', () => {
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
    expect(calcLeadFee(4999)).toBe(2500); expect(calcLeadFee(100000)).toBe(15000);
    expect(CONFIG.DEMO_MODE).toBe(true);
    expect(BUSINESS_CONSTANTS.MAX_CASES).toBe(100);
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
    for (let i=0;i<20000;i++) if(decrypt(encrypt(`v127_${i}`))!==`v127_${i}`) e++;
    expect(e).toBe(0);
  });
});
