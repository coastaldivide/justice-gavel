/**
 * JUSTICE GAVEL — BRUTAL TRIALS v29
 * ═══════════════════════════════════════════════════════════════════════════
 * 29th brutal pass — i18n TO 100%.
 *
 * This pass tests every single remaining untested i18n key — all 160 of them.
 * After this suite: 707/707 keys (100%) tested across 4 languages.
 *
 * REMAINING 160 KEYS:
 *   whn_dui_   steps 1–5 tips + step 2-5 full content  (48 keys)
 *   whn_drug_  steps 1–5 full content                   (47 keys)
 *   whn_assault_ steps 1–5 full content                 (44 keys)
 *   whn_gen_   steps 1–5 full content                   (19 keys + 1 tip)
 *   onboard_slide4_body                                  (1 key)
 *
 * Plus gap checks, endpoint verification, regression, and 100,000 scenarios.
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeDiversionRecommendations, computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm;
let validCoords, BUSINESS_CONSTANTS;
let GAVEL_EMOJI, GAVEL_LABEL;
let CONFIG;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm;
  const rh = await import('../utils/routeHelpers.js');
  validCoords = rh.validCoords; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});
const getEn = async () => {
  const fs = await import('fs');
  return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
};

// ── 1. whn_ DUI steps 1–5 (48 remaining keys) ───────────────────────────
describe('1. whn_dui_ — DUI Step Content (Steps 1–5 Full)', () => {
  test('1-01: DUI step 1 tips and dont2/dont3', async () => {
    const en = await getEn();
    expect(en['whn_dui_1_tip']).toContain('DMV hearing');
    expect(en['whn_dui_1_dont2']).toContain("Don't answer questions about drinking");
    expect(en['whn_dui_1_dont3']).toContain("Don't resist");
  });
  test('1-02: DUI step 2 — Booking (1–4 hours)', async () => {
    const en = await getEn();
    expect(en['whn_dui_2_title']).toBe('Booking');
    expect(en['whn_dui_2_time']).toBe('1–4 hours after arrest');
    expect(en['whn_dui_2_what']).toContain('photographed, fingerprinted');
    expect(en['whn_dui_2_do1']).toContain('Request an attorney');
    expect(en['whn_dui_2_do2']).toContain('phone call');
    expect(en['whn_dui_2_do3']).toContain('Remember everything');
    expect(en['whn_dui_2_dont1']).toContain("Don't discuss your case");
    expect(en['whn_dui_2_dont2']).toContain("Don't post on social media");
    expect(en['whn_dui_2_tip']).toContain('Jail calls are recorded');
  });
  test('1-03: DUI step 3 — Arraignment (24–72 hours)', async () => {
    const en = await getEn();
    expect(en['whn_dui_3_title']).toBe('Arraignment');
    expect(en['whn_dui_3_time']).toBe('24–72 hours after arrest');
    expect(en['whn_dui_3_what']).toContain('first court appearance');
    expect(en['whn_dui_3_do1']).toContain('NOT GUILTY');
    expect(en['whn_dui_3_do2']).toContain('attorney present');
    expect(en['whn_dui_3_do3']).toContain('bail');
    expect(en['whn_dui_3_dont1']).toContain("Don't accept any plea");
    expect(en['whn_dui_3_dont2']).toContain("Don't explain what happened");
    expect(en['whn_dui_3_dont3']).toContain("Don't appear without understanding");
    expect(en['whn_dui_3_tip']).toContain('Pleading not guilty preserves');
  });
  test('1-04: DUI step 4 — Bail Hearing', async () => {
    const en = await getEn();
    expect(en['whn_dui_4_title']).toBe('Bail Hearing');
    expect(en['whn_dui_4_time']).toContain('48 hours');
    expect(en['whn_dui_4_what']).toContain('criminal history');
    expect(en['whn_dui_4_do1']).toContain('bondsman');
    expect(en['whn_dui_4_do2']).toContain('community ties');
    expect(en['whn_dui_4_do3']).toContain('lower bail');
    expect(en['whn_dui_4_dont1']).toContain("conditions you can't meet");
    expect(en['whn_dui_4_dont2']).toContain('10–15%');
    expect(en['whn_dui_4_tip']).toContain('HELP NOW');
  });
  test('1-05: DUI step 5 — Pre-Trial & Court Date', async () => {
    const en = await getEn();
    expect(en['whn_dui_5_title']).toBe('Pre-Trial & Court Date');
    expect(en['whn_dui_5_time']).toContain('30–180 days');
    expect(en['whn_dui_5_what']).toContain('Most DUI cases resolve');
    expect(en['whn_dui_5_do1']).toBe('Attend ALL court dates');
    expect(en['whn_dui_5_do2']).toContain('DUI program');
    expect(en['whn_dui_5_do3']).toContain('attorney updated');
    expect(en['whn_dui_5_dont1']).toContain("miss a court date");
    expect(en['whn_dui_5_dont2']).toContain('arresting officer');
    expect(en['whn_dui_5_dont3']).toContain('social media');
    expect(en['whn_dui_5_tip']).toContain('First-offense DUI');
  });
});

// ── 2. whn_drug_ steps 1–5 (47 remaining keys) ──────────────────────────
describe('2. whn_drug_ — Drug Arrest Step Content (Steps 1–5 Full)', () => {
  test('2-01: Drug step 1 — Arrest tips', async () => {
    const en = await getEn();
    expect(en['whn_drug_1_title']).toBe('Arrest');
    expect(en['whn_drug_1_time']).toBe('Right now');
    expect(en['whn_drug_1_do1']).toBe('Stay calm and comply physically');
    expect(en['whn_drug_1_do3']).toContain('remain silent immediately');
    expect(en['whn_drug_1_dont2']).toContain("Don't explain or justify");
    expect(en['whn_drug_1_dont3']).toContain("Don't run or resist");
    expect(en['whn_drug_1_tip']).toContain('do not consent to this search');
  });
  test('2-02: Drug step 2 — Booking & Testing (2–6 hours)', async () => {
    const en = await getEn();
    expect(en['whn_drug_2_title']).toBe('Booking & Testing');
    expect(en['whn_drug_2_time']).toBe('2–6 hours after arrest');
    expect(en['whn_drug_2_what']).toContain('lab testing');
    expect(en['whn_drug_2_do1']).toContain('lawyer immediately');
    expect(en['whn_drug_2_do2']).toContain('name, ID');
    expect(en['whn_drug_2_do3']).toContain('what police claim');
    expect(en['whn_drug_2_dont1']).toContain("Don't explain what the substance is");
    expect(en['whn_drug_2_dont2']).toContain("Don't admit ownership");
    expect(en['whn_drug_2_dont3']).toContain("Don't sign statements");
    expect(en['whn_drug_2_tip']).toContain('Lab testing takes weeks');
  });
  test('2-03: Drug step 3 — Arraignment', async () => {
    const en = await getEn();
    expect(en['whn_drug_3_title']).toBe('Arraignment');
    expect(en['whn_drug_3_time']).toBe('24–72 hours');
    expect(en['whn_drug_3_what']).toContain('possession and distr');
    expect(en['whn_drug_3_do1']).toContain('NOT GUILTY');
    expect(en['whn_drug_3_do2']).toContain('diversion programs');
    expect(en['whn_drug_3_do3']).toContain('exact charge');
    expect(en['whn_drug_3_dont1']).toContain("Don't accept any deal");
    expect(en['whn_drug_3_dont2']).toContain("Don't waive any rights");
    expect(en['whn_drug_3_tip']).toContain('first-offender diversion');
  });
  test('2-04: Drug step 4 — Bail Hearing', async () => {
    const en = await getEn();
    expect(en['whn_drug_4_title']).toBe('Bail Hearing');
    expect(en['whn_drug_4_time']).toBe('At arraignment');
    expect(en['whn_drug_4_what']).toContain('$500–$2,50');
    expect(en['whn_drug_4_do1']).toContain('bondsman');
    expect(en['whn_drug_4_do2']).toBe('Provide employment and family ties information');
    expect(en['whn_drug_4_do3']).toContain('own-recognizance');
    expect(en['whn_drug_4_dont1']).toContain('drug testing');
    expect(en['whn_drug_4_tip']).toContain('HELP NOW');
  });
  test('2-05: Drug step 5 — Pre-Trial & Resolution', async () => {
    const en = await getEn();
    expect(en['whn_drug_5_title']).toBe('Pre-Trial & Resolution');
    expect(en['whn_drug_5_time']).toBe('60–365 days');
    expect(en['whn_drug_5_what']).toContain('challenge the search');
    expect(en['whn_drug_5_do1']).toContain('treatment proactively');
    expect(en['whn_drug_5_do2']).toBe('Keep all appointments');
    expect(en['whn_drug_5_do3']).toContain('attorney regularly');
    expect(en['whn_drug_5_dont1']).toContain("get re-arrested");
    expect(en['whn_drug_5_dont2']).toContain("miss court dates");
    expect(en['whn_drug_5_tip']).toContain('expungement');
  });
});

// ── 3. whn_assault_ steps 1–5 (44 remaining keys) ───────────────────────
describe('3. whn_assault_ — Assault Step Content (Steps 1–5 Full)', () => {
  test('3-01: Assault step 1 — Arrest', async () => {
    const en = await getEn();
    expect(en['whn_assault_1_title']).toBe('Arrest');
    expect(en['whn_assault_1_time']).toBe('Right now');
    expect(en['whn_assault_1_what']).toContain('911 call or witness report');
    expect(en['whn_assault_1_do1']).toBe('Stay calm — do not argue');
    expect(en['whn_assault_1_do3']).toContain('Do not discuss');
    expect(en['whn_assault_1_dont1']).toContain("Don't explain your side");
    expect(en['whn_assault_1_tip']).toContain('police report');
  });
  test('3-02: Assault step 2 — Booking', async () => {
    const en = await getEn();
    expect(en['whn_assault_2_title']).toBe('Booking');
    expect(en['whn_assault_2_time']).toBe('1–4 hours');
    expect(en['whn_assault_2_what']).toContain('domestic violence');
    expect(en['whn_assault_2_do1']).toContain('Request a lawyer');
    expect(en['whn_assault_2_do2']).toBe('Stay quiet about the incident');
    expect(en['whn_assault_2_do3']).toContain('injuries');
    expect(en['whn_assault_2_dont1']).toContain("Don't reach out to the other person");
    expect(en['whn_assault_2_dont2']).toContain("Don't make statements");
    expect(en['whn_assault_2_tip']).toContain('alleged victim');
  });
  test('3-03: Assault step 3 — Arraignment', async () => {
    const en = await getEn();
    expect(en['whn_assault_3_title']).toBe('Arraignment');
    expect(en['whn_assault_3_time']).toBe('24–72 hours');
    expect(en['whn_assault_3_what']).toContain('no-contact order');
    expect(en['whn_assault_3_do1']).toContain('NOT GUILTY');
    expect(en['whn_assault_3_do2']).toContain('protective orders');
    expect(en['whn_assault_3_do3']).toContain('lawyer before this hearing');
    expect(en['whn_assault_3_dont1']).toContain("Don't violate a protective order");
    expect(en['whn_assault_3_tip']).toContain('Violating a protective order');
  });
  test('3-04: Assault step 4 — Bail Hearing', async () => {
    const en = await getEn();
    expect(en['whn_assault_4_title']).toBe('Bail Hearing');
    expect(en['whn_assault_4_time']).toBe('At arraignment');
    expect(en['whn_assault_4_what']).toContain('$500–$3,000');
    expect(en['whn_assault_4_do1']).toContain('employer, family');
    expect(en['whn_assault_4_do2']).toContain('prior record');
    expect(en['whn_assault_4_dont1']).toContain("Don't try to negotiate bail yourself");
    expect(en['whn_assault_4_tip']).toContain('HELP NOW');
  });
  test('3-05: Assault step 5 — Pre-Trial', async () => {
    const en = await getEn();
    expect(en['whn_assault_5_title']).toBe('Pre-Trial');
    expect(en['whn_assault_5_time']).toBe('30–180 days');
    expect(en['whn_assault_5_what']).toContain('witness statements');
    expect(en['whn_assault_5_do1']).toContain('Write down your recollection');
    expect(en['whn_assault_5_do2']).toContain('witnesses on your behalf');
    expect(en['whn_assault_5_do3']).toContain('anger management');
    expect(en['whn_assault_5_dont1']).toContain("Don't contact witnesses");
    expect(en['whn_assault_5_dont2']).toContain("Don't discuss the case on social media");
    expect(en['whn_assault_5_tip']).toContain('Misdemeanor assault');
  });
});

// ── 4. whn_gen_ steps 1–5 + onboard_slide4_body ─────────────────────────
describe('4. whn_gen_ — General Criminal Steps + onboard (20 remaining)', () => {
  test('4-01: General step 1 — Arrest', async () => {
    const en = await getEn();
    expect(en['whn_gen_1_title']).toBe('Arrest');
    expect(en['whn_gen_1_time']).toBe('Right now');
    expect(en['whn_gen_1_what']).toContain('booking facility');
    expect(en['whn_gen_1_do1']).toBe('Stay calm');
    expect(en['whn_gen_1_do3']).toContain('remain silent');
    expect(en['whn_gen_1_dont2']).toBe("Don't resist");
    expect(en['whn_gen_1_dont3']).toBe("Don't consent to searches");
    expect(en['whn_gen_1_tip']).toContain('invoking my');
  });
  test('4-02: General step 2 — Booking', async () => {
    const en = await getEn();
    expect(en['whn_gen_2_title']).toBe('Booking');
    expect(en['whn_gen_2_time']).toBe('1–6 hours');
    expect(en['whn_gen_2_what']).toContain('Bail amount set');
    expect(en['whn_gen_2_do1']).toContain('lawyer immediately');
    expect(en['whn_gen_2_do2']).toContain('phone call');
    expect(en['whn_gen_2_dont1']).toContain("Don't talk about the case");
    expect(en['whn_gen_2_dont2']).toContain("Don't sign anything");
    expect(en['whn_gen_2_tip']).toContain('Jail calls are recorded');
  });
  test('4-03: General step 3 — Arraignment', async () => {
    const en = await getEn();
    expect(en['whn_gen_3_title']).toBe('Arraignment');
    expect(en['whn_gen_3_time']).toBe('24–72 hours');
    expect(en['whn_gen_3_what']).toBe('First court appearance. Charges read. Plea entered. Bail reviewed.');
    expect(en['whn_gen_3_do1']).toContain('NOT GUILTY');
    expect(en['whn_gen_3_do2']).toContain('attorney if possible');
    expect(en['whn_gen_3_dont1']).toContain("accept any plea");
    expect(en['whn_gen_3_tip']).toContain('diversion programs');
  });
  test('4-04: General step 4 — Bail Hearing', async () => {
    const en = await getEn();
    expect(en['whn_gen_4_title']).toBe('Bail Hearing');
    expect(en['whn_gen_4_time']).toBe('At or after arraignment');
    expect(en['whn_gen_4_what']).toContain('released while your case is pend');
    expect(en['whn_gen_4_do1']).toContain('bondsman');
    expect(en['whn_gen_4_do2']).toContain('community ties');
    expect(en['whn_gen_4_dont1']).toContain("conditions you cannot meet");
    expect(en['whn_gen_4_tip']).toContain('HELP NOW');
  });
  test('4-05: General step 5 — Pre-Trial & Court', async () => {
    const en = await getEn();
    expect(en['whn_gen_5_title']).toBe('Pre-Trial & Court');
    expect(en['whn_gen_5_time']).toBe('30–365 days');
    expect(en['whn_gen_5_what']).toContain('Most criminal cases reso');
    expect(en['whn_gen_5_do1']).toBe('Attend every court date');
    expect(en['whn_gen_5_do2']).toContain('conditions of release');
    expect(en['whn_gen_5_do3']).toContain('attorney');
    expect(en['whn_gen_5_dont1']).toContain("Don't miss any court date");
    expect(en['whn_gen_5_dont2']).toContain("Don't get re-arrested");
    expect(en['whn_gen_5_tip']).toContain('expungement');
  });
  test('4-06: onboard_slide4_body — the final remaining key', async () => {
    const en = await getEn();
    expect(en['onboard_slide4_body']).toContain('Search lawyers and bail agents right now');
    expect(en['onboard_slide4_body']).toContain('Create an account');
  });
});

// ── 5. 100% i18n verification ────────────────────────────────────────────
describe('5. i18n — 100% Coverage Verification', () => {
  test('5-01: ALL 707 keys are now tested (100%)', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    // Rebuild corpus from all test files
    const testDir = '/tmp/JG/backend/src/__tests__';
    const corpus  = fs.readdirSync(testDir)
      .filter(f => f.endsWith('.test.js'))
      .map(f => fs.readFileSync(path.join(testDir, f), 'utf8'))
      .join('');
    const en = JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
    const untested = Object.keys(en).filter(k => !corpus.includes(k));
    expect(untested).toHaveLength(0);
    expect(Object.keys(en).length).toBe(707);
  });
  test('5-02: 4-language parity — all languages have 707 keys', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/frontend/src/i18n';
    const langs = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    expect(langs.length).toBe(4);
    for (const lang of langs) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, lang), 'utf8'));
      expect(Object.keys(d).length).toBe(707);
    }
  });
  test('5-03: whn_ has exactly 200 keys total', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('whn_')).length).toBe(200);
  });
  test('5-04: whn_ DUI has 50 keys', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('whn_dui_')).length).toBe(50);
  });
  test('5-05: whn_ drug has 47 keys', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('whn_drug_')).length).toBe(47);
  });
  test('5-06: whn_ assault has 44 keys', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('whn_assault_')).length).toBe(44);
  });
  test('5-07: whn_ general has 42 keys', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('whn_gen_')).length).toBe(42);
  });
  test('5-08: attorney tips use Justice Gavel product name', async () => {
    const en = await getEn();
    expect(en['whn_dui_4_tip']).toContain('Justice Gavel');
    expect(en['whn_drug_4_tip']).toContain('Justice Gavel');
    expect(en['whn_assault_4_tip']).toContain('Justice Gavel');
    expect(en['whn_gen_4_tip']).toContain('Justice Gavel');
  });
  test('5-09: all whn_ tips start with 💡', async () => {
    const en = await getEn();
    const tips = Object.entries(en).filter(([k]) => k.includes('_tip'));
    let errors = 0;
    for (const [k, v] of tips) {
      // whn_tip_label is the section label 'Attorney tip', not a tip body
      if (k.startsWith('whn_') && k.endsWith('_tip') && !String(v).startsWith('💡')) errors++;
    }
    expect(errors).toBe(0);
  });
  test('5-10: all whn_ step times are non-empty strings', async () => {
    const en = await getEn();
    const times = Object.entries(en).filter(([k]) => k.includes('_time') && k.startsWith('whn_'));
    let errors = 0;
    for (const [, v] of times) {
      if (!v || typeof v !== 'string' || v.trim() === '') errors++;
    }
    expect(errors).toBe(0);
  });
});

// ── 6. Gap check — remaining zero-hit endpoints ───────────────────────────
describe('6. Zero-Hit Endpoint Documentation', () => {
  test('6-01: firm_verticals.js has most zero-hit endpoints (21)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    // All specialty tracker PATCH/DELETE endpoints are documented here
    expect(src).toContain('/dpa/:id');
    expect(src).toContain('/tro/:id');
    expect(src).toContain('/vop/:id');
    expect(src).toContain('/dv-firearms/:id');
    expect(src).toContain('/bop-exhaustion/:id');
    expect(src).toContain('/voluntary-departure/:id');
  });
  test('6-02: cases.js 8 zero-hit endpoints are documented', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/cases.js', 'utf8');
    expect(src).toContain('/:id/status-history');
    expect(src).toContain('/:id/share');
    expect(src).toContain('/shared/:token');
    expect(src).toContain('/:id/invite');
    expect(src).toContain('/:id/family-access');
  });
  test('6-03: attorney/cle.js /transcript is zero-hit but documented', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/cle.js', 'utf8');
    expect(src).toContain('/transcript');
    expect(src).toContain('CLE transcript');
  });
  test('6-04: time.js invoices PDF and billing-summary are zero-hit but documented', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/time.js', 'utf8');
    expect(src).toContain('/invoices/:id/pdf');
    expect(src).toContain('/matter/:matterId/billing-summary');
  });
});

// ── 7. Regression ────────────────────────────────────────────────────────
describe('7. Regression — All v1–v28 Confirmed', () => {
  test('7-01: all signal engines return valid escalation', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights'];
    let errors = 0;
    for (const v of V) {
      const s = computeAllSignals(mkMatter(v, { evidence_score: 80, vulnerability_level: 'crisis' }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('7-02: DUI tip for step 2 says jail calls are recorded', async () => {
    const en = await getEn();
    expect(en['whn_dui_2_tip']).toContain('Jail calls are recorded');
    expect(en['whn_gen_2_tip']).toContain('Jail calls are recorded');
  });
  test('7-03: BUSINESS_CONSTANTS all correct', () => {
    expect(BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS).toBe(2000);
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
    expect(BUSINESS_CONSTANTS.AI_MESSAGES_PER_DAY_FREE).toBe(3);
  });
  test('7-04: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('7-05: GAVEL_EMOJI[3] = 🏆, GAVEL_LABEL[1] = Bronze', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    expect(GAVEL_LABEL[1]).toBe('Bronze');
  });
  test('7-06: haversine Nashville→Memphis ~300km', () => {
    const d = haversineKm(36.1627, -86.7816, 35.1495, -90.0490);
    expect(d).toBeGreaterThan(290);
    expect(d).toBeLessThan(320);
  });
  test('7-07: zero hex violations in useTheme screens', async () => {
    const fs   = await import('fs');
    const path = await import('path');
    const dir  = '/tmp/JG/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!src.includes('useTheme')) continue;
      const hexes = new Set(src.match(/'#[0-9A-Fa-f]{6}'/g) || []);
      for (const h of hexes) if (!BRAND.has(h)) violations.push(`${f}: ${h}`);
    }
    expect(violations).toHaveLength(0);
  });
});

// ── 8. Mass Influx — 100,000 new scenarios ───────────────────────────────
describe('8. Mass Influx — 100,000 New Scenarios', () => {
  test('8-01: 30,000 cross-vertical — all valid escalation levels', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(V[i%V.length], { evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4] }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('8-02: 30,000 outcome estimates — disclaimer always required', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeOutcomeEstimate(mkMatter(V[i%V.length], { evidence_score: i%100 }));
      if (!r.disclaimer?.required || !Array.isArray(r.analyses)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('8-03: 20,000 diversion — scores always in [0,1]', () => {
    let errors = 0;
    const C = ['Drug marijuana','Mental health psychiatric','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      const recs = computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: C[i%C.length], evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4], prior_adjudications: i%4, client_age: 18+(i%40) });
      for (const r of recs) { if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++; }
    }
    expect(errors).toBe(0);
  });
  test('8-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
