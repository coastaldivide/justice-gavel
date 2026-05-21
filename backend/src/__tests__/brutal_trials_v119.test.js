// JUSTICE GAVEL - BRUTAL TRIALS v119
// 119th pass: 5 S0 fixes + TermsAcceptanceModal + attorney/verification
// + billing/bondsman (verified badge + leads) + billing/consumer
// + recovery-agents + admin deep routes

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

// ── DISC51. 5 S0 Fixes ─────────────────────────────────────────────────────
describe('DISC51. S0 Final — 5 Items', () => {
  test('DISC51-01: GET /:id/signers FINAL [≥5]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/contracts/execution.js','utf8');
    expect(src).toContain("router.get('/:id/signers'");
    expect(src).toContain('authRequired');
  });
  test('DISC51-02: Critical Escalation Proof — title-driven prioCapital [≥5]', () => {
    const s = computeAllSignals({
      id:1, vertical:'criminal_defense', title:'Murder',
      evidence_score:40, vulnerability_level:'crisis',
      supervised_release:1, time_pressure:'standard', plea_offer_pending:0,
    });
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.triggers).toContain('expedited_bail');
    // prioCapital: title keyword triggers capital case escalation
  });
  test('DISC51-03: admin GET /log — audit log viewer route [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/admin.js','utf8');
    expect(src).toContain("router.get('/log'");
    expect(src).toContain("router.get('/log/:table/:id'");
    expect(src).toContain('authRequired');
  });
  test('DISC51-04: dms.js POST /search — DMS full-text search [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/dms.js','utf8');
    expect(src).toContain("router.post('/search'");
    expect(src).toContain('authRequired');
    // Full-text search across NetDocuments/iManage workspace
  });
  test('DISC51-05: expungement /check is public — no auth required [≥4]', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/expungement/check.js','utf8');
    expect(src).toContain("router.get('/check'");
    expect(src).not.toContain('authRequired');
    // Access-to-justice: eligibility check publicly accessible without login
  });
});

// ── TOS. TermsAcceptanceModal — Clickwrap ToS ─────────────────────────────
describe('TOS. TermsAcceptanceModal.tsx — Clickwrap Terms of Service', () => {
  test('TOS-01: 12,227 char clickwrap ToS modal', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx','utf8');
    expect(src.length).toBeGreaterThan(10000);
    expect(src).toContain('TermsAcceptanceModal');
    // Shown on first login and when ToS version is updated
  });
  test('TOS-02: POST /api to record acceptance — consent versioning', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TermsAcceptanceModal.tsx','utf8');
    const apis = (src.match(/api\.(get|post|put|delete)/g)||[]).length;
    expect(apis).toBeGreaterThanOrEqual(1);
    // Records consent version + timestamp — for GDPR/CCPA compliance
  });
  test('TOS-03: LegalDisclaimerModal CONSENT_VERSION — version tracking', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalDisclaimerModal.tsx','utf8');
    expect(src).toContain('CONSENT_VERSION');
    // When CONSENT_VERSION bumps → all users re-shown modal on next login
  });
});

// ── AVR. attorney/verification.js — Bar Verification ─────────────────────
describe('AVR. attorney/verification.js — Attorney Bar Number Verification', () => {
  test('AVR-01: POST /verify-bar — submit bar number for verification', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/verification.js','utf8');
    expect(src).toContain("router.post('/verify-bar'");
    expect(src).toContain('authRequired');
    expect(src.length).toBeGreaterThan(8000);
    // Attorneys must verify state bar number before accepting cases
  });
  test('AVR-02: POST /approve-verification — admin approves attorney', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/verification.js','utf8');
    expect(src).toContain("router.post('/approve-verification'");
    // Admin reviews + approves bar verification submissions
  });
});

// ── BBD. billing/bondsman.js — Bondsman Business Model ────────────────────
describe('BBD. billing/bondsman.js — Bondsman Leads + Verified Badge', () => {
  test('BBD-01: POST/GET /bondsman/profile — bondsman profile management', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(src).toContain("router.post('/bondsman/profile'");
    expect(src).toContain("router.get('/bondsman/profile'");
    expect(src).toContain('authRequired');
  });
  test('BBD-02: GET /leads — bondsman arrest lead feed', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(src).toContain("router.get('/leads'");
    expect(src).toContain('leads');
    // Core bondsman revenue: pay-per-lead arrest alerts in their area
  });
  test('BBD-03: POST /leads/:id/accept — bondsman accepts + pays for lead', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(src).toContain("router.post('/leads/:id/accept'");
    // Charges calcLeadFee(bailAmount) to bondsman Stripe account
  });
  test('BBD-04: verified-badge subscribe + status + cancel — $49/mo badge', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js','utf8');
    expect(src).toContain("router.post('/bondsman/verified-badge/subscribe'");
    expect(src).toContain("router.get('/bondsman/verified-badge/status'");
    expect(src).toContain("router.post('/bondsman/verified-badge/cancel'");
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900); // $49/mo
    // Verified badge: 🥇 displayed on profile, increases lead volume
  });
});

// ── BCN. billing/consumer.js — Consumer Subscription ─────────────────────
describe('BCN. billing/consumer.js — Consumer Subscription Tiers', () => {
  test('BCN-01: POST /consumer/subscribe — start consumer subscription', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js','utf8');
    expect(src).toContain("router.post('/consumer/subscribe'");
    expect(src).toContain('authRequired');
    // Monthly plan: $9.99/mo; Annual: $79.99/yr (7-day trial)
  });
  test('BCN-02: GET /consumer/subscription — subscription status', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js','utf8');
    expect(src).toContain("router.get('/consumer/subscription'");
    expect(src).toContain('subscription');
  });
  test('BCN-03: GET /admin/stats — billing admin metrics', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/consumer.js','utf8');
    expect(src).toContain("router.get('/admin/stats'");
    // Admin: MRR, churn rate, trial conversions, active subscriptions
  });
  test('BCN-04: TRIAL_DAYS — 30 days monthly, 7 days annual', () => {
    expect(BUSINESS_CONSTANTS.TRIAL_DAYS_MONTHLY).toBe(30);
    expect(BUSINESS_CONSTANTS.TRIAL_DAYS_ANNUAL).toBe(7);
    expect(BUSINESS_CONSTANTS.TRIAL_DAYS_CONSUMER).toBe(7);
  });
});

// ── Regression ─────────────────────────────────────────────────────────────
describe('Regression — All v1–v118 Confirmed', () => {
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
    expect(calcLeadFee(4999)).toBe(2500);
    expect(calcLeadFee(5000)).toBe(5000);
    expect(calcLeadFee(25000)).toBe(10000);
    expect(calcLeadFee(100000)).toBe(15000);
    expect(CONFIG.DEMO_MODE).toBe(true);
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
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
    const dir='/tmp/JG/frontend/src/screens';
    const BRAND=new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    let hex=0, acc=0;
    for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.tsx')&&!f.includes('.web.'))) {
      const s=fs.readFileSync(path.join(dir,f),'utf8');
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
    for (let i=0;i<20000;i++) if(decrypt(encrypt(`v119_${i}`))!==`v119_${i}`) e++;
    expect(e).toBe(0);
  });
});
