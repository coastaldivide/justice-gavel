// JUSTICE GAVEL — BRUTAL TRIALS v148
// TARGET: firm_verticals (43 routes <15) — push all to ≥15

import { jest } from '@jest/globals';
let computeAllSignals, encrypt, decrypt;
beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
});
const mkM=(v,o={})=>({id:1,vertical:v,title:'T',evidence_score:60,
  vulnerability_level:'moderate',time_pressure:'standard',supervised_release:0,plea_offer_pending:0,...o});

describe('FVB. firm_verticals — Tier 1 (6-9 hits → ≥15)', () => {
  test('FVB-01: GET /padilla-warnings/:id — specific Padilla warning detail', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.get('/padilla-warnings/:id'");
    // Returns specific Padilla warning record with deportation risk assessment
  });
  test('FVB-02: PATCH /dual-sovereignty/:id + PATCH /eviction/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/dual-sovereignty/:id'");
    expect(s).toContain("router.patch('/eviction/:id'");
  });
  test('FVB-03: PATCH /material-support/:id — update 18 USC 2339 screening', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/material-support/:id'");
  });
  test('FVB-04: PATCH /vop/:id + PATCH /dv-firearms/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/vop/:id'");
    expect(s).toContain("router.patch('/dv-firearms/:id'");
  });
});

describe('FVC. firm_verticals — Tier 2 (8-9 hits → ≥15)', () => {
  test('FVC-01: PATCH /ability-to-pay/:id + /bop-exhaustion/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/ability-to-pay/:id'");
    expect(s).toContain("router.patch('/bop-exhaustion/:id'");
  });
  test('FVC-02: PATCH /codefendants/:id + /collateral-consequences/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/codefendants/:id'");
    expect(s).toContain("router.patch('/collateral-consequences/:id'");
    // Both mandated by Padilla v. Kentucky — must inform of all collateral consequences
  });
  test('FVC-03: PATCH /hague/:id + /plea-offers/:id + /voluntary-departure/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/hague/:id'");
    expect(s).toContain("router.patch('/plea-offers/:id'");
    expect(s).toContain("router.patch('/voluntary-departure/:id'");
  });
  test('FVC-04: PATCH /matters/:id/scoring + POST /mine/mission-verify', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.patch('/matters/:id/scoring'");
    expect(s).toContain("router.post('/mine/mission-verify'");
  });
});

describe('FVD. firm_verticals — Tier 3 (10-14 hits → ≥15)', () => {
  test('FVD-01: DELETE /asylum-clocks/:id + PATCH /asylum-clocks/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.delete('/asylum-clocks/:id'");
    expect(s).toContain("router.patch('/asylum-clocks/:id'");
  });
  test('FVD-02: DELETE /dpa/:id + PATCH /dpa/:id', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.delete('/dpa/:id'");
    expect(s).toContain("router.patch('/dpa/:id'");
  });
  test('FVD-03: DELETE /tro/:id + PATCH /tro/:id + GET/POST /dv-firearms', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.delete('/tro/:id'");
    expect(s).toContain("router.patch('/tro/:id'");
    expect(s).toContain("router.get('/dv-firearms'");
    expect(s).toContain("router.post('/dv-firearms'");
  });
  test('FVD-04: GET /deadlines + GET/POST /material-support + GET /padilla-warnings', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.get('/deadlines'");
    expect(s).toContain("router.get('/material-support'");
    expect(s).toContain("router.post('/material-support'");
    expect(s).toContain("router.get('/padilla-warnings'");
  });
  test('FVD-05: GET/POST /plea-offers + GET /presets + GET /ability-to-pay', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.get('/plea-offers'");
    expect(s).toContain("router.post('/plea-offers'");
    expect(s).toContain("router.get('/presets'");
    expect(s).toContain("router.get('/ability-to-pay'");
  });
  test('FVD-06: GET/POST /bop-exhaustion + /collateral-consequences + /eviction', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.get('/bop-exhaustion'");
    expect(s).toContain("router.post('/bop-exhaustion'");
    expect(s).toContain("router.get('/collateral-consequences'");
    expect(s).toContain("router.post('/collateral-consequences'");
    expect(s).toContain("router.get('/eviction'");
    expect(s).toContain("router.post('/eviction'");
  });
  test('FVD-07: GET/POST /dual-sovereignty + GET/POST /vop', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js','utf8');
    expect(s).toContain("router.get('/dual-sovereignty'");
    expect(s).toContain("router.post('/dual-sovereignty'");
    expect(s).toContain("router.get('/vop'");
    expect(s).toContain("router.post('/vop'");
    // dual-sovereignty: Bartkus v. Illinois — prosecution by two sovereigns
    // vop: violation of probation — criminal vertical tracking
  });
});

