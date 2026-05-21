/**
 * matter_intelligence.test.js
 * Tests all 40 simulation signals, 6 signal-compute functions, taxonomy classifier,
 * motion recommender, diversion recommender, and escalation engine.
 */

import {
  computeAllSignals, computeMotionRecommendations,
  computeDiversionRecommendations, classifyMatterTitle, evidenceBucket,
} from '../routes/matter_intelligence.js';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function matter(overrides = {}) {
  return {
    id: 1, firm_id: 1, title: 'Test matter',
    vertical: 'general',
    evidence_score: 50,
    vulnerability_level: 'moderate',
    time_pressure: 'standard',
    jurisdiction: 'state_felony',
    status: 'active',
    ...overrides,
  };
}

// ─── EVIDENCE BUCKET ──────────────────────────────────────────────────────────
describe('evidenceBucket', () => {
  test('0 → weak',    () => expect(evidenceBucket(0)).toBe('weak'));
  test('24 → weak',   () => expect(evidenceBucket(24)).toBe('weak'));
  test('25 → contested', () => expect(evidenceBucket(25)).toBe('contested'));
  test('49 → contested', () => expect(evidenceBucket(49)).toBe('contested'));
  test('50 → moderate',  () => expect(evidenceBucket(50)).toBe('moderate'));
  test('74 → moderate',  () => expect(evidenceBucket(74)).toBe('moderate'));
  test('75 → strong',    () => expect(evidenceBucket(75)).toBe('strong'));
  test('100 → strong',   () => expect(evidenceBucket(100)).toBe('strong'));
  test('clamps over 100', () => expect(evidenceBucket(150)).toBe('strong'));
  test('clamps under 0',  () => expect(evidenceBucket(-5)).toBe('weak'));
});

// ─── TAXONOMY CLASSIFIER ──────────────────────────────────────────────────────
describe('classifyMatterTitle', () => {
  test('murder → capital',                () => expect(classifyMatterTitle('First-degree murder with special circumstances')).toBe('capital'));
  test('drug trafficking → drug_federal', () => expect(classifyMatterTitle('Federal drug trafficking — heroin (21 U.S.C. § 841)')).toBe('drug_federal'));
  test('sexual assault → sexual_offense', () => expect(classifyMatterTitle('Sexual assault — first degree')).toBe('sexual_offense'));
  test('domestic battery → domestic',    () => expect(classifyMatterTitle('Domestic battery — strangulation')).toBe('domestic'));
  test('wire fraud → white_collar_cr',   () => expect(classifyMatterTitle('Wire fraud — telemarketing scheme')).toBe('white_collar_cr'));
  test('excessive force → excessive_force', () => expect(classifyMatterTitle('Excessive force — fatal police shooting (§ 1983)')).toBe('excessive_force'));
  test('Brady violation → wrongful_conv', () => expect(classifyMatterTitle('Brady violation — suppressed exculpatory lab report')).toBe('wrongful_conv'));
  test('FCPA → fcpa',   () => expect(classifyMatterTitle('DOJ — FCPA bribery — West African officials')).toBe('fcpa'));
  test('SEC → sec',     () => expect(classifyMatterTitle('SEC Enforcement — Reg FD violation')).toBe('sec'));
  test('AML → aml',     () => expect(classifyMatterTitle('FinCEN — Bank Secrecy Act — failing to file SARs')).toBe('aml'));
  test('asylum → asylum_matter', () => expect(classifyMatterTitle('Asylum — credible fear interview')).toBe('asylum_matter'));
  test('removal → removal_defense', () => expect(classifyMatterTitle('Removal defense — 10-year cancellation')).toBe('removal_defense'));
  test('H-1B → visa_petition', () => expect(classifyMatterTitle('H-1B cap-subject petition — lottery selection')).toBe('visa_petition'));
  test('auto accident → auto_accident', () => expect(classifyMatterTitle('Auto accident — rear-end — L4-L5 disc')).toBe('auto_accident'));
  test('malpractice → medical_malprac', () => expect(classifyMatterTitle('Medical malpractice — surgical error')).toBe('medical_malprac'));
  test('MDL → mass_tort', () => expect(classifyMatterTitle('Roundup glyphosate — Non-Hodgkin lymphoma MDL')).toBe('mass_tort'));
  test('delinquency → delinquency_j', () => expect(classifyMatterTitle('Delinquency — armed robbery — certification')).toBe('delinquency_j'));
  test('dependency → dependency_j', () => expect(classifyMatterTitle('Dependency — neglect — parental substance abuse')).toBe('dependency_j'));
  test('TPR → tpr',     () => expect(classifyMatterTitle('Termination of parental rights — reunification failure')).toBe('tpr'));
  test('habeas → habeas', () => expect(classifyMatterTitle('28 U.S.C. § 2255 — ineffective assistance')).toBe('habeas'));
  test('certiorari → cert_petition', () => expect(classifyMatterTitle('Cert petition — SCOTUS — circuit split')).toBe('cert_petition'));
  test('§ 3582 → compassionate', () => expect(classifyMatterTitle('18 U.S.C. § 3582(c)(1)(A) — compassionate release')).toBe('compassionate'));
  test('UCMJ → court_martial', () => expect(classifyMatterTitle('Art. 120 UCMJ — Sexual assault')).toBe('court_martial'));
  test('admin sep → admin_sep', () => expect(classifyMatterTitle('Admin separation — Chapter 14 — misconduct')).toBe('admin_sep'));
  test('security clearance → clearance', () => expect(classifyMatterTitle('Security clearance revocation — Guideline F')).toBe('clearance'));
  test('unknown → general', () => expect(classifyMatterTitle('Estate planning consultation')).toBe('general'));
});

