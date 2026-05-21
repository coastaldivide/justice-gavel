// JUSTICE GAVEL — BRUTAL TRIALS v145
// TARGET: conflicts.js(7) + firm_acquisition(5) + privilege(5)
//         + recap(5) + matter_intelligence(4) + analytics(4)

import { jest } from '@jest/globals';
let computeAllSignals, computeOutcomeEstimate, encrypt, decrypt, BUSINESS_CONSTANTS;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const rh = await import('../utils/routeHelpers.js');
  BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
});

const mkM = (v,o={}) => ({id:1,vertical:v,title:'T',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',
  supervised_release:0,plea_offer_pending:0,...o});

// ── conflicts.js — 7 routes ────────────────────────────────────────────────
describe('CON_A. conflicts.js — 7 Routes PUSH ≥10', () => {
  test('CON_A-01: GET /ethics-wall/log/:firmId — full wall audit log', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(s).toContain("router.get('/ethics-wall/log/:firmId'");
    // Audit trail of all ethics wall creations/removals per firm
  });
  test('CON_A-02: GET/POST /ethics-wall/:matterId + DELETE', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(s).toContain("router.get('/ethics-wall/:matterId'");
    expect(s).toContain("router.post('/ethics-wall/:matterId'");
    expect(s).toContain("router.delete('/ethics-wall/:matterId/:userId'");
  });
  test('CON_A-03: GET /report/:firmId + GET /waivers/:firmId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(s).toContain("router.get('/report/:firmId'");
    expect(s).toContain("router.get('/waivers/:firmId'");
    // report: firm-wide conflict compliance report; waivers: signed consent docs
  });
  test('CON_A-04: GET /soc2/:firmId — SOC 2 conflict controls', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(s).toContain("router.get('/soc2/:firmId'");
    // SOC 2 Type II: conflict detection control evidence
  });
});

// ── firm_acquisition.js — 5 routes ────────────────────────────────────────
describe('ACQ_A. firm_acquisition.js — 5 Routes PUSH ≥10', () => {
  test('ACQ_A-01: GET /vertical-demo + POST /trial + POST /upgrade', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/firm_acquisition.js','utf8');
    expect(s).toContain("router.get('/vertical-demo'");
    expect(s).toContain("router.post('/trial'");
    expect(s).toContain("router.post('/upgrade'");
    // vertical-demo: preview vertical features before purchase
    // trial: start 14-day trial; upgrade: convert trial to paid
  });
  test('ACQ_A-02: GET /checklist + POST /checklist/:key — onboarding', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/firm_acquisition.js','utf8');
    expect(s).toContain("router.get('/checklist'");
    expect(s).toContain("router.post('/checklist/:key'");
    // Onboarding checklist: complete items to unlock full platform
  });
});

// ── privilege.js — 5 routes ────────────────────────────────────────────────
describe('PRV_A. privilege.js — 5 Routes PUSH ≥10', () => {
  test('PRV_A-01: GET /matter/:matterId/csv — export privilege log as CSV', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(s).toContain("router.get('/matter/:matterId/csv'");
    // CSV export for privilege log submission to opposing counsel
  });
  test('PRV_A-02: GET /matter/:matterId/pdf + GET /matter/:matterId/review-status', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(s).toContain("router.get('/matter/:matterId/pdf'");
    expect(s).toContain("router.get('/matter/:matterId/review-status'");
  });
  test('PRV_A-03: PUT /entries/:id/review + GET /bases', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(s).toContain("router.put('/entries/:id/review'");
    expect(s).toContain("router.get('/bases'");
    // /bases: returns privilege doctrine list (A-C, work product, common interest)
  });
});

// ── recap — 5 routes ──────────────────────────────────────────────────────
describe('RCP_A. integrations/recap.js — 5 Routes PUSH ≥10', () => {
  test('RCP_A-01: GET /status/:matterId + POST /refresh/:matterId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js','utf8');
    expect(s).toContain("router.get('/status/:matterId'");
    expect(s).toContain("router.post('/refresh/:matterId'");
    // status: RECAP sync state; refresh: pull latest PACER entries
  });
  test('RCP_A-02: DELETE /unlink/:matterId + POST /import/:matterId', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/recap.js','utf8');
    expect(s).toContain("router.delete('/unlink/:matterId'");
    expect(s).toContain("router.post('/import/:matterId'");
  });
});

// ── matter_intelligence HTTP — 4 routes ───────────────────────────────────
describe('MIA_A. matter_intelligence.js — 4 Routes PUSH ≥10', () => {
  test('MIA_A-01: GET /firm/dashboard — firm-wide intelligence', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js','utf8');
    expect(s).toContain("router.get('/firm/dashboard'");
  });
  test('MIA_A-02: GET /:matterId/signals + diversion + motions', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js','utf8');
    expect(s).toContain("router.get('/:matterId/signals'");
    expect(s).toContain("router.get('/:matterId/diversion'");
    expect(s).toContain("router.get('/:matterId/motions'");
  });
  test('MIA_A-03: signals runtime — 10 verticals × 4 evidence scores', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights',
             'white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for (const v of V)
      for (const s of [0,30,60,90]) {
        const r=computeAllSignals(mkM(v,{evidence_score:s}));
        if (!r.escalation?.level) e++;
      }
    expect(e).toBe(0);
  });
});

// ── analytics.js — 4 routes ───────────────────────────────────────────────
describe('ANA_A. analytics.js — 4 Routes PUSH ≥10', () => {
  test('ANA_A-01: GET /:matterId/estimate + /:matterId/precedents', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/analytics.js','utf8');
    expect(s).toContain("router.get('/:matterId/estimate'");
    expect(s).toContain("router.get('/:matterId/precedents'");
  });
  test('ANA_A-02: GET /monitor/status + POST /monitor/run', async () => {
    const fs = await import('fs');
    const s = fs.readFileSync('/tmp/JG/backend/src/routes/analytics.js','utf8');
    expect(s).toContain("router.get('/monitor/status'");
    expect(s).toContain("router.post('/monitor/run'");
    // monitor/run: triggers runBiasAudit() for precedent fairness check
  });
});

// Regression
describe('Regression', () => {
  test('R-01: 500K encrypt', () => {
    let e=0;
    for (let i=0;i<500000;i++) if(decrypt(encrypt(`v145_${i}`))!==`v145_${i}`) e++;
    expect(e).toBe(0);
  });
  test('R-02: 0 acc + 0 hex', async () => {
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
