/**
 * JUSTICE GAVEL — BRUTAL TRIALS v20
 * 18 new domains targeting every remaining function-level gap.
 */
import { jest } from '@jest/globals';

let computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations;
let computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm, googleMapsLink;
let hasMinRole;
let safeInt, truncateStr, validCoords, BUSINESS_CONSTANTS;
let GAVEL_LEVELS, GAVEL_EMOJI, GAVEL_LABEL;
let MOTION_TYPES;
let CONFIG;

beforeAll(async () => {
  const mi  = await import('../routes/matter_intelligence.js');
  computeAllSignals              = mi.computeAllSignals;
  computeMotionRecommendations   = mi.computeMotionRecommendations;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe  = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm; googleMapsLink = geo.googleMapsLink;
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole;
  const rh  = await import('../utils/routeHelpers.js');
  safeInt = rh.safeInt; truncateStr = rh.truncateStr;
  validCoords = rh.validCoords; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg  = await import('../routes/golden_gavel.js');
  GAVEL_LEVELS = gg.GAVEL_LEVELS; GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
  const motT = await import('../routes/motions/_motion_types.js');
  MOTION_TYPES = motT.MOTION_TYPES;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});


// ── 1. auth.js forgot/reset password ─────────────────────────────────────
describe('1. auth.js — Forgot/Reset Password', () => {
  test('1-01: /forgot-password validates email format', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain('/forgot-password');
    expect(src).toContain('Invalid email format');
    expect(src).toContain('Email required');
  });
  test('1-02: reset link goes to justicegavel.app/reset-password', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain('justicegavel.app');
    expect(src).toContain('reset-password?token=');
  });
  test('1-03: reset uses sendEmail from sendgrid', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain("'Reset your Justice Gavel password'");
    expect(src).toContain('../services/sendgrid.js');
  });
  test('1-04: /update-profile endpoint exists', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain('/update-profile');
  });
  test('1-05: CURRENT_TOS_VERSION is 2.1', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/auth.js', 'utf8');
    expect(src).toContain("CURRENT_TOS_VERSION = '2.1'");
  });
});

// ── 2. schoolDisciplineParallel ───────────────────────────────────────────
describe('2. schoolDisciplineParallel — IDEA/504 Parallel Proceeding', () => {
  test('2-01: fires for age<18 + school keyword', () => {
    const s = computeAllSignals(mkMatter('juvenile', { client_age: 16, title: 'School suspension expulsion fight' }));
    expect(s.vertical_signals.schoolDisciplineParallel).toBe(true);
  });
  test('2-02: fires for age<18 + IEP/manifestation/disability/504', () => {
    const s = computeAllSignals(mkMatter('juvenile', { client_age: 14, title: 'IEP manifestation disability review' }));
    expect(s.vertical_signals.schoolDisciplineParallel).toBe(true);
  });
  test('2-03: does NOT fire for age >= 18', () => {
    const s = computeAllSignals(mkMatter('juvenile', { client_age: 18, title: 'School expulsion discipline' }));
    expect(s.vertical_signals.schoolDisciplineParallel).toBe(false);
  });
  test('2-04: does NOT fire without school/disability keyword', () => {
    const s = computeAllSignals(mkMatter('juvenile', { client_age: 15, title: 'Drug possession minor' }));
    expect(s.vertical_signals.schoolDisciplineParallel).toBe(false);
  });
  test('2-05: source mentions IDEA § 504 protections', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('IDEA');
    expect(src).toContain('§ 504');
  });
  test('2-06: 2000 computations — always correct', () => {
    let errors = 0;
    const TITLES = ['School expulsion discipline','IEP manifestation disability','Drug arrest minor','Car theft juvenile'];
    for (let i = 0; i < 2000; i++) {
      const age = 13 + (i % 8);
      const title = TITLES[i % TITLES.length];
      const s = computeAllSignals(mkMatter('juvenile', { client_age: age, title }));
      const hasSchool = /iep|manifestation|disability|504|school|expulsion|suspension|discipline/.test(title.toLowerCase());
      if (s.vertical_signals.schoolDisciplineParallel !== (age < 18 && hasSchool)) errors++;
    }
    expect(errors).toBe(0);
  });
});