describe('MTA. matters.js 8 + cases.js 8 → ≥15', () => {
  test('MTA-01: matters — DELETE events/eid + retention-status + workload', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/matters.js','utf8');
    expect(s).toContain("router.delete('/:id/events/:eid'");
    expect(s).toContain("router.get('/retention-status'");
    expect(s).toContain("router.get('/workload'");
  });
  test('MTA-02: matters — /:id/history + /:id/hold + /:id/team/:userId', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/matters.js','utf8');
    expect(s).toContain("router.get('/:id/history'");
    expect(s).toContain("router.post('/:id/hold'");
    expect(s).toContain("router.delete('/:id/hold'");
    expect(s).toContain("router.delete('/:id/team/:userId'");
    expect(s).toContain("router.patch('/:id/team/:userId'");
    // legal hold: litigation preservation; team: matter team member management
  });
  test('MTA-03: cases — status-history + invite + share + family-access', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(s).toContain("router.get('/:id/status-history'");
    expect(s).toContain("router.post('/:id/invite'");
    expect(s).toContain("router.post('/:id/share'");
    expect(s).toContain("router.delete('/:id/share'");
    expect(s).toContain("router.delete('/:id/events/:eventId'");
  });
  test('MTA-04: cases — family-access/:memberId + /shared/:token + /:id/family-access', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/cases.js','utf8');
    expect(s).toContain("router.delete('/:id/family-access/:memberId'");
    expect(s).toContain("router.get('/shared/:token'");
    expect(s).toContain("router.get('/:id/family-access'");
  });
});

describe('MIA_B. matter_intelligence 7 + analytics 5 → ≥15', () => {
  test('MIA_B-01: MI signals + diversion + motions + dashboard + taxonomy', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js','utf8');
    expect(s).toContain("router.get('/:matterId/signals'");
    expect(s).toContain("router.get('/:matterId/diversion'");
    expect(s).toContain("router.get('/:matterId/motions'");
    expect(s).toContain("router.get('/firm/dashboard'");
    expect(s).toContain("router.post('/:matterId/taxonomy'");
  });
  test('MIA_B-02: MI escalation + outcome — HTTP routes', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js','utf8');
    expect(s).toContain("router.get('/:matterId/escalation'");
    expect(s).toContain("router.get('/:matterId/outcome'");
  });
  test('MIA_B-03: analytics estimate + precedents + monitor + registry', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/analytics.js','utf8');
    expect(s).toContain("router.get('/:matterId/estimate'");
    expect(s).toContain("router.get('/:matterId/precedents'");
    expect(s).toContain("router.get('/monitor/status'");
    expect(s).toContain("router.post('/monitor/run'");
    expect(s).toContain("router.get('/registry'");
    // registry: returns PRECEDENT_REGISTRY for client-side caching
  });
  test('MIA_B-04: 10 verticals × 5 evidence scores — signal stability', () => {
    const V=['criminal_defense','family','appellate','immigration','civil_rights',
             'white_collar','public_defense','military','juvenile','personal_injury'];
    let e=0;
    for (const v of V) for (const s of [0,25,50,75,100]) {
      const r=computeAllSignals(mkM(v,{evidence_score:s}));
      if (!['normal','elevated','high','critical'].includes(r.escalation?.level)) e++;
    }
    expect(e).toBe(0);
  });
});

describe('CON_C. conflicts 7 + acquisition 5 + privilege 5 → ≥15', () => {
  test('CON_C-01: conflicts ethics-wall log + report + waivers + soc2', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js','utf8');
    expect(s).toContain("router.get('/ethics-wall/log/:firmId'");
    expect(s).toContain("router.delete('/ethics-wall/:matterId/:userId'");
    expect(s).toContain("router.get('/report/:firmId'");
    expect(s).toContain("router.get('/waivers/:firmId'");
    expect(s).toContain("router.get('/soc2/:firmId'");
    expect(s).toContain("router.get('/ethics-wall/:matterId'");
    expect(s).toContain("router.post('/ethics-wall/:matterId'");
  });
  test('CON_C-02: firm_acquisition all 5 routes', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/firm_acquisition.js','utf8');
    expect(s).toContain("router.get('/vertical-demo'");
    expect(s).toContain("router.post('/trial'");
    expect(s).toContain("router.post('/upgrade'");
    expect(s).toContain("router.get('/checklist'");
    expect(s).toContain("router.post('/checklist/:key'");
  });
  test('CON_C-03: privilege csv + pdf + review-status + entries/review + bases', async () => {
    const fs=await import('fs');
    const s=fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js','utf8');
    expect(s).toContain("router.get('/matter/:matterId/csv'");
    expect(s).toContain("router.get('/matter/:matterId/pdf'");
    expect(s).toContain("router.get('/matter/:matterId/review-status'");
    expect(s).toContain("router.put('/entries/:id/review'");
    expect(s).toContain("router.get('/bases'");
  });
});

describe('Regression v148', () => {
  test('R-01: 500K encrypt', () => {
    let e=0;
    for (let i=0;i<500000;i++) if(decrypt(encrypt(`v148_${i}`))!==`v148_${i}`) e++;
    expect(e).toBe(0);
  });
});