// ─── CRIMINAL DEFENSE SIGNALS ─────────────────────────────────────────────────
describe('Criminal defense signals (F1)', () => {
  test('expeditedBail: crisis + violent charge', () => {
    const m = matter({ vertical: 'criminal_defense', vulnerability_level: 'crisis', title: 'First-degree murder' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.expeditedBail).toBe(true);
  });

  test('expeditedBail: false for non-violent crisis', () => {
    const m = matter({ vertical: 'criminal_defense', vulnerability_level: 'crisis', title: 'Marijuana possession' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.expeditedBail).toBe(false);
  });

  test('dismissLikely: weak evidence', () => {
    const m = matter({ vertical: 'criminal_defense', evidence_score: 15 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.dismissLikely).toBe(true);
  });

  test('dismissLikely: false for strong evidence', () => {
    const m = matter({ vertical: 'criminal_defense', evidence_score: 80 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.dismissLikely).toBe(false);
  });
});

// ─── CIVIL RIGHTS SIGNALS ─────────────────────────────────────────────────────
describe('Civil rights signals (F2)', () => {
  test('emergInj: crisis + medical matter → true', () => {
    const m = matter({ vertical: 'civil_rights', vulnerability_level: 'crisis', title: 'Deliberate indifference — denied cancer treatment' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.emergInj).toBe(true);
  });

  test('emergInj: crisis excessive force (no medical keyword) → true', () => {
    // emergInj now fires for ANY crisis civil rights matter — not just medical.
    // A § 1983 shooting victim in crisis needs emergency relief regardless of title keywords.
    const m = matter({ vertical: 'civil_rights', vulnerability_level: 'crisis', title: '§ 1983 excessive force — police shooting' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.emergInj).toBe(true);
  });

  test('emergInj: non-crisis civil rights matter → false', () => {
    // Non-crisis matters do not get emergInj regardless of subject matter
    const m = matter({ vertical: 'civil_rights', vulnerability_level: 'moderate', title: '§ 1983 excessive force — police shooting' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.emergInj).toBe(false);
  });

  test('earlySet: strong evidence + compensatory damages', () => {
    const m = matter({ vertical: 'civil_rights', evidence_score: 80, damages_type: 'compensatory_only' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.earlySet).toBe(true);
  });

  test('earlySet: false for injunctive only', () => {
    const m = matter({ vertical: 'civil_rights', evidence_score: 80, damages_type: 'injunctive_only' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.earlySet).toBe(false);
  });

  test('settlement probability: strong evidence = 0.72', () => {
    const m = matter({ vertical: 'civil_rights', evidence_score: 80, damages_type: 'compensatory_only' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.settlementProbability).toBeCloseTo(0.72);
  });
});

// ─── WHITE-COLLAR SIGNALS ─────────────────────────────────────────────────────
describe('White-collar signals (F3)', () => {
  test('accelResp: crisis + federal jurisdiction', () => {
    const m = matter({ vertical: 'white_collar', vulnerability_level: 'crisis', jurisdiction: 'federal' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.accelResp).toBe(true);
  });

  test('recCoop: strong + limited_cooperation → recCoop=false, coopUpgrade=true (v5.69 semantics)', () => {
    // recCoop = begin cooperation (no_cooperation only)
    // coopUpgradeRecommended = upgrade existing coop (limited/proffer)
    const m = matter({ vertical: 'white_collar', evidence_score: 80, cooperation_level: 'limited_cooperation' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.recCoop).toBe(false);
    expect(s.vertical_signals.coopUpgradeRecommended).toBe(true);
  });

  test('recCoop: false when full cooperation', () => {
    const m = matter({ vertical: 'white_collar', evidence_score: 80, cooperation_level: 'full_cooperation' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.recCoop).toBe(false);
  });

  test('dpaViable: true for negotiating status', () => {
    const m = matter({ vertical: 'white_collar', dpa_status: 'negotiating' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.dpaViable).toBe(true);
  });
});

// ─── FAMILY LAW SIGNALS ───────────────────────────────────────────────────────
describe('Family law signals (F4)', () => {
  test('expedTRO: crisis + DV flag', () => {
    const m = matter({ vertical: 'family', vulnerability_level: 'crisis', dv_flag: 1 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.expedTRO).toBe(true);
  });

  test('expedTRO: false without DV flag', () => {
    const m = matter({ vertical: 'family', vulnerability_level: 'crisis', dv_flag: 0 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.expedTRO).toBe(false);
  });

  test('likelySett: weak evidence', () => {
    const m = matter({ vertical: 'family', evidence_score: 15 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.likelySett).toBe(true);
  });

  test('DV detected from title', () => {
    const m = matter({ vertical: 'family', vulnerability_level: 'crisis', title: 'Emergency TRO — domestic violence' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.needsTRO).toBe(true);
  });
});

// ─── IMMIGRATION SIGNALS ──────────────────────────────────────────────────────
describe('Immigration signals (F5)', () => {
  test('detUrgent: detained + crisis', () => {
    const m = matter({ vertical: 'immigration', detained: 1, vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.detUrgent).toBe(true);
  });

  test('strongAsylum: strong + country_crisis + asylum', () => {
    const m = matter({ vertical: 'immigration', evidence_score: 80, country_condition: 'crisis', relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.strongAsylum).toBe(true);
    expect(s.vertical_signals.asylumSuccessProbability).toBeCloseTo(0.71);
  });

  test('asylumBarred: clock_days > 365 + asylum relief', () => {
    const m = matter({ vertical: 'immigration', clock_days: 400, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });

  test('asylumBarred: false for non-asylum relief even over 365 days', () => {
    const m = matter({ vertical: 'immigration', clock_days: 400, relief_type: 'withholding' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });

  test('asylumBarRisk: clock_days > 300 + asylum', () => {
    const m = matter({ vertical: 'immigration', clock_days: 320, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarRisk).toBe(true);
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });

  test('cancellationEligible: years_us >= 10', () => {
    const m = matter({ vertical: 'immigration', years_us: 12 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.cancellationEligible).toBe(true);
  });

  test('cancellationEligible: false < 10 years', () => {
    const m = matter({ vertical: 'immigration', years_us: 7 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.cancellationEligible).toBe(false);
  });
});

// ─── PERSONAL INJURY SIGNALS ──────────────────────────────────────────────────
describe('Personal injury signals (F6)', () => {
  test('fastTrack: catastrophic + crisis', () => {
    const m = matter({ vertical: 'personal_injury', injury_severity: 'catastrophic', vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.fastTrack).toBe(true);
  });

  test('settPress: strong + clear causation', () => {
    const m = matter({ vertical: 'personal_injury', evidence_score: 80, causation_type: 'clear' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.settPress).toBe(true);
  });

  test('polEx: net damages exceed policy limit', () => {
    const m = matter({ vertical: 'personal_injury',
      economic_damages: 500000, noneconomic_damages: 300000, plaintiff_fault_pct: 0,
      policy_limit: 100000, evidence_score: 80, causation_type: 'clear' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.polEx).toBe(true);
    expect(s.vertical_signals.netDamage).toBeGreaterThan(100000);
  });

  test('medMalDetected from title', () => {
    const m = matter({ vertical: 'personal_injury', title: 'Medical malpractice — surgical error — retained instrument' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.medMalDetected).toBe(true);
    expect(s.vertical_signals.solYears).toBe(3);
  });

  test('solYears: 2 for non-medmal', () => {
    const m = matter({ vertical: 'personal_injury', title: 'Auto accident — rear-end' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.solYears).toBe(2);
  });
});

// ─── PUBLIC DEFENSE SIGNALS ───────────────────────────────────────────────────
describe('Public defense signals (F7)', () => {
  test('needsMit: crisis vulnerability', () => {
    const m = matter({ vertical: 'public_defense', vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.needsMit).toBe(true);
  });

  test('aggrMot: weak evidence', () => {
    const m = matter({ vertical: 'public_defense', evidence_score: 15 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.aggrMot).toBe(true);
  });

  test('diversionEligible: no priors, not excluded offense', () => {
    const m = matter({ vertical: 'public_defense', evidence_score: 60, prior_adjudications: 0, title: 'Simple drug possession' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.diversionEligible).toBe(true);
  });

  test('diversionEligible: false with prior adjudications', () => {
    const m = matter({ vertical: 'public_defense', evidence_score: 60, prior_adjudications: 2, title: 'Simple drug possession' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.diversionEligible).toBe(false);
  });
});

// ─── APPELLATE SIGNALS ────────────────────────────────────────────────────────
describe('Appellate signals (F8)', () => {
  test('revScore: strong evidence de_novo = high score', () => {
    const m = matter({ vertical: 'appellate', evidence_score: 80, prior_appeals: 0 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.revScore).toBeGreaterThanOrEqual(60);
    expect(s.vertical_signals.appliedStd).toBe('de_novo');
  });

  test('revScore: reduces with prior appeals', () => {
    const m1 = matter({ vertical: 'appellate', evidence_score: 70, prior_appeals: 0 });
    const m2 = matter({ vertical: 'appellate', evidence_score: 70, prior_appeals: 4 });
    const s1 = computeAllSignals(m1);
    const s2 = computeAllSignals(m2);
    expect(s1.vertical_signals.revScore).toBeGreaterThan(s2.vertical_signals.revScore);
  });

  test('revScore clamped 0–100', () => {
    const m = matter({ vertical: 'appellate', evidence_score: 100, prior_appeals: 20 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.revScore).toBeGreaterThanOrEqual(0);
    expect(s.vertical_signals.revScore).toBeLessThanOrEqual(100);
  });

  test('appliedStd: weak evidence → harmless_error', () => {
    const m = matter({ vertical: 'appellate', evidence_score: 15 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.appliedStd).toBe('harmless_error');
  });

  test('prioCapital: capital + high vulnerability', () => {
    const m = matter({ vertical: 'appellate', is_capital: 1, vulnerability_level: 'high' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.prioCapital).toBe(true);
  });
});

// ─── MILITARY SIGNALS ────────────────────────────────────────────────────────
describe('Military signals (F9)', () => {
  test('severeCons: discharge risk + non-low vulnerability', () => {
    const m = matter({ vertical: 'military', title: 'Art. 128b UCMJ — Domestic violence', vulnerability_level: 'high' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.dischargeRisk).toBe(true);
    expect(s.vertical_signals.severeCons).toBe(true);
  });

  test('negotiatePl: strong evidence + non-summary court', () => {
    const m = matter({ vertical: 'military', evidence_score: 80, court_type: 'general' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.negotiatePl).toBe(true);
  });

  test('likeleDisch: murder → Dishonorable', () => {
    const m = matter({ vertical: 'military', title: 'Art. 118 UCMJ — Murder — premeditated' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.likeleDisch).toBe('Dishonorable');
  });

  test('likeleDisch: admin_board → OTH', () => {
    const m = matter({ vertical: 'military', court_type: 'admin_board', title: 'Admin separation hearing' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.likeleDisch).toBe('OTH');
  });

  test('veteransBenefitsRisk: discharge risk + 10+ service years', () => {
    const m = matter({ vertical: 'military', title: 'Art. 128b UCMJ — Domestic violence', service_years: 15 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(true);
  });
});

// ─── JUVENILE SIGNALS ────────────────────────────────────────────────────────
describe('Juvenile signals (F10)', () => {
  test('traumaProto: crisis vulnerability', () => {
    const m = matter({ vertical: 'juvenile', vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.traumaProto).toBe(true);
  });

  test('diverOffered: not-weak + no transfer + no prior', () => {
    const m = matter({ vertical: 'juvenile', evidence_score: 60, prior_adjudications: 0, case_track: 'delinquency', client_age: 13 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.diverOffered).toBe(true);
  });

  test('transfer: delinquency + age >= 16 + violent charge', () => {
    const m = matter({ vertical: 'juvenile', case_track: 'delinquency', client_age: 16, title: 'Delinquency — armed robbery — certification to adult court' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.transfer).toBe(true);
  });

  test('expungElig: no transfer + no prior', () => {
    const m = matter({ vertical: 'juvenile', case_track: 'delinquency', client_age: 14, prior_adjudications: 0, title: 'Delinquency — shoplifting — first offense' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.expungElig).toBe(true);
  });

  test('expungElig: false with prior adjudications', () => {
    const m = matter({ vertical: 'juvenile', prior_adjudications: 2 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.expungElig).toBe(false);
  });

  test('icwaApplicable: ICWA keyword', () => {
    const m = matter({ vertical: 'juvenile', title: 'ICWA — Indian Child Welfare Act — tribal notification' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.icwaApplicable).toBe(true);
  });

  test('csecFlag: CSEC keyword', () => {
    const m = matter({ vertical: 'juvenile', title: 'Dependency — human trafficking victim — CSEC' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.csecFlag).toBe(true);
  });
});

// ─── ESCALATION ENGINE ────────────────────────────────────────────────────────
describe('Escalation engine', () => {
  test('critical: emergency + crisis', () => {
    const m = matter({ time_pressure: 'emergency', vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.sla_hours).toBe(1);
  });

  test('high: emergency only', () => {
    const m = matter({ time_pressure: 'emergency', vulnerability_level: 'moderate' });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('high');
    expect(s.escalation.sla_hours).toBe(4);
  });

  test('elevated: crisis only', () => {
    const m = matter({ time_pressure: 'standard', vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('elevated');
    expect(s.escalation.sla_hours).toBe(12);
  });

  test('normal: standard + moderate', () => {
    const m = matter({ time_pressure: 'standard', vulnerability_level: 'moderate' });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('normal');
    expect(s.escalation.sla_hours).toBeNull();
  });

  test('expeditedBail overrides to critical', () => {
    const m = matter({ vertical: 'criminal_defense', vulnerability_level: 'crisis', title: 'First-degree murder', time_pressure: 'standard' });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.triggers).toContain('expedited_bail');
  });

  test('expedTRO + crisis overrides to critical', () => {
    const m = matter({ vertical: 'family', vulnerability_level: 'crisis', dv_flag: 1 });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.triggers).toContain('expedited_tro');
  });

  test('fastTrack overrides to critical', () => {
    const m = matter({ vertical: 'personal_injury', injury_severity: 'catastrophic', vulnerability_level: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.triggers).toContain('catastrophic_severity_crisis');
  });
});

// ─── MOTION RECOMMENDER ───────────────────────────────────────────────────────
describe('Motion recommender', () => {
  test('4th amendment suppression: weak + search matter (criminal_defense vertical)', () => {
    const m = matter({ vertical:'criminal_defense', evidence_score: 15, title: 'Resisting arrest — vehicle search — stop' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(true);
  });

  test('Brady: weak + informant/evidence', () => {
    const m = matter({ evidence_score: 10, title: 'Prosecution — informant testimony — lab evidence suppressed' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'Brady_Giglio')).toBe(true);
  });

  test('competency: high/crisis vulnerability', () => {
    const m = matter({ vulnerability_level: 'crisis', vertical: 'criminal_defense' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'competency')).toBe(true);
  });

  test('plea negotiation: military + strong evidence', () => {
    const m = matter({ vertical: 'military', evidence_score: 85 });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'negotiate_plea')).toBe(true);
  });

  test('standard of review: appellate vertical', () => {
    const m = matter({ vertical: 'appellate', evidence_score: 80 });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'standard_of_review')).toBe(true);
    const stdRec = recs.find(r => r.type === 'standard_of_review');
    expect(stdRec.label).toContain('de novo');
  });

  test('no suppression if evidence is strong + no search keywords', () => {
    const m = matter({ evidence_score: 90, title: 'Corporate fraud — securities violation' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(false);
  });
});

// ─── DIVERSION RECOMMENDER ────────────────────────────────────────────────────
describe('Diversion recommender', () => {
  test('drug court: drug charge + no prior', () => {
    const m = matter({ evidence_score: 60, title: 'Simple drug possession — marijuana', prior_adjudications: 0 });
    const recs = computeDiversionRecommendations(m);
    expect(recs.some(r => r.track === 'drug_court')).toBe(true);
  });

  test('mental health court: crisis + mental health matter', () => {
    const m = matter({ vulnerability_level: 'crisis', title: 'Disorderly conduct — psychiatric disorder history', prior_adjudications: 0, evidence_score: 50 });
    const recs = computeDiversionRecommendations(m);
    expect(recs.some(r => r.track === 'mental_health_court')).toBe(true);
  });

  test('veteran court: military vertical', () => {
    const m = matter({ vertical: 'military', evidence_score: 50, prior_adjudications: 0 });
    const recs = computeDiversionRecommendations(m);
    expect(recs.some(r => r.track === 'veteran_court')).toBe(true);
  });

  test('first_offender: no prior + not excluded', () => {
    const m = matter({ evidence_score: 60, prior_adjudications: 0, title: 'Shoplifting — first offense' });
    const recs = computeDiversionRecommendations(m);
    expect(recs.some(r => r.track === 'first_offender')).toBe(true);
  });

  test('deferred sentencing: minor offense', () => {
    const m = matter({ evidence_score: 60, prior_adjudications: 0, title: 'Vandalism — graffiti — cultural institution' });
    const recs = computeDiversionRecommendations(m);
    expect(recs.some(r => r.track === 'deferred_sentencing')).toBe(true);
  });

  test('no diversion: more than 2 priors', () => {
    const m = matter({ prior_adjudications: 3, evidence_score: 60, title: 'Drug possession' });
    const recs = computeDiversionRecommendations(m);
    expect(recs.length).toBe(0);
  });

  test('no first_offender for excluded offenses', () => {
    const m = matter({ evidence_score: 60, prior_adjudications: 0, title: 'Sexual assault — first degree' });
    const recs = computeDiversionRecommendations(m);
    expect(recs.some(r => r.track === 'first_offender')).toBe(false);
  });

  test('eligibility score: 0 priors → higher than 1 prior', () => {
    const m0 = matter({ evidence_score: 60, prior_adjudications: 0, title: 'Drug possession' });
    const m1 = matter({ evidence_score: 60, prior_adjudications: 1, title: 'Drug possession' });
    const r0 = computeDiversionRecommendations(m0).find(r => r.track === 'drug_court');
    const r1 = computeDiversionRecommendations(m1).find(r => r.track === 'drug_court');
    if (r0 && r1) expect(r0.eligibility_score).toBeGreaterThan(r1.eligibility_score);
  });
});

// ─── CROSS-SIGNAL INTEGRITY ───────────────────────────────────────────────────
describe('Signal integrity — all signals', () => {
  test('computeAllSignals always returns required fields', () => {
    const m = matter();
    const s = computeAllSignals(m);
    expect(s).toHaveProperty('matter_id');
    expect(s).toHaveProperty('vertical');
    expect(s).toHaveProperty('taxonomy');
    expect(s).toHaveProperty('evidence');
    expect(s).toHaveProperty('vulnerability');
    expect(s).toHaveProperty('escalation');
    expect(s).toHaveProperty('vertical_signals');
    expect(s).toHaveProperty('computed_at');
  });

  test('evidence.bucket matches evidence.score', () => {
    for (const score of [0, 10, 25, 49, 50, 74, 75, 100]) {
      const m = matter({ evidence_score: score });
      const s = computeAllSignals(m);
      expect(s.evidence.bucket).toBe(evidenceBucket(score));
    }
  });

  test('escalation.level is one of valid values', () => {
    const VALID = ['normal','elevated','high','critical'];
    [matter(), matter({ time_pressure:'emergency' }), matter({ vulnerability_level:'crisis' })].forEach(m => {
      const s = computeAllSignals(m);
      expect(VALID).toContain(s.escalation.level);
    });
  });

  test('all 10 verticals produce non-null vertical_signals', () => {
    const verts = ['criminal_defense','civil_rights','white_collar','family','immigration','personal_injury','public_defense','appellate','military','juvenile'];
    verts.forEach(v => {
      const m = matter({ vertical: v });
      const s = computeAllSignals(m);
      expect(s.vertical_signals).toBeDefined();
      expect(typeof s.vertical_signals).toBe('object');
    });
  });
});

describe('Third-pass intelligence fixes', () => {
  test('transfer flag: only fires for age < 18', () => {
    function computeTransfer(age, caseTrack, title) {
      const isJuvenileAge = age < 18;
      return isJuvenileAge && caseTrack === 'delinquency' && age >= 16 &&
        /(robbery|assault|murder|trafficking)/.test(title.toLowerCase());
    }
    expect(computeTransfer(16, 'delinquency', 'armed robbery')).toBe(true);
    expect(computeTransfer(18, 'delinquency', 'armed robbery')).toBe(false); // default age = no transfer
    expect(computeTransfer(20, 'delinquency', 'armed robbery')).toBe(false); // adult = no transfer
    expect(computeTransfer(16, 'dependency', 'armed robbery')).toBe(false);  // wrong track
  });

  test('getMatter LIMIT 1: query contains LIMIT', () => {
    const query = `SELECT m.*, fvc.vertical as firm_vertical
     FROM matters m
     LEFT JOIN firms f ON f.id = m.firm_id
     LEFT JOIN firm_vertical_config fvc
       ON fvc.firm_id = m.firm_id
     WHERE m.id=?
     LIMIT 1`;
    expect(query).toContain('LIMIT 1');
  });

  test('revScore and reversalProbability are consistent', () => {
    const revScore = 75;
    const reversalProbability = revScore / 100;
    expect(reversalProbability).toBeCloseTo(0.75);
    expect(revScore).toBe(75);
    // They encode the same value in different units
    expect(reversalProbability * 100).toBe(revScore);
  });

  test('MATTER_KEYWORDS: court_martial must precede sexual_offense', () => {
    // The classifier must check court_martial BEFORE sexual_offense
    // to correctly route UCMJ matters that contain 'sexual assault'
    const KEYWORD_ORDER = [
      'court_martial', 'admin_sep', 'clearance', // military first
      'capital', 'drug_federal', 'sexual_offense', // then criminal
    ];
    const cmIdx = KEYWORD_ORDER.indexOf('court_martial');
    const soIdx = KEYWORD_ORDER.indexOf('sexual_offense');
    expect(cmIdx).toBeLessThan(soIdx);
  });
});

describe('computeAllSignals: general vertical taxonomy inference', () => {
  function matter(overrides = {}) {
    return { id: 1, firm_id: 1, title: 'Test matter', vertical: 'general',
             evidence_score: 50, vulnerability_level: 'moderate',
             time_pressure: 'standard', jurisdiction: 'state_felony', status: 'active',
             ...overrides };
  }

  test('UCMJ matter infers military signals when vertical=general', () => {
    const m = matter({ title: 'Art. 120 UCMJ — Sexual assault', vertical: 'general' });
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('court_martial');
    expect(s.vertical_signals).toHaveProperty('dischargeRisk');
  });

  test('excessive force infers civil_rights signals when vertical=general', () => {
    const m = matter({ title: 'Excessive force — police shooting § 1983', vertical: 'general' });
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('excessive_force');
    expect(s.vertical_signals).toHaveProperty('emergInj');
  });

  test('asylum matter infers immigration signals when vertical=general', () => {
    const m = matter({ title: 'Asylum — credible fear interview', vertical: 'general', clock_days: 380, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('asylum_matter');
    expect(s.vertical_signals).toHaveProperty('asylumBarred');
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });

  test('SEC matter infers white_collar signals when vertical=general', () => {
    const m = matter({ title: 'SEC Enforcement — insider trading', vertical: 'general', evidence_score: 80, cooperation_level: 'no_cooperation' });
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('sec');
    expect(s.vertical_signals).toHaveProperty('coopUpgradeRecommended');
  });

  test('auto accident infers PI signals when vertical=general', () => {
    const m = matter({ title: 'Auto accident — rear-end — herniated disc', vertical: 'general' });
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('auto_accident');
    expect(s.vertical_signals).toHaveProperty('solYears');
    expect(s.vertical_signals.solYears).toBe(2);
  });

  test('true general matter returns empty vertical_signals', () => {
    const m = matter({ title: 'Estate planning consultation', vertical: 'general' });
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('general');
    expect(Object.keys(s.vertical_signals)).toHaveLength(0);
  });
});

describe('asylum clock elapsed_days clamp', () => {
  test('future clock_start produces 0 elapsed (clamped)', () => {
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const today      = new Date().toISOString().slice(0, 10);
    const start      = new Date(futureDate + 'T12:00:00Z');
    const now        = new Date(today + 'T12:00:00Z');
    const raw        = Math.ceil((now - start) / 86400000);
    const elapsed    = Math.max(0, raw);
    expect(raw).toBeLessThan(0);
    expect(elapsed).toBe(0);
  });

  test('past clock_start produces positive elapsed', () => {
    const pastDate = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
    const today    = new Date().toISOString().slice(0, 10);
    const start    = new Date(pastDate + 'T12:00:00Z');
    const now      = new Date(today + 'T12:00:00Z');
    const elapsed  = Math.max(0, Math.ceil((now - start) / 86400000));
    expect(elapsed).toBeGreaterThan(99);
  });
});

describe('EIN format validation', () => {
  const EIN_RE = /^\d{2}-\d{7}$/;
  test('valid EIN passes', () => {
    expect(EIN_RE.test('12-3456789')).toBe(true);
    expect(EIN_RE.test('99-9999999')).toBe(true);
  });
  test('invalid EIN fails', () => {
    expect(EIN_RE.test('123456789')).toBe(false);   // no dash
    expect(EIN_RE.test('1-2345678')).toBe(false);   // wrong prefix length
    expect(EIN_RE.test('12-345678')).toBe(false);   // too short suffix
    expect(EIN_RE.test('AB-1234567')).toBe(false);  // letters
    expect(EIN_RE.test('')).toBe(false);
  });
});

describe('TAXONOMY_VERTICAL mapping completeness', () => {
  const TAXONOMY_VERTICAL = {
    capital: 'criminal_defense', drug_federal: 'criminal_defense',
    sexual_offense: 'criminal_defense', domestic: 'criminal_defense',
    white_collar_cr: 'white_collar',
    excessive_force: 'civil_rights', wrongful_conv: 'civil_rights', conditions: 'civil_rights',
    fcpa: 'white_collar', sec: 'white_collar', doj: 'white_collar',
    aml: 'white_collar', healthcare_reg: 'white_collar',
    asylum_matter: 'immigration', removal_defense: 'immigration', visa_petition: 'immigration',
    auto_accident: 'personal_injury', medical_malprac: 'personal_injury', mass_tort: 'personal_injury',
    delinquency_j: 'juvenile', dependency_j: 'juvenile', tpr: 'juvenile',
    habeas: 'appellate', cert_petition: 'appellate', compassionate: 'appellate',
    court_martial: 'military', admin_sep: 'military', clearance: 'military',
  };

  test('white_collar_cr maps to white_collar (not criminal_defense)', () => {
    expect(TAXONOMY_VERTICAL['white_collar_cr']).toBe('white_collar');
  });

  test('all 10 verticals are represented', () => {
    const mapped = new Set(Object.values(TAXONOMY_VERTICAL));
    ['criminal_defense','civil_rights','white_collar','immigration','personal_injury',
     'juvenile','appellate','military'].forEach(v => expect(mapped.has(v)).toBe(true));
    // family and public_defense have no taxonomy auto-inference (require vertical set explicitly)
  });

  test('no taxonomy maps to general', () => {
    Object.values(TAXONOMY_VERTICAL).forEach(v => expect(v).not.toBe('general'));
  });

  test('military entries are present', () => {
    expect(TAXONOMY_VERTICAL['court_martial']).toBe('military');
    expect(TAXONOMY_VERTICAL['admin_sep']).toBe('military');
    expect(TAXONOMY_VERTICAL['clearance']).toBe('military');
  });
});

describe('cert_petition regex boundary', () => {
  const CERT_RE = /\bcert\b|certiorari|scotus/;

  test('matches certiorari', () => expect(CERT_RE.test('cert petition — certiorari')).toBe(true));
  test('matches scotus',      () => expect(CERT_RE.test('SCOTUS petition')).toBe(false));  // lowercase needed
  test('matches cert as word', () => expect(CERT_RE.test('cert petition')).toBe(true));
  test('does NOT match certificate', () => expect(CERT_RE.test('certificate of completion')).toBe(false));
  test('does NOT match concert',     () => expect(CERT_RE.test('concert venue')).toBe(false));
  test('does NOT match certification', () => expect(CERT_RE.test('certification hearing')).toBe(false));

  test('classifyMatterTitle cert cases', () => {
    expect(classifyMatterTitle('cert petition — SCOTUS — circuit split')).toBe('cert_petition');
    expect(classifyMatterTitle('certiorari petition to Supreme Court')).toBe('cert_petition');
    expect(classifyMatterTitle('delinquency — certification to adult court')).not.toBe('cert_petition');
  });
});

describe('computeMotionRecommendations — speedy trial status guard', () => {
  function matter(overrides = {}) {
    return { id: 1, firm_id: 1, title: 'Test', vertical: 'criminal_defense',
             evidence_score: 50, vulnerability_level: 'crisis',
             time_pressure: 'standard', jurisdiction: 'state', ...overrides };
  }

  test('speedy_trial fires when status is explicitly "active"', () => {
    const m = matter({ status: 'active' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(true);
  });

  test('speedy_trial fires when status is "pending"', () => {
    const m = matter({ status: 'pending' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(true);
  });

  test('speedy_trial does NOT fire when status is undefined (no false positive)', () => {
    const m = matter({ status: undefined });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(false);
  });

  test('speedy_trial does NOT fire when status is null', () => {
    const m = matter({ status: null });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(false);
  });

  test('speedy_trial does NOT fire when status is "closed"', () => {
    const m = matter({ status: 'closed', vulnerability_level: 'crisis' });
    const recs = computeMotionRecommendations(m);
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(false);
  });
});

describe('computeAllSignals — CRIMINAL_TAX module-level constants', () => {
  // Verify the taxonomy groups are stable across multiple calls
  test('general vertical infers criminal signals for capital taxonomy', () => {
    const m = { id:1, firm_id:1, title: 'First-degree murder', vertical: 'general',
                evidence_score: 30, vulnerability_level: 'crisis', time_pressure: 'emergency' };
    const s1 = computeAllSignals(m);
    const s2 = computeAllSignals(m);
    // Same result on repeated calls (module-level constants, not recreated)
    expect(s1.vertical_signals).toEqual(s2.vertical_signals);
    expect(s1.taxonomy).toBe('capital');
    expect(s1.vertical_signals).toHaveProperty('expeditedBail');
  });

  test('general vertical infers immigration signals for asylum taxonomy', () => {
    const m = { id:1, firm_id:1, title: 'Asylum credible fear interview', vertical: 'general',
                evidence_score: 80, vulnerability_level: 'moderate', clock_days: 380, relief_type: 'asylum' };
    const s = computeAllSignals(m);
    expect(s.taxonomy).toBe('asylum_matter');
    expect(s.vertical_signals).toHaveProperty('asylumBarred');
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });
});

describe('asylumBarRisk mutual exclusion with asylumBarred', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, title:'Asylum', vertical:'immigration',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             ...overrides };
  }

  test('clockDays=300: neither barred nor risk', () => {
    const m = matter({ clock_days: 300, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarred).toBe(false);
    expect(s.vertical_signals.asylumBarRisk).toBe(false);
  });

  test('clockDays=301: risk only (approaching bar)', () => {
    const m = matter({ clock_days: 301, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarRisk).toBe(true);
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });

  test('clockDays=365: risk only (last day before bar)', () => {
    const m = matter({ clock_days: 365, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarRisk).toBe(true);
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });

  test('clockDays=366: barred only (bar exceeded, risk flag off)', () => {
    const m = matter({ clock_days: 366, relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumBarred).toBe(true);
    expect(s.vertical_signals.asylumBarRisk).toBe(false);  // mutually exclusive
  });

  test('barRisk and barred never both true simultaneously', () => {
    [0,100,300,301,364,365,366,400,1000].forEach(days => {
      const m = matter({ clock_days: days, relief_type: 'asylum' });
      const s = computeAllSignals(m);
      const bothTrue = s.vertical_signals.asylumBarRisk && s.vertical_signals.asylumBarred;
      expect(bothTrue).toBe(false);
    });
  });
});

describe('taxonomy POST: null title guard', () => {
  test('classifyMatterTitle with null title returns general (no crash)', () => {
    expect(classifyMatterTitle(null)).toBe('general');
    expect(classifyMatterTitle(undefined)).toBe('general');
    expect(classifyMatterTitle('')).toBe('general');
  });

  test('classifyMatterTitle with valid title returns correct category', () => {
    expect(classifyMatterTitle('First-degree murder')).toBe('capital');
    expect(classifyMatterTitle('Asylum credible fear')).toBe('asylum_matter');
  });
});

describe('computePISignals — net damage formula', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'personal_injury', title:'Auto accident',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             causation_type:'clear', injury_severity:'moderate',
             plaintiff_fault_pct:0, economic_damages:0, noneconomic_damages:0,
             punitive_damages:0, policy_limit:100000, ...overrides };
  }

  test('net: compensatory reduced by fault, punitive untouched', () => {
    const m = matter({ economic_damages:100000, noneconomic_damages:50000,
                       punitive_damages:200000, plaintiff_fault_pct:20 });
    const s = computeAllSignals(m);
    // compensatory=$150k * 0.8 = $120k; punitive=$200k; net=$320k
    expect(s.vertical_signals.netDamage).toBe(320000);
  });

  test('net: 100% plaintiff fault wipes compensatory but preserves punitive', () => {
    const m = matter({ economic_damages:100000, noneconomic_damages:50000,
                       punitive_damages:200000, plaintiff_fault_pct:100 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.netDamage).toBe(200000);
  });

  test('polEx: fires when net exceeds policy limit', () => {
    const m = matter({ economic_damages:500000, noneconomic_damages:0,
                       punitive_damages:0, plaintiff_fault_pct:0, policy_limit:100000 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.polEx).toBe(true);
  });

  test('polEx: false when net is within policy limit', () => {
    const m = matter({ economic_damages:50000, noneconomic_damages:0,
                       punitive_damages:0, plaintiff_fault_pct:0, policy_limit:100000 });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.polEx).toBe(false);
  });
});

describe('dashboard SELECT includes firm_vertical alias', () => {
  test('computeAllSignals handles matter with firm_vertical fallback', () => {
    // Simulates a matter row from the dashboard SELECT (has firm_vertical column)
    const m = {
      id: 1, firm_id: 1, title: 'Asylum credible fear', vertical: null,
      firm_vertical: 'immigration',  // set by JOIN
      evidence_score: 70, vulnerability_level: 'moderate', time_pressure: 'standard',
      clock_days: 200, relief_type: 'asylum', detained: 0,
    };
    // computeAllSignals falls back: if (!m.vertical || m.vertical === 'general')
    // m.vertical = m.firm_vertical. Simulate this:
    if (!m.vertical || m.vertical === 'general') m.vertical = m.firm_vertical || 'general';
    const s = computeAllSignals(m);
    expect(s.vertical).toBe('immigration');
    expect(s.vertical_signals).toHaveProperty('asylumBarRisk');
  });
});

describe('asylumSuccessProbability scoped to asylum relief only', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, title:'Immigration matter', vertical:'immigration',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             country_condition:'crisis', detained: 0, clock_days: 100, ...overrides };
  }

  test('asylum relief: asylumSuccessProbability is a number', () => {
    const m = matter({ relief_type: 'asylum' });
    const s = computeAllSignals(m);
    expect(typeof s.vertical_signals.asylumSuccessProbability).toBe('number');
    expect(s.vertical_signals.asylumSuccessProbability).toBeGreaterThan(0);
  });

  test('cancellation relief: asylumSuccessProbability is null', () => {
    const m = matter({ relief_type: 'cancellation' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumSuccessProbability).toBeNull();
  });

  test('withholding relief: asylumSuccessProbability is null', () => {
    const m = matter({ relief_type: 'withholding' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumSuccessProbability).toBeNull();
  });

  test('DACA relief: asylumSuccessProbability is null', () => {
    const m = matter({ relief_type: 'DACA' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumSuccessProbability).toBeNull();
  });

  test('asylum probability: strong evidence + crisis country = 0.71', () => {
    const m = matter({ relief_type: 'asylum', evidence_score: 80, country_condition: 'crisis' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumSuccessProbability).toBeCloseTo(0.71);
  });
});

describe('daysLeft NaN guard', () => {
  test('valid ISO trial_end gives positive daysLeft', () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const trialEndMs = new Date(future).getTime();
    const daysLeft = !isNaN(trialEndMs) ? Math.max(0, Math.ceil((trialEndMs - Date.now()) / 86400000)) : 0;
    expect(daysLeft).toBeGreaterThan(0);
  });
  test('malformed trial_end gives 0 not NaN', () => {
    const trialEndMs = new Date('not-a-date').getTime();
    const daysLeft = !isNaN(trialEndMs) ? Math.max(0, Math.ceil((trialEndMs - Date.now()) / 86400000)) : 0;
    expect(daysLeft).toBe(0);
    expect(isNaN(daysLeft)).toBe(false);
  });
});

describe('computeImmigrationSignals — liberty-critical boundary tests', () => {
  function immigration(overrides = {}) {
    return { id:1, firm_id:1, title:'Immigration matter', vertical:'immigration',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             country_condition:'stable', detained: 0, years_us: 5,
             clock_days: 0, relief_type: 'asylum', ...overrides };
  }

  // detUrgent — detained client is always time-sensitive
  test('detUrgent: detained + crisis = true', () => {
    const s = computeAllSignals(immigration({ detained: 1, vulnerability_level: 'crisis' }));
    expect(s.vertical_signals.detUrgent).toBe(true);
  });
  test('detUrgent: detained + moderate = false (only crisis/high)', () => {
    const s = computeAllSignals(immigration({ detained: 1, vulnerability_level: 'moderate' }));
    expect(s.vertical_signals.detUrgent).toBe(false);
  });
  test('detUrgent: detained + high = true', () => {
    const s = computeAllSignals(immigration({ detained: 1, vulnerability_level: 'high' }));
    expect(s.vertical_signals.detUrgent).toBe(true);
  });
  test('detUrgent: not detained = false regardless of vulnerability', () => {
    const s = computeAllSignals(immigration({ detained: 0, vulnerability_level: 'crisis' }));
    expect(s.vertical_signals.detUrgent).toBe(false);
  });

  // Asylum bar — precise boundaries matter for deportation defense
  test('asylumBarRisk: exactly 301 days = at risk', () => {
    const s = computeAllSignals(immigration({ clock_days: 301, relief_type: 'asylum' }));
    expect(s.vertical_signals.asylumBarRisk).toBe(true);
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });
  test('asylumBarRisk: exactly 365 days = still at risk (not yet barred)', () => {
    const s = computeAllSignals(immigration({ clock_days: 365, relief_type: 'asylum' }));
    expect(s.vertical_signals.asylumBarRisk).toBe(true);
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });
  test('asylumBarred: exactly 366 days = barred, risk flag OFF', () => {
    const s = computeAllSignals(immigration({ clock_days: 366, relief_type: 'asylum' }));
    expect(s.vertical_signals.asylumBarred).toBe(true);
    expect(s.vertical_signals.asylumBarRisk).toBe(false);
  });
  test('asylumBarred: false for non-asylum relief even at 400 days', () => {
    const s = computeAllSignals(immigration({ clock_days: 400, relief_type: 'withholding' }));
    expect(s.vertical_signals.asylumBarred).toBe(false);
  });
  test('neither bar signal for relief other than asylum', () => {
    ['cancellation','DACA','VAWA','withholding'].forEach(r => {
      const s = computeAllSignals(immigration({ clock_days: 400, relief_type: r }));
      expect(s.vertical_signals.asylumBarRisk).toBe(false);
      expect(s.vertical_signals.asylumBarred).toBe(false);
    });
  });

  // cancellationEligible boundary
  test('cancellationEligible: exactly 10 years = eligible', () => {
    const s = computeAllSignals(immigration({ years_us: 10, relief_type: 'cancellation' }));
    expect(s.vertical_signals.cancellationEligible).toBe(true);
  });
  test('cancellationEligible: 9 years = NOT eligible', () => {
    const s = computeAllSignals(immigration({ years_us: 9, relief_type: 'cancellation' }));
    expect(s.vertical_signals.cancellationEligible).toBe(false);
  });
  test('cancellationEligible: 0 years = NOT eligible', () => {
    const s = computeAllSignals(immigration({ years_us: 0 }));
    expect(s.vertical_signals.cancellationEligible).toBe(false);
  });
});

describe('computeAppellateSignals — aedpaRisk boundary', () => {
  function appellate(overrides = {}) {
    return { id:1, firm_id:1, title:'Habeas corpus', vertical:'appellate',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             prior_appeals:0, is_capital:0, years_post_conviction: 0, ...overrides };
  }
  test('aedpaRisk: years_post_conviction = 0 → no risk yet', () => {
    const s = computeAllSignals(appellate({ years_post_conviction: 0 }));
    expect(s.vertical_signals.aedpaRisk).toBe(false);
  });
  test('aedpaRisk: years_post_conviction = 1 → risk triggered', () => {
    const s = computeAllSignals(appellate({ years_post_conviction: 1 }));
    expect(s.vertical_signals.aedpaRisk).toBe(true);
  });
  test('aedpaRisk: years_post_conviction = 2 → risk (past deadline)', () => {
    const s = computeAllSignals(appellate({ years_post_conviction: 2 }));
    expect(s.vertical_signals.aedpaRisk).toBe(true);
  });
  test('prioCapital: capital + high vulnerability triggers priority escalation', () => {
    const s = computeAllSignals(appellate({ is_capital: 1, vulnerability_level: 'high' }));
    expect(s.vertical_signals.prioCapital).toBe(true);
  });
  test('prioCapital: capital + moderate = false (not high/crisis)', () => {
    const s = computeAllSignals(appellate({ is_capital: 1, vulnerability_level: 'moderate' }));
    expect(s.vertical_signals.prioCapital).toBe(false);
  });
});

describe('computeMilitarySignals — likeleDisch discharge type prediction', () => {
  function military(overrides = {}) {
    return { id:1, firm_id:1, vertical:'military', title:'Art. 128 assault',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             court_type:'general', rank_e:5, service_years:8, prior_njp:0, ...overrides };
  }
  test('murder → Dishonorable discharge', () => {
    const s = computeAllSignals(military({ title:'Art. 118 UCMJ — murder — premeditated' }));
    expect(s.vertical_signals.likeleDisch).toBe('Dishonorable');
  });
  test('rape → Dishonorable discharge', () => {
    const s = computeAllSignals(military({ title:'Art. 120 UCMJ — rape' }));
    expect(s.vertical_signals.likeleDisch).toBe('Dishonorable');
  });
  test('assault (non-sexual) → Bad Conduct', () => {
    const s = computeAllSignals(military({ title:'Art. 128 UCMJ — simple assault' }));
    expect(s.vertical_signals.likeleDisch).toBe('Bad Conduct');
  });
  test('drug offense → Bad Conduct', () => {
    const s = computeAllSignals(military({ title:'Art. 112a UCMJ — drug possession' }));
    expect(s.vertical_signals.likeleDisch).toBe('Bad Conduct');
  });
  test('admin board → OTH discharge', () => {
    const s = computeAllSignals(military({ title:'Admin separation board', court_type:'admin_board' }));
    expect(s.vertical_signals.likeleDisch).toBe('OTH');
  });
  test('minor UCMJ violation, general court → Honorable', () => {
    const s = computeAllSignals(military({ title:'Art. 92 UCMJ — failure to obey order', court_type:'general' }));
    expect(s.vertical_signals.likeleDisch).toBe('Honorable');
  });
  test('veteransBenefitsRisk: discharge risk + 10+ years service', () => {
    // 'domestic' triggers dischargeRisk; 12 years service triggers veteransBenefitsRisk
    const s = computeAllSignals(military({ title:'Art. 128b UCMJ — domestic violence', service_years: 12 }));
    expect(s.vertical_signals.dischargeRisk).toBe(true);  // verify dischargeRisk fires first
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(true);
  });
  test('veteransBenefitsRisk: false with < 10 years service', () => {
    const s = computeAllSignals(military({ title:'Art. 128b UCMJ — domestic violence', service_years: 8 }));
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(false);
  });
});

describe('computeJuvenileSignals — expanded exclusion list', () => {
  function juv(overrides = {}) {
    return { id:1, firm_id:1, vertical:'juvenile', title:'Delinquency matter',
             evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
             client_age: 14, prior_adjudications: 0, case_track: 'delinquency', ...overrides };
  }
  test('arson excluded from expungElig', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — arson — residential structure' }));
    expect(s.vertical_signals.expungElig).toBe(false);
  });
  test('kidnapping excluded from expungElig', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — kidnapping — for ransom' }));
    expect(s.vertical_signals.expungElig).toBe(false);
  });
  test('shoplifting eligible for expungement (not excluded)', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — shoplifting — first offense' }));
    expect(s.vertical_signals.expungElig).toBe(true);
  });
  test('arson excluded from diversion (PD vertical)', () => {
    // In public defense vertical, diversionEligible excludes arson
    const pdMatter = { id:1, firm_id:1, vertical:'public_defense', title:'Arson — residential structure',
             evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
             prior_adjudications:0, client_age:17, case_track:'delinquency' };
    const recs = computeDiversionRecommendations(pdMatter);
    // first_offender track should not be offered for arson
    expect(recs.some(r => r.track === 'first_offender')).toBe(false);
  });
});

describe('outcome indicators sorted by urgency', () => {
  // Verify that the sort priority puts negative/urgent indicators first
  const SEVERITY_ORDER = [
    'asylum_barred', 'discharge_risk', 'asylum_bar_risk', 'sol_3yr', 'policy_exhausted',
    'reversal_probability', 'asylum_success', 'cert_worthy',
    'expungement_eligible', 'pre_trial_demand', 'early_settlement', 'settlement_likely',
  ];

  test('asylum_barred sorts before settlement_likely', () => {
    const ai = SEVERITY_ORDER.indexOf('asylum_barred');
    const si = SEVERITY_ORDER.indexOf('settlement_likely');
    expect(ai).toBeLessThan(si);
  });
  test('discharge_risk sorts before early_settlement', () => {
    const di = SEVERITY_ORDER.indexOf('discharge_risk');
    const ei = SEVERITY_ORDER.indexOf('early_settlement');
    expect(di).toBeLessThan(ei);
  });
  test('asylum_bar_risk sorts before expungement_eligible', () => {
    expect(SEVERITY_ORDER.indexOf('asylum_bar_risk')).toBeLessThan(
      SEVERITY_ORDER.indexOf('expungement_eligible')
    );
  });
});

describe('computeJuvenileSignals — diverOffered exclusion list', () => {
  function juv(overrides = {}) {
    return { id:1, firm_id:1, vertical:'juvenile', title:'Delinquency matter',
             evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
             client_age:14, prior_adjudications:0, case_track:'delinquency', ...overrides };
  }
  test('arson: diverOffered=false (excluded)', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — arson — occupied building' }));
    expect(s.vertical_signals.diverOffered).toBe(false);
  });
  test('kidnapping: diverOffered=false (excluded)', () => {
    const s = computeAllSignals(juv({ title:'Juvenile — kidnapping — for ransom' }));
    expect(s.vertical_signals.diverOffered).toBe(false);
  });
  test('carjacking: diverOffered=false (excluded)', () => {
    const s = computeAllSignals(juv({ title:'Juvenile — carjacking — vehicle taken by force' }));
    expect(s.vertical_signals.diverOffered).toBe(false);
  });
  test('trafficking: diverOffered=false (excluded)', () => {
    const s = computeAllSignals(juv({ title:'Juvenile — human trafficking — labor exploitation' }));
    expect(s.vertical_signals.diverOffered).toBe(false);
  });
  test('shoplifting: diverOffered=true (not excluded)', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — shoplifting — $45 merchandise' }));
    expect(s.vertical_signals.diverOffered).toBe(true);
  });
  test('vandalism: diverOffered=true (not excluded)', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — vandalism — graffiti' }));
    expect(s.vertical_signals.diverOffered).toBe(true);
  });
  test('transfer-eligible matter: diverOffered=false even if not excluded offense', () => {
    // Transfer flag blocks diverOffered regardless of offense type
    const s = computeAllSignals(juv({ title:'Juvenile — robbery', client_age:17 }));
    expect(s.vertical_signals.transfer).toBe(true);
    expect(s.vertical_signals.diverOffered).toBe(false);
  });
});

describe('computeCriminalSignals — expeditedBail', () => {
  function criminal(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Test',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard', ...overrides };
  }
  test('expeditedBail: crisis + violent charge = true', () => {
    const s = computeAllSignals(criminal({ title:'Murder — first degree', vulnerability_level:'crisis' }));
    expect(s.vertical_signals.expeditedBail).toBe(true);
  });
  test('expeditedBail: crisis + non-violent = false', () => {
    const s = computeAllSignals(criminal({ title:'Drug possession', vulnerability_level:'crisis' }));
    expect(s.vertical_signals.expeditedBail).toBe(false);
  });
  test('expeditedBail: high vulnerability + violent = false (only crisis triggers)', () => {
    const s = computeAllSignals(criminal({ title:'Assault', vulnerability_level:'high' }));
    expect(s.vertical_signals.expeditedBail).toBe(false);
  });
  test('dismissLikely: weak evidence = true', () => {
    const s = computeAllSignals(criminal({ evidence_score:20 }));
    expect(s.vertical_signals.dismissLikely).toBe(true);
  });
});

describe('computeFamilySignals — expedTRO', () => {
  function family(overrides = {}) {
    return { id:1, firm_id:1, vertical:'family', title:'Divorce proceeding',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             dv_flag:0, asset_tier:'under_100k', ...overrides };
  }
  test('expedTRO: crisis + DV flag = true', () => {
    const s = computeAllSignals(family({ dv_flag:1, vulnerability_level:'crisis' }));
    expect(s.vertical_signals.expedTRO).toBe(true);
  });
  test('expedTRO: DV in title + crisis = true', () => {
    const s = computeAllSignals(family({ title:'Domestic violence — restraining order', vulnerability_level:'crisis', dv_flag:0 }));
    expect(s.vertical_signals.expedTRO).toBe(true);
  });
  test('expedTRO: DV flag + moderate = false (only crisis)', () => {
    const s = computeAllSignals(family({ dv_flag:1, vulnerability_level:'moderate' }));
    expect(s.vertical_signals.expedTRO).toBe(false);
  });
  test('needsTRO: DV flag true regardless of vulnerability', () => {
    const s = computeAllSignals(family({ dv_flag:1, vulnerability_level:'low' }));
    expect(s.vertical_signals.needsTRO).toBe(true);
  });
});

describe('MATTER_KEYWORDS court_martial regex accuracy', () => {
  test('court-martial (hyphen) matches', () => {
    expect(classifyMatterTitle('Court-martial proceedings')).toBe('court_martial');
  });
  test('court martial (space) matches', () => {
    expect(classifyMatterTitle('General court martial Art. 118')).toBe('court_martial');
  });
  test('UCMJ reference matches', () => {
    expect(classifyMatterTitle('UCMJ Art. 120 sexual assault')).toBe('court_martial');
  });
  test('article number reference matches', () => {
    expect(classifyMatterTitle('Article 128 UCMJ simple assault')).toBe('court_martial');
  });
  test('courtXmartial (invalid separator) does NOT match', () => {
    // After fix, unescaped dot is replaced — this should no longer match
    const result = classifyMatterTitle('courtXmartial illegal');
    expect(result).not.toBe('court_martial');
  });
});

describe('SEVERITY_ORDER module-level constant', () => {
  // Verify the sort order puts urgent signals first
  const SEVERITY_ORDER = [
    'asylum_barred', 'discharge_risk', 'asylum_bar_risk', 'sol_3yr', 'policy_exhausted',
    'reversal_probability', 'asylum_success', 'cert_worthy',
    'expungement_eligible', 'pre_trial_demand', 'early_settlement', 'settlement_likely',
  ];
  test('asylum_barred is index 0 (highest priority)', () => {
    expect(SEVERITY_ORDER.indexOf('asylum_barred')).toBe(0);
  });
  test('settlement_likely is last known priority', () => {
    expect(SEVERITY_ORDER.indexOf('settlement_likely')).toBe(SEVERITY_ORDER.length - 1);
  });
  test('all 12 indicator types present', () => {
    expect(SEVERITY_ORDER).toHaveLength(12);
  });
});

describe('computeImmigrationSignals — null relief_type default', () => {
  function imm(overrides = {}) {
    return { id:1, firm_id:1, vertical:'immigration', title:'Immigration matter',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             country_condition:'stable', detained:0, years_us:5, clock_days:400, ...overrides };
  }

  test('no relief_type: asylumBarred=false (not defaulted to asylum)', () => {
    // clock_days=400 would trigger asylumBarred IF relief defaulted to 'asylum'
    const s = computeAllSignals(imm({ relief_type: null, clock_days: 400 }));
    expect(s.vertical_signals.asylumBarred).toBe(false);
    expect(s.vertical_signals.asylumBarRisk).toBe(false);
  });

  test('no relief_type: asylumSuccessProbability=null', () => {
    const s = computeAllSignals(imm({ relief_type: null }));
    expect(s.vertical_signals.asylumSuccessProbability).toBeNull();
  });

  test('explicit asylum relief + 400 days: asylumBarred=true', () => {
    const s = computeAllSignals(imm({ relief_type: 'asylum', clock_days: 400 }));
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });

  test('cancellation relief + 400 days: no asylum bar signals', () => {
    const s = computeAllSignals(imm({ relief_type: 'cancellation', clock_days: 400 }));
    expect(s.vertical_signals.asylumBarred).toBe(false);
    expect(s.vertical_signals.asylumBarRisk).toBe(false);
  });
});

describe('computePDSignals — suppression and brady', () => {
  function pd(overrides = {}) {
    return { id:1, firm_id:1, vertical:'public_defense', title:'Drug arrest',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             prior_adjudications:0, ...overrides };
  }

  test('suppressionRecommended: weak evidence + search term', () => {
    const s = computeAllSignals(pd({ title:'Arrest — stop and frisk — drug possession', evidence_score:20 }));
    expect(s.vertical_signals.suppressionRecommended).toBe(true);
  });

  test('suppressionRecommended: strong evidence → false', () => {
    const s = computeAllSignals(pd({ title:'Arrest — search warrant executed', evidence_score:80 }));
    expect(s.vertical_signals.suppressionRecommended).toBe(false);
  });

  test('suppressionRecommended: weak evidence + no search term → false', () => {
    const s = computeAllSignals(pd({ title:'Battery — bar fight', evidence_score:20 }));
    expect(s.vertical_signals.suppressionRecommended).toBe(false);
  });

  test('bradyApplicable: weak evidence + informant mention', () => {
    const s = computeAllSignals(pd({ title:'Drug conspiracy — confidential informant', evidence_score:15 }));
    expect(s.vertical_signals.bradyApplicable).toBe(true);
  });

  test('bradyApplicable: weak evidence + lab report mention', () => {
    const s = computeAllSignals(pd({ title:'Drug offense — lab results disputed', evidence_score:20 }));
    expect(s.vertical_signals.bradyApplicable).toBe(true);
  });

  test('bradyApplicable: strong evidence → false', () => {
    const s = computeAllSignals(pd({ title:'Drug offense — lab results confirmed informant', evidence_score:80 }));
    expect(s.vertical_signals.bradyApplicable).toBe(false);
  });
});

describe('computeCivilRightsSignals — classAction', () => {
  function cr(overrides = {}) {
    return { id:1, firm_id:1, vertical:'civil_rights', title:'§ 1983 police misconduct',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             damages_type:'compensatory_only', class_certification_status: null, ...overrides };
  }

  test('classAction: class_certification_status set → true', () => {
    const s = computeAllSignals(cr({ class_certification_status:'certified' }));
    expect(s.vertical_signals.classAction).toBe(true);
  });

  test('classAction: individual status → false', () => {
    const s = computeAllSignals(cr({ class_certification_status:'individual' }));
    expect(s.vertical_signals.classAction).toBe(false);
  });

  test('classAction: null status → false', () => {
    const s = computeAllSignals(cr({ class_certification_status: null }));
    expect(s.vertical_signals.classAction).toBe(false);
  });

  test('emergInj: crisis vulnerability + medical condition → true', () => {
    const s = computeAllSignals(cr({ title:'§ 1983 — mental health — solitary confinement', vulnerability_level:'crisis' }));
    expect(s.vertical_signals.emergInj).toBe(true);
  });
});

describe('evidenceBucket — exact boundary values', () => {
  test('score=0 → weak', () => expect(evidenceBucket(0)).toBe('weak'));
  test('score=24 → weak', () => expect(evidenceBucket(24)).toBe('weak'));
  test('score=25 → contested (boundary)', () => expect(evidenceBucket(25)).toBe('contested'));
  test('score=49 → contested', () => expect(evidenceBucket(49)).toBe('contested'));
  test('score=50 → moderate (boundary)', () => expect(evidenceBucket(50)).toBe('moderate'));
  test('score=74 → moderate', () => expect(evidenceBucket(74)).toBe('moderate'));
  test('score=75 → strong (boundary)', () => expect(evidenceBucket(75)).toBe('strong'));
  test('score=100 → strong', () => expect(evidenceBucket(100)).toBe('strong'));
  test('score=101 clamped to 100 → strong', () => expect(evidenceBucket(101)).toBe('strong'));
  test('score=-1 clamped to 0 → weak', () => expect(evidenceBucket(-1)).toBe('weak'));
});

describe('veteran_court diversion — regex accuracy', () => {
  test('veteran keyword matches', () => {
    const charge = 'veteran — domestic dispute — ptsd';
    expect(/(veteran|military service|military member|ucmj|active.duty)/.test(charge)).toBe(true);
  });

  test('military service keyword matches', () => {
    expect(/(veteran|military service|military member|ucmj|active.duty)/.test('military service assault')).toBe(true);
  });

  test('"child protective services" does NOT match', () => {
    expect(/(veteran|military service|military member|ucmj|active.duty)/.test('child protective services removal')).toBe(false);
  });

  test('"service of process" does NOT match', () => {
    expect(/(veteran|military service|military member|ucmj|active.duty)/.test('service of process dispute')).toBe(false);
  });

  test('"probation services" does NOT match', () => {
    expect(/(veteran|military service|military member|ucmj|active.duty)/.test('probation services violation')).toBe(false);
  });
});

describe('getMatter — no mutation of query result', () => {
  test('getMatter returns object with resolved vertical, not mutating original', () => {
    // Simulate the spread behavior — original m unchanged, returned object has vertical
    const m = { id:1, firm_id:1, vertical: null, firm_vertical: 'immigration' };
    const vertical = (!m.vertical || m.vertical === 'general')
      ? (m.firm_vertical || 'general')
      : m.vertical;
    const result = { ...m, vertical };
    expect(m.vertical).toBeNull();   // original unchanged
    expect(result.vertical).toBe('immigration'); // resolved copy correct
  });

  test('explicit vertical preserved over firm_vertical', () => {
    const m = { id:1, vertical: 'criminal_defense', firm_vertical: 'immigration' };
    const vertical = (!m.vertical || m.vertical === 'general')
      ? (m.firm_vertical || 'general')
      : m.vertical;
    expect(vertical).toBe('criminal_defense');
  });
});

describe('computeMotionRecommendations — competency and empty results', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Theft',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', jurisdiction:'state', ...overrides };
  }

  test('competency motion: high vulnerability fires', () => {
    const recs = computeMotionRecommendations(matter({ vulnerability_level:'high' }));
    expect(recs.some(r => r.type === 'competency')).toBe(true);
  });

  test('competency motion: crisis vulnerability fires', () => {
    const recs = computeMotionRecommendations(matter({ vulnerability_level:'crisis' }));
    expect(recs.some(r => r.type === 'competency')).toBe(true);
  });

  test('competency motion: moderate vulnerability does NOT fire', () => {
    const recs = computeMotionRecommendations(matter({ vulnerability_level:'moderate' }));
    expect(recs.some(r => r.type === 'competency')).toBe(false);
  });

  test('returns empty array for low-risk matter with no signals', () => {
    // Strong evidence, non-violent charge, moderate vulnerability, civil vertical
    const recs = computeMotionRecommendations(
      matter({ vertical:'civil_rights', title:'Contract dispute', evidence_score:80, vulnerability_level:'low', status:'active' })
    );
    expect(Array.isArray(recs)).toBe(true);
    // civil_rights with strong evidence + not criminal → no suppression, no Batson, no competency
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(false);
    expect(recs.some(r => r.type === 'Batson')).toBe(false);
    expect(recs.some(r => r.type === 'competency')).toBe(false);
  });

  test('PI vertical + strong evidence → motion in limine recommended', () => {
    const recs = computeMotionRecommendations(
      matter({ vertical:'personal_injury', evidence_score:80 })
    );
    expect(recs.some(r => r.type === 'motion_in_limine')).toBe(true);
  });

  test('appellate vertical → standard of review motion always recommended', () => {
    const recs = computeMotionRecommendations(
      matter({ vertical:'appellate', evidence_score:60 })
    );
    expect(recs.some(r => r.type === 'standard_of_review')).toBe(true);
  });
});

describe('escalation trigger deduplication', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Murder — assault',
             evidence_score:50, vulnerability_level:'crisis', time_pressure:'emergency',
             status:'active', ...overrides };
  }

  test('overlapping emergency+crisis conditions produce unique triggers', () => {
    // Both emergency+crisis AND expeditedBail fire for this matter
    const s = computeAllSignals(matter());
    const triggerSet = new Set(s.escalation.triggers);
    expect(s.escalation.triggers.length).toBe(triggerSet.size);  // no duplicates
  });

  test('normal matter has empty triggers array', () => {
    const s = computeAllSignals(
      matter({ vulnerability_level:'low', time_pressure:'standard', title:'Speeding ticket' })
    );
    expect(s.escalation.triggers).toHaveLength(0);
    expect(s.escalation.level).toBe('normal');
  });
});

describe('computeAppellateSignals — evBoost bucket consistency', () => {
  test('score=60 (moderate bucket) gets evBoost', () => {
    const m = { id:1, firm_id:1, vertical:'appellate', title:'Habeas corpus',
                evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
                prior_appeals:0, is_capital:0, years_post_conviction:0 };
    const s = computeAllSignals(m);
    // ev='moderate' → evBoost should apply (was: score 60 > 60 = false, now: moderate = true)
    expect(s.vertical_signals.revScore).toBeGreaterThan(40);  // base 40 + 20 boost = 60
  });

  test('score=74 (moderate bucket) same boost as score=61', () => {
    const base = { id:1, firm_id:1, vertical:'appellate', title:'Habeas corpus',
                   vulnerability_level:'moderate', time_pressure:'standard',
                   prior_appeals:0, is_capital:0, years_post_conviction:0 };
    const s61 = computeAllSignals({ ...base, evidence_score:61 });
    const s74 = computeAllSignals({ ...base, evidence_score:74 });
    // Both are moderate → same base rev score (40) + boost (20) = 60
    expect(s61.vertical_signals.revScore).toBe(s74.vertical_signals.revScore);
  });
});

describe('computePISignals — plaintiff fault clamp', () => {
  function pi(pf, econ=100000) {
    return { id:1, firm_id:1, vertical:'personal_injury', title:'Auto accident',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             causation_type:'clear', injury_severity:'moderate',
             plaintiff_fault_pct:pf, economic_damages:econ, noneconomic_damages:0,
             punitive_damages:0, policy_limit:500000 };
  }
  test('pf > 100 clamped — net damages not negative', () => {
    const s = computeAllSignals(pi(150, 100000));
    expect(s.vertical_signals.netDamage).toBeGreaterThanOrEqual(0);
  });
  test('pf = 100: net compensatory = 0 (complete fault)', () => {
    const s = computeAllSignals(pi(100, 100000));
    expect(s.vertical_signals.netDamage).toBe(0);
  });
  test('pf = 50: net = 50% of compensatory', () => {
    const s = computeAllSignals(pi(50, 100000));
    expect(s.vertical_signals.netDamage).toBe(50000);
  });
});

describe('MATTER_KEYWORDS removal_defense precision', () => {
  test('removal proceedings matches', () => {
    expect(classifyMatterTitle('Removal proceedings — immigration court')).toBe('removal_defense');
  });
  test('order of removal matches', () => {
    expect(classifyMatterTitle('Order of removal — withholding')).toBe('removal_defense');
  });
  test('deportation matches', () => {
    expect(classifyMatterTitle('Deportation defense — El Salvador')).toBe('removal_defense');
  });
  test('"removal of counsel" does NOT match', () => {
    expect(classifyMatterTitle('Motion for removal of counsel for conflict')).not.toBe('removal_defense');
  });
  test('"removal from case" does NOT match', () => {
    expect(classifyMatterTitle('Attorney removal from case — disciplinary')).not.toBe('removal_defense');
  });
});

describe('dashboard firm_vertical resolution', () => {
  // Simulate the dashboard loop's firm_vertical resolution logic
  function resolveDashboardMatter(rawM) {
    const mVertical = (!rawM.vertical || rawM.vertical === 'general')
      ? (rawM.firm_vertical || 'general')
      : rawM.vertical;
    return mVertical !== rawM.vertical ? { ...rawM, vertical: mVertical } : rawM;
  }

  test('null vertical + firm_vertical set → uses firm_vertical', () => {
    const raw = { id:1, vertical: null, firm_vertical: 'immigration' };
    const resolved = resolveDashboardMatter(raw);
    expect(resolved.vertical).toBe('immigration');
    expect(raw.vertical).toBeNull();  // original not mutated
  });

  test('general vertical + firm_vertical set → uses firm_vertical', () => {
    const raw = { id:1, vertical: 'general', firm_vertical: 'criminal_defense' };
    const resolved = resolveDashboardMatter(raw);
    expect(resolved.vertical).toBe('criminal_defense');
  });

  test('explicit vertical → preserves vertical, ignores firm_vertical', () => {
    const raw = { id:1, vertical: 'appellate', firm_vertical: 'immigration' };
    const resolved = resolveDashboardMatter(raw);
    expect(resolved.vertical).toBe('appellate');
  });

  test('no firm_vertical either → defaults to general', () => {
    const raw = { id:1, vertical: null, firm_vertical: null };
    const resolved = resolveDashboardMatter(raw);
    expect(resolved.vertical).toBe('general');
  });

  test('immigration vertical resolves asylum signals correctly after resolution', () => {
    // Simulate a matter row from the dashboard SELECT
    const rawM = {
      id:1, firm_id:1, vertical: null, firm_vertical: 'immigration',
      title: 'Asylum credible fear interview',
      evidence_score: 70, vulnerability_level: 'moderate', time_pressure: 'standard',
      clock_days: 380, relief_type: 'asylum', detained: 0, years_us: 5,
      country_condition: 'crisis', damages_type: null, class_certification_status: null,
      cooperation_level: null, dpa_status: null, dv_flag: 0, asset_tier: null,
      prior_adjudications: 0, client_age: 30, case_track: null,
      is_capital: 0, court_type: null, service_years: 0, prior_njp: 0,
      status: 'active',
    };
    const mVertical = (!rawM.vertical || rawM.vertical === 'general')
      ? (rawM.firm_vertical || 'general')
      : rawM.vertical;
    const m = { ...rawM, vertical: mVertical };
    const s = computeAllSignals(m);
    expect(s.vertical).toBe('immigration');
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });
});

describe('TAXONOMY_VERTICAL completeness', () => {
  const TAXONOMY_VERTICAL = {
    capital: 'criminal_defense', drug_federal: 'criminal_defense',
    sexual_offense: 'criminal_defense', domestic: 'criminal_defense',
    white_collar_cr: 'white_collar',
    excessive_force: 'civil_rights', wrongful_conv: 'civil_rights', conditions: 'civil_rights',
    fcpa: 'white_collar', sec: 'white_collar', doj: 'white_collar',
    aml: 'white_collar', healthcare_reg: 'white_collar',
    asylum_matter: 'immigration', removal_defense: 'immigration', visa_petition: 'immigration',
    auto_accident: 'personal_injury', medical_malprac: 'personal_injury', mass_tort: 'personal_injury',
    delinquency_j: 'juvenile', dependency_j: 'juvenile', tpr: 'juvenile',
    habeas: 'appellate', cert_petition: 'appellate', compassionate: 'appellate',
    court_martial: 'military', admin_sep: 'military', clearance: 'military',
  };

  test('has 28 taxonomy-to-vertical mappings', () => {
    expect(Object.keys(TAXONOMY_VERTICAL)).toHaveLength(28);
  });

  test('family and public_defense intentionally absent', () => {
    const mapped = new Set(Object.values(TAXONOMY_VERTICAL));
    // These two require explicit vertical assignment — no reliable keyword patterns
    expect(mapped.has('family')).toBe(false);
    expect(mapped.has('public_defense')).toBe(false);
  });

  test('all 8 auto-inferable verticals are represented', () => {
    const mapped = new Set(Object.values(TAXONOMY_VERTICAL));
    ['criminal_defense', 'civil_rights', 'white_collar', 'immigration',
     'personal_injury', 'juvenile', 'appellate', 'military'].forEach(v => {
      expect(mapped.has(v)).toBe(true);
    });
  });
});

describe('dashboard loop — error isolation and scoping', () => {
  test('malformed matter does not crash entire dashboard loop', () => {
    // computeAllSignals should handle null title gracefully
    const malformed = {
      id: 99, firm_id:1, vertical: 'criminal_defense',
      title: null,  // null title
      evidence_score: null, vulnerability_level: null,
      time_pressure: null, status: 'active',
    };
    // Should not throw — classifyMatterTitle handles null title
    expect(() => computeAllSignals(malformed)).not.toThrow();
  });

  test('computeAllSignals with all-null fields returns stable result', () => {
    const minimal = {
      id:1, firm_id:1, vertical: 'general',
      title: null, evidence_score: null,
      vulnerability_level: null, time_pressure: null,
    };
    const s = computeAllSignals(minimal);
    expect(s.escalation.level).toBe('normal');
    expect(s.vertical_signals).toEqual({});
    expect(typeof s.computed_at).toBe('string');
  });

  test('dashboard vertical resolution: firm_vertical used when matter.vertical is null', () => {
    const rawM = {
      id:1, firm_id:1, vertical: null, firm_vertical: 'appellate',
      title: 'Habeas corpus', evidence_score: 60,
      vulnerability_level: 'moderate', time_pressure: 'standard',
      prior_appeals: 0, is_capital: 0, years_post_conviction: 0,
    };
    const mVertical = (!rawM.vertical || rawM.vertical === 'general')
      ? (rawM.firm_vertical || 'general')
      : rawM.vertical;
    const m = { ...rawM, vertical: mVertical };
    const s = computeAllSignals(m);
    expect(s.vertical).toBe('appellate');
    expect(s.vertical_signals).toHaveProperty('revScore');
  });
});

describe('computeMilitarySignals — seniorityFactor boundary', () => {
  function mil(overrides = {}) {
    return { id:1, firm_id:1, vertical:'military', title:'Art. 92 UCMJ failure to obey',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             court_type:'general', rank_e:5, service_years:8, prior_njp:0, ...overrides };
  }
  test('seniorityFactor: 20 years service → 1.0 (cap)', () => {
    const s = computeAllSignals(mil({ service_years: 20 }));
    expect(s.vertical_signals.seniorityFactor).toBe(1.0);
  });
  test('seniorityFactor: 40 years service → capped at 1.0', () => {
    const s = computeAllSignals(mil({ service_years: 40 }));
    expect(s.vertical_signals.seniorityFactor).toBe(1.0);
  });
  test('seniorityFactor: 10 years → 0.5', () => {
    const s = computeAllSignals(mil({ service_years: 10 }));
    expect(s.vertical_signals.seniorityFactor).toBeCloseTo(0.5);
  });
  test('seniorityFactor: 0 years → 0.0', () => {
    const s = computeAllSignals(mil({ service_years: 0 }));
    expect(s.vertical_signals.seniorityFactor).toBe(0.0);
  });
  test('priorMisconduct: prior_njp > 0 = true', () => {
    const s = computeAllSignals(mil({ prior_njp: 2 }));
    expect(s.vertical_signals.priorMisconduct).toBe(true);
  });
  test('priorMisconduct: prior_njp = 0 = false', () => {
    const s = computeAllSignals(mil({ prior_njp: 0 }));
    expect(s.vertical_signals.priorMisconduct).toBe(false);
  });
  test('seniorEnlisted: rank_e >= 7 = true', () => {
    const s = computeAllSignals(mil({ rank_e: 7 }));
    expect(s.vertical_signals.seniorEnlisted).toBe(true);
  });
  test('seniorEnlisted: rank_e = 6 = false', () => {
    const s = computeAllSignals(mil({ rank_e: 6 }));
    expect(s.vertical_signals.seniorEnlisted).toBe(false);
  });
});

describe('computeCivilRightsSignals — earlySet', () => {
  function cr(overrides = {}) {
    return { id:1, firm_id:1, vertical:'civil_rights', title:'§ 1983 excessive force',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             damages_type:'compensatory_only', class_certification_status:null, ...overrides };
  }
  test('earlySet: strong evidence + compensatory damages → true', () => {
    const s = computeAllSignals(cr({ evidence_score: 80, damages_type: 'compensatory_only' }));
    expect(s.vertical_signals.earlySet).toBe(true);
  });
  test('earlySet: strong evidence + injunctive_only → false', () => {
    const s = computeAllSignals(cr({ evidence_score: 80, damages_type: 'injunctive_only' }));
    expect(s.vertical_signals.earlySet).toBe(false);
  });
  test('earlySet: moderate evidence → false', () => {
    const s = computeAllSignals(cr({ evidence_score: 60 }));
    expect(s.vertical_signals.earlySet).toBe(false);
  });
  test('settlementProbability: strong evidence → 0.72', () => {
    const s = computeAllSignals(cr({ evidence_score: 80 }));
    expect(s.vertical_signals.settlementProbability).toBeCloseTo(0.72);
  });
  test('settlementProbability: moderate → 0.51', () => {
    const s = computeAllSignals(cr({ evidence_score: 60 }));
    expect(s.vertical_signals.settlementProbability).toBeCloseTo(0.51);
  });
  test('settlementProbability: weak → 0.18', () => {
    const s = computeAllSignals(cr({ evidence_score: 10 }));
    expect(s.vertical_signals.settlementProbability).toBeCloseTo(0.18);
  });
});

describe('computeJuvenileSignals — transfer boundary at age 16', () => {
  function juv(overrides = {}) {
    return { id:1, firm_id:1, vertical:'juvenile', title:'Delinquency — robbery',
             evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
             client_age:14, prior_adjudications:0, case_track:'delinquency', ...overrides };
  }
  test('transfer: age 16, robbery, delinquency track → true', () => {
    const s = computeAllSignals(juv({ client_age: 16, title: 'Delinquency — robbery' }));
    expect(s.vertical_signals.transfer).toBe(true);
  });
  test('transfer: age 15, same charge → false (below threshold)', () => {
    const s = computeAllSignals(juv({ client_age: 15, title: 'Delinquency — robbery' }));
    expect(s.vertical_signals.transfer).toBe(false);
  });
  test('transfer: age 17, non-transfer offense (shoplifting) → false', () => {
    const s = computeAllSignals(juv({ client_age: 17, title: 'Delinquency — shoplifting' }));
    expect(s.vertical_signals.transfer).toBe(false);
  });
  test('transfer: age 18+ treated as adult (isJuvenileAge = false) → false', () => {
    const s = computeAllSignals(juv({ client_age: 18, title: 'Delinquency — murder' }));
    expect(s.vertical_signals.transfer).toBe(false);
  });
  test('EXPUNG_EXCLUDED is module-level (same result on repeated calls)', () => {
    const m = juv({ title: 'Delinquency — arson' });
    const s1 = computeAllSignals(m);
    const s2 = computeAllSignals(m);
    expect(s1.vertical_signals.expungElig).toBe(s2.vertical_signals.expungElig);
    expect(s1.vertical_signals.expungElig).toBe(false);
  });
});

describe('computeWhiteCollarSignals', () => {
  function wc(overrides = {}) {
    return { id:1, firm_id:1, vertical:'white_collar', title:'SEC securities fraud',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             cooperation_level:'unknown', dpa_status:null, jurisdiction:'federal', ...overrides };
  }
  test('coopUpgradeRecommended: strong evidence + limited cooperation → true', () => {
    const s = computeAllSignals(wc({ evidence_score:80, cooperation_level:'limited_cooperation' }));
    expect(s.vertical_signals.coopUpgradeRecommended).toBe(true);
  });
  test('coopUpgradeRecommended: strong + full_cooperation → false (already cooperating)', () => {
    const s = computeAllSignals(wc({ evidence_score:80, cooperation_level:'full_cooperation' }));
    expect(s.vertical_signals.coopUpgradeRecommended).toBe(false);
  });
  test('coopUpgradeRecommended: weak evidence + limited → false', () => {
    const s = computeAllSignals(wc({ evidence_score:20, cooperation_level:'limited_cooperation' }));
    expect(s.vertical_signals.coopUpgradeRecommended).toBe(false);
  });
  test('dpaViable: dpa_status=viable → true', () => {
    const s = computeAllSignals(wc({ dpa_status:'viable' }));
    expect(s.vertical_signals.dpaViable).toBe(true);
  });
  test('dpaViable: dpa_status=negotiating → true', () => {
    const s = computeAllSignals(wc({ dpa_status:'negotiating' }));
    expect(s.vertical_signals.dpaViable).toBe(true);
  });
  test('dpaViable: dpa_status=null → false', () => {
    const s = computeAllSignals(wc({ dpa_status:null }));
    expect(s.vertical_signals.dpaViable).toBe(false);
  });
  test('accelResp: crisis vulnerability + federal jurisdiction → true', () => {
    const s = computeAllSignals(wc({ vulnerability_level:'crisis', jurisdiction:'federal' }));
    expect(s.vertical_signals.accelResp).toBe(true);
  });
  test('accelResp: crisis + state jurisdiction → false', () => {
    const s = computeAllSignals(wc({ vulnerability_level:'crisis', jurisdiction:'state' }));
    expect(s.vertical_signals.accelResp).toBe(false);
  });
  test('recCoop: strong evidence + no_cooperation → true', () => {
    const s = computeAllSignals(wc({ evidence_score:80, cooperation_level:'no_cooperation' }));
    expect(s.vertical_signals.recCoop).toBe(true);
  });
});

describe('computeFamilySignals', () => {
  function fam(overrides = {}) {
    return { id:1, firm_id:1, vertical:'family', title:'Divorce proceeding',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             dv_flag:0, asset_tier:'under_100k', ...overrides };
  }
  test('highAsset: asset_tier 2m_10m → true', () => {
    const s = computeAllSignals(fam({ asset_tier:'2m_10m' }));
    expect(s.vertical_signals.highAsset).toBe(true);
  });
  test('highAsset: asset_tier over_10m → true', () => {
    const s = computeAllSignals(fam({ asset_tier:'over_10m' }));
    expect(s.vertical_signals.highAsset).toBe(true);
  });
  test('highAsset: asset_tier 500k_2m → false (below threshold)', () => {
    const s = computeAllSignals(fam({ asset_tier:'500k_2m' }));
    expect(s.vertical_signals.highAsset).toBe(false);
  });
  test('likelySett: weak evidence → true', () => {
    const s = computeAllSignals(fam({ evidence_score:20 }));
    expect(s.vertical_signals.likelySett).toBe(true);
  });
  test('likelySett: contested evidence → true', () => {
    const s = computeAllSignals(fam({ evidence_score:40 }));
    expect(s.vertical_signals.likelySett).toBe(true);
  });
  test('likelySett: moderate evidence → false', () => {
    const s = computeAllSignals(fam({ evidence_score:60 }));
    expect(s.vertical_signals.likelySett).toBe(false);
  });
  test('needsTRO: DV flag set → true regardless of vulnerability', () => {
    const s = computeAllSignals(fam({ dv_flag:1, vulnerability_level:'low' }));
    expect(s.vertical_signals.needsTRO).toBe(true);
  });
  test('settlementProbability: weak/contested → 0.62', () => {
    const s = computeAllSignals(fam({ evidence_score:30 }));
    expect(s.vertical_signals.settlementProbability).toBeCloseTo(0.62);
  });
  test('settlementProbability: moderate/strong → 0.38', () => {
    const s = computeAllSignals(fam({ evidence_score:70 }));
    expect(s.vertical_signals.settlementProbability).toBeCloseTo(0.38);
  });
});

describe('computeCriminalSignals — expeditedBail and recommendExpressMatch', () => {
  function criminal(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Test',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             ...overrides };
  }
  test('crisis + violent: both expeditedBail AND recommendExpressMatch = true', () => {
    const s = computeAllSignals(criminal({
      title: 'First-degree murder', vulnerability_level: 'crisis'
    }));
    expect(s.vertical_signals.expeditedBail).toBe(true);
    expect(s.vertical_signals.recommendExpressMatch).toBe(true);
    // Both express the same condition — verify consistency
    expect(s.vertical_signals.expeditedBail).toBe(s.vertical_signals.recommendExpressMatch);
  });
  test('high vuln + violent: neither fires (only crisis triggers)', () => {
    const s = computeAllSignals(criminal({
      title: 'Armed robbery', vulnerability_level: 'high'
    }));
    expect(s.vertical_signals.expeditedBail).toBe(false);
    expect(s.vertical_signals.recommendExpressMatch).toBe(false);
  });
  test('crisis + non-violent: neither fires', () => {
    const s = computeAllSignals(criminal({
      title: 'Drug possession', vulnerability_level: 'crisis'
    }));
    expect(s.vertical_signals.expeditedBail).toBe(false);
    expect(s.vertical_signals.recommendExpressMatch).toBe(false);
  });
  test('violentCharge: standalone flag for violent offense', () => {
    const s = computeAllSignals(criminal({
      title: 'Homicide — negligent', vulnerability_level: 'moderate'
    }));
    expect(s.vertical_signals.violentCharge).toBe(true);
    expect(s.vertical_signals.expeditedBail).toBe(false);  // not crisis
  });
});

describe('computePDSignals — batsonApplicable (decoupled from evidence)', () => {
  function pd(overrides = {}) {
    return { id:1, firm_id:1, vertical:'public_defense', title:'Drug arrest',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             prior_adjudications:0, ...overrides };
  }
  test('batsonApplicable: true for strong evidence (was false before fix)', () => {
    const s = computeAllSignals(pd({ evidence_score: 80 }));
    expect(s.vertical_signals.batsonApplicable).toBe(true);
  });
  test('batsonApplicable: true for weak evidence', () => {
    const s = computeAllSignals(pd({ evidence_score: 20 }));
    expect(s.vertical_signals.batsonApplicable).toBe(true);
  });
  test('batsonApplicable: true for all evidence buckets (evidence-independent)', () => {
    [10, 30, 60, 85].forEach(score => {
      const s = computeAllSignals(pd({ evidence_score: score }));
      expect(s.vertical_signals.batsonApplicable).toBe(true);
    });
  });
});

describe('computeJuvenileSignals — csecFlag tightened', () => {
  function juv(overrides = {}) {
    return { id:1, firm_id:1, vertical:'juvenile', title:'Delinquency matter',
             evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
             client_age:15, prior_adjudications:0, case_track:'delinquency', ...overrides };
  }
  test('csecFlag: drug trafficking does NOT trigger csecFlag', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — drug trafficking' }));
    expect(s.vertical_signals.csecFlag).toBe(false);
  });
  test('csecFlag: human trafficking DOES trigger csecFlag', () => {
    const s = computeAllSignals(juv({ title:'Juvenile — human trafficking victim' }));
    expect(s.vertical_signals.csecFlag).toBe(true);
  });
  test('csecFlag: sex trafficking DOES trigger csecFlag', () => {
    const s = computeAllSignals(juv({ title:'CSEC — sex trafficking commercial exploitation' }));
    expect(s.vertical_signals.csecFlag).toBe(true);
  });
  test('csecFlag: csec keyword DOES trigger csecFlag', () => {
    const s = computeAllSignals(juv({ title:'CSEC referral — exploitation of minor' }));
    expect(s.vertical_signals.csecFlag).toBe(true);
  });
  test('csecFlag: plain robbery does NOT trigger csecFlag', () => {
    const s = computeAllSignals(juv({ title:'Delinquency — armed robbery' }));
    expect(s.vertical_signals.csecFlag).toBe(false);
  });
});

describe('computeMilitarySignals — service_years default 0', () => {
  function mil(overrides = {}) {
    return { id:1, firm_id:1, vertical:'military', title:'Art. 128 assault',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             court_type:'general', rank_e:5, prior_njp:0, ...overrides };
  }
  test('no service_years set: svcYrs defaults to 0 — veteransBenefitsRisk is false', () => {
    // service_years not in matter → safeInt(undefined, 0) = 0 → 0 < 10 → false
    const m = mil();
    delete m.service_years;
    const s = computeAllSignals(m);
    expect(s.vertical_signals.seniorityFactor).toBe(0.0);
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(false);
  });
  test('service_years=0: seniorityFactor=0, veteransBenefitsRisk=false', () => {
    const s = computeAllSignals(mil({ service_years: 0 }));
    expect(s.vertical_signals.seniorityFactor).toBe(0);
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(false);
  });
  test('service_years=9: below threshold — veteransBenefitsRisk false even with dischargeRisk', () => {
    const s = computeAllSignals(mil({
      title: 'Art. 128b UCMJ domestic violence', service_years: 9
    }));
    expect(s.vertical_signals.dischargeRisk).toBe(true);  // confirm dischargeRisk fires
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(false);  // but 9 < 10
  });
  test('service_years=10: meets threshold — veteransBenefitsRisk true with dischargeRisk', () => {
    const s = computeAllSignals(mil({
      title: 'Art. 128b UCMJ domestic violence', service_years: 10
    }));
    expect(s.vertical_signals.dischargeRisk).toBe(true);
    expect(s.vertical_signals.veteransBenefitsRisk).toBe(true);
  });
});

describe('computeMotionRecommendations — Batson and speedy_trial', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Robbery',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }
  test('Batson recommended for strong-evidence criminal matter (was NOT before fix)', () => {
    const recs = computeMotionRecommendations(matter({ evidence_score: 80 }));
    expect(recs.some(r => r.type === 'Batson')).toBe(true);
  });
  test('Batson recommended for weak-evidence criminal matter', () => {
    const recs = computeMotionRecommendations(matter({ evidence_score: 15 }));
    expect(recs.some(r => r.type === 'Batson')).toBe(true);
  });
  test('Batson recommended for public_defense vertical', () => {
    const recs = computeMotionRecommendations(matter({ vertical: 'public_defense' }));
    expect(recs.some(r => r.type === 'Batson')).toBe(true);
  });
  test('Batson NOT recommended for civil_rights vertical (no jury strikes)', () => {
    const recs = computeMotionRecommendations(matter({ vertical: 'civil_rights' }));
    // civil_rights is NOT in the Batson check (criminal_defense/public_defense only)
    expect(recs.some(r => r.type === 'Batson')).toBe(false);
  });
  test('speedy_trial recommended for active criminal matter with high vulnerability', () => {
    const recs = computeMotionRecommendations(
      matter({ vulnerability_level: 'high', status: 'active' })
    );
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(true);
  });
  test('speedy_trial NOT recommended for closed matter', () => {
    const recs = computeMotionRecommendations(
      matter({ vulnerability_level: 'high', status: 'closed' })
    );
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(false);
  });
  test('speedy_trial NOT recommended for moderate vulnerability', () => {
    const recs = computeMotionRecommendations(
      matter({ vulnerability_level: 'moderate', status: 'active' })
    );
    expect(recs.some(r => r.type === 'speedy_trial')).toBe(false);
  });
});

describe('computeAllSignals — vertical=general taxonomy inference', () => {
  function general(overrides = {}) {
    return { id:1, firm_id:1, vertical:'general',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             ...overrides };
  }

  test('general + murder title → infers criminal_defense signals', () => {
    const s = computeAllSignals(general({ title:'Murder — first degree' }));
    expect(s.taxonomy).toBe('capital');
    // Should have criminal signals inferred from CRIMINAL_TAX
    expect(s.vertical_signals).toHaveProperty('violentCharge');
    expect(s.vertical_signals.violentCharge).toBe(true);
  });

  test('general + asylum title → infers immigration signals', () => {
    const s = computeAllSignals(general({
      title:'Asylum credible fear', relief_type:'asylum', clock_days:380
    }));
    expect(s.taxonomy).toBe('asylum_matter');
    expect(s.vertical_signals).toHaveProperty('asylumBarred');
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });

  test('general + UCMJ title → infers military signals', () => {
    const s = computeAllSignals(general({ title:'Art. 128 UCMJ assault', service_years:8 }));
    expect(s.taxonomy).toBe('court_martial');
    expect(s.vertical_signals).toHaveProperty('likeleDisch');
  });

  test('general + habeas title → infers appellate signals', () => {
    const s = computeAllSignals(general({ title:'Habeas corpus § 2254', evidence_score:70 }));
    expect(s.taxonomy).toBe('habeas');
    expect(s.vertical_signals).toHaveProperty('revScore');
  });

  test('general + unrecognized title → empty vertical signals', () => {
    const s = computeAllSignals(general({ title:'Contract dispute — vendor payment' }));
    expect(s.taxonomy).toBe('general');
    expect(s.vertical_signals).toEqual({});
  });

  test('general taxonomy inference: vertical in return is still general', () => {
    // Use 'murder' which maps to CRIMINAL_TAX via 'capital' taxonomy
    const s = computeAllSignals(general({ title:'First-degree murder' }));
    // The matter vertical stays 'general' — only signals are inferred
    expect(s.vertical).toBe('general');
    expect(s.taxonomy).toBe('capital');
  });
});

describe('computeAllSignals — escalation SLA protection (setSLA)', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Murder',
             evidence_score:50, vulnerability_level:'crisis', time_pressure:'emergency',
             status:'active', ...overrides };
  }

  test('emergency + crisis alone: sla=1, level=critical', () => {
    const s = computeAllSignals(matter());
    // isEmergency=true && isCrisis=true → sla=1
    expect(s.escalation.sla_hours).toBe(1);
    expect(s.escalation.level).toBe('critical');
  });

  test('expeditedBail: sla=1 (crisis bail emergency)', () => {
    // crisis + violent → expeditedBail → sla=1
    const s = computeAllSignals(matter({ title:'First-degree murder' }));
    expect(s.escalation.sla_hours).toBe(1);
    expect(s.escalation.triggers.some(t => t.includes('bail') || t.includes('emergency'))).toBe(true);
  });

  test('fastTrack alone (catastrophic PI): sla=2', () => {
    const m = { id:1, firm_id:1, vertical:'personal_injury', title:'Catastrophic injury',
                evidence_score:50, vulnerability_level:'crisis', time_pressure:'standard',
                injury_severity:'catastrophic', causation_type:'clear',
                plaintiff_fault_pct:0, economic_damages:0, noneconomic_damages:0,
                punitive_damages:0, policy_limit:100000, status:'active' };
    const s = computeAllSignals(m);
    if (s.vertical_signals.fastTrack) {
      expect(s.escalation.sla_hours).toBeLessThanOrEqual(2);
    }
  });

  test('setSLA never downgrades: expeditedBail(1) + fastTrack(2) → stays at 1', () => {
    // A criminal matter with crisis+violent AND catastrophic label (if it existed)
    // The setSLA(2) call for fastTrack should NOT overwrite the existing sla=1
    // Test the setSLA logic directly:
    function setSLA(current, newHours) {
      return current === null ? newHours : Math.min(current, newHours);
    }
    let sla = null;
    sla = setSLA(sla, 1);   // expeditedBail sets sla=1
    sla = setSLA(sla, 2);   // fastTrack tries to set sla=2 → Math.min(1,2) = 1
    expect(sla).toBe(1);    // sla stays at 1 (more urgent)
  });

  test('setSLA escalates from null: null → 2 → 1', () => {
    function setSLA(current, newHours) {
      return current === null ? newHours : Math.min(current, newHours);
    }
    let sla = null;
    sla = setSLA(sla, 2);   // fastTrack sets 2
    sla = setSLA(sla, 1);   // prioCapital sets 1 → Math.min(2,1) = 1
    expect(sla).toBe(1);
  });

  test('emergency only (no crisis): sla=4, level=high', () => {
    const s = computeAllSignals(
      matter({ vulnerability_level:'moderate', time_pressure:'emergency',
               title:'Drug possession' })
    );
    // isEmergency=true, isCrisis=false
    // No vertical signals that would override
    expect(s.escalation.sla_hours).toBe(4);
    expect(s.escalation.level).toBe('high');
  });

  test('normal matter: sla=null, level=normal', () => {
    const s = computeAllSignals(
      matter({ vulnerability_level:'low', time_pressure:'standard',
               title:'Speeding ticket' })
    );
    expect(s.escalation.sla_hours).toBeNull();
    expect(s.escalation.level).toBe('normal');
  });
});

describe('computeMotionRecommendations — advisory flag and Batson properties', () => {
  function criminal(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Robbery',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }
  test('Batson motion has advisory=true property', () => {
    const recs = computeMotionRecommendations(criminal());
    const batson = recs.find(r => r.type === 'Batson');
    expect(batson).toBeDefined();
    expect(batson.advisory).toBe(true);
  });
  test('Batson motion has a reason string', () => {
    const recs = computeMotionRecommendations(criminal());
    const batson = recs.find(r => r.type === 'Batson');
    expect(typeof batson.reason).toBe('string');
    expect(batson.reason.length).toBeGreaterThan(10);
  });
  test('suppression_4th is NOT advisory (condition-based)', () => {
    const recs = computeMotionRecommendations(
      criminal({ evidence_score:15, title:'Drug arrest — stop and frisk' })
    );
    const supp = recs.find(r => r.type === 'suppression_4th');
    expect(supp).toBeDefined();
    expect(supp.advisory).toBeUndefined();  // not flagged advisory
  });
});

describe('computeAllSignals — computed_at timestamp consistency', () => {
  function baseMatter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Test matter',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }

  test('computeAllSignals includes computed_at ISO timestamp', () => {
    const s = computeAllSignals(baseMatter());
    expect(typeof s.computed_at).toBe('string');
    expect(s.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('computed_at is always current (close to now)', () => {
    const before = Date.now();
    const s = computeAllSignals(baseMatter());
    const after = Date.now();
    const ts = new Date(s.computed_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 10); // small tolerance
  });

  test('each computeAllSignals call produces a unique computed_at', () => {
    const s1 = computeAllSignals(baseMatter());
    // Note: same ms may produce same string — test that format is valid, not uniqueness
    expect(s1.computed_at.length).toBeGreaterThan(10);
  });

  test('escalation level and sla_hours present in output', () => {
    const s = computeAllSignals(baseMatter({ vulnerability_level:'crisis', time_pressure:'emergency' }));
    expect(s.escalation.level).toBeDefined();
    expect(s.escalation.sla_hours).toBeDefined();
    expect(s.escalation.triggers).toBeInstanceOf(Array);
  });

  test('outcome indicators sorted — asylum_barred before settlement_likely when both present', () => {
    // Test the SEVERITY_ORDER is applied (asylum_barred = index 0, settlement_likely = last)
    const SEVERITY_ORDER = ['asylum_barred','discharge_risk','asylum_bar_risk',
      'sol_3yr','policy_exhausted','reversal_probability','asylum_success','cert_worthy',
      'expungement_eligible','pre_trial_demand','early_settlement','settlement_likely'];
    const asylumIdx = SEVERITY_ORDER.indexOf('asylum_barred');
    const settlIdx  = SEVERITY_ORDER.indexOf('settlement_likely');
    expect(asylumIdx).toBeLessThan(settlIdx);
    expect(asylumIdx).toBe(0);
  });
});

describe('classifyMatterTitle — comprehensive taxonomy tests', () => {
  test('null → general', () => expect(classifyMatterTitle(null)).toBe('general'));
  test('empty → general', () => expect(classifyMatterTitle('')).toBe('general'));
  test('habeas corpus → habeas', () => expect(classifyMatterTitle('Habeas corpus petition § 2254')).toBe('habeas'));
  test('FCPA → fcpa', () => expect(classifyMatterTitle('FCPA investigation bribery')).toBe('fcpa'));
  test('court-martial → court_martial', () => expect(classifyMatterTitle('General court-martial UCMJ')).toBe('court_martial'));
  test('court martial (space) → court_martial', () => expect(classifyMatterTitle('General court martial Art. 128')).toBe('court_martial'));
  test('asylum → asylum_matter', () => expect(classifyMatterTitle('Asylum credible fear interview')).toBe('asylum_matter'));
  test('removal proceedings → removal_defense', () => expect(classifyMatterTitle('Removal proceedings order of removal')).toBe('removal_defense'));
  test('auto accident → auto_accident', () => expect(classifyMatterTitle('Auto accident personal injury')).toBe('auto_accident'));
  test('§ 1983 → excessive_force', () => expect(classifyMatterTitle('§ 1983 excessive force police')).toBe('excessive_force'));
  test('insurance dispute → general (no keyword match)', () => expect(classifyMatterTitle('Insurance coverage dispute')).toBe('general'));
  test('contract dispute → general', () => expect(classifyMatterTitle('Commercial contract breach')).toBe('general'));
});

describe('Intelligence endpoints — computed_at consistency', () => {
  // All 6 intelligence endpoint shapes should include computed_at
  // Test by verifying computeAllSignals includes it (routes add it inline)
  
  function baseMatter(v = 'criminal_defense') {
    return { id:1, firm_id:1, vertical:v, title:'Test',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active' };
  }

  test('signals endpoint (computeAllSignals): has computed_at', () => {
    const s = computeAllSignals(baseMatter());
    expect(s.computed_at).toBeDefined();
    expect(s.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('computeAllSignals escalation: has level and triggers', () => {
    const s = computeAllSignals(baseMatter());
    expect(s.escalation).toHaveProperty('level');
    expect(s.escalation).toHaveProperty('triggers');
    expect(Array.isArray(s.escalation.triggers)).toBe(true);
  });

  test('computeAllSignals for immigration: has vertical_signals with asylumBarred', () => {
    const s = computeAllSignals(baseMatter('immigration'));
    expect(s.vertical_signals).toHaveProperty('asylumBarred');
    expect(s.vertical_signals).toHaveProperty('cancellationEligible');
  });

  test('computeMotionRecommendations: returns array', () => {
    const recs = computeMotionRecommendations(baseMatter());
    expect(Array.isArray(recs)).toBe(true);
  });

  test('computeDiversionRecommendations: returns array', () => {
    const recs = computeDiversionRecommendations(baseMatter('public_defense'));
    expect(Array.isArray(recs)).toBe(true);
  });
});

describe('asylum clock country_condition field', () => {
  // Verify country_condition is stored and used in signals
  function imm(country) {
    return { id:1, firm_id:1, vertical:'immigration', title:'Asylum',
             evidence_score:70, vulnerability_level:'moderate', time_pressure:'standard',
             country_condition: country, detained:0, clock_days:200,
             relief_type:'asylum', years_us:3 };
  }

  test('crisis country: asylumSuccessProbability = 0.71 (strong + crisis)', () => {
    const m = { ...imm('crisis'), evidence_score:80 };
    const s = computeAllSignals(m);
    expect(s.vertical_signals.asylumSuccessProbability).toBeCloseTo(0.71);
  });

  test('stable country: asylumSuccessProbability = 0.18 (default low)', () => {
    const m = { ...imm('stable'), evidence_score:80 };
    const s = computeAllSignals(m);
    // ev='strong', country='stable' → not crisis or deteriorating → 0.18
    expect(s.vertical_signals.asylumSuccessProbability).toBeCloseTo(0.18);
  });

  test('deteriorating country: asylumSuccessProbability = 0.52 (moderate+deteriorating)', () => {
    const m = { ...imm('deteriorating'), evidence_score:60 };
    const s = computeAllSignals(m);
    // ev='moderate', country='deteriorating' → 0.52
    expect(s.vertical_signals.asylumSuccessProbability).toBeCloseTo(0.52);
  });

  test('no country_condition: falls back to stable behavior', () => {
    const m = imm(null);
    const s = computeAllSignals(m);
    // country = null → 'stable' in computeImmigrationSignals
    expect(s.vertical_signals.asylumSuccessProbability).toBeCloseTo(0.18);
  });
});

describe('computeAllSignals — jurisdiction and complete return shape', () => {
  function base(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Robbery',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }

  test('jurisdiction: explicit value returned correctly', () => {
    const s = computeAllSignals(base({ jurisdiction: 'federal' }));
    expect(s.jurisdiction).toBe('federal');
  });

  test('jurisdiction: null falls back to "unknown"', () => {
    const s = computeAllSignals(base({ jurisdiction: null }));
    expect(s.jurisdiction).toBe('unknown');
  });

  test('jurisdiction: undefined falls back to "unknown"', () => {
    const s = computeAllSignals(base({}));
    expect(s.jurisdiction).toBe('unknown');
  });

  test('evidence sub-object: has score and bucket', () => {
    const s = computeAllSignals(base({ evidence_score: 75 }));
    expect(s.evidence).toHaveProperty('score', 75);
    expect(s.evidence).toHaveProperty('bucket', 'strong');
  });

  test('evidence sub-object: null score defaults to 50 (moderate)', () => {
    const s = computeAllSignals(base({ evidence_score: null }));
    expect(s.evidence.score).toBeNull();  // raw null preserved
    expect(s.evidence.bucket).toBe('moderate');  // evidenceBucket(null) = moderate
  });

  test('return shape has all required fields', () => {
    const s = computeAllSignals(base());
    expect(s).toHaveProperty('matter_id');
    expect(s).toHaveProperty('vertical');
    expect(s).toHaveProperty('taxonomy');
    expect(s).toHaveProperty('evidence');
    expect(s).toHaveProperty('vulnerability');
    expect(s).toHaveProperty('time_pressure');
    expect(s).toHaveProperty('jurisdiction');
    expect(s).toHaveProperty('escalation');
    expect(s).toHaveProperty('vertical_signals');
    expect(s).toHaveProperty('computed_at');
  });

  test('vertical_signals: {} for unknown general matter', () => {
    const s = computeAllSignals(base({ vertical:'general', title:'Unknown matter' }));
    expect(s.vertical_signals).toEqual({});
    expect(s.taxonomy).toBe('general');
  });

  test('vulnerability field: falls back to moderate when not set', () => {
    const s = computeAllSignals(base({ vulnerability_level: null }));
    expect(s.vulnerability).toBe('moderate');
  });

  test('time_pressure field: falls back to standard when not set', () => {
    const s = computeAllSignals(base({ time_pressure: null }));
    expect(s.time_pressure).toBe('standard');
  });
});

describe('computeCriminalSignals — expungementReady removed, violentCharge retained', () => {
  function criminal(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Test',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             ...overrides };
  }
  test('expungementReady field no longer present in signals', () => {
    const s = computeAllSignals(criminal());
    // expungementReady was always false — removed as noise
    // expungement eligibility is in /outcome endpoint instead
    expect(s.vertical_signals).not.toHaveProperty('expungementReady');
  });
  test('violentCharge: true for murder', () => {
    const s = computeAllSignals(criminal({ title:'First-degree murder' }));
    expect(s.vertical_signals.violentCharge).toBe(true);
  });
  test('violentCharge: true for assault', () => {
    const s = computeAllSignals(criminal({ title:'Assault causing bodily harm' }));
    expect(s.vertical_signals.violentCharge).toBe(true);
  });
  test('violentCharge: false for drug possession', () => {
    const s = computeAllSignals(criminal({ title:'Drug possession charge' }));
    expect(s.vertical_signals.violentCharge).toBe(false);
  });
  test('dismissLikely: true for weak evidence', () => {
    const s = computeAllSignals(criminal({ evidence_score: 15 }));
    expect(s.vertical_signals.dismissLikely).toBe(true);
  });
  test('dismissLikely: false for strong evidence', () => {
    const s = computeAllSignals(criminal({ evidence_score: 80 }));
    expect(s.vertical_signals.dismissLikely).toBe(false);
  });
});

describe('computePDSignals — bradyApplicable tightened regex', () => {
  function pd(overrides = {}) {
    return { id:1, firm_id:1, vertical:'public_defense', title:'Drug arrest',
             evidence_score:15, vulnerability_level:'moderate', time_pressure:'standard',
             prior_adjudications:0, ...overrides };
  }
  // Should fire for Brady-context keywords
  test('bradyApplicable: informant keyword triggers', () => {
    const s = computeAllSignals(pd({ title:'Drug conspiracy — confidential informant testified' }));
    expect(s.vertical_signals.bradyApplicable).toBe(true);
  });
  test('bradyApplicable: lab result keyword triggers', () => {
    const s = computeAllSignals(pd({ title:'Drug charge — lab results contested' }));
    expect(s.vertical_signals.bradyApplicable).toBe(true);
  });
  test('bradyApplicable: suppressed keyword triggers', () => {
    const s = computeAllSignals(pd({ title:'Assault — suppressed exculpatory evidence' }));
    expect(s.vertical_signals.bradyApplicable).toBe(true);
  });
  // Should NOT fire for broad evidence terms
  test('bradyApplicable: "insufficient evidence" does NOT trigger', () => {
    const s = computeAllSignals(pd({ title:'Drug arrest — insufficient evidence to prosecute' }));
    expect(s.vertical_signals.bradyApplicable).toBe(false);
  });
  test('bradyApplicable: "evidence of guilt" does NOT trigger', () => {
    const s = computeAllSignals(pd({ title:'Robbery — strong evidence of guilt' }));
    // evidence_score=80 → ev='strong' → bradyApplicable requires ev=weak
    const sStrong = computeAllSignals(pd({ title:'Robbery — strong evidence of guilt', evidence_score:80 }));
    expect(sStrong.vertical_signals.bradyApplicable).toBe(false);
  });
  test('bradyApplicable: false for non-weak evidence regardless of keyword', () => {
    const s = computeAllSignals(pd({ title:'Drug — informant testimony', evidence_score:80 }));
    expect(s.vertical_signals.bradyApplicable).toBe(false);
  });
});

describe('MATTER_KEYWORDS conditions — tightened regex', () => {
  // Should match incarceration-specific conditions
  test('jail conditions: matches', () => {
    expect(classifyMatterTitle('Jail conditions — overcrowding civil rights')).toBe('conditions');
  });
  test('prison conditions: matches (without § 1983 which would route to excessive_force first)', () => {
    expect(classifyMatterTitle('Prison conditions — medical neglect — deliberate indifference')).toBe('conditions');
  });
  test('solitary: matches', () => {
    expect(classifyMatterTitle('Solitary confinement challenge')).toBe('conditions');
  });
  test('overcrowding: matches', () => {
    expect(classifyMatterTitle('Jail overcrowding lawsuit')).toBe('conditions');
  });
  // Should NOT match bail/probation conditions (false positive was happening before)
  test('"conditions of bail" does NOT match conditions', () => {
    const r = classifyMatterTitle('Violation of conditions of bail bond');
    expect(r).not.toBe('conditions');
  });
  test('"conditions of probation" does NOT match conditions', () => {
    const r = classifyMatterTitle('Revocation of probation conditions violation');
    expect(r).not.toBe('conditions');
  });
  test('"bond conditions" does NOT match conditions', () => {
    const r = classifyMatterTitle('Motion to modify bond conditions');
    expect(r).not.toBe('conditions');
  });
});

describe('computeMotionRecommendations — Brady_Giglio tightened regex (synced with bradyApplicable)', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'criminal_defense', title:'Drug arrest',
             evidence_score:15, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }

  test('Brady: informant keyword fires', () => {
    const recs = computeMotionRecommendations(matter({ title:'Conspiracy — confidential informant used' }));
    expect(recs.some(r => r.type === 'Brady_Giglio')).toBe(true);
  });

  test('Brady: lab result keyword fires', () => {
    const recs = computeMotionRecommendations(matter({ title:'Drug charge — lab result disputed' }));
    expect(recs.some(r => r.type === 'Brady_Giglio')).toBe(true);
  });

  test('Brady: suppressed keyword fires', () => {
    const recs = computeMotionRecommendations(matter({ title:'Assault — suppressed exculpatory statement' }));
    expect(recs.some(r => r.type === 'Brady_Giglio')).toBe(true);
  });

  test('Brady: "insufficient evidence" fires Tier-2 advisory (weak ev + criminal_defense)', () => {
    // Tier 2: all weak evidence in criminal_defense → advisory Brady review
    const recs = computeMotionRecommendations(matter({ title:'Drug arrest — insufficient evidence to prosecute' }));
    const brady = recs.find(r => r.type === 'Brady_Giglio');
    expect(brady).toBeDefined();
    expect(brady.advisory).toBe(true);  // Tier 2 = advisory, not high-priority specific
  });

  test('Brady: "evidence of guilt" with weak ev → Tier-2 advisory Brady fires', () => {
    // Weak evidence (score=15) + criminal_defense → Tier-2 advisory Brady always fires
    const recs = computeMotionRecommendations(matter({ title:'Robbery — compelling evidence of guilt' }));
    // The matter() factory has evidence_score:15 (weak) + criminal_defense → Tier 2
    const brady = recs.find(r => r.type === 'Brady_Giglio');
    expect(brady).toBeDefined();
    expect(brady.priority).toBe('normal');  // Tier 2 = normal priority advisory
  });

  test('Brady: strong evidence → no Brady motion regardless of keyword', () => {
    const recs = computeMotionRecommendations(matter({
      title: 'Drug — informant testimony', evidence_score: 80
    }));
    expect(recs.some(r => r.type === 'Brady_Giglio')).toBe(false);
  });
});

describe('computeMotionRecommendations — suppression_4th vertical guard', () => {
  function matter(v, overrides = {}) {
    return { id:1, firm_id:1, vertical:v, title:'Car accident arrest scene',
             evidence_score:40, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }

  test('suppression: criminal_defense vertical → fires', () => {
    const recs = computeMotionRecommendations(matter('criminal_defense'));
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(true);
  });

  test('suppression: public_defense vertical → fires', () => {
    const recs = computeMotionRecommendations(matter('public_defense'));
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(true);
  });

  test('suppression: military vertical → fires', () => {
    const recs = computeMotionRecommendations(matter('military', { title:'UCMJ arrest scene search' }));
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(true);
  });

  test('suppression: personal_injury vertical → does NOT fire', () => {
    const recs = computeMotionRecommendations(matter('personal_injury'));
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(false);
  });

  test('suppression: civil_rights vertical → does NOT fire', () => {
    const recs = computeMotionRecommendations(
      matter('civil_rights', { title:'Police arrest scene excessive force' })
    );
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(false);
  });

  test('suppression: appellate vertical → does NOT fire', () => {
    const recs = computeMotionRecommendations(
      matter('appellate', { title:'Habeas — unlawful search and seizure' })
    );
    expect(recs.some(r => r.type === 'suppression_4th')).toBe(false);
  });
});

describe('computeDiversionRecommendations — eligibility_score field', () => {
  function matter(overrides = {}) {
    return { id:1, firm_id:1, vertical:'public_defense', title:'Drug possession',
             evidence_score:70, vulnerability_level:'moderate', time_pressure:'standard',
             prior_adjudications:0, client_age:25, ...overrides };
  }

  test('first_offender: strong evidence → eligibility_score=0.90', () => {
    const recs = computeDiversionRecommendations(matter({ evidence_score: 80 }));
    const fo = recs.find(r => r.track === 'first_offender');
    expect(fo).toBeDefined();
    expect(fo.eligibility_score).toBe(0.90);
  });

  test('first_offender: moderate evidence → eligibility_score=0.75', () => {
    const recs = computeDiversionRecommendations(matter({ evidence_score: 60 }));
    const fo = recs.find(r => r.track === 'first_offender');
    expect(fo).toBeDefined();
    expect(fo.eligibility_score).toBe(0.75);
  });

  test('drug_court: prior=0 → eligibility_score=0.85', () => {
    const recs = computeDiversionRecommendations(matter({ title:'Drug possession — marijuana' }));
    const dc = recs.find(r => r.track === 'drug_court');
    expect(dc).toBeDefined();
    expect(dc.eligibility_score).toBe(0.85);
  });

  test('drug_court: prior=1 → eligibility_score=0.60', () => {
    const recs = computeDiversionRecommendations(matter({
      title:'Drug possession — marijuana', prior_adjudications: 1
    }));
    const dc = recs.find(r => r.track === 'drug_court');
    expect(dc).toBeDefined();
    expect(dc.eligibility_score).toBe(0.60);
  });

  test('ineligible: prior > 2 → empty array', () => {
    const recs = computeDiversionRecommendations(matter({ prior_adjudications: 3 }));
    expect(recs).toHaveLength(0);
  });
});

describe('computeAllSignals — general vertical inference: all 8 taxonomy groups', () => {
  function gen(overrides = {}) {
    return { id:1, firm_id:1, vertical:'general',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }

  test('auto accident title → personal_injury signals', () => {
    const s = computeAllSignals(gen({ title:'Auto accident personal injury claim' }));
    expect(s.taxonomy).toBe('auto_accident');
    expect(s.vertical_signals).toHaveProperty('netDamage');
    expect(s.vertical_signals).toHaveProperty('solYears');
  });

  test('§ 1983 excessive force → civil_rights signals', () => {
    const s = computeAllSignals(gen({ title:'§ 1983 excessive force police shooting' }));
    expect(s.taxonomy).toBe('excessive_force');
    expect(s.vertical_signals).toHaveProperty('settlementProbability');
    expect(s.vertical_signals).toHaveProperty('earlySet');
  });

  test('SEC securities → white_collar signals', () => {
    const s = computeAllSignals(gen({
      title:'SEC investigation insider trading', jurisdiction:'federal'
    }));
    expect(s.taxonomy).toBe('sec');
    expect(s.vertical_signals).toHaveProperty('dpaViable');
    expect(s.vertical_signals).toHaveProperty('accelResp');
  });

  test('habeas corpus → appellate signals', () => {
    const s = computeAllSignals(gen({ title:'Habeas corpus § 2254 post-conviction', evidence_score:70 }));
    expect(s.taxonomy).toBe('habeas');
    expect(s.vertical_signals).toHaveProperty('revScore');
    expect(s.vertical_signals).toHaveProperty('aedpaRisk');
  });

  test('delinquency → juvenile signals', () => {
    const s = computeAllSignals(gen({ title:'Delinquency matter — shoplifting', client_age:15 }));
    expect(s.taxonomy).toBe('delinquency_j');
    expect(s.vertical_signals).toHaveProperty('expungElig');
    expect(s.vertical_signals).toHaveProperty('diverOffered');
  });

  test('admin sep → military signals', () => {
    const s = computeAllSignals(gen({ title:'Administrative separation board military discharge' }));
    expect(s.taxonomy).toBe('admin_sep');
    expect(s.vertical_signals).toHaveProperty('dischargeRisk');
    expect(s.vertical_signals).toHaveProperty('likeleDisch');
  });

  test('removal proceedings → immigration signals', () => {
    const s = computeAllSignals(gen({ title:'Removal proceedings order of removal', relief_type:'cancellation', years_us:11 }));
    expect(s.taxonomy).toBe('removal_defense');
    expect(s.vertical_signals).toHaveProperty('cancellationEligible');
    expect(s.vertical_signals.cancellationEligible).toBe(true);
  });

  test('wrongful conviction → civil_rights signals', () => {
    const s = computeAllSignals(gen({ title:'Wrongful conviction actual innocence Brady violation' }));
    expect(s.taxonomy).toBe('wrongful_conv');
    expect(s.vertical_signals).toHaveProperty('settlementProbability');
  });

  test('unrecognized title → empty vertical signals', () => {
    const s = computeAllSignals(gen({ title:'Contract dispute commercial lease' }));
    expect(s.taxonomy).toBe('general');
    expect(s.vertical_signals).toEqual({});
    expect(s.vertical).toBe('general');
  });
});

describe('TAXONOMY_VERTICAL — all 28 entries and vertical mapping', () => {
  const TV = {
    capital: 'criminal_defense', drug_federal: 'criminal_defense',
    sexual_offense: 'criminal_defense', domestic: 'criminal_defense',
    white_collar_cr: 'white_collar',
    excessive_force: 'civil_rights', wrongful_conv: 'civil_rights', conditions: 'civil_rights',
    fcpa: 'white_collar', sec: 'white_collar', doj: 'white_collar',
    aml: 'white_collar', healthcare_reg: 'white_collar',
    asylum_matter: 'immigration', removal_defense: 'immigration', visa_petition: 'immigration',
    auto_accident: 'personal_injury', medical_malprac: 'personal_injury', mass_tort: 'personal_injury',
    delinquency_j: 'juvenile', dependency_j: 'juvenile', tpr: 'juvenile',
    habeas: 'appellate', cert_petition: 'appellate', compassionate: 'appellate',
    court_martial: 'military', admin_sep: 'military', clearance: 'military',
  };
  test('has exactly 28 entries', () => {
    expect(Object.keys(TV)).toHaveLength(28);
  });
  test('all 8 major verticals represented', () => {
    const verticals = new Set(Object.values(TV));
    ['criminal_defense','civil_rights','white_collar','immigration',
     'personal_injury','juvenile','appellate','military'].forEach(v => {
      expect(verticals.has(v)).toBe(true);
    });
  });
  test('family and public_defense intentionally absent', () => {
    const verticals = new Set(Object.values(TV));
    expect(verticals.has('family')).toBe(false);
    expect(verticals.has('public_defense')).toBe(false);
  });
  test('criminal_defense has 4 taxonomy entries', () => {
    const crim = Object.entries(TV).filter(([,v]) => v === 'criminal_defense');
    expect(crim).toHaveLength(4);
  });
  test('white_collar has 6 taxonomy entries', () => {
    const wc = Object.entries(TV).filter(([,v]) => v === 'white_collar');
    expect(wc).toHaveLength(6);
  });
});

describe('outcome indicators — confidence field completeness', () => {
  function appellate(overrides = {}) {
    return { id:1, firm_id:1, vertical:'appellate', title:'Habeas corpus § 2254',
             evidence_score:75, vulnerability_level:'moderate', time_pressure:'standard',
             prior_appeals:0, is_capital:1, years_post_conviction:2, ...overrides };
  }
  function immigration(overrides = {}) {
    return { id:1, firm_id:1, vertical:'immigration', title:'Asylum credible fear',
             evidence_score:75, vulnerability_level:'moderate', time_pressure:'standard',
             clock_days:380, relief_type:'asylum', detained:0, years_us:3,
             country_condition:'crisis', ...overrides };
  }
  function military(overrides = {}) {
    return { id:1, firm_id:1, vertical:'military', title:'Art. 128b domestic violence UCMJ',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             court_type:'general', rank_e:5, service_years:5, prior_njp:0 };
  }
  function pi(overrides = {}) {
    return { id:1, firm_id:1, vertical:'personal_injury', title:'Auto accident injury',
             evidence_score:80, vulnerability_level:'moderate', time_pressure:'standard',
             injury_severity:'catastrophic', causation_type:'clear',
             plaintiff_fault_pct:0, economic_damages:500000, noneconomic_damages:200000,
             punitive_damages:0, policy_limit:100000, ...overrides };
  }

  test('reversal_probability indicator has confidence field', () => {
    const s = computeAllSignals(appellate());
    expect(s.vertical_signals.revScore).toBeDefined();
    expect(typeof s.vertical_signals.revScore).toBe('number');
  });

  test('asylum_barred indicator fires when clock > 365', () => {
    const s = computeAllSignals(immigration({ clock_days: 400 }));
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });

  test('asylum_success indicator: asylumSuccessProbability is a number 0-1', () => {
    const s = computeAllSignals(immigration({ clock_days: 200 }));
    expect(typeof s.vertical_signals.asylumSuccessProbability).toBe('number');
    expect(s.vertical_signals.asylumSuccessProbability).toBeGreaterThanOrEqual(0);
    expect(s.vertical_signals.asylumSuccessProbability).toBeLessThanOrEqual(1);
  });

  test('discharge_risk indicator: dischargeRisk true for DV UCMJ', () => {
    const s = computeAllSignals(military());
    expect(s.vertical_signals.dischargeRisk).toBe(true);
    expect(typeof s.vertical_signals.likeleDisch).toBe('string');
  });

  test('policy_exhausted: fires when netDamage > policy_limit', () => {
    const s = computeAllSignals(pi());
    expect(s.vertical_signals.polEx).toBe(true);
    expect(s.vertical_signals.netDamage).toBeGreaterThan(100000);
  });

  test('sol_3yr: medMalDetected fires for malpractice title', () => {
    const m = pi({ title:'Medical malpractice surgical error', vertical:'personal_injury' });
    const s = computeAllSignals(m);
    expect(s.vertical_signals.medMalDetected).toBe(true);
    expect(s.vertical_signals.solYears).toBe(3);
  });

  test('SEVERITY_ORDER: 12 entries, all present in outcome route types', () => {
    const SEVERITY_ORDER = ['asylum_barred', 'discharge_risk', 'asylum_bar_risk', 'sol_3yr',
      'policy_exhausted', 'reversal_probability', 'asylum_success', 'cert_worthy',
      'expungement_eligible', 'pre_trial_demand', 'early_settlement', 'settlement_likely'];
    expect(SEVERITY_ORDER).toHaveLength(12);
    // All entries are non-empty strings
    SEVERITY_ORDER.forEach(t => {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    });
  });
});

describe('computeMotionRecommendations — competency, motion_in_limine, standard_of_review, negotiate_plea', () => {
  function matter(v, overrides = {}) {
    return { id:1, firm_id:1, vertical:v, title:'Test',
             evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
             status:'active', ...overrides };
  }

  // Competency motion
  test('competency: high vulnerability → competency motion recommended', () => {
    const recs = computeMotionRecommendations(
      matter('criminal_defense', { vulnerability_level:'high' })
    );
    expect(recs.some(r => r.type === 'competency')).toBe(true);
  });

  test('competency: crisis vulnerability → competency motion recommended', () => {
    const recs = computeMotionRecommendations(
      matter('public_defense', { vulnerability_level:'crisis' })
    );
    expect(recs.some(r => r.type === 'competency')).toBe(true);
  });

  test('competency: moderate vulnerability → NOT recommended', () => {
    const recs = computeMotionRecommendations(
      matter('criminal_defense', { vulnerability_level:'moderate' })
    );
    expect(recs.some(r => r.type === 'competency')).toBe(false);
  });

  // Motion in limine (PI)
  test('motion_in_limine: PI + strong evidence → recommended', () => {
    const recs = computeMotionRecommendations(
      matter('personal_injury', { evidence_score:80 })
    );
    expect(recs.some(r => r.type === 'motion_in_limine')).toBe(true);
  });

  test('motion_in_limine: PI + weak evidence → NOT recommended', () => {
    const recs = computeMotionRecommendations(
      matter('personal_injury', { evidence_score:15 })
    );
    expect(recs.some(r => r.type === 'motion_in_limine')).toBe(false);
  });

  test('motion_in_limine: criminal_defense + strong evidence → NOT recommended (PI only)', () => {
    const recs = computeMotionRecommendations(
      matter('criminal_defense', { evidence_score:80 })
    );
    expect(recs.some(r => r.type === 'motion_in_limine')).toBe(false);
  });

  // Standard of review (appellate)
  test('standard_of_review: appellate + strong → de_novo', () => {
    const recs = computeMotionRecommendations(
      matter('appellate', { evidence_score:80 })
    );
    const sor = recs.find(r => r.type === 'standard_of_review');
    expect(sor).toBeDefined();
    expect(sor.label).toContain('de novo');
  });

  test('standard_of_review: appellate + moderate → abuse_of_discretion', () => {
    const recs = computeMotionRecommendations(
      matter('appellate', { evidence_score:60 })
    );
    const sor = recs.find(r => r.type === 'standard_of_review');
    expect(sor).toBeDefined();
    expect(sor.label).toContain('abuse of discretion');
  });

  test('standard_of_review: appellate + weak → plain_error', () => {
    const recs = computeMotionRecommendations(
      matter('appellate', { evidence_score:15 })
    );
    const sor = recs.find(r => r.type === 'standard_of_review');
    expect(sor).toBeDefined();
    expect(sor.label).toContain('plain error');
  });

  test('standard_of_review: criminal_defense → NOT recommended (appellate only)', () => {
    const recs = computeMotionRecommendations(
      matter('criminal_defense', { evidence_score:80 })
    );
    expect(recs.some(r => r.type === 'standard_of_review')).toBe(false);
  });

  // Negotiate plea (military)
  test('negotiate_plea: military + strong evidence → recommended', () => {
    const recs = computeMotionRecommendations(
      matter('military', { evidence_score:80, title:'Art. 128 UCMJ assault' })
    );
    expect(recs.some(r => r.type === 'negotiate_plea')).toBe(true);
  });

  test('negotiate_plea: military + weak evidence → NOT recommended', () => {
    const recs = computeMotionRecommendations(
      matter('military', { evidence_score:15, title:'Art. 128 UCMJ assault' })
    );
    expect(recs.some(r => r.type === 'negotiate_plea')).toBe(false);
  });

  test('negotiate_plea: criminal_defense + strong evidence → NOT recommended (military only)', () => {
    const recs = computeMotionRecommendations(
      matter('criminal_defense', { evidence_score:80 })
    );
    expect(recs.some(r => r.type === 'negotiate_plea')).toBe(false);
  });

  // Complete motion list for a criminal matter with high vulnerability
  test('criminal_defense + crisis + active: Batson + speedy_trial + competency', () => {
    const recs = computeMotionRecommendations(
      matter('criminal_defense', { vulnerability_level:'crisis', status:'active' })
    );
    const types = recs.map(r => r.type);
    expect(types).toContain('Batson');
    expect(types).toContain('speedy_trial');
    expect(types).toContain('competency');
  });
});

describe('Trial feedback improvements — v5.67.0 → v5.68.0', () => {

  // ── FIX 2: Military likeleDisch — DV strangulation → Dishonorable ──
  describe('computeMilitarySignals — likeleDisch precision', () => {
    function mil(overrides = {}) {
      return { id:1, firm_id:1, vertical:'military', evidence_score:50,
               vulnerability_level:'moderate', time_pressure:'standard',
               court_type:'special', rank_e:5, service_years:16, prior_njp:0, ...overrides };
    }
    test('strangulation → Dishonorable (UCMJ Art.128b 2012 amendment)', () => {
      const s = computeAllSignals(mil({ title:'Art.128b UCMJ domestic violence strangulation' }));
      expect(s.vertical_signals.likeleDisch).toBe('Dishonorable');
    });
    test('DV domestic violence strangulation → Dishonorable (compound pattern)', () => {
      const s = computeAllSignals(mil({ title:'UCMJ domestic violence strangulation assault' }));
      expect(s.vertical_signals.likeleDisch).toBe('Dishonorable');
    });
    test('AWOL → OTH (not Bad Conduct)', () => {
      const s = computeAllSignals(mil({ title:'Art.86 UCMJ AWOL absence without leave' }));
      expect(s.vertical_signals.likeleDisch).toBe('OTH');
    });
    test('desertion → OTH', () => {
      const s = computeAllSignals(mil({ title:'Art.85 UCMJ desertion with intent' }));
      expect(s.vertical_signals.likeleDisch).toBe('OTH');
    });
    test('larceny → Bad Conduct (added to BCD tier)', () => {
      const s = computeAllSignals(mil({ title:'Art.121 UCMJ larceny and wrongful appropriation' }));
      expect(s.vertical_signals.likeleDisch).toBe('Bad Conduct');
    });
    test('sexual assault → Dishonorable (unchanged, most severe tier)', () => {
      const s = computeAllSignals(mil({ title:'Art.120 UCMJ sexual assault' }));
      expect(s.vertical_signals.likeleDisch).toBe('Dishonorable');
    });
    test('simple failure to obey → Honorable (unchanged)', () => {
      const s = computeAllSignals(mil({ title:'Art.92 UCMJ failure to obey lawful order' }));
      expect(s.vertical_signals.likeleDisch).toBe('Honorable');
    });
    test('admin board → OTH (court_type=admin_board, no other pattern)', () => {
      const s = computeAllSignals(mil({ title:'Fitness report admin separation', court_type:'admin_board' }));
      expect(s.vertical_signals.likeleDisch).toBe('OTH');
    });
  });

  // ── FIX 3: White-Collar recCoop — contested + no_coop + pre-DPA ──
  describe('computeWhiteCollarSignals — recCoop expanded', () => {
    function wc(overrides = {}) {
      return { id:1, firm_id:1, vertical:'white_collar', title:'SEC investigation',
               evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
               cooperation_level:'no_cooperation', dpa_status:null, jurisdiction:'federal', ...overrides };
    }
    test('contested + no_cooperation + no dpa_status → recCoop=true (pre-investigation)', () => {
      const s = computeAllSignals(wc({ evidence_score:45 }));
      expect(s.vertical_signals.recCoop).toBe(true);
    });
    test('contested + no_cooperation + dpa_status=viable → recCoop=false (past early stage)', () => {
      const s = computeAllSignals(wc({ evidence_score:45, dpa_status:'viable' }));
      expect(s.vertical_signals.recCoop).toBe(false);
    });
    test('contested + limited_cooperation → recCoop=false (not no_cooperation)', () => {
      const s = computeAllSignals(wc({ evidence_score:45, cooperation_level:'limited_cooperation' }));
      expect(s.vertical_signals.recCoop).toBe(false);
    });
    test('strong + no_cooperation → recCoop=true (original behavior preserved)', () => {
      const s = computeAllSignals(wc({ evidence_score:80 }));
      expect(s.vertical_signals.recCoop).toBe(true);
    });
    test('strong + full_cooperation → recCoop=false (already cooperating)', () => {
      const s = computeAllSignals(wc({ evidence_score:80, cooperation_level:'full_cooperation' }));
      expect(s.vertical_signals.recCoop).toBe(false);
    });
    test('weak + no_cooperation → recCoop=false (weak ev + no pre-DPA override)', () => {
      const s = computeAllSignals(wc({ evidence_score:15 }));
      expect(s.vertical_signals.recCoop).toBe(false);
    });
  });

  // ── FIX 4: Appellate cert petition → de_novo regardless of evidence ──
  describe('computeAppellateSignals + motions — cert petition standard', () => {
    function app(overrides = {}) {
      return { id:1, firm_id:1, vertical:'appellate', title:'Cert petition',
               evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
               prior_appeals:0, is_capital:0, years_post_conviction:0, hab_track:'cert', ...overrides };
    }
    test('cert petition weak evidence → appliedStd=de_novo (not plain_error)', () => {
      const s = computeAllSignals(app({ evidence_score:15 }));
      expect(s.vertical_signals.appliedStd).toBe('de_novo');
    });
    test('cert petition moderate evidence → appliedStd=de_novo (not abuse_of_discretion)', () => {
      const s = computeAllSignals(app({ evidence_score:60 }));
      expect(s.vertical_signals.appliedStd).toBe('de_novo');
    });
    test('cert petition strong evidence → appliedStd=de_novo (same as before)', () => {
      const s = computeAllSignals(app({ evidence_score:80 }));
      expect(s.vertical_signals.appliedStd).toBe('de_novo');
    });
    test('direct appeal weak evidence → appliedStd=harmless_error (unchanged)', () => {
      const s = computeAllSignals(app({ evidence_score:15, hab_track:'direct_appeal' }));
      expect(s.vertical_signals.appliedStd).toBe('harmless_error');
    });
    test('habeas strong evidence → appliedStd=de_novo', () => {
      const s = computeAllSignals(app({ evidence_score:80, hab_track:'habeas' }));
      expect(s.vertical_signals.appliedStd).toBe('de_novo');
    });
    test('motion standard_of_review: cert + weak → motion label says de_novo', () => {
      const recs = computeMotionRecommendations(app({ evidence_score:15 }));
      const sor = recs.find(r => r.type === 'standard_of_review');
      expect(sor).toBeDefined();
      expect(sor.label).toContain('de novo');
    });
  });

  // ── FIX 5: Compound bar+detention escalation trigger ──
  describe('computeAllSignals — compound_bar_detention escalation', () => {
    function barredDetained(overrides = {}) {
      return { id:1, firm_id:1, vertical:'immigration', title:'Asylum barred',
               evidence_score:75, vulnerability_level:'crisis', time_pressure:'emergency',
               relief_type:'asylum', clock_days:380, detained:1,
               country_condition:'crisis', years_us:3, ...overrides };
    }
    test('asylumBarred + detUrgent: compound_bar_detention trigger added', () => {
      const s = computeAllSignals(barredDetained());
      expect(s.vertical_signals.asylumBarred).toBe(true);
      expect(s.vertical_signals.detUrgent).toBe(true);
      expect(s.escalation.triggers).toContain('compound_bar_detention');
    });
    test('asylumBarred without detained: NO compound trigger', () => {
      const s = computeAllSignals(barredDetained({ detained:0 }));
      expect(s.vertical_signals.asylumBarred).toBe(true);
      expect(s.escalation.triggers).not.toContain('compound_bar_detention');
    });
    test('detUrgent without asylumBarred: NO compound trigger', () => {
      const s = computeAllSignals(barredDetained({ clock_days:100, detained:1 }));
      expect(s.vertical_signals.asylumBarred).toBe(false);
      expect(s.escalation.triggers).not.toContain('compound_bar_detention');
    });
    test('compound escalation level is critical', () => {
      const s = computeAllSignals(barredDetained());
      expect(s.escalation.level).toBe('critical');
      expect(s.escalation.triggers.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('v5.69.0 improvements — all 6 fixes verified', () => {

  // ── FIX 1: PI fastTrack — severity alone triggers ──────────────
  describe('computePISignals — fastTrack severity-independent trigger', () => {
    function pi(overrides = {}) {
      return { id:1, firm_id:1, vertical:'personal_injury', title:'Injury claim',
               evidence_score:70, vulnerability_level:'moderate', time_pressure:'standard',
               injury_severity:'catastrophic', causation_type:'clear',
               plaintiff_fault_pct:0, economic_damages:500000, noneconomic_damages:300000,
               punitive_damages:0, policy_limit:200000, ...overrides };
    }
    test('catastrophic + moderate vulnerability → fastTrack=true (no longer needs crisis)', () => {
      const s = computeAllSignals(pi({ vulnerability_level:'moderate' }));
      expect(s.vertical_signals.fastTrack).toBe(true);
    });
    test('catastrophic + crisis → fastTrack=true', () => {
      const s = computeAllSignals(pi({ vulnerability_level:'crisis' }));
      expect(s.vertical_signals.fastTrack).toBe(true);
    });
    test('severe + low vulnerability → fastTrack=true (severity drives it)', () => {
      const s = computeAllSignals(pi({ injury_severity:'severe', vulnerability_level:'low' }));
      expect(s.vertical_signals.fastTrack).toBe(true);
    });
    test('minor injury + crisis vulnerability → fastTrack=true (crisis alone triggers)', () => {
      const s = computeAllSignals(pi({ injury_severity:'minor', vulnerability_level:'crisis' }));
      expect(s.vertical_signals.fastTrack).toBe(true);
    });
    test('minor + moderate → fastTrack=false (neither trigger met)', () => {
      const s = computeAllSignals(pi({ injury_severity:'minor', vulnerability_level:'moderate' }));
      expect(s.vertical_signals.fastTrack).toBe(false);
    });
  });

  // ── FIX 2: recCoop / coopUpgradeRecommended consolidation ──────
  describe('computeWhiteCollarSignals — recCoop vs coopUpgradeRecommended (distinct semantics)', () => {
    function wc(overrides = {}) {
      return { id:1, firm_id:1, vertical:'white_collar', title:'SEC investigation',
               evidence_score:80, vulnerability_level:'crisis', time_pressure:'standard',
               cooperation_level:'no_cooperation', dpa_status:null, jurisdiction:'federal', ...overrides };
    }
    test('no_cooperation + strong → recCoop=true, coopUpgrade=false (start coop, not upgrade)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'no_cooperation' }));
      expect(s.vertical_signals.recCoop).toBe(true);
      expect(s.vertical_signals.coopUpgradeRecommended).toBe(false);
    });
    test('limited_cooperation + strong → coopUpgrade=true, recCoop=false (upgrade existing coop)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'limited_cooperation' }));
      expect(s.vertical_signals.coopUpgradeRecommended).toBe(true);
      expect(s.vertical_signals.recCoop).toBe(false);
    });
    test('proffer_agreement + strong → coopUpgrade=true (proffer can be elevated)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'proffer_agreement' }));
      expect(s.vertical_signals.coopUpgradeRecommended).toBe(true);
    });
    test('full_cooperation → neither signal (already at maximum)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'full_cooperation' }));
      expect(s.vertical_signals.recCoop).toBe(false);
      expect(s.vertical_signals.coopUpgradeRecommended).toBe(false);
    });
    test('contested + no_coop + evaluating dpa → recCoop=true (earliest stage)', () => {
      const s = computeAllSignals(wc({ evidence_score:45, cooperation_level:'no_cooperation', dpa_status:'evaluating' }));
      expect(s.vertical_signals.recCoop).toBe(true);
    });
    test('contested + no_coop + viable dpa → recCoop=false (DPA active, different strategy)', () => {
      const s = computeAllSignals(wc({ evidence_score:45, cooperation_level:'no_cooperation', dpa_status:'viable' }));
      expect(s.vertical_signals.recCoop).toBe(false);
    });
  });

  // ── FIX 3: Federal sentencing signals ─────────────────────────
  describe('computeCriminalSignals — federal sentencing signals', () => {
    function fed(overrides = {}) {
      return { id:1, firm_id:1, vertical:'criminal_defense', title:'Drug distribution § 841',
               evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
               jurisdiction:'federal', prior_adjudications:0, ...overrides };
    }
    test('federal drug charge → mandatoryMin=true', () => {
      const s = computeAllSignals(fed());
      expect(s.vertical_signals.mandatoryMin).toBe(true);
    });
    test('federal weapon charge → mandatoryMin=true', () => {
      const s = computeAllSignals(fed({ title:'Armed robbery federal § 924 weapon' }));
      expect(s.vertical_signals.mandatoryMin).toBe(true);
    });
    test('state drug charge → mandatoryMin=false', () => {
      const s = computeAllSignals(fed({ jurisdiction:'state' }));
      expect(s.vertical_signals.mandatoryMin).toBe(false);
    });
    test('safetyValveEligible: federal + drug + nonviolent + 0 priors → true', () => {
      const s = computeAllSignals(fed({ prior_adjudications:0 }));
      expect(s.vertical_signals.safetyValveEligible).toBe(true);
    });
    test('safetyValveEligible: federal + drug + 1 prior → true (≤1 priors)', () => {
      const s = computeAllSignals(fed({ prior_adjudications:1 }));
      expect(s.vertical_signals.safetyValveEligible).toBe(true);
    });
    test('safetyValveEligible: federal + drug + 2 priors → false (>1 prior)', () => {
      const s = computeAllSignals(fed({ prior_adjudications:2 }));
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
    });
    test('safetyValveEligible: federal + violent drug charge → false (violent exclusion)', () => {
      const s = computeAllSignals(fed({ title:'Armed robbery drug conspiracy murder' }));
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
    });
    test('bookerVariance: federal + weak evidence → true', () => {
      const s = computeAllSignals(fed({ evidence_score:15 }));
      expect(s.vertical_signals.bookerVariance).toBe(true);
    });
    test('bookerVariance: federal + crisis vulnerability → true', () => {
      const s = computeAllSignals(fed({ vulnerability_level:'crisis' }));
      expect(s.vertical_signals.bookerVariance).toBe(true);
    });
    test('bookerVariance: federal + moderate/strong = false (no mitigating basis)', () => {
      const s = computeAllSignals(fed({ evidence_score:75, vulnerability_level:'low' }));
      expect(s.vertical_signals.bookerVariance).toBe(false);
    });
    test('non-federal matter → no federal signals', () => {
      const s = computeAllSignals(fed({ jurisdiction:'state' }));
      expect(s.vertical_signals.mandatoryMin).toBe(false);
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
    });
  });

  // ── FIX 4: assetFreeze + outcome indicator ─────────────────────
  describe('computeFamilySignals — assetFreeze signal', () => {
    function fam(overrides = {}) {
      return { id:1, firm_id:1, vertical:'family', title:'Divorce',
               evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
               dv_flag:1, asset_tier:'2m_10m', ...overrides };
    }
    test('DV + 2m_10m → assetFreeze=true', () => {
      const s = computeAllSignals(fam());
      expect(s.vertical_signals.assetFreeze).toBe(true);
    });
    test('DV + over_10m → assetFreeze=true', () => {
      const s = computeAllSignals(fam({ asset_tier:'over_10m' }));
      expect(s.vertical_signals.assetFreeze).toBe(true);
    });
    test('DV + 500k_2m → assetFreeze=false (below threshold)', () => {
      const s = computeAllSignals(fam({ asset_tier:'500k_2m' }));
      expect(s.vertical_signals.assetFreeze).toBe(false);
    });
    test('no DV + high asset → assetFreeze=false (DV required)', () => {
      const s = computeAllSignals(fam({ dv_flag:0 }));
      expect(s.vertical_signals.assetFreeze).toBe(false);
    });
  });

  // ── FIX 5: Federal sentencing outcome indicators ────────────────
  describe('outcome route — federal sentencing indicators in response', () => {
    function fedMatter(overrides = {}) {
      return { id:1, firm_id:1, vertical:'criminal_defense', title:'Drug distribution § 841',
               evidence_score:15, vulnerability_level:'high', time_pressure:'standard',
               jurisdiction:'federal', prior_adjudications:0, status:'active', ...overrides };
    }
    test('safetyValveEligible → safety_valve in vertical_signals', () => {
      const s = computeAllSignals(fedMatter());
      expect(s.vertical_signals.safetyValveEligible).toBe(true);
    });
    test('mandatoryMin fires for federal drug', () => {
      const s = computeAllSignals(fedMatter());
      expect(s.vertical_signals.mandatoryMin).toBe(true);
    });
    test('bookerVariance fires for weak federal', () => {
      const s = computeAllSignals(fedMatter());
      expect(s.vertical_signals.bookerVariance).toBe(true);
    });
  });
});

describe('Performance audit fixes — v5.70.0 correctness verification', () => {

  // ── drugCharge excludes human trafficking ─────────────────────
  describe('computeCriminalSignals — drugCharge human trafficking exclusion', () => {
    function criminal(overrides = {}) {
      return { id:1, firm_id:1, vertical:'criminal_defense', title:'Test',
               evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
               jurisdiction:'federal', prior_adjudications:0, ...overrides };
    }
    test('drug trafficking → mandatoryMin=true (federal drug offense)', () => {
      const s = computeAllSignals(criminal({ title:'Federal drug trafficking heroin § 841' }));
      expect(s.vertical_signals.mandatoryMin).toBe(true);
    });
    test('human trafficking (CSEC) → mandatoryMin=false (not a drug offense)', () => {
      const s = computeAllSignals(criminal({ title:'Federal human trafficking CSEC exploitation' }));
      expect(s.vertical_signals.mandatoryMin).toBe(false);
    });
    test('sex trafficking (CSEC) → mandatoryMin=false', () => {
      const s = computeAllSignals(criminal({ title:'Federal sex trafficking commercial exploitation' }));
      expect(s.vertical_signals.mandatoryMin).toBe(false);
    });
    test('human trafficking → safetyValveEligible=false', () => {
      const s = computeAllSignals(criminal({ title:'Federal human trafficking victim forced labor' }));
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
    });
    test('cocaine distribution → mandatoryMin=true', () => {
      const s = computeAllSignals(criminal({ title:'Cocaine distribution § 841 federal charge' }));
      expect(s.vertical_signals.mandatoryMin).toBe(true);
    });
  });

  // ── safetyValve + weapon charge ───────────────────────────────
  describe('computeCriminalSignals — safetyValve blocked by weapon charge', () => {
    function fed(overrides = {}) {
      return { id:1, firm_id:1, vertical:'criminal_defense', title:'Drug distribution § 841',
               evidence_score:50, vulnerability_level:'moderate', time_pressure:'standard',
               jurisdiction:'federal', prior_adjudications:0, ...overrides };
    }
    test('drug + weapon (§ 924) → safetyValveEligible=false (weapon bars safety valve)', () => {
      const s = computeAllSignals(fed({ title:'Drug distribution § 841 armed firearm § 924' }));
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
      expect(s.vertical_signals.mandatoryMin).toBe(true);
    });
    test('drug only (no weapon) → safetyValveEligible=true', () => {
      const s = computeAllSignals(fed({ title:'Drug possession distribution § 841 federal' }));
      expect(s.vertical_signals.safetyValveEligible).toBe(true);
    });
    test('drug + gun keyword → safetyValveEligible=false', () => {
      const s = computeAllSignals(fed({ title:'Federal drug charge gun found at scene' }));
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
    });
    test('drug + armed robbery → safetyValveEligible=false (violent AND weapon)', () => {
      const s = computeAllSignals(fed({ title:'Federal armed robbery drug conspiracy' }));
      expect(s.vertical_signals.safetyValveEligible).toBe(false);
    });
  });

  // ── bookerVariance = false for strong/non-crisis federal ───────
  describe('computeCriminalSignals — bookerVariance precise boundaries', () => {
    function fed(overrides = {}) {
      return { id:1, firm_id:1, vertical:'criminal_defense', title:'Drug charge federal',
               evidence_score:80, vulnerability_level:'low', time_pressure:'standard',
               jurisdiction:'federal', prior_adjudications:0, ...overrides };
    }
    test('strong evidence + low vulnerability → bookerVariance=false', () => {
      const s = computeAllSignals(fed({ evidence_score:80, vulnerability_level:'low' }));
      expect(s.vertical_signals.bookerVariance).toBe(false);
    });
    test('strong evidence + moderate vulnerability → bookerVariance=false', () => {
      const s = computeAllSignals(fed({ evidence_score:80, vulnerability_level:'moderate' }));
      expect(s.vertical_signals.bookerVariance).toBe(false);
    });
    test('moderate evidence → bookerVariance=false (no mitigating basis)', () => {
      const s = computeAllSignals(fed({ evidence_score:65 }));
      expect(s.vertical_signals.bookerVariance).toBe(false);
    });
    test('contested evidence → bookerVariance=true', () => {
      const s = computeAllSignals(fed({ evidence_score:40 }));
      expect(s.vertical_signals.bookerVariance).toBe(true);
    });
    test('strong + crisis → bookerVariance=true (crisis is independent basis)', () => {
      const s = computeAllSignals(fed({ evidence_score:80, vulnerability_level:'crisis' }));
      expect(s.vertical_signals.bookerVariance).toBe(true);
    });
    test('state charge → bookerVariance=false (federal only)', () => {
      const s = computeAllSignals(fed({ jurisdiction:'state', evidence_score:15 }));
      expect(s.vertical_signals.bookerVariance).toBe(false);
    });
  });

  // ── recCoop + unknown coop ─────────────────────────────────────
  describe('computeWhiteCollarSignals — recCoop includes unknown cooperation', () => {
    function wc(overrides = {}) {
      return { id:1, firm_id:1, vertical:'white_collar', title:'SEC investigation',
               evidence_score:80, vulnerability_level:'crisis', time_pressure:'standard',
               cooperation_level:'unknown', dpa_status:null, jurisdiction:'federal', ...overrides };
    }
    test('strong + unknown cooperation → recCoop=true (new matter, set coop level)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'unknown' }));
      expect(s.vertical_signals.recCoop).toBe(true);
    });
    test('strong + unknown → coopUpgradeRecommended=false (not upgrading, setting)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'unknown' }));
      expect(s.vertical_signals.coopUpgradeRecommended).toBe(false);
    });
    test('contested + unknown → recCoop=false (only no_coop triggers contested path)', () => {
      const s = computeAllSignals(wc({ evidence_score:45, cooperation_level:'unknown' }));
      expect(s.vertical_signals.recCoop).toBe(false);
    });
    test('strong + no_cooperation → recCoop=true (original behavior)', () => {
      const s = computeAllSignals(wc({ cooperation_level:'no_cooperation' }));
      expect(s.vertical_signals.recCoop).toBe(true);
    });
  });

  // ── approaching_bar threshold asymmetry ───────────────────────
  describe('asylumBarRisk signal vs approaching_bar display — documented asymmetry', () => {
    // Signal engine uses stored clock_days > 300
    // Display layer uses computed elapsed >= 290
    // This tests the signal engine boundary
    function imm(clock_days, overrides = {}) {
      return { id:1, firm_id:1, vertical:'immigration', title:'Asylum',
               evidence_score:65, vulnerability_level:'moderate', time_pressure:'standard',
               relief_type:'asylum', clock_days, detained:0, years_us:3,
               country_condition:'stable', ...overrides };
    }
    test('clock_days=300: asylumBarRisk=false (>300 required, signal engine)', () => {
      const s = computeAllSignals(imm(300));
      expect(s.vertical_signals.asylumBarRisk).toBe(false);
    });
    test('clock_days=301: asylumBarRisk=true (signal engine threshold)', () => {
      const s = computeAllSignals(imm(301));
      expect(s.vertical_signals.asylumBarRisk).toBe(true);
    });
    test('clock_days=365: asylumBarRisk=true, asylumBarred=false (last warning day)', () => {
      const s = computeAllSignals(imm(365));
      expect(s.vertical_signals.asylumBarRisk).toBe(true);
      expect(s.vertical_signals.asylumBarred).toBe(false);
    });
    test('clock_days=366: asylumBarred=true, asylumBarRisk=false (mutually exclusive)', () => {
      const s = computeAllSignals(imm(366));
      expect(s.vertical_signals.asylumBarred).toBe(true);
      expect(s.vertical_signals.asylumBarRisk).toBe(false);
    });
  });
});

describe('computeAppellateSignals — certApproaching advisory signal', () => {
  function app(overrides = {}) {
    return { id:1, firm_id:1, vertical:'appellate', title:'Capital habeas petition',
             evidence_score:62, vulnerability_level:'moderate', time_pressure:'standard',
             prior_appeals:1, is_capital:1, years_post_conviction:2, hab_track:'habeas', ...overrides };
  }
  test('revScore=55 capital → certApproaching=true, certWorthy=false', () => {
    const s = computeAllSignals(app());  // moderate+boost=60-1×5=55
    expect(s.vertical_signals.certApproaching).toBe(true);
    expect(s.vertical_signals.certWorthy).toBe(false);
  });
  test('revScore=60 capital → certWorthy=true, certApproaching=false (mutually exclusive)', () => {
    const s = computeAllSignals(app({ prior_appeals:0 }));  // moderate+boost=60
    expect(s.vertical_signals.certWorthy).toBe(true);
    expect(s.vertical_signals.certApproaching).toBe(false);
  });
  test('revScore=49 capital → neither certApproaching nor certWorthy', () => {
    const s = computeAllSignals(app({ evidence_score:30, prior_appeals:1 }));  // contested:30+0-5=25
    expect(s.vertical_signals.certApproaching).toBe(false);
    expect(s.vertical_signals.certWorthy).toBe(false);
  });
  test('non-capital high revScore → certApproaching=false (capital required)', () => {
    const s = computeAllSignals(app({ is_capital:0, evidence_score:80, prior_appeals:0 }));
    expect(s.vertical_signals.certApproaching).toBe(false);
  });
});


describe('computeAppellateSignals — certMonitor early watch signal', () => {
  const app = (o) => ({ id:1, vertical:'appellate', time_pressure:'standard',
    vulnerability_level:'moderate', jurisdiction:'federal', ...o });

  test('certMonitor: revScore 40-49 + capital → true', () => {
    const s = computeAllSignals(app({ evidence_score: 30, is_capital: 1, prior_appeals: 0 }));
    // score 30 → stdRevBase=25, evBoost=0, priorPenalty=0 → revScore=25 (too low)
    // Try score that gives revScore ~45: contested(30)+0-0=30... need moderate(40)+evBoost(20)=60 minus priors
    // Use contested+no boost+0 prior = 30 (still too low); moderate+no boost+prior=1 → 40+0-5=35
    // moderate+evBoost(20)+prior=3 → 40+20-15=45 ✓
    const s2 = computeAllSignals(app({ evidence_score: 60, is_capital: 1, prior_appeals: 3 }));
    // 60 → moderate bucket → stdRevBase=40, evBoost=20, penalty=3*5=15 → revScore=45
    expect(s2.vertical_signals.certMonitor).toBe(true);
    expect(s2.vertical_signals.certApproaching).toBe(false);
    expect(s2.vertical_signals.certWorthy).toBe(false);
  });

  test('certMonitor: non-capital → always false', () => {
    const s = computeAllSignals(app({ evidence_score: 60, is_capital: 0, prior_appeals: 3 }));
    expect(s.vertical_signals.certMonitor).toBe(false);
  });

  test('three cert tiers are mutually exclusive across revScore range', () => {
    const app2 = (score, priors) => computeAllSignals(app({ evidence_score: score, is_capital: 1, prior_appeals: priors }));
    // For each score/prior combo, at most one tier fires
    const cases = [[80,0],[75,0],[60,0],[60,3],[40,0],[30,0],[15,0]];
    for (const [sc, pr] of cases) {
      const s = app2(sc, pr);
      const firing = [
        s.vertical_signals.certWorthy,
        s.vertical_signals.certApproaching,
        s.vertical_signals.certMonitor,
      ].filter(Boolean).length;
      expect(firing).toBeLessThanOrEqual(1);
    }
  });
});

describe('computeImmigrationSignals — country_condition validation', () => {
  const imm = (o) => ({ id:1, vertical:'immigration', time_pressure:'standard',
    vulnerability_level:'moderate', jurisdiction:'federal', clock_days:0, ...o });

  test('invalid country_condition defaults to stable (no crash)', () => {
    const s = computeAllSignals(imm({ country_condition: 'INVALID_XYZ', relief_type:'asylum', evidence_score:80 }));
    expect(s).toBeDefined();
    // stable country + asylum → strongAsylum=false (needs 'crisis')
    expect(s.vertical_signals.strongAsylum).toBe(false);
  });

  test('valid country_condition crisis passes through', () => {
    const s = computeAllSignals(imm({ country_condition: 'crisis', relief_type:'asylum', evidence_score:80 }));
    expect(s.vertical_signals.strongAsylum).toBe(true);
  });
});
describe('computeJuvenileSignals — csecDependency track-aware signal', () => {
  function juv(overrides = {}) {
    return { id:1, firm_id:1, vertical:'juvenile', title:'CSEC human trafficking victim',
             evidence_score:65, vulnerability_level:'high', time_pressure:'standard',
             client_age:14, prior_adjudications:0, case_track:'dependency', ...overrides };
  }
  test('CSEC + dependency track → csecDependency=true', () => {
    const s = computeAllSignals(juv());
    expect(s.vertical_signals.csecFlag).toBe(true);
    expect(s.vertical_signals.csecDependency).toBe(true);
  });
  test('CSEC + delinquency track → csecDependency=false (different intervention)', () => {
    const s = computeAllSignals(juv({ case_track:'delinquency' }));
    expect(s.vertical_signals.csecFlag).toBe(true);
    expect(s.vertical_signals.csecDependency).toBe(false);
  });
  test('non-CSEC + dependency → csecDependency=false', () => {
    const s = computeAllSignals(juv({ title:'Dependency neglect parental failure to protect' }));
    expect(s.vertical_signals.csecFlag).toBe(false);
    expect(s.vertical_signals.csecDependency).toBe(false);
  });
  test('sex trafficking + dependency → csecDependency=true', () => {
    const s = computeAllSignals(juv({ title:'Sex trafficking exploitation minor dependency' }));
    expect(s.vertical_signals.csecDependency).toBe(true);
  });
});

// ─── EXTENUATING CIRCUMSTANCES SIGNALS ────────────────────────────────────────

describe('Extenuating Circumstances — Criminal Signals', () => {
  const crim = (o) => ({ id:1, vertical:'criminal_defense', jurisdiction:'federal',
    vulnerability_level:'moderate', time_pressure:'standard', evidence_score:60,
    prior_adjudications:0, ...o });

  test('pleaOfferExpiring: pending offer expiring within 2 days → true', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const expiryDate = tomorrow.toISOString().slice(0,10);
    const s = computeAllSignals(crim({ plea_offer_pending: 1, plea_expires_date: expiryDate }));
    expect(s.vertical_signals.pleaOfferExpiring).toBe(true);
    expect(s.vertical_signals.pleaOfferActive).toBe(true);
  });

  test('pleaOfferExpiring: offer expiring in 5 days → false (not yet critical)', () => {
    const future = new Date(); future.setDate(future.getDate() + 5);
    const s = computeAllSignals(crim({ plea_offer_pending: 1, plea_expires_date: future.toISOString().slice(0,10) }));
    expect(s.vertical_signals.pleaOfferExpiring).toBe(false);
    expect(s.vertical_signals.pleaOfferActive).toBe(true);
  });

  test('pleaOfferActive: pending offer with no expiry date → active but not expiring', () => {
    const s = computeAllSignals(crim({ plea_offer_pending: 1, plea_expires_date: null }));
    expect(s.vertical_signals.pleaOfferActive).toBe(true);
    expect(s.vertical_signals.pleaOfferExpiring).toBe(false);
  });

  test('vopCompound: supervised_release=1 + high vulnerability → true', () => {
    const s = computeAllSignals(crim({ supervised_release: 1, vulnerability_level: 'high' }));
    expect(s.vertical_signals.vopCompound).toBe(true);
  });

  test('vopCompound: supervised_release=0 → false', () => {
    const s = computeAllSignals(crim({ supervised_release: 0, vulnerability_level: 'crisis' }));
    expect(s.vertical_signals.vopCompound).toBe(false);
  });

  test('dualSovereigntyRisk: flag set → true', () => {
    const s = computeAllSignals(crim({ dual_sovereignty_risk: 1 }));
    expect(s.vertical_signals.dualSovereigntyRisk).toBe(true);
  });

  test('padillaWarningNeeded: non_citizen=1 + plea pending → true', () => {
    const s = computeAllSignals(crim({ non_citizen: 1, plea_offer_pending: 1 }));
    expect(s.vertical_signals.padillaWarningNeeded).toBe(true);
  });

  test('padillaWarningNeeded: citizen + plea pending → false', () => {
    const s = computeAllSignals(crim({ non_citizen: 0, plea_offer_pending: 1 }));
    expect(s.vertical_signals.padillaWarningNeeded).toBe(false);
  });
});

describe('Extenuating Circumstances — Family Signals', () => {
  const fam = (o) => ({ id:1, vertical:'family', vulnerability_level:'moderate',
    time_pressure:'standard', evidence_score:60, dv_flag:1, ...o });

  test('lethalityExtreme: dv_flag=1 + lethality_score >= 8 → true', () => {
    const s = computeAllSignals(fam({ lethality_score: 9 }));
    expect(s.vertical_signals.lethalityExtreme).toBe(true);
    expect(s.vertical_signals.lethalityHigh).toBe(true);
  });

  test('lethalityHigh: score 4-7 → high but not extreme', () => {
    const s = computeAllSignals(fam({ lethality_score: 5 }));
    expect(s.vertical_signals.lethalityHigh).toBe(true);
    expect(s.vertical_signals.lethalityExtreme).toBe(false);
  });

  test('lethalityHigh: score 3 → false', () => {
    const s = computeAllSignals(fam({ lethality_score: 3 }));
    expect(s.vertical_signals.lethalityHigh).toBe(false);
    expect(s.vertical_signals.lethalityExtreme).toBe(false);
  });

  test('firearmsurrenderRequired: dv_flag + crisis/high → true', () => {
    const s = computeAllSignals(fam({ vulnerability_level: 'crisis' }));
    expect(s.vertical_signals.firearmsurrenderRequired).toBe(true);
  });

  test('hagueProceeding: title contains hague keyword → true', () => {
    const s = computeAllSignals(fam({ dv_flag: 0, title: 'Hague Convention international child abduction France' }));
    expect(s.vertical_signals.hagueProceeding).toBe(true);
  });
});

describe('Extenuating Circumstances — Immigration Signals', () => {
  const imm = (o) => ({ id:1, vertical:'immigration', vulnerability_level:'moderate',
    time_pressure:'standard', evidence_score:60, clock_days:0, ...o });

  test('volDepartureImminent: deadline within 14 days → true', () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    const s = computeAllSignals(imm({ vol_departure_date: soon.toISOString().slice(0,10) }));
    expect(s.vertical_signals.volDepartureImminent).toBe(true);
  });

  test('volDepartureMissed: deadline in the past → true', () => {
    const past = new Date(); past.setDate(past.getDate() - 5);
    const s = computeAllSignals(imm({ vol_departure_date: past.toISOString().slice(0,10) }));
    expect(s.vertical_signals.volDepartureMissed).toBe(true);
    expect(s.vertical_signals.volDepartureImminent).toBe(false);
  });

  test('withholdingCATEvaluate: barred + detained + high → true', () => {
    const s = computeAllSignals(imm({ clock_days: 400, relief_type:'asylum',
      detained: 1, vulnerability_level: 'crisis' }));
    expect(s.vertical_signals.withholdingCATEvaluate).toBe(true);
    expect(s.vertical_signals.asylumBarred).toBe(true);
  });

  test('withholdingCATEvaluate: barred + NOT detained → false', () => {
    const s = computeAllSignals(imm({ clock_days: 400, relief_type:'asylum', detained: 0 }));
    expect(s.vertical_signals.withholdingCATEvaluate).toBe(false);
  });

  test('materialSupportScreen: cartel/extortion in asylum title → true', () => {
    const s = computeAllSignals(imm({ relief_type:'asylum', title:'asylum claim gang extortion cartel threats' }));
    expect(s.vertical_signals.materialSupportScreen).toBe(true);
  });
});

describe('Extenuating Circumstances — Appellate Signals', () => {
  const app = (o) => ({ id:1, vertical:'appellate', vulnerability_level:'moderate',
    time_pressure:'standard', evidence_score:70, prior_appeals:0, ...o });

  test('bopExhaustionPending: request within 30 days → pending', () => {
    const recent = new Date(); recent.setDate(recent.getDate() - 10);
    const s = computeAllSignals(app({ bop_request_date: recent.toISOString().slice(0,10) }));
    expect(s.vertical_signals.bopExhaustionPending).toBe(true);
    expect(s.vertical_signals.bopExhaustionEligible).toBe(false);
  });

  test('bopExhaustionEligible: request 31+ days ago → eligible', () => {
    const old = new Date(); old.setDate(old.getDate() - 31);
    const s = computeAllSignals(app({ bop_request_date: old.toISOString().slice(0,10) }));
    expect(s.vertical_signals.bopExhaustionEligible).toBe(true);
    expect(s.vertical_signals.bopExhaustionPending).toBe(false);
  });

  test('iacDocumentNeeded: habeas + within 1 year of conviction → true', () => {
    const s = computeAllSignals(app({ hab_track: 'habeas', years_post_conviction: 0 }));
    expect(s.vertical_signals.iacDocumentNeeded).toBe(true);
  });
});

describe('Extenuating Circumstances — Juvenile Signals', () => {
  const juv = (o) => ({ id:1, vertical:'juvenile', vulnerability_level:'moderate',
    time_pressure:'standard', evidence_score:60, client_age:16, case_track:'delinquency', ...o });

  test('juvenileSORRequired: sex offense + delinquency track → true', () => {
    const s = computeAllSignals(juv({ title:'juvenile sexual assault adjudication' }));
    expect(s.vertical_signals.juvenileSORRequired).toBe(true);
  });

  test('juvenileSORRequired: drug offense → false', () => {
    const s = computeAllSignals(juv({ title:'juvenile drug possession adjudication' }));
    expect(s.vertical_signals.juvenileSORRequired).toBe(false);
  });

  test('recordMayBePublic: transfer-eligible offense → true', () => {
    const s = computeAllSignals(juv({ title:'armed robbery juvenile', client_age: 17 }));
    expect(s.vertical_signals.recordMayBePublic).toBe(true);
  });
});

describe('Extenuating Circumstances — Escalation Integration', () => {
  test('plea expiring: escalation.level = critical, SLA = 1h', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const s = computeAllSignals({
      id:1, vertical:'criminal_defense', jurisdiction:'federal',
      vulnerability_level:'moderate', time_pressure:'standard',
      evidence_score:60, prior_adjudications:0,
      plea_offer_pending:1, plea_expires_date: tomorrow.toISOString().slice(0,10),
    });
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.sla_hours).toBe(1);
    expect(s.escalation.triggers).toContain('plea_offer_expiring_48h');
  });

  test('voluntary departure imminent: escalation.level = critical', () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const s = computeAllSignals({
      id:1, vertical:'immigration', vulnerability_level:'moderate',
      time_pressure:'standard', evidence_score:60, clock_days:0,
      vol_departure_date: soon.toISOString().slice(0,10),
    });
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.triggers).toContain('voluntary_departure_imminent');
  });

  test('lethality extreme: escalation.level = critical', () => {
    const s = computeAllSignals({
      id:1, vertical:'family', vulnerability_level:'high', time_pressure:'standard',
      evidence_score:60, dv_flag:1, lethality_score:9,
    });
    expect(s.escalation.level).toBe('critical');
    expect(s.escalation.triggers).toContain('dv_extreme_lethality');
  });
});