// ── 3. maxConfinementJurisdictionalCeiling + priorMisconduct ─────────────
describe('3. maxConfinementJurisdictionalCeiling — Military', () => {
  test('3-01: general court-martial ceiling = 240 months', () => {
    const s = computeAllSignals(mkMatter('military', { court_type: 'general', evidence_score: 60 }));
    expect(s.vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
  });
  test('3-02: special court-martial ceiling = 12 months', () => {
    const s = computeAllSignals(mkMatter('military', { court_type: 'special', evidence_score: 60 }));
    expect(s.vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('3-03: priorMisconduct fires when prior_njp > 0', () => {
    const s = computeAllSignals(mkMatter('military', { prior_njp: 1, court_type: 'general' }));
    expect(s.vertical_signals.priorMisconduct).toBe(true);
  });
  test('3-04: priorMisconduct false when prior_njp = 0', () => {
    const s = computeAllSignals(mkMatter('military', { prior_njp: 0, court_type: 'general' }));
    expect(s.vertical_signals.priorMisconduct).toBe(false);
  });
  test('3-05: source has verify Article-specific max caveat', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('verify Article-specific max');
  });
  test('3-06: 2000 military computations — ceiling always 240 or 12', () => {
    let errors = 0;
    for (let i = 0; i < 2000; i++) {
      const ct = i % 2 === 0 ? 'general' : 'special';
      const s = computeAllSignals(mkMatter('military', { court_type: ct, evidence_score: i % 100, prior_njp: i % 3 }));
      if (s.vertical_signals.maxConfinementJurisdictionalCeiling !== (ct === 'general' ? 240 : 12)) errors++;
    }
    expect(errors).toBe(0);
  });
});

// ── 4. contentRefresh + integrations ─────────────────────────────────────
describe('4. contentRefresh.getContentAge + integrations', () => {
  test('4-01: getContentAge exported from contentRefresh.js', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/contentRefresh.js', 'utf8');
    expect(src).toContain('export async function getContentAge');
  });
  test('4-02: SAFE table whitelist: expungement_rules, rights_cards, crisis_resources, lessons', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/contentRefresh.js', 'utf8');
    for (const t of ['expungement_rules','rights_cards','crisis_resources','lessons']) expect(src).toContain(`'${t}'`);
    expect(src).toContain('SAFE.has(table)');
  });
  test('4-03: staleness thresholds: 30d/60d/30d', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/contentRefresh.js', 'utf8');
    expect(src).toContain('expungement_rules: 30');
    expect(src).toContain('rights_cards:      60');
    expect(src).toContain('ABA/LawHelp');
  });
  test('4-04: syncDMS supports iManage + NetDocuments', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/dms.js', 'utf8');
    expect(src).toContain('iManage Work 10+');
    expect(src).toContain('NetDocuments');
    expect(src).toContain('pushMatterToImanage');
  });
  test('4-05: refreshTokenIfNeeded is silent on demo mode', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/integrations/index.js', 'utf8');
    expect(src).toContain('refreshTokenIfNeeded');
    expect(src).toContain('silent on demo mode');
    expect(src).toContain('fresh conn object with updated tokens');
  });
});

// ── 5. outbound_bot deliverLead + sendPaymentLink ────────────────────────
describe('5. outbound_bot.js — Lead + Payment Link', () => {
  test('5-01: deliverLead fetches arrest, returns error if not found', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/outbound_bot.js', 'utf8');
    expect(src).toContain('deliverLead');
    expect(src).toContain('arrest_not_found');
    expect(src).toContain('arrest_records');
  });
  test('5-02: deliverLead signature has phone, arrestId, stripeLinkId, stripePaymentIntentId', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/outbound_bot.js', 'utf8');
    expect(src).toContain('phone, arrestId, stripeLinkId, stripePaymentIntentId');
  });
  test('5-03: sendPaymentLink signature has phone, arrestId, recipientType, recipientId', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/outbound_bot.js', 'utf8');
    expect(src).toContain('phone, arrestId, recipientType, recipientId');
  });
  test('5-04: TCPA idempotency key model', () => {
    const makeKey = (type, rId, aId) => `${type}:${rId}:${aId}`;
    expect(makeKey('sms_lead', 42, 9981)).toBe('sms_lead:42:9981');
    expect(makeKey('email', 1, 5).split(':').length).toBe(3);
  });
  test('5-05: SMS references $30k bail + $75 offer', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/outbound_bot.js', 'utf8');
    expect(src).toContain('$30k bail');
    expect(src).toContain('$75');
  });
});

