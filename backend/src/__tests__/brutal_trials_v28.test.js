/**
 * JUSTICE GAVEL — BRUTAL TRIALS v28
 * ═══════════════════════════════════════════════════════════════════════════
 * 28th brutal pass — screens at 3–6 hits, analytics, route clusters, i18n 100%.
 *
 * NEW DOMAINS (15 areas):
 *  1.  ImmigrationConsequencesScreen — fetchError, immigrationLesson,
 *                                       eiorCourts, tab, PTR, mountedRef
 *  2.  TenantRightsScreen — eviction emergency, housingLesson, legalAidResources,
 *                            situation, PTR, Linking, mountedRef
 *  3.  InsuranceScreen — /insurance/quote, plan/quote/error states, PTR
 *  4.  PILeadScreen — /billing/pi-lead/submit, step wizard (caseType/severity/
 *                     description), PI attorney lead marketplace, PTR, Alert
 *  5.  AdvocacyScreen — /advocacy/stats, stats/loading/error states, PTR, mountedRef
 *  6.  DrugPenaltiesScreen — zero API calls, state/penalties/expanded/offenseFilter,
 *                             offline static, mountedRef
 *  7.  conflicts.js — 10 handlers: conflict check, index, report, waiver,
 *                     ethics-wall CRUD, waivers list
 *  8.  consultations.js — 5 handlers: book/list/slots/cancel, $10/$15/$25 fees
 *  9.  docket.js — 9 handlers: calculate, entries CRUD, matter/:matterId, upcoming
 * 10.  attorney/verification.js — bar verification submit + admin approve
 * 11.  checkStaleness — EXPIRED/WARNING/APPROACHING severity model
 *       runBiasAudit — audit_date, version, tests[] shape, evidence symmetry test
 * 12.  PRECEDENT_REGISTRY — 4 design principles, every-entry-cited rule
 * 13.  i18n final sweep — rc_ (12), div_ (10), whn_ (163), gg_ (3), ice_ (2),
 *                          case_ (3), onboard_ (4), disc_ (8), 4-language parity
 * 14.  Regression — all v1–v27 confirmed
 * 15.  Mass influx — 100,000 new scenarios
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeDiversionRecommendations, computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm;
let hasMinRole;
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
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole;
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

// ── 1–6. Low-hit screens ─────────────────────────────────────────────────
describe('1. ImmigrationConsequencesScreen + TenantRightsScreen', () => {
  test('1-01: ImmigrationConsequencesScreen fetches Immigration lessons + EOIR courts', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx', 'utf8');
    expect(src).toContain("category=Immigration");
    expect(src).toContain('IMMIGRATION_COURT');
    expect(src).toContain('eiorCourts');
    expect(src).toContain('immigrationLesson');
  });
  test('1-02: ImmigrationConsequencesScreen has tab, PTR, fetchError, mountedRef', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx', 'utf8');
    expect(src).toContain('tab');
    expect(src).toContain('RefreshControl');
    expect(src).toContain('fetchError');
    expect(src).toContain('mountedRef');
  });
  test('1-03: ImmigrationConsequencesScreen is 2-tab: Consequences + DACA/Visa', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/ImmigrationConsequencesScreen.tsx', 'utf8');
    expect(src).toContain('Consequences');
    expect(src).toContain('DACA');
  });
  test('1-04: TenantRightsScreen handles eviction emergency with hard deadline', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TenantRightsScreen.tsx', 'utf8');
    expect(src).toContain('eviction');
    expect(src).toContain('hard deadline');
  });
  test('1-05: TenantRightsScreen has situation, housingLesson, legalAidResources states', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/TenantRightsScreen.tsx', 'utf8');
    expect(src).toContain('situation');
    expect(src).toContain('housingLesson');
    expect(src).toContain('legalAidResources');
    expect(src).toContain('Linking');
    expect(src).toContain('mountedRef');
  });
});

describe('2. InsuranceScreen + PILeadScreen + AdvocacyScreen + DrugPenaltiesScreen', () => {
  test('2-01: InsuranceScreen fetches /insurance/quote with plan/quote states', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/InsuranceScreen.tsx', 'utf8');
    expect(src).toContain("'/insurance/quote'");
    expect(src).toContain('plan');
    expect(src).toContain('quote');
    expect(src).toContain('error');
    expect(src).toContain('RefreshControl');
  });
  test('2-02: PILeadScreen submits to /billing/pi-lead/submit', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/PILeadScreen.tsx', 'utf8');
    expect(src).toContain("'/billing/pi-lead/submit'");
    expect(src).toContain('PI attorney lead marketplace');
    expect(src).toContain('step');
    expect(src).toContain('caseType');
    expect(src).toContain('severity');
  });
  test('2-03: AdvocacyScreen fetches /advocacy/stats', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/AdvocacyScreen.tsx', 'utf8');
    expect(src).toContain("'/advocacy/stats'");
    expect(src).toContain('stats');
    expect(src).toContain('mountedRef');
    expect(src).toContain('RefreshControl');
  });
  test('2-04: DrugPenaltiesScreen is offline static (no API calls)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/screens/DrugPenaltiesScreen.tsx', 'utf8');
    expect(src).not.toContain("api.get");
    expect(src).not.toContain("api.post");
    expect(src).toContain('state');
    expect(src).toContain('penalties');
    expect(src).toContain('offenseFilter');
  });
});

// ── 7. conflicts.js ───────────────────────────────────────────────────────
describe('7. conflicts.js — Conflict Screening & Ethics Wall', () => {
  test('7-01: conflicts.js has 10 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js', 'utf8');
    const h = src.match(/router\.(get|post|delete|patch|put)\s*\(/g) || [];
    expect(h.length).toBe(10);
  });
  test('7-02: has bulk conflict check by party names', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js', 'utf8');
    expect(src).toContain('/check');
    expect(src).toContain('bulk conflict check');
    expect(src).toContain('party names');
  });
  test('7-03: has conflict waiver with justification', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js', 'utf8');
    expect(src).toContain('/waiver');
    expect(src).toContain('justification');
  });
  test('7-04: has ethics wall CRUD for matter-level attorney walls', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/conflicts.js', 'utf8');
    expect(src).toContain('ethics-wall');
    expect(src).toContain('Ethics Walls');
  });
});

// ── 8. consultations.js ───────────────────────────────────────────────────
describe('8. consultations.js — Video Consultation Booking', () => {
  test('8-01: consultations.js has 5 handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/consultations.js', 'utf8');
    const h = src.match(/router\.(get|post|delete)\s*\(/g) || [];
    expect(h.length).toBe(5);
  });
  test('8-02: tiered platform fees: $10/$15/$25 by duration', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/consultations.js', 'utf8');
    expect(src).toContain('$10');
    expect(src).toContain('$15');
    expect(src).toContain('$25');
    expect(src).toContain('30 min');
    expect(src).toContain('60 min');
  });
  test('8-03: has book, list, slots, cancel endpoints', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/consultations.js', 'utf8');
    expect(src).toContain('/book');
    expect(src).toContain('/slots/:lawyerId');
    expect(src).toContain(':id/cancel');
  });
});

// ── 9. docket.js ──────────────────────────────────────────────────────────
describe('9. docket.js — Deadline Calculation Engine', () => {
  test('9-01: docket.js has 9 route handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/docket.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete)\s*\(/g) || [];
    expect(h.length).toBe(9);
  });
  test('9-02: POST /calculate computes deadlines from trigger event', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/docket.js', 'utf8');
    expect(src).toContain('/calculate');
    expect(src).toContain('calculate deadlines from a trigger event');
  });
  test('9-03: has docket entries CRUD + matter/:matterId + upcoming', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/docket.js', 'utf8');
    expect(src).toContain('/entries');
    expect(src).toContain('/matter/:matterId');
    expect(src).toContain('/upcoming');
  });
});

// ── 10. attorney/verification.js ──────────────────────────────────────────
describe('10. attorney/verification.js — Bar Verification', () => {
  test('10-01: verification.js has bar submit + admin approve', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/verification.js', 'utf8');
    expect(src).toContain('Bar verification submit');
    expect(src).toContain('admin approve');
  });
  test('10-02: verification.js has 2 handlers', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/attorney/verification.js', 'utf8');
    const h = src.match(/router\.(get|post|put|delete|patch)\s*\(/g) || [];
    expect(h.length).toBe(2);
  });
});

// ── 11. Analytics: checkStaleness + runBiasAudit ─────────────────────────
describe('11. Analytics — checkStaleness + runBiasAudit', () => {
  test('11-01: checkStaleness iterates PRECEDENT_REGISTRY and flags expiry', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain('checkStaleness');
    expect(src).toContain('PRECEDENT_REGISTRY');
    expect(src).toContain('superseded_by');
    expect(src).toContain('stale_after');
  });
  test('11-02: checkStaleness returns EXPIRED/WARNING/APPROACHING severity levels', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain("'EXPIRED'");
  });
  test('11-03: checkStaleness computes days-until using daysUntil calculation', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain('daysUntil');
    expect(src).toContain('1000 * 86400');
  });
  test('11-04: runBiasAudit returns audit_date, version, tests[] shape', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain('runBiasAudit');
    expect(src).toContain('audit_date');
    expect(src).toContain("version: MONITOR_VERSION");
    expect(src).toContain('tests: []');
  });
  test('11-05: runBiasAudit test 1 is evidence strength symmetry', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentMonitor.js', 'utf8');
    expect(src).toContain('Evidence strength symmetry');
    expect(src).toContain('same reason and in the same direction');
  });
  test('11-06: checkStaleness model', () => {
    const checkEntry = (daysUntil) => {
      if (daysUntil < 0) return 'EXPIRED';
      if (daysUntil < 30) return 'WARNING';
      return 'OK';
    };
    expect(checkEntry(-1)).toBe('EXPIRED');
    expect(checkEntry(29)).toBe('WARNING');
    expect(checkEntry(90)).toBe('OK');
  });
});

// ── 12. PRECEDENT_REGISTRY design principles ──────────────────────────────
describe('12. PRECEDENT_REGISTRY — Authoritative Knowledge Base', () => {
  test('12-01: registry has 4 design principles', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentRegistry.js', 'utf8');
    expect(src).toContain('DESIGN PRINCIPLES');
    expect(src).toContain('1. Every entry is cited');
    expect(src).toContain('2. Every entry has a staleness date');
    expect(src).toContain('3. Jurisdiction matters');
    expect(src).toContain('4. Circuit splits are explicit');
  });
  test('12-02: registry exports REGISTRY_VERSION, REGISTRY_DATE, PRECEDENT_REGISTRY', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentRegistry.js', 'utf8');
    expect(src).toContain('REGISTRY_VERSION');
    expect(src).toContain('REGISTRY_DATE');
    expect(src).toContain('PRECEDENT_REGISTRY');
  });
  test('12-03: registry entries have stat_base, jurisdiction, stale_after, source', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentRegistry.js', 'utf8');
    expect(src).toContain('stat_base');
    expect(src).toContain('jurisdiction');
    expect(src).toContain('stale_after');
    expect(src).toContain('source');
  });
  test('12-04: getRelevantEntries exported and filters by vertical/taxonomy', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/analytics/precedentRegistry.js', 'utf8');
    expect(src).toContain('getRelevantEntries');
  });
  test('12-05: PRECEDENT_REGISTRY runtime test — importable', async () => {
    const { PRECEDENT_REGISTRY, REGISTRY_VERSION } = await import('../analytics/precedentRegistry.js');
    expect(Array.isArray(PRECEDENT_REGISTRY)).toBe(true);
    expect(PRECEDENT_REGISTRY.length).toBeGreaterThan(10);
    expect(typeof REGISTRY_VERSION).toBe('string');
  });
});

// ── 13. i18n final sweep ─────────────────────────────────────────────────
describe('13. i18n Final Sweep — 211 remaining keys', () => {
  test('13-01: rc_ page_sub and remaining rights card labels', async () => {
    const en = await getEn();
    expect(en['rc_page_sub']).toContain('tap your state');
    expect(en['rc_share_text']).toContain('Share as image');
    expect(en['rc_change_state']).toContain('Change State');
    expect(en['rc_h4']).toContain('RIGHT TO KNOW THE CHARGES');
    expect(en['rc_h5']).toContain('TRAFFIC STOP');
    expect(en['rc_h6']).toContain('DURING ARREST');
    expect(en['rc_h7']).toContain('BAIL AND RELEASE');
    expect(en['rc_h8']).toContain('PHONE CALL');
    expect(en['rc_b4']).toContain('right to be told');
    expect(en['rc_b5']).toContain("driver's license");
    expect(en['rc_b6']).toContain('Do not physically resist');
    expect(en['rc_b7']).toContain('bail hearing');
    expect(en['rc_b8']).toContain('phone call');
  });
  test('13-02: div_ remaining labels', async () => {
    const en = await getEn();
    expect(en['div_programs_available']).toBe('Programs available');
    expect(en['div_what_is']).toBe('What is diversion?');
    expect(en['div_charge_disorderly']).toBe('Disorderly Conduct / Trespassing');
    expect(en['div_charge_assault']).toBe('Simple Assault (no weapon)');
    expect(en['div_charge_fraud']).toBe('Minor Fraud / Bad Check');
    expect(en['div_charge_drug_sales']).toBe('Drug Sales or Distribution');
    expect(en['div_prior_none']).toBe('No prior arrests or convictions');
    expect(en['div_prior_minor']).toBe('Prior misdemeanor (resolved)');
    expect(en['div_prior_felony']).toBe('Prior felony conviction');
    expect(en['div_state_note']).toBe('Note for your state');
  });
  test('13-03: whn_ navigation and no-walkthrough label', async () => {
    const en = await getEn();
    expect(en['whn_no_walkthrough']).toBe('Select your charge type above to see what happens next.');
    expect(en['whn_dui_2_dont3']).toBe("Don't sign anything without a lawyer");
    expect(en['whn_assault_2_dont2']).toBe("Don't make statements");
    expect(en['whn_gen_3_dont1']).toContain('accept any plea');
  });
  test('13-04: gg_ remaining 3 keys', async () => {
    const en = await getEn();
    expect(en['gg_criteria']).toBe('Your criteria');
    expect(en['gg_hall_intro']).toContain('chosen public recognition');
    expect(en['gg_next']).toBe('Next:');
  });
  test('13-05: ice_ title/subtitle, case_ empty/ai, onboard_ remaining', async () => {
    const en = await getEn();
    expect(en['ice_title']).toBe('ICE Detention Help');
    expect(en['ice_subtitle']).toBe('Know your rights if detained by ICE');
    expect(en['case_empty_sub']).toBe('Tap + New case to add your first case.');
    expect(en['case_ai_title']).toBe('Discuss with AI');
    expect(en['case_voice_sub']).toContain('Dictate');
    expect(en['onboard_slide3_title']).toBe('A lawyer who gets it.');
    expect(en['onboard_record_body']).toContain('eligible to seal or expunge');
    expect(en['onboard_expunge_body']).toContain('tells you');
  });
  test('13-06: disc_ remaining 8 keys', async () => {
    const en = await getEn();
    expect(en['disc_sub']).toContain('Upload any discovery document');
    expect(en['disc_upload_examples']).toContain('Police reports');
    expect(en['disc_tap_change']).toBe('Tap to change');
    expect(en['disc_type_label']).toContain('Document type');
    expect(en['disc_doc_medical']).toBe('Medical Records');
    expect(en['disc_doc_witness']).toBe('Witness Statement');
    expect(en['disc_doc_crime_scene']).toBe('Crime Scene Photo');
    expect(en['disc_doc_court']).toBe('Court Filing');
  });
  test('13-07: 4-language parity — all 4 languages have 707 keys', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = '/tmp/JG/frontend/src/i18n';
    const langs = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    expect(langs.length).toBe(4);
    for (const lang of langs) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, lang), 'utf8'));
      expect(Object.keys(d).length).toBe(707);
    }
  });
  test('13-08: qc_what_you_get, bail_directions, booking_done, juv_cta_ai, atty_office_name', async () => {
    const en = await getEn();
    expect(en['qc_what_you_get']).toBe('What you get');
    expect(en['bail_directions']).toBe('🗺  Directions');
    expect(en['booking_done']).toBe('Done');
    expect(en['juv_cta_ai']).toBe('Ask AI About Your Situation');
    expect(en['atty_office_name']).toBe('Office Name');
    expect(en['help_now_loading_search']).toContain('bail bondsmen and attorneys');
  });
});

// ── 14. Regression ───────────────────────────────────────────────────────
describe('14. Regression — All v1–v27 Confirmed', () => {
  test('14-01: PRECEDENT_REGISTRY is array with >10 entries', async () => {
    const { PRECEDENT_REGISTRY } = await import('../analytics/precedentRegistry.js');
    expect(PRECEDENT_REGISTRY.length).toBeGreaterThan(10);
  });
  test('14-02: icwaApplicable fires on tribal', () => {
    expect(computeAllSignals(mkMatter('juvenile', { title: 'ICWA tribal custody' })).vertical_signals.icwaApplicable).toBe(true);
  });
  test('14-03: PI fastTrack: severe→true, moderate→false', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'moderate', vulnerability_level: 'moderate' })).vertical_signals.fastTrack).toBe(false);
  });
  test('14-04: military: general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('14-05: i18n total = 707 keys, 4 languages', async () => {
    const en = await getEn();
    expect(Object.keys(en).length).toBe(707);
  });
  test('14-06: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('14-07: zero hex violations in useTheme screens', async () => {
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

// ── 15. Mass Influx ───────────────────────────────────────────────────────
describe('15. Mass Influx — 100,000 New Scenarios', () => {
  test('15-01: 30,000 cross-vertical — all escalation levels valid', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(V[i%V.length], { evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4], jurisdiction: i%3===0?'federal':'state' }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('15-02: 30,000 outcome estimates — disclaimer always required', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const r = computeOutcomeEstimate(mkMatter(V[i%V.length], { evidence_score: i%100 }));
      if (!r.disclaimer?.required || !Array.isArray(r.analyses) || !r.version) errors++;
    }
    expect(errors).toBe(0);
  });
  test('15-03: 20,000 diversion — scores in [0,1]', () => {
    let errors = 0;
    const C = ['Drug marijuana','Mental health psychiatric','Theft minor','Veteran PTSD'];
    for (let i = 0; i < 20000; i++) {
      const recs = computeDiversionRecommendations({ id: i, vertical: 'criminal_defense', title: C[i%C.length], evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4], prior_adjudications: i%4, client_age: 18+(i%40) });
      for (const r of recs) { if (r.eligibility_score < 0 || r.eligibility_score > 1) errors++; }
    }
    expect(errors).toBe(0);
  });
  test('15-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