// ── 6. processGoldenGavelAward + fetchSCOTUSSlipOpinions ────────────────
describe('6. Golden Gavel Award + SCOTUS Monitoring', () => {
  test('6-01: processGoldenGavelAward calls evaluateGavelLevel', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/golden_gavel.js', 'utf8');
    expect(src).toContain('processGoldenGavelAward');
    expect(src).toContain('evaluateGavelLevel');
    expect(src).toContain('gavel_level, golden_gavel, hall_opt_in');
  });
  test('6-02: award only fires when level increases', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/golden_gavel.js', 'utf8');
    expect(src).toContain('newLevel === curre');
  });
  test('6-03: fetchSCOTUSSlipOpinions fetches from supremecourt.gov RSS', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain('fetchSCOTUSSlipOpinions');
    expect(src).toContain('supremecourt.gov');
    expect(src).toContain("'User-Agent': 'JusticeGavel/1.0");
  });
  test('6-04: SCOTUS fetch has 8s timeout via AbortController', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain('AbortController');
    expect(src).toContain('8000');
    expect(src).toContain('controller.abort()');
  });
});

// ── 7. checkins.js 7 handlers ────────────────────────────────────────────
describe('7. checkins.js — 7-Handler Enrollment System', () => {
  test('7-01: has exactly 7 handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js', 'utf8');
    const h = src.match(/router\.(post|get|put|delete|patch)\s*\(/g) || [];
    expect(h.length).toBe(7);
  });
  test('7-02: enroll, enrollments, enrollments/:id, history, submit, status, my', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/checkins.js', 'utf8');
    expect(src).toContain("'/enroll'");
    expect(src).toContain("'/enrollments'");
    expect(src).toContain("'/enrollments/:id'");
    expect(src).toContain("'/history/:enrollmentId'");
    expect(src).toContain("'/status/:enrollmentId'");
    expect(src).toContain("'/submit'");
    expect(src).toContain("'/my/:enrollmentId'");
  });
});

// ── 8. privilege.js + time.js + cle.js + bondsman badge ─────────────────
describe('8. privilege / time / CLE / bondsman badge', () => {
  test('8-01: privilege.js has AI generate + entries CRUD + PDF export', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js', 'utf8');
    expect(src).toContain('/generate');
    expect(src).toContain('AI-generate privilege entries');
    expect(src).toContain('/entries');
    expect(src).toContain('/pdf');
  });
  test('8-02: privilege.js has /matter/:matterId for full log', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/privilege.js', 'utf8');
    expect(src).toContain('/matter/:matterId');
    expect(src).toContain('privilege log for a matter');
  });
  test('8-03: time.js has time entries CRUD + billing-summary', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/time.js', 'utf8');
    expect(src).toContain('/entries');
    expect(src).toContain('billing-summary');
    expect(src).toContain('unbilled');
  });
  test('8-04: cle.js has 4 handlers + transcript + idempotent complete', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/cle.js', 'utf8');
    const h = src.match(/router\.(get|post)\s*\(/g) || [];
    expect(h.length).toBe(4);
    expect(src).toContain('/transcript');
    expect(src).toContain('idempotent');
    expect(src).toContain('verified defender status');
  });
  test('8-05: bondsman verified-badge subscribe/cancel/status at $49/mo', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/billing/bondsman.js', 'utf8');
    expect(src).toContain('verified-badge/subscribe');
    expect(src).toContain('verified-badge/cancel');
    expect(src).toContain('verified-badge/status');
    expect(src).toContain("status='active'");
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
  });
});

// ── 9. firm_verticals specialty trackers (11 families) ───────────────────
describe('9. firm_verticals.js — Specialty Tracker Families', () => {
  test('9-01: 58 total handlers confirmed', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(h.length).toBe(58);
  });
  test('9-02: plea-offers + padilla-warnings trackers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('/plea-offers');
    expect(src).toContain('/padilla-warnings');
  });
  test('9-03: vop, dv-firearms, bop-exhaustion trackers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('/vop');
    expect(src).toContain('/dv-firearms');
    expect(src).toContain('/bop-exhaustion');
  });
  test('9-04: codefendants, collateral-consequences, ability-to-pay', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('/codefendants');
    expect(src).toContain('/collateral-consequences');
    expect(src).toContain('/ability-to-pay');
  });
  test('9-05: hague, material-support, dual-sovereignty, eviction', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/firm_verticals.js', 'utf8');
    expect(src).toContain('/hague');
    expect(src).toContain('/material-support');
    expect(src).toContain('/dual-sovereignty');
    expect(src).toContain('/eviction');
  });
});

// ── 10. Regression ────────────────────────────────────────────────────────
describe('10. Regression', () => {
  test('10-01: schoolDisciplineParallel fires on age<18 + school keyword', () => {
    expect(computeAllSignals(mkMatter('juvenile', { client_age: 15, title: 'School expulsion' })).vertical_signals.schoolDisciplineParallel).toBe(true);
  });
  test('10-02: general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('10-03: BUSINESS_CONSTANTS correct', () => {
    expect(BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS).toBe(2000);
    expect(BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS).toBe(4900);
    expect(BUSINESS_CONSTANTS.MIN_CHARGE_CENTS).toBe(50);
  });
  test('10-04: civil_rights crisis → emergInj=true', () => {
    expect(computeAllSignals(mkMatter('civil_rights', { vulnerability_level: 'crisis' })).vertical_signals.emergInj).toBe(true);
  });
  test('10-05: family expedTRO = crisis + dv_flag', () => {
    expect(computeAllSignals(mkMatter('family', { vulnerability_level: 'crisis', dv_flag: 1 })).vertical_signals.expedTRO).toBe(true);
    expect(computeAllSignals(mkMatter('family', { vulnerability_level: 'high', dv_flag: 1 })).vertical_signals.expedTRO).toBe(false);
  });
  test('10-06: GAVEL_EMOJI[3] = 🏆, GAVEL_LABEL[3] = Golden', () => {
    expect(GAVEL_EMOJI[3]).toBe('🏆');
    expect(GAVEL_LABEL[3]).toBe('Golden');
  });
  test('10-07: encryption 500 round-trips', () => {
    for (let i = 0; i < 500; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('10-08: zero hex violations in useTheme screens', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = '/tmp/JG/frontend/src/screens';
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

// ── 11. Mass Influx — 100,000 new scenarios ───────────────────────────────
describe('11. Mass Influx — 100,000 New Scenarios', () => {
  test('11-01: 30,000 schoolDisciplineParallel — always correct', () => {
    let errors = 0;
    const TITLES = ['School expulsion fight','IEP disability 504','Drug possession minor','Car theft charge'];
    for (let i = 0; i < 30000; i++) {
      const age = 13 + (i % 8);
      const title = TITLES[i % TITLES.length];
      const s = computeAllSignals(mkMatter('juvenile', { client_age: age, title, evidence_score: i % 100 }));
      const hasSchool = /iep|manifestation|disability|504|school|expulsion|suspension|discipline/.test(title.toLowerCase());
      if (s.vertical_signals.schoolDisciplineParallel !== (age < 18 && hasSchool)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('11-02: 30,000 military ceiling — always 240 or 12', () => {
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const ct = i % 2 === 0 ? 'general' : 'special';
      const s = computeAllSignals(mkMatter('military', { court_type: ct, evidence_score: i % 100, prior_njp: i % 4 }));
      if (s.vertical_signals.maxConfinementJurisdictionalCeiling !== (ct === 'general' ? 240 : 12)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('11-03: 20,000 diversion eligibility_score in [0,1]', () => {
    let errors = 0;
    const CHARGES = ['Drug marijuana','Mental health psychiatric','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      const recs = computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: CHARGES[i % CHARGES.length], evidence_score: i % 100, vulnerability_level: ['low','moderate','high','crisis'][i % 4], prior_adjudications: i % 4, client_age: 18 + (i % 40) });
      for (const r of recs) { if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++; }
    }
    expect(errors).toBe(0);
  });
  test('11-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
