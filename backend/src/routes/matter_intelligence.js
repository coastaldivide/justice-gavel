/**
 * matter_intelligence.js — Outcome prediction, motion/diversion recommendations,
 *                           emergency escalation, and vertical-specific intelligence
 *                           derived from all 40 simulation signals.
 *
 * GET  /api/matter-intelligence/:matterId/signals     — all computed signals for a matter
 * GET  /api/matter-intelligence/:matterId/outcome     — outcome prediction summary
 * GET  /api/matter-intelligence/:matterId/motions     — motion recommendations
 * GET  /api/matter-intelligence/:matterId/diversion   — diversion recommendations
 * GET  /api/matter-intelligence/:matterId/escalation  — emergency escalation status
 * POST /api/matter-intelligence/:matterId/taxonomy    — classify matter title → workflow
 *
 * GET  /api/matter-intelligence/firm/dashboard        — firm-wide intelligence dashboard
 */

import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import logger           from '../utils/logger.js';
import { err400, err403, err404, safeInt } from '../utils/routeHelpers.js';
import { writeAuditLog }                   from '../middleware/audit.js';
import { hasMinRole }                      from '../middleware/rbac.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user

const router = Router();

// ─── RBAC — reuses hasMinRole from middleware/rbac.js ───────────────────────
// Local getFirmCtx is a lightweight DB query wrapper (loadFirmContext takes full req)
async function getFirmCtx(db, userId) {
  return db.get(
    `SELECT fm.firm_id, fm.firm_role FROM firm_members fm
     WHERE fm.user_id=? AND fm.status='active' LIMIT 1`,
    [userId]
  ).catch(() => null);
}
// hasMinRank aliases the imported hasMinRole for consistency with existing callers
const hasMinRank = (role, min) => hasMinRole(role, min);

// ─── SIGNAL COMPUTATION ENGINE ────────────────────────────────────────────────

function evidenceBucket(score) {
  const s = Math.max(0, Math.min(100, safeInt(score, 50)));
  if (s < 25) return 'weak';
  if (s < 50) return 'contested';
  if (s < 75) return 'moderate';
  return 'strong';
}

// F1 — Criminal Defense
function computeCriminalSignals(m) {
  const charge  = (m.title || '').toLowerCase();
  const violent = /murder|assault|rape|robbery|kidnap|homicide|strangulation/.test(charge);
  const crisis  = m.vulnerability_level === 'crisis';
  const ev      = evidenceBucket(m.evidence_score);

  const federal    = m.jurisdiction === 'federal';
  const prior      = safeInt(m.prior_adjudications, 0);
  // drugCharge: federal narcotics offenses. Excludes CSEC (human/sex trafficking ≠ drug).
  const drugCharge = /\bdrug\b|marijuana|heroin|meth|cocaine|fentanyl|§ 841|drug trafficking/.test(charge)
                  && !/(human trafficking|sex trafficking|csec)/.test(charge);
  const weaponCharge = /weapon|firearm|gun|§ 924|armed/.test(charge);

  return {
    // expeditedBail: triggers escalation SLA and bail specialist match
    expeditedBail: crisis && violent,
    dismissLikely: ev === 'weak',
    // expungementReady removed — was always false; expungement eligibility
    // is surfaced via the /outcome endpoint's expungement_eligible indicator.
    violentCharge: violent,
    // recommendExpressMatch: same condition as expeditedBail — flags for
    // express (same-day) attorney matching in the intake pipeline
    recommendExpressMatch: crisis && violent,
    // ── Federal sentencing signals ─────────────────────────────────────────────
    // mandatoryMin: federal drug/weapon charges carry statutory mandatory minimums.
    // Advisory only — attorneys must verify the specific statute and quantity threshold.
    mandatoryMin: federal && (drugCharge || weaponCharge),
    // safetyValveEligible: 18 U.S.C. § 3553(f) — allows courts to sentence below
    // the mandatory minimum for qualifying low-level nonviolent drug offenders.
    // Requirements: ≤ 1 criminal history point, no violence/weapon in offense,
    // no death/serious injury, not a leader, fully debriefed.
    // This signal is advisory — prior_adjudications is a proxy for criminal history.
    // safetyValveEligible: § 3553(f). Barred by violence, weapon (§ 924), or > 1 prior.
    safetyValveEligible: federal && drugCharge && !violent && !weaponCharge && prior <= 1,
    // bookerVariance: United States v. Booker (2005) — guidelines advisory.
    // Strong mitigating factors (low evidence, moderate vulnerability) support
    // a below-guidelines variance motion. Advisory: attorneys evaluate case-by-case.
    bookerVariance: federal && (ev === 'weak' || ev === 'contested' || ['high','crisis'].includes(m.vulnerability_level || '')),
    // ── VOP compound emergency ───────────────────────────────────────────────────
    // A new arrest while on supervised release / probation creates two simultaneous
    // cases. VOP hearings: preponderance standard, hearsay admissible, no jury.
    // This is the most common re-entry crisis for the ~4.5M Americans on supervision.
    // vopCompound: a new arrest while on supervision creates TWO simultaneous cases.
    // The compound emergency is the supervision status, not the vulnerability level —
    // even a minor-offense arrest while on probation triggers a VOP petition.
    vopCompound: !!(m.supervised_release) && ['criminal_defense','public_defense'].includes(m.vertical || ''),
    // ── Plea offer expiry ────────────────────────────────────────────────────────
    // DA offers routinely expire in 48-72 hours. Tracking expiry is critical.
    // CRITICAL signal fires when offer expires within 2 days.
    pleaOfferExpiring: !!(m.plea_offer_pending) && (() => {
      if (!m.plea_expires_date) return false;
      const daysLeft = Math.ceil((new Date(m.plea_expires_date) - new Date()) / 86400000);
      return daysLeft >= 0 && daysLeft <= 2;
    })(),
    pleaOfferActive: !!(m.plea_offer_pending),
    // ── Dual sovereignty risk ────────────────────────────────────────────────────
    // Double jeopardy does not bar successive state+federal prosecution (Petite Policy
    // is internal DOJ policy, not a legal bar). A state acquittal is not an end.
    dualSovereigntyRisk: !!(m.dual_sovereignty_risk),
    // ── First Step Act / Fair Sentencing Act retroactivity ───────────────────────
    // Crack/powder cocaine sentencing disparity. Clients sentenced pre-2010 under
    // 100:1 ratio may qualify for retroactive reduction under § 404(b) FSA.
    firstStepActEligible: federal && drugCharge &&
      /crack|cocaine.*base|\brock\b/.test(charge) &&
      safeInt(m.years_post_conviction, 0) === 0,  // pre-conviction — evaluate at sentencing
    // ── Non-citizen Padilla warning flag ────────────────────────────────────────
    // Padilla v. Kentucky (2010): mandatory immigration consequence warning before plea.
    // This signal prompts the attorney to document the Padilla warning.
    padillaWarningNeeded: !!(m.non_citizen) && !!(m.plea_offer_pending),
  };
}

// F2 — Civil Rights
function computeCivilRightsSignals(m) {
  const matter   = (m.title || '').toLowerCase();
  const medical  = /medical|cancer|suicide|solitary|mental/.test(matter);
  const crisis   = m.vulnerability_level === 'crisis';
  const ev       = evidenceBucket(m.evidence_score);
  const damages  = m.damages_type || 'compensatory_only';

  return {
    // emergInj: ALL crisis civil rights matters warrant emergency injunction evaluation.
    // A § 1983 victim in crisis does not need 'medical' in the title to need emergency relief.
    // The prior condition (crisis && medical) excluded shooting victims, wrongful conviction
    // clients in crisis, and others with non-medical but urgent civil rights emergencies.
    emergInj: crisis,
    earlySet: ev === 'strong' && damages !== 'injunctive_only',
    classAction: !!m.class_certification_status && m.class_certification_status !== 'individual',
    settlementProbability: ev === 'strong' ? 0.72 : ev === 'moderate' ? 0.51 : ev === 'contested' ? 0.34 : 0.18,
  };
}

// F3 — White-Collar
function computeWhiteCollarSignals(m) {
  const ev      = evidenceBucket(m.evidence_score);
  const coop    = m.cooperation_level || 'unknown';
  const crisis  = m.vulnerability_level === 'crisis';
  const federal = m.jurisdiction === 'federal';

  return {
    accelResp: crisis && federal,
    // recCoop: 'Begin cooperation now' — urgent signal for non-cooperating clients.
    //   Strong + no_cooperation: recommend immediately (govt likely prevails).
    //   Strong + unknown: coop unset on new matter — prompt attorney to establish it.
    //   Contested + no_coop + pre-active-DPA: early coop = max Filip credit.
    recCoop: (ev === 'strong' && ['no_cooperation','unknown'].includes(coop)) ||
             (ev === 'contested' && coop === 'no_cooperation' &&
              (!m.dpa_status || m.dpa_status === 'evaluating')),
    // coopUpgradeRecommended: 'Upgrade cooperation tier' — strategic signal for
    //   clients already cooperating (limited/proffer) who could provide more.
    //   Only meaningful when strong evidence means full cooperation maximizes Filip credit.
    //   Distinct from recCoop: assumes cooperation has already begun, not started yet.
    coopUpgradeRecommended: ev === 'strong' && ['limited_cooperation','proffer_agreement'].includes(coop),
    dpaViable: ['viable','negotiating','signed'].includes(m.dpa_status || ''),
  };
}

// F4 — Family Law
function computeFamilySignals(m) {
  const dv      = !!(m.dv_flag || /domestic violence|dv|restraining|protective order/.test((m.title||'').toLowerCase()));
  const ev      = evidenceBucket(m.evidence_score);
  const crisis  = m.vulnerability_level === 'crisis';

  return {
    expedTRO: crisis && dv,
    likelySett: ['weak','contested'].includes(ev),
    needsTRO: dv,
    highAsset: ['2m_10m','over_10m'].includes(m.asset_tier || ''),
    // assetFreeze: high-asset DV matters — TRO should be accompanied by asset preservation motion.
    // Shared business assets and marital property are at dissipation risk during DV proceedings.
    assetFreeze: dv && ['2m_10m','over_10m'].includes(m.asset_tier || ''),
    settlementProbability: ['weak','contested'].includes(ev) ? 0.62 : 0.38,
    // ── DV lethality assessment ──────────────────────────────────────────────────
    // Lethality score 0-10 (Campbell Danger Assessment factors).
    // The most dangerous time for a DV victim is when leaving the abuser.
    // Score >= 4: Dangerous. Score >= 8: Extreme danger.
    // Attorneys with DV matters should complete a lethality assessment at intake.
    lethalityHigh: dv && safeInt(m.lethality_score, 0) >= 4,
    lethalityExtreme: dv && safeInt(m.lethality_score, 0) >= 8,
    // ── Firearm surrender compliance ─────────────────────────────────────────────
    // 18 U.S.C. § 922(g)(8): unlawful to possess firearm while subject to qualifying
    // DV protective order (upheld United States v. Rahimi, 2024).
    // TROs routinely require surrender within 24-72 hours — federal crime to miss.
    firearmsurrenderRequired: dv && (crisis || m.vulnerability_level === 'high'),
    // ── Hague Convention (international parental kidnapping) ─────────────────────
    // 1-year deadline for return petition. After 1 year: settled-child defense.
    hagueProceeding: /hague|international.*child|parental.*abduction|international.*custody/.test((m.title||'').toLowerCase()),
  };
}

// F5 — Immigration
// IMPORTANT: The 1-year asylum filing deadline (8 U.S.C. § 1158(a)(2)(B)) runs
// from the date of the client's LAST ARRIVAL in the United States, not the date
// the tracker was created. clock_days should be populated from the client's
// actual arrival/entry date for asylumBarred/asylumBarRisk to be accurate.
// Attorneys MUST verify this date independently — this signal is advisory only.
function computeImmigrationSignals(m) {
  const ev      = evidenceBucket(m.evidence_score);
  const VALID_COUNTRY_CONDITIONS = ['crisis','deteriorating','stable','improving'];
  const rawCountry = m.country_condition || 'stable';
  if (m.country_condition && !VALID_COUNTRY_CONDITIONS.includes(rawCountry)) {
    logger.warn(`[mi/imm] unknown country_condition '${rawCountry}' on matter ${m.id} — defaulting to 'stable'`);
  }
  const country = VALID_COUNTRY_CONDITIONS.includes(rawCountry) ? rawCountry : 'stable';
  // Do NOT default to 'asylum' — a matter with no relief_type set must not
  // trigger asylum bar signals. Use null so all asylum-specific checks remain
  // false until relief_type is explicitly set on the matter.
  const relief  = m.relief_type || null;
  const detained = !!(m.detained);
  const high    = ['high','crisis'].includes(m.vulnerability_level);
  const clockDays = safeInt(m.clock_days, 0);

  return {
    detUrgent: detained && high,
    strongAsylum: ev === 'strong' && country === 'crisis' && relief === 'asylum',
    asylumBarred: clockDays > 365 && relief === 'asylum',
    // asylumBarRisk: only true when approaching the bar but not yet barred.
    // Mutually exclusive with asylumBarred — callers need not dedup.
    // Uses stored clock_days (300-day threshold). The GET /asylum-clocks display
    // layer uses computed elapsed_days (290-day) — intentionally wider warning window.
    asylumBarRisk: clockDays > 300 && clockDays <= 365 && relief === 'asylum',
    // Continuous physical presence required — voluntary departure or removal resets clock.
    // This signal indicates years_us >= 10 but does NOT verify continuity. Advisory only.
    cancellationEligible: safeInt(m.years_us, 0) >= 10,
    // Compound emergency: barred + detained = simultaneous stay + bar challenge
    compound_bar_detention: (clockDays > 365 && relief === 'asylum') && (detained && high),
    // ALIGNMENT NOTE: These hard-coded values (0.71/0.52/0.31/0.18) approximate
    // EOIR asylum grant rates. The analytics registry (imm_asylum_grant_rates)
    // contains the authoritative, factor-weighted published statistics.
    // Attorneys should use the 🧠 Analytics tab for registry-backed analysis.
    // These values remain here as a quick signal for the outcome indicator display.
    // ── Voluntary departure deadline ────────────────────────────────────────────
    // IJ may grant vol. departure — client must leave by deadline or face:
    //   automatic 10-year bar + bond forfeiture + destruction of future relief options.
    // This is separate from the asylum clock. Even ONE DAY late is irreversible.
    volDepartureImminent: (() => {
      if (!m.vol_departure_date) return false;
      const daysLeft = Math.ceil((new Date(m.vol_departure_date) - new Date()) / 86400000);
      return daysLeft >= 0 && daysLeft <= 14;
    })(),
    volDepartureMissed: (() => {
      if (!m.vol_departure_date) return false;
      return new Date(m.vol_departure_date) < new Date();
    })(),
    // ── Withholding of removal / CAT alternatives ────────────────────────────────
    // When asylum bar is exceeded, withholding (§ 1231(b)(3)) and Convention Against
    // Torture relief are the remaining options. No 1-year bar. Higher standard.
    // This signal prompts attorneys not to stop at asylumBarred=true.
    withholdingCATEvaluate: clockDays > 365 && relief === 'asylum' && detained,
    // ── Material support bar screening flag ──────────────────────────────────────
    // 8 U.S.C. § 1182(a)(3)(B): even duress-based 'support' can bar asylum.
    // Applied to cartel extortion victims, kidnapping victims who complied.
    // Must be screened at intake — no attorney sees this without the flag.
    materialSupportScreen: relief === 'asylum' &&
      /cartel|gang|extortion|traffick|kidnap|forced|duress|coerce/.test((m.title||'').toLowerCase()),
    // Only meaningful for asylum relief — null for other relief types
    asylumSuccessProbability: relief === 'asylum'
      ? (ev === 'strong' && country === 'crisis' ? 0.71
        : ev === 'moderate' && ['crisis','deteriorating'].includes(country) ? 0.52
        : ev === 'contested' ? 0.31 : 0.18)
      : null,
  };
}

// F6 — Personal Injury
function computePISignals(m) {
  const ev       = evidenceBucket(m.evidence_score);
  const causa    = m.causation_type || 'disputed';
  const severity = m.injury_severity || 'moderate';
  const crisis   = m.vulnerability_level === 'crisis';
  const pf       = Math.max(0, Math.min(100, safeInt(m.plaintiff_fault_pct, 0)));  // clamp [0,100]
  const econ     = safeInt(m.economic_damages, 0);
  const nonEcon  = safeInt(m.noneconomic_damages, 0);
  const punitive = ev === 'strong' && causa === 'clear' ? safeInt(m.punitive_damages, 0) : 0;
  // Punitive damages are not reduced by plaintiff fault %
  // Only compensatory (econ + nonEcon) is reduced by plaintiff fault %
  const compensatory = econ + nonEcon;
  const net          = Math.round(compensatory * (1 - pf / 100)) + punitive;
  // polLimit: null when not explicitly set — prevents polEx from firing on unknown limits.
  const polLimit = m.policy_limit != null ? safeInt(m.policy_limit, 100000) : null;
  const medMal   = /malpractice|surgical|misdiagnosis|anesthesia/.test((m.title||'').toLowerCase());

  return {
    // fastTrack: catastrophic/severe injury OR crisis client vulnerability.
    // Both independently warrant same-day attorney contact — not both required.
    fastTrack: ['catastrophic','severe'].includes(severity) || crisis,
    settPress: ev === 'strong' && causa === 'clear',
    polEx: polLimit !== null && net > polLimit,
    netDamage: net,
    solYears: medMal ? 3 : 2,
    medMalDetected: medMal,
    settlementProbability: ev === 'strong' && causa === 'clear' ? 0.68 : ev === 'strong' ? 0.55 : 0.32,
  };
}

// F7 — Public Defense
function computePDSignals(m) {
  const ev      = evidenceBucket(m.evidence_score);
  const high    = ['high','crisis'].includes(m.vulnerability_level);
  const prior   = safeInt(m.prior_adjudications, 0);
  const charge  = (m.title || '').toLowerCase();

  return {
    needsMit: high,
    aggrMot: ['weak','contested'].includes(ev),
    // Advisory signal — many jurisdictions prohibit diversion for any violent felony
    // or offense with a mandatory minimum. Verify local diversion program eligibility.
    diversionEligible: ev !== 'weak' && prior === 0 &&
      !/(sexual assault|murder|robbery|arson|kidnap|carjacking|trafficking)/.test(charge),
    suppressionRecommended: ['weak','contested'].includes(ev) && /(search|seizure|stop|frisk|arrest)/.test(charge),
    // Brady v. Maryland: withheld exculpatory evidence, informant identity, lab results.
    // 'evidence' alone is too broad (matches 'insufficient evidence', 'evidence of guilt').
    bradyApplicable: ev === 'weak' && /(informant|lab report|lab result|witness tamper|suppressed|withheld|exculpatory)/.test(charge),
    // Batson v. Kentucky — discriminatory use of peremptory jury strikes.
    // NOT keyed to evidence strength — all criminal/PD matters with jury selection
    // have Batson rights. Advisory: attorneys should evaluate every jury-eligible matter.
    batsonApplicable: true,  // always applicable for criminal/PD verticals
  };
}

// F8 — Appellate
function computeAppellateSignals(m) {
  const ev        = evidenceBucket(m.evidence_score);
  const priorApp  = safeInt(m.prior_appeals, 0);
  const capital   = !!(m.is_capital);
  const high      = ['high','crisis'].includes(m.vulnerability_level);
  const stdRevBase = { strong: 60, moderate: 40, contested: 30, weak: 25 }[ev] || 25;
  const evBoost   = (ev === 'moderate' || ev === 'strong') ? 20 : 0;  // bucket-based, not raw score
  const revScore  = Math.max(0, Math.min(100, stdRevBase + evBoost - priorApp * 5));
  // Standard of review — SCOTUS cert petitions always use de_novo (legal questions).
  // hab_track='cert' overrides evidence-based standard since SCOTUS reviews law not facts.
  const isCertPetition = m.hab_track === 'cert';
  const appliedStd = isCertPetition ? 'de_novo'  // SCOTUS reviews legal questions de novo
    : ev === 'strong' ? 'de_novo'
    : ev === 'moderate' ? 'abuse_of_discretion'
    : ev === 'contested' ? 'plain_error' : 'harmless_error';

  return {
    prioCapital:          capital && high,
    revScore,             // 0-100 integer scale
    reversalProbability:  revScore / 100,  // 0.0-1.0 decimal for confidence displays
    appliedStd,
    // AEDPA § 2244(d)(1): 1-year deadline runs from the date judgment becomes FINAL
    // (after exhausting direct appeal), NOT from the conviction date.
    // years_post_conviction must be measured from final judgment for accuracy.
    // UI must display: 'Enter years since FINAL JUDGMENT on direct appeal, not conviction date.'
    // Flag at >= 1 year as early alert; attorneys must verify the precise start date.
    aedpaRisk:   safeInt(m.years_post_conviction, 0) >= 1,
    // aedpaRiskNote: surfaced in API response so frontend can display the field-level advisory.
    aedpaRiskNote: safeInt(m.years_post_conviction, 0) >= 1
      ? 'AEDPA 1-year limit: measure from FINAL JUDGMENT date, not conviction date (28 U.S.C. § 2244(d)(1))'
      : null,
    certWorthy:  revScore >= 60 && capital,
    // certApproaching: advisory for capital matters near cert threshold (revScore 50-59).
    // Attorneys should begin preserving federal constitutional issues before filing.
    certApproaching: revScore >= 50 && capital && revScore < 60,
    // certMonitor: early-watch signal for capital cases at revScore 40-49.
    // Attorney action: continue building the record, preserve constitutional issues.
    // A revScore 48 capital case receives no cert signal without this tier.
    certMonitor: revScore >= 40 && capital && revScore < 50,
    // ── Compassionate release § 3582(c)(1)(A) ────────────────────────────────────
    // Requires 30-day BOP administrative exhaustion before court filing.
    // Track BOP request date → calculate court-eligible date.
    bopExhaustionEligible: (() => {
      if (!m.bop_request_date) return false;
      const daysSinceRequest = Math.ceil((new Date() - new Date(m.bop_request_date)) / 86400000);
      return daysSinceRequest >= 30;  // 30-day lapse → court filing unlocked
    })(),
    bopExhaustionPending: !!(m.bop_request_date) && (() => {
      const daysSinceRequest = Math.ceil((new Date() - new Date(m.bop_request_date)) / 86400000);
      return daysSinceRequest < 30;
    })(),
    // ── IAC documentation flag ──────────────────────────────────────────────────
    // Strickland v. Washington (1984): IAC = deficient performance + prejudice.
    // IAC claims are the primary post-conviction vehicle in federal habeas.
    // This flag prompts documentation of prior counsel's actions at intake.
    iacDocumentNeeded: m.hab_track === 'habeas' && safeInt(m.years_post_conviction, 0) <= 1,
  };
}

// F9 — Military
function computeMilitarySignals(m) {
  const ev       = evidenceBucket(m.evidence_score);
  const charge   = (m.title || '').toLowerCase();
  const court    = m.court_type || 'general';
  const rankE    = safeInt(m.rank_e, 5);
  // Default 0 — unknown service length must not trigger veteransBenefitsRisk.
  // A matter with no service_years set could falsely show benefits at risk.
  const svcYrs   = safeInt(m.service_years, 0);
  const priorNJP = safeInt(m.prior_njp, 0);
  const notLow   = m.vulnerability_level !== 'low';

  const dischargeRisk = /(admin sep|discharge|conduct unbecoming|sexual assault|sexual|domestic|awol)/.test(charge);
  // likeleDisch discharge prediction — order matters (most severe checked first).
  // Art.128b DV strangulation (UCMJ 2012 amendment): mandatory dishonorable consideration.
  // sexual assault / murder: Dishonorable by UCMJ art. 120/118.
  // General assault / drug / theft: Bad Conduct (BCD) per UCMJ precedent.
  // Admin board: OTH (other than honorable) by process.
  const likeleDisch = /murder|rape|sexual assault/.test(charge) ? 'Dishonorable'
    : /strangulation|domestic violence strangulation/.test(charge) ? 'Dishonorable'
    : /conduct unbecoming|awol|desertion/.test(charge) ? 'OTH'
    : /assault|drug|theft|larceny/.test(charge) ? 'Bad Conduct'
    : court === 'admin_board' ? 'OTH' : 'Honorable';
  // maxConf is the court's JURISDICTIONAL CEILING, not the offense-specific max.
  // General court-martial: up to 240 months (jurisdictional); actual max varies by Article.
  // Special court-martial: max 12 months. Attorneys must verify Article-specific maximums.
  // maxConf: JURISDICTIONAL CEILING only — not the offense-specific maximum.
  // GCM: Art. 118 (murder) = life; Art. 121 (<$1k larceny) = 1yr; Art. 120 (rape) = life.
  // This value must always be displayed with the advisory caveat — never as a definitive max.
  const maxConf = court === 'general' ? 240 : 12;

  return {
    severeCons: dischargeRisk && notLow,
    negotiatePl: ev === 'strong' && court !== 'summary',
    dischargeRisk,
    likeleDisch,
    // Renamed: 'Ceiling' makes the advisory nature unambiguous in API responses.
    // Frontend MUST display this with the caveat: 'jurisdictional ceiling — verify Article-specific max.'
    maxConfinementJurisdictionalCeiling: maxConf,
    veteransBenefitsRisk: dischargeRisk && svcYrs >= 10,
    seniorEnlisted: rankE >= 7,
    seniorityFactor: Math.min(svcYrs / 20, 1),
    priorMisconduct: priorNJP > 0,
  };
}

/** Offense exclusion list for juvenile expungement and diversion eligibility.
 * Deliberately conservative — many jurisdictions bar both for these offenses.
 * Attorneys must verify their jurisdiction's specific rules. */
const EXPUNG_EXCLUDED = /(sexual assault|murder|robbery|arson|kidnap|carjacking|trafficking)/;

// F10 — Juvenile
function computeJuvenileSignals(m) {
  const ev      = evidenceBucket(m.evidence_score);
  const age     = safeInt(m.client_age, 14);
  const prior   = safeInt(m.prior_adjudications, 0);
  const track   = m.case_track || 'delinquency';
  const high    = ['high','crisis'].includes(m.vulnerability_level);
  const matter  = (m.title || '').toLowerCase();
  // Only set transfer flag for matters explicitly in the juvenile vertical
  // Default client_age=18 would create false positives on non-juvenile matters
  const isJuvenileAge = age < 18;
  const transfer = isJuvenileAge && track === 'delinquency' && age >= 16 && /(robbery|assault|murder|trafficking)/.test(matter);
  const expungElig = !transfer && prior === 0 && !EXPUNG_EXCLUDED.test(matter);

  return {
    traumaProto: high,
    // Diversion exclusion mirrors computePDSignals and computeDiversionRecommendations
    // Attorneys must verify jurisdiction-specific diversion program eligibility
    diverOffered: ev !== 'weak' && !transfer && prior === 0 &&
      !EXPUNG_EXCLUDED.test(matter),
    transfer,
    expungElig,
    icwaApplicable: /icwa|indian child|tribal/.test(matter),
    // CSEC = Commercial Sexual Exploitation of Children.
    // Bare 'trafficking' is too broad — drug trafficking is not CSEC.
    csecFlag: /csec|human trafficking|sex trafficking/.test(matter),
    // csecDependency: CSEC in a dependency track requires child welfare coordination
    // (CPS/DHHS referral) — distinct response from delinquency CSEC diversion.
    csecDependency: /csec|human trafficking|sex trafficking/.test(matter) && track === 'dependency',
    iepManifest: /iep|manifestation|disability|504/.test(matter),
    // ── Mandatory juvenile sex offender registration ─────────────────────────────
    // Some states require registration even for juvenile adjudications — lifetime
    // consequences applied to a child. Varies dramatically by state and offense.
    // Advisory: attorneys must verify state-specific registration requirements.
    juvenileSORRequired: /sexual assault|sex offense|indecent|exploitation|csam/.test(matter)
      && track === 'delinquency',
    // ── Juvenile record confidentiality ─────────────────────────────────────────
    // Juvenile records are NOT automatically sealed in all states for all offenses.
    // Serious offenses (transfer-eligible) may be public record.
    // This signal prompts attorneys to advise clients accurately.
    recordMayBePublic: transfer || /sexual assault|murder|robbery/.test(matter),
    // ── School discipline parallel proceedings ───────────────────────────────────
    // Students arrested often face expulsion before any conviction.
    // IDEA § 504 protections apply differently when disability is involved.
    schoolDisciplineParallel: age < 18 && (/iep|manifestation|disability|504/.test(matter) || /school|expulsion|suspension|discipline/.test(matter)),
  };
}

// ── TAXONOMY — 300-type matter classifier ─────────────────────────────────────
const MATTER_KEYWORDS = {
  // Military (checked first — UCMJ matters contain 'sexual assault' too)
  court_martial:   [/court[\-\s]?martial|court-martial|ucmj|article \d+|art\. \d+/],
  admin_sep:       [/admin sep|separation board|military discharge|discharge.*service|oth discharge/],
  clearance:       [/security clearance/],
  // Criminal
  capital:         [/murder|homicide|killing|death penalty/],
  drug_federal:    [/trafficking|heroin|meth|cocaine|fentanyl|§ 841|cce|distribution.*drug/],
  sexual_offense:  [/sexual assault|rape|indecent|csam|exploitation/],
  domestic:        [/domestic|strangulation|protective order/],
  white_collar_cr: [/fraud|embezzlement|wire fraud|mail fraud|tax evasion/],
  // Civil Rights
  excessive_force: [/excessive force|police|officer|§ 1983|shooting|tasing/],
  wrongful_conv:   [/wrongful conviction|brady|innocence|actual innocence/],
  // 'conditions' alone is too broad (matches bail conditions, bond conditions).
  // Require specific incarceration-context terms.
  conditions:      [/jail conditions|prison conditions|detention conditions|overcrowding|solitary|medical.*jail|\bprison\b/],
  // White-Collar
  fcpa:            [/fcpa|bribery|foreign.*corrupt/],
  aml:             [/fincen|bsa|bank secrecy|sar|structuring|laundering/],
  sec:             [/\bsec\b|securities|insider trading|spac|reg fd/],
  doj:             [/doj|grand jury|antitrust|mlars/],
  healthcare_reg:  [/hhs|oig|false claims|stark|kickback|medicare|medicaid/],
  // Immigration
  asylum_matter:   [/asylum|credible fear/],
  removal_defense: [/removal proceedings|order of removal|removal defense|cancellation of removal|deportation/],
  visa_petition:   [/h-1b|l-1|o-1|eb-1|eb-2|eb-3|niw/],
  // PI
  auto_accident:   [/auto|car|truck|motorcycle|vehicle|collision/],
  medical_malprac: [/malpractice|surgical|misdiagnosis|anesthesia/],
  mass_tort:       [/mdl|mass tort|roundup|asbestos|mesothelioma|pfas|opioid/],
  // Juvenile
  delinquency_j:   [/delinquency|juvenile.*crime|adjudication/],
  dependency_j:    [/dependency|neglect|abuse.*child|removal.*minor/],
  tpr:             [/termination.*parental|tpr|parental rights/],
  // Appellate
  habeas:          [/habeas|§ 2254|§ 2255|coram nobis|pcr/],
  cert_petition:   [/\bcert\b|certiorari|scotus/],
  compassionate:   [/compassionate release|§ 3582/],

};

function classifyMatterTitle(title) {
  const t = (title || '').toLowerCase();
  for (const [cat, patterns] of Object.entries(MATTER_KEYWORDS)) {
    if (patterns.some(p => p.test(t))) return cat;
  }
  return 'general';
}

// ─── TAXONOMY GROUP CONSTANTS — used by computeAllSignals default vertical fallback ───
const CRIMINAL_TAX = ['capital','drug_federal','sexual_offense','domestic','white_collar_cr'];
const CIVIL_TAX    = ['excessive_force','wrongful_conv','conditions'];
const WC_TAX       = ['fcpa','sec','doj','aml','healthcare_reg'];
const IMM_TAX      = ['asylum_matter','removal_defense','visa_petition'];
const PI_TAX       = ['auto_accident','medical_malprac','mass_tort'];
const JUV_TAX      = ['delinquency_j','dependency_j','tpr'];
const APP_TAX      = ['habeas','cert_petition','compassionate'];
const MIL_TAX      = ['court_martial','admin_sep','clearance'];

// ─── COMPUTE ALL SIGNALS FOR A MATTER ─────────────────────────────────────────
function computeAllSignals(matter) {
  const vertical = matter.vertical || 'general';
  const taxonomy = classifyMatterTitle(matter.title);
  // evidence bucket for the return value (verticalSignals each compute their own internally)
  let verticalSignals = {};
  switch (vertical) {
    case 'criminal_defense': verticalSignals = computeCriminalSignals(matter); break;
    case 'civil_rights':     verticalSignals = computeCivilRightsSignals(matter); break;
    case 'white_collar':     verticalSignals = computeWhiteCollarSignals(matter); break;
    case 'family':           verticalSignals = computeFamilySignals(matter); break;
    case 'immigration':      verticalSignals = computeImmigrationSignals(matter); break;
    case 'personal_injury':  verticalSignals = computePISignals(matter); break;
    case 'public_defense': {
      verticalSignals = computePDSignals(matter);
      // Public defense matters share extenuating circumstance signals with criminal_defense:
      // VOP compound and plea offer expiry fire for any client on supervision or with pending plea.
      const federal_pd = matter.jurisdiction === 'federal';
      const charge_pd  = (matter.title || '').toLowerCase();
      const drugCharge_pd = /drug|trafficking|narcotic|fentanyl|heroin|meth|cocaine|§ 841/.test(charge_pd);
      verticalSignals.vopCompound = !!(matter.supervised_release);
      verticalSignals.pleaOfferExpiring = !!(matter.plea_offer_pending) && (() => {
        if (!matter.plea_expires_date) return false;
        const daysLeft = Math.ceil((new Date(matter.plea_expires_date) - new Date()) / 86400000);
        return daysLeft >= 0 && daysLeft <= 2;
      })();
      verticalSignals.pleaOfferActive     = !!(matter.plea_offer_pending);
      verticalSignals.padillaWarningNeeded = !!(matter.non_citizen) && !!(matter.plea_offer_pending);
      verticalSignals.dualSovereigntyRisk  = !!(matter.dual_sovereignty_risk);
      verticalSignals.firstStepActEligible = federal_pd && drugCharge_pd &&
        /crack|cocaine.*base|\brock\b/.test(charge_pd) &&
        (matter.years_post_conviction || 0) === 0;
      break;
    }
    case 'appellate':        verticalSignals = computeAppellateSignals(matter); break;
    case 'military':         verticalSignals = computeMilitarySignals(matter); break;
    case 'juvenile':         verticalSignals = computeJuvenileSignals(matter); break;
    default: {
      // Infer vertical signals from taxonomy when vertical='general'
      // Taxonomy group arrays are module-level constants (see TAXONOMY_GROUPS below)
      if      (CRIMINAL_TAX.includes(taxonomy))  verticalSignals = computeCriminalSignals(matter);
      else if (CIVIL_TAX.includes(taxonomy))     verticalSignals = computeCivilRightsSignals(matter);
      else if (WC_TAX.includes(taxonomy))        verticalSignals = computeWhiteCollarSignals(matter);
      else if (IMM_TAX.includes(taxonomy))       verticalSignals = computeImmigrationSignals(matter);
      else if (PI_TAX.includes(taxonomy))        verticalSignals = computePISignals(matter);
      else if (JUV_TAX.includes(taxonomy))       verticalSignals = computeJuvenileSignals(matter);
      else if (APP_TAX.includes(taxonomy))       verticalSignals = computeAppellateSignals(matter);
      else if (MIL_TAX.includes(taxonomy))       verticalSignals = computeMilitarySignals(matter);
      break;
    }
  }

  // Emergency escalation — compound conditions
  const timePressure = matter.time_pressure || 'standard';
  const isEmergency  = timePressure === 'emergency';
  const isCrisis     = matter.vulnerability_level === 'crisis';

  const escalation = {
    level: 'normal',
    triggers: [],
    sla_hours: null,
  };

  if (isEmergency && isCrisis) {
    escalation.level = 'critical';
    escalation.sla_hours = 1;
    escalation.triggers.push('emergency_time_pressure + crisis_vulnerability');
  } else if (isEmergency) {
    escalation.level = 'high';
    escalation.sla_hours = 4;
    escalation.triggers.push('emergency_time_pressure');
  } else if (isCrisis) {
    escalation.level = 'elevated';
    escalation.sla_hours = 12;
    escalation.triggers.push('crisis_vulnerability');
  }

  // Helper: apply SLA only if it is more urgent (lower value) than current
  const setSLA = (hours) => {
    escalation.sla_hours = escalation.sla_hours === null
      ? hours
      : Math.min(escalation.sla_hours, hours);
  };

  if (verticalSignals.expeditedBail || verticalSignals.expedTRO || verticalSignals.detUrgent) {
    escalation.level = 'critical';
    setSLA(1);
    if (verticalSignals.expeditedBail) escalation.triggers.push('expedited_bail');
    if (verticalSignals.expedTRO)      escalation.triggers.push('expedited_tro');
    if (verticalSignals.detUrgent)     escalation.triggers.push('detained_urgent');
    // Compound escalation: barred + detained = simultaneous emergency stay + bar challenge
    if (verticalSignals.asylumBarred && verticalSignals.detUrgent) {
      escalation.triggers.push('compound_bar_detention');
    }
  }

  if (verticalSignals.fastTrack) {
    escalation.level = 'critical';
    setSLA(2);  // 2h for catastrophic PI — setSLA protects against overwriting sla=1
    escalation.triggers.push('catastrophic_severity_crisis');
  }

  // Plea offer expiring within 48 hours — window to accept closes
  if (verticalSignals.pleaOfferExpiring) {
    escalation.level = 'critical';
    setSLA(1);
    escalation.triggers.push('plea_offer_expiring_48h');
  }

  // Voluntary departure imminent — 10-year bar risk
  if (verticalSignals.volDepartureImminent) {
    escalation.level = 'critical';
    setSLA(1);
    escalation.triggers.push('voluntary_departure_imminent');
  }

  // VOP compound emergency — two simultaneous cases, lower evidentiary standard
  if (verticalSignals.vopCompound) {
    escalation.level = escalation.level === 'critical' ? 'critical' : 'high';
    setSLA(4);
    escalation.triggers.push('vop_compound_emergency');
  }

  // Extreme lethality — DV victim at risk of being killed
  if (verticalSignals.lethalityExtreme) {
    escalation.level = 'critical';
    setSLA(1);
    escalation.triggers.push('dv_extreme_lethality');
  }

  // DV firearm surrender non-compliance — federal crime exposure
  if (verticalSignals.firearmsurrenderRequired && isEmergency) {
    escalation.level = 'critical';
    setSLA(2);
    escalation.triggers.push('firearm_surrender_required');
  }

  if (verticalSignals.prioCapital) {
    escalation.level = 'critical';
    setSLA(1);
    escalation.triggers.push('capital_case_high_vulnerability');
  }

  // Deduplicate triggers in case overlapping conditions fired
  escalation.triggers = [...new Set(escalation.triggers)];

  return {
    matter_id: matter.id,
    vertical,
    taxonomy,
    evidence: { score: matter.evidence_score, bucket: evidenceBucket(matter.evidence_score) },
    vulnerability: matter.vulnerability_level || 'moderate',
    time_pressure: timePressure,
    jurisdiction: matter.jurisdiction || 'unknown',
    escalation,
    vertical_signals: verticalSignals,
    computed_at: new Date().toISOString(),
  };
}

// ─── MOTION RECOMMENDER ───────────────────────────────────────────────────────
function computeMotionRecommendations(matter) {
  const ev      = evidenceBucket(matter.evidence_score);
  const charge  = (matter.title || '').toLowerCase();
  const vuln    = matter.vulnerability_level || 'moderate';
  const vertical= matter.vertical || 'general';
  const recs    = [];

  // 4th Amendment suppression — only relevant for criminal, PD, and military (Art. 31 rights)
  if (['weak','contested'].includes(ev) &&
      ['criminal_defense','public_defense','military'].includes(vertical) &&
      /(search|seizure|stop|frisk|arrest|traffic stop|vehicle|drug arrest|DUI|stopped|pulled over)/.test(charge)) {
    recs.push({
      type: 'suppression_4th',
      label: '4th Amendment Suppression Motion',
      reason: `Weak/contested evidence (${ev}) + search/seizure matter — challenge the stop, search, or seizure.`,
      priority: 'high',
    });
  }

  // Brady/Giglio — only fire on specific Brady-indicator keywords
  // Mirrors computePDSignals.bradyApplicable — must stay in sync
  if (ev === 'weak' && /(informant|lab report|lab result|witness tamper|suppressed|withheld|exculpatory|police misconduct|key witness)/.test(charge)) {
    recs.push({
      type: 'Brady_Giglio',
      label: 'Brady/Giglio Disclosure Motion',
      reason: 'Weak evidence + Brady indicators — request full Brady/Giglio disclosure compliance.',
      priority: 'high',
    });
  } else if (ev === 'weak' && ['criminal_defense','public_defense','military'].includes(vertical) &&
             !recs.some(r => r.type === 'Brady_Giglio')) {
    recs.push({
      type: 'Brady_Giglio',
      label: 'Brady/Giglio Review — Advisory',
      reason: 'Weak evidence — conduct Brady/Giglio disclosure review and request all exculpatory materials.',
      priority: 'normal',
      advisory: true,
    });
  }

  // Batson challenge
  // Batson: evidence-independent — applies to ALL criminal/PD matters at jury selection
  if (vertical === 'criminal_defense' || vertical === 'public_defense') {
    recs.push({
      type: 'Batson',
      label: 'Batson Challenge (Jury Selection)',
      reason: 'Evaluate all peremptory strikes during voir dire for discriminatory patterns — applies regardless of evidence strength.',
      advisory: true,
      priority: 'normal',
    });
  }

  // Competency — Dusky v. United States standard.
  // Criminal/PD ONLY — civil, family, PI, immigration verticals do not have competency hearings.
  if (['high','crisis'].includes(vuln) &&
      ['criminal_defense','public_defense'].includes(vertical)) {
    recs.push({
      type: 'competency',
      label: 'Competency Evaluation Motion',
      reason: `${vuln.toUpperCase()} vulnerability — evaluate client competency to stand trial (Dusky standard).`,
      priority: 'high',
    });
  }

  // Speedy trial — only fire when matter has an explicit active status
  // Requires explicit status — a missing/null status should not trigger speedy trial
  // DB uses 'active' for open matters; 'pending' and 'open' kept for compatibility
  if (['high','crisis'].includes(vuln) && matter.status && /(pending|open|active)/.test(matter.status)) {
    recs.push({
      type: 'speedy_trial',
      label: 'Speedy Trial Demand',
      reason: 'Client vulnerability + open matter — assert speedy trial rights to accelerate resolution.',
      priority: 'normal',
    });
  }

  // Motion in limine (PI)
  if (vertical === 'personal_injury' && ev === 'strong') {
    recs.push({
      type: 'motion_in_limine',
      label: 'Motion in Limine — Expert Exclusion',
      reason: 'Strong plaintiff evidence — proactively exclude defense expert theories under Daubert.',
      priority: 'normal',
    });
  }

  // Appellate
  if (vertical === 'appellate') {
    // Cert petitions: SCOTUS reviews legal questions de novo regardless of evidence weight
    const isCert = matter.hab_track === 'cert';
    const std = isCert ? 'de_novo'
      : ev === 'strong' ? 'de_novo'
      : ev === 'moderate' ? 'abuse_of_discretion' : 'plain_error';
    const stdLabel = isCert ? 'de_novo (SCOTUS — legal questions)' : std;
    recs.push({
      type: 'standard_of_review',
      label: `Apply ${stdLabel.replace(/_/g, ' ')} standard of review`,
      reason: isCert
        ? 'Cert petition: SCOTUS reviews legal questions de novo — frame petition on pure legal error.'
        : `Evidence quality (${ev}) maps to ${std} — frame all briefs accordingly.`,
      priority: 'high',
    });
  }

  // Military
  if (vertical === 'military' && ev === 'strong') {
    recs.push({
      type: 'negotiate_plea',
      label: 'Plea Agreement Negotiation',
      reason: 'Strong prosecution evidence — negotiate plea to reduce discharge type and confinement.',
      priority: 'high',
    });
  }

  return recs;
}

// ─── DIVERSION RECOMMENDER ───────────────────────────────────────────────────
function computeDiversionRecommendations(matter) {
  const ev      = evidenceBucket(matter.evidence_score);
  const charge  = (matter.title || '').toLowerCase();
  const vuln    = matter.vulnerability_level || 'moderate';
  const prior   = safeInt(matter.prior_adjudications, 0);
  const age     = safeInt(matter.client_age, 30);
  const recs    = [];

  if (prior > 2) return recs; // ineligible

  if (/(drug|marijuana|substance|possession|paraphernalia)/.test(charge) && prior <= 1) {
    recs.push({
      track: 'drug_court',
      label: 'Drug Court Diversion',
      reason: 'Substance-related charge + limited priors — drug court offers treatment over incarceration.',
      eligibility_score: prior === 0 ? 0.85 : 0.60,
    });
  }

  if (['high','crisis'].includes(vuln) && /(mental|competency|psychiatric|disorder)/.test(charge)) {
    recs.push({
      track: 'mental_health_court',
      label: 'Mental Health Court',
      reason: 'Crisis/high vulnerability + mental health indicators — mental health diversion likely appropriate.',
      eligibility_score: 0.78,
    });
  }

  // 'military service' or 'veteran' — avoid matching 'child protective services', 'service of process'
  if (/(veteran|military service|military member|ucmj|active.duty)/.test(charge) || matter.vertical === 'military') {
    recs.push({
      track: 'veteran_court',
      label: 'Veterans Treatment Court',
      reason: 'Military matter or veteran status — Veterans Court addresses service-related circumstances.',
      eligibility_score: 0.80,
    });
  }

  // Expanded exclusion — consistent with computePDSignals diversionEligible
  if (ev !== 'weak' && prior === 0 && !/(sexual assault|murder|robbery|arson|kidnap|carjacking|trafficking)/.test(charge)) {
    recs.push({
      track: 'first_offender',
      label: 'First Offender Program',
      reason: 'No prior adjudications + not in excluded offense list — standard first-offender diversion available.',
      eligibility_score: ev === 'strong' ? 0.90 : ev === 'moderate' ? 0.75 : 0.55,
    });
  }

  if (/(shoplifting|theft|minor|simple assault|trespass|vandalism)/.test(charge) && prior <= 1) {
    recs.push({
      track: 'deferred_sentencing',
      label: 'Deferred Sentencing / Community Service',
      reason: 'Low-level offense — deferred sentencing with community service avoids criminal record.',
      eligibility_score: prior === 0 ? 0.88 : 0.65,
    });
  }

  return recs;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
/** Outcome indicator sort order — urgent/negative signals first, opportunities last. */
const SEVERITY_ORDER = [
  // Immediate/CRITICAL — must appear first
  'plea_expiry', 'vol_departure', 'vol_departure_missed', 'dv_lethality',
  'vop_compound', 'firearm_surrender',
  // High urgency
  'asylum_barred', 'padilla_required', 'withholding_cat', 'compassionate_release',
  'discharge_risk', 'mandatory_minimum', 'asylum_bar_risk', 'material_support',
  'sol_3yr', 'policy_exhausted', 'hague', 'dual_sovereignty',
  // Advisory/strategic
  'plea_active', 'iac_documentation', 'juvenile_sor',
  'reversal_probability', 'asylum_success', 'cert_worthy', 'cert_approaching',
  'safety_valve', 'booker_variance', 'first_step_act',
  'asset_preservation', 'expungement_eligible', 'pre_trial_demand',
  'early_settlement', 'settlement_likely',
];

/** Maps taxonomy category → practice vertical for auto-classification. */
const TAXONOMY_VERTICAL = {
  // criminal_defense
  capital: 'criminal_defense', drug_federal: 'criminal_defense',
  sexual_offense: 'criminal_defense', domestic: 'criminal_defense',
  white_collar_cr: 'white_collar',
  // civil_rights
  excessive_force: 'civil_rights', wrongful_conv: 'civil_rights', conditions: 'civil_rights',
  // white_collar
  fcpa: 'white_collar', sec: 'white_collar', doj: 'white_collar',
  aml: 'white_collar', healthcare_reg: 'white_collar',
  // immigration
  asylum_matter: 'immigration', removal_defense: 'immigration', visa_petition: 'immigration',
  // personal_injury
  auto_accident: 'personal_injury', medical_malprac: 'personal_injury', mass_tort: 'personal_injury',
  // juvenile
  delinquency_j: 'juvenile', dependency_j: 'juvenile', tpr: 'juvenile',
  // appellate
  habeas: 'appellate', cert_petition: 'appellate', compassionate: 'appellate',
  // military
  court_martial: 'military', admin_sep: 'military', clearance: 'military',
  // Note: 'family' and 'public_defense' have no keyword-based taxonomy entries.
  // These verticals require explicit vertical assignment — auto-inference is not reliable.
};


// ─── ROUTE HANDLERS ───────────────────────────────────────────────────────────

async function getMatter(db, matterId, firmId, userId = null) {
  // Try matter + vertical fields
  const m = await db.get(
    `SELECT m.id, m.firm_id, m.created_by, m.title, m.matter_type,
        m.practice_group, m.client_name, m.jurisdiction, m.status, m.priority,
        m.vertical, m.time_pressure, m.vulnerability_level,
        m.evidence_score, m.evidence_bucket,
        m.damages_type, m.class_certification_status,
        m.cooperation_level, m.dpa_status, m.dv_flag, m.asset_tier,
        m.custody_type, m.support_formula, m.prenup_flag,
        m.country_condition, m.relief_type, m.detained, m.years_us,
        m.removal_type, m.clock_days, m.injury_severity, m.causation_type,
        m.plaintiff_fault_pct, m.economic_damages, m.noneconomic_damages,
        m.punitive_damages, m.policy_limit, m.prior_adjudications,
        m.client_age, m.case_track, m.placement_type, m.hab_track,
        m.years_post_conviction, m.prior_appeals, m.is_capital,
        m.court_type, m.branch, m.rank_e, m.service_years, m.prior_njp,
        m.class_size, m.matter_taxonomy,
        m.supervised_release, m.on_supervision_since, m.dual_sovereignty_risk,
        m.plea_offer_pending, m.plea_expires_date, m.vol_departure_date,
        m.bop_request_date, m.non_citizen, m.lethality_score,
        fvc.vertical as firm_vertical
     FROM matters m
     LEFT JOIN firm_vertical_config fvc
       ON fvc.firm_id = m.firm_id
     WHERE m.id=?
     LIMIT 1`,
    [safeInt(matterId, 0)]
  ).catch(() => null);
  // safeInt(non-numeric) = 0; matter id 0 never exists, returns null naturally
  if (!m) return null;
  // Strict cross-firm isolation:
  //   - Matter has firm_id → must match caller's firm
  //   - Matter has no firm_id (consumer matter) → only accessible to the creator
  if (m.firm_id) {
    if (!firmId || m.firm_id !== firmId) return null;
  } else {
    // Consumer matter (no firm_id): only the original creator can access it.
    // getMatter receives userId as third argument for this check.
    // Allow access only if caller created this consumer matter
    if (userId === null || m.created_by !== userId) {
      return null;
    }
  }
  // Use matter.vertical if set, else firm_vertical (return clean object, no mutation)
  const vertical = (!m.vertical || m.vertical === 'general')
    ? (m.firm_vertical || 'general')
    : m.vertical;
  return { ...m, vertical };
}

// GET /api/matter-intelligence/firm/dashboard
router.get('/firm/dashboard', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await getFirmCtx(db, req.user.id);
    if (!ctx) return err403(res, 'Not a firm member.');
    if (!hasMinRank(ctx.firm_role, 'partner')) return err403(res, 'Requires partner+.');

    const limit  = Math.min(safeInt(req.query.limit, 200), 1000);
    const offset = safeInt(req.query.offset, 0);
    const matters = await db.all(
      `SELECT m.id, m.firm_id, m.created_by, m.title, m.vertical, m.matter_type,
              m.time_pressure, m.vulnerability_level, m.evidence_score, m.evidence_bucket,
              m.damages_type, m.class_certification_status, m.cooperation_level, m.dpa_status,
              m.dv_flag, m.asset_tier, m.country_condition, m.relief_type, m.detained, m.clock_days,
              m.injury_severity, m.causation_type, m.plaintiff_fault_pct, m.economic_damages,
              m.noneconomic_damages, m.punitive_damages, m.policy_limit,
              m.jurisdiction,
              m.prior_adjudications, m.client_age, m.case_track,
              m.is_capital, m.court_type, m.service_years, m.prior_njp,
              m.years_us, m.years_post_conviction, m.prior_appeals,
              m.rank_e, m.branch, m.hab_track,
              m.status, m.updated_at,
              fvc.vertical AS firm_vertical
       FROM matters m
       LEFT JOIN (
         SELECT firm_id, vertical FROM firm_vertical_config
         GROUP BY firm_id
       ) fvc ON fvc.firm_id = m.firm_id
       WHERE m.firm_id=? AND m.status='active'
       ORDER BY m.updated_at DESC LIMIT ? OFFSET ?`,
      [ctx.firm_id, limit, offset]
    ).catch(() => []);
    const { total_active } = await db.get(
      `SELECT COUNT(*) as total_active FROM matters m WHERE m.firm_id=? AND m.status='active'`,
      [ctx.firm_id]
    ).catch(() => ({ total_active: matters.length }));

    let criticalCount = 0, highCount = 0, expungElig = 0,
        settlementOpp = 0, diversionElig = 0, barRisk = 0,
        safetyValveCount = 0, mandatoryMinCount = 0;

    for (const rawM of matters) {
      try {
        // Resolve firm_vertical the same way getMatter does — matters with no
        // explicit vertical fall back to the firm's configured vertical.
        const mVertical = (!rawM.vertical || rawM.vertical === 'general')
          ? (rawM.firm_vertical || 'general')
          : rawM.vertical;
        const m = mVertical !== rawM.vertical ? { ...rawM, vertical: mVertical } : rawM;
        const s = computeAllSignals(m);
        if (s.escalation.level === 'critical') criticalCount++;
        else if (s.escalation.level === 'high' || s.escalation.level === 'elevated') highCount++;
        if (s.vertical_signals.dismissLikely || s.vertical_signals.expungElig) expungElig++;
        if (s.vertical_signals.earlySet || s.vertical_signals.likelySett || s.vertical_signals.settPress) settlementOpp++;
        if (s.vertical_signals.diversionEligible || s.vertical_signals.diverOffered) diversionElig++;
        if (s.vertical_signals.asylumBarRisk || s.vertical_signals.asylumBarred) barRisk++;
        if (s.vertical_signals.safetyValveEligible) safetyValveCount++;
        if (s.vertical_signals.mandatoryMin)         mandatoryMinCount++;
      } catch (signalErr) {
        logger.warn(`[mi/dashboard] skipping matter ${rawM.id}: ${signalErr.message}`);
      }
    }

    res.json({
      firm_id: ctx.firm_id,
      total_active_matters: total_active,
      returned: matters.length,
      limit,
      offset,
      escalation_summary: { critical: criticalCount, high: highCount },
      opportunity_summary: {
        expungement_eligible: expungElig,
        settlement_opportunities: settlementOpp,
        diversion_eligible: diversionElig,
        asylum_bar_risk: barRisk,
        safety_valve_eligible: safetyValveCount,
        mandatory_minimum_matters: mandatoryMinCount,
      },
      computed_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[mi/dashboard]', e.message);
    res.status(500).json({ error: 'Could not compute dashboard.' });
  }
});

// GET /api/matter-intelligence/:matterId/signals
router.get('/:matterId/signals', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const ctx  = await getFirmCtx(db, req.user.id);
    const m    = await getMatter(db, req.params.matterId, ctx?.firm_id, req.user.id);
    if (!m) return err404(res, 'Matter not found.');
    if (!hasMinRank(ctx?.firm_role || '', 'associate')) return err403(res, 'Requires associate+.');

    res.json(computeAllSignals(m));
  } catch (e) {
    logger.error('[mi/signals]', e.message);
    res.status(500).json({ error: 'Could not compute signals.' });
  }
});

// GET /api/matter-intelligence/:matterId/outcome
router.get('/:matterId/outcome', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await getFirmCtx(db, req.user.id);
    const m   = await getMatter(db, req.params.matterId, ctx?.firm_id, req.user.id);
    if (!m) return err404(res, 'Matter not found.');
    if (!hasMinRank(ctx?.firm_role || '', 'associate')) return err403(res, 'Requires associate+.');

    const signals = computeAllSignals(m);
    const vs      = signals.vertical_signals;

    // Build outcome summary from all vertical signals
    const outcome = {
      matter_id: m.id,
      vertical: signals.vertical,
      taxonomy: signals.taxonomy,
      outcome_indicators: [],
    };

    // Universal
    if (vs.dismissLikely) outcome.outcome_indicators.push({ type:'expungement_eligible', label:'Dismissal motion viable — expungement pathway open on resolution', confidence:0.77, source:'VAR-D: weak evidence', advisory:true });
    if (vs.earlySet)      outcome.outcome_indicators.push({ type:'early_settlement', label:'Early settlement opportunity', confidence:vs.settlementProbability||0.65, source:'VAR-D: strong + non-injunctive' });
    if (vs.likelySett)    outcome.outcome_indicators.push({ type:'settlement_likely', label:'Settlement pathway open', confidence:vs.settlementProbability||0.55, source:'VAR-D: favorable settlement factors' });
    // ── DV lethality ───────────────────────────────────────────────────────────
    if (vs.lethalityExtreme) outcome.outcome_indicators.push({ type:'dv_lethality', label:'🚨 EXTREME LETHALITY — Campbell score ≥ 8: client at acute risk of homicide. Implement safety plan immediately.', confidence:0.85, source:'lethality_score >= 8 + DV; Campbell Danger Assessment (validated)', advisory:false });
    if (vs.lethalityHigh && !vs.lethalityExtreme) outcome.outcome_indicators.push({ type:'dv_lethality', label:'High lethality — Campbell score ≥ 4: DV victim in dangerous situation. Escalate safety planning.', confidence:0.78, source:'lethality_score 4-7 + DV matter', advisory:false });
    // ── Firearm surrender ──────────────────────────────────────────────────────
    if (vs.firearmsurrenderRequired) outcome.outcome_indicators.push({ type:'firearm_surrender', label:'⚠ Firearm surrender required by TRO — 18 U.S.C. § 922(g)(8): federal crime to possess while subject to qualifying DV order', confidence:0.94, source:'DV + crisis/high; United States v. Rahimi (2024)', advisory:false });
    // ── Hague Convention ───────────────────────────────────────────────────────
    if (vs.hagueProceeding) outcome.outcome_indicators.push({ type:'hague', label:'Hague Convention proceeding — 1-year deadline for return petition: after 1 year child may be deemed settled', confidence:0.87, source:'Hague keywords in matter title; Hague Convention on Civil Aspects of International Child Abduction', advisory:false });
    if (vs.assetFreeze)   outcome.outcome_indicators.push({ type:'asset_preservation', label:'Asset preservation motion recommended alongside TRO', confidence:0.88, source:'High-asset matter + DV flag', advisory:true });
    if (vs.settPress)     outcome.outcome_indicators.push({ type:'pre_trial_demand', label:'Pre-trial demand recommended', confidence:0.68, source:'VAR-D: strong + clear causation' });

    // Vertical-specific
    if (vs.revScore !== undefined) outcome.outcome_indicators.push({ type:'reversal_probability', label:`Reversal score: ${vs.revScore}/100`, confidence:vs.reversalProbability||vs.revScore/100, source:`Standard of review: ${vs.appliedStd}` });
    if (vs.asylumSuccessProbability !== null && vs.asylumSuccessProbability !== undefined) {
      const pct = Math.round(vs.asylumSuccessProbability * 100);
      const tier = pct >= 60 ? 'High' : pct >= 40 ? 'Moderate' : 'Low';
      outcome.outcome_indicators.push({
        type: 'asylum_success',
        label: `Asylum strength: ${tier} (${pct}% est.)`,
        confidence: vs.asylumSuccessProbability,
        source: 'Simulation estimate — verify country conditions independently',
        advisory: true,  // not empirical data
      });
    }
    if (vs.asylumBarred) outcome.outcome_indicators.push({ type:'asylum_barred', label:'1-year asylum bar exceeded', confidence:1.0, source:'Clock days > 365 + relief = asylum' });
    if (vs.asylumBarRisk && !vs.asylumBarred) outcome.outcome_indicators.push({ type:'asylum_bar_risk', label:'Approaching 1-year asylum bar', confidence:0.9, source:'Clock days > 300' });
    // compound_bar_detention: simultaneous emergency — 1-year bar exceeded AND detained
    // Requires both emergency stay AND bar challenge motion filed simultaneously.
    // This is the highest-urgency immigration scenario — surfaces only in outcome, not just escalation.
    if (vs.compound_bar_detention) outcome.outcome_indicators.push({
      type: 'asylum_barred',
      label: '🚨 COMPOUND EMERGENCY: 1-year bar + detained — simultaneous stay + bar challenge required',
      confidence: 0.98,
      source: 'Bar exceeded (clock_days > 365) + detained + high/crisis vulnerability',
      advisory: false,
    });
    if (vs.polEx)         outcome.outcome_indicators.push({ type:'policy_exhausted', label:'Policy limit exceeded — UIM coverage check', confidence:0.95, source:`Net damages $${(vs.netDamage||0).toLocaleString()} > policy limit` });
    if (vs.medMalDetected) outcome.outcome_indicators.push({ type:'sol_3yr', label:'3-year medical malpractice SOL applies', confidence:1.0, source:'Matter title: malpractice keyword detected' });
    if (vs.dischargeRisk) outcome.outcome_indicators.push({ type:'discharge_risk', label:`Discharge type: ${vs.likeleDisch} (predicted)`, confidence:0.72, source:'UCMJ charge type analysis' });
    if (vs.certWorthy)     outcome.outcome_indicators.push({ type:'cert_worthy', label:'SCOTUS certiorari potentially viable', confidence:0.4, source:'High reversal score + capital case' });
    // Federal sentencing outcome indicators
    // ── VOP compound emergency ──────────────────────────────────────────────────
    // ── Plea offer ─────────────────────────────────────────────────────────────
    if (vs.pleaOfferExpiring) outcome.outcome_indicators.push({ type:'plea_expiry', label:'🚨 Plea offer expiring within 48 hours — decision required immediately', confidence:0.99, source:'plea_offer_pending=1 + expires_date within 2 days', advisory:false });
    if (vs.pleaOfferActive && !vs.pleaOfferExpiring) outcome.outcome_indicators.push({ type:'plea_active', label:'Active plea offer — review terms, advise client, document decision (and Padilla if non-citizen)', confidence:0.95, source:'plea_offer_pending=1', advisory:true });
    // ── Padilla ─────────────────────────────────────────────────────────────────
    if (vs.padillaWarningNeeded) outcome.outcome_indicators.push({ type:'padilla_required', label:'Padilla warning required — non-citizen client has pending plea: document immigration consequence advice NOW', confidence:0.98, source:'non_citizen=1 + plea_offer_pending=1; Padilla v. Kentucky (2010)', advisory:false });
    // ── Dual sovereignty ──────────────────────────────────────────────────────
    if (vs.dualSovereigntyRisk) outcome.outcome_indicators.push({ type:'dual_sovereignty', label:'Dual sovereignty risk — federal prosecution possible after state proceedings', confidence:0.80, source:'dual_sovereignty_risk=1; Petite Policy is internal DOJ policy, not a legal bar', advisory:true });
    // ── First Step Act ────────────────────────────────────────────────────────
    if (vs.firstStepActEligible) outcome.outcome_indicators.push({ type:'first_step_act', label:'Fair Sentencing Act: crack/cocaine disparity — evaluate § 404(b) retroactive reduction', confidence:0.70, source:'federal + crack keyword + pre-conviction; Fair Sentencing Act (2010), First Step Act (2018)', advisory:true });
    if (vs.safetyValveEligible) outcome.outcome_indicators.push({ type:'safety_valve', label:'§ 3553(f) Safety Valve — below mandatory minimum possible', confidence:0.72, source:'Federal drug charge + limited priors + nonviolent', advisory:true });
    if (vs.mandatoryMin && !vs.safetyValveEligible) outcome.outcome_indicators.push({ type:'mandatory_minimum', label:'Mandatory minimum sentence likely applicable', confidence:0.82, source:'Federal drug/weapon charge', advisory:true });
    if (vs.bookerVariance)   outcome.outcome_indicators.push({ type:'booker_variance', label:'Below-guidelines Booker variance motion warranted', confidence:0.55, source:'Federal matter + mitigating factors', advisory:true });
    if (vs.certApproaching) outcome.outcome_indicators.push({ type:'cert_approaching', label:'Cert threshold approaching — preserve federal constitutional issues now', confidence:0.25, source:'Rev score 50-59 + capital', advisory:true });
    if (vs.certMonitor && !vs.certApproaching) outcome.outcome_indicators.push({ type:'cert_approaching', label:'Cert threshold watch — continue building record (rev score 40-49). Verify federal constitutional issue preserved in state record.', confidence:0.12, source:'Rev score 40-49 + capital case', advisory:true });
    // New extenuating circumstance outcome indicators
    if (vs.pleaOfferExpiring) outcome.outcome_indicators.push({ type:'plea_expiry', label:'🚨 PLEA OFFER EXPIRING within 48 hours — decision required NOW', confidence:1.0, source:'plea_expires_date on matter' });
    if (vs.pleaOfferActive && !vs.pleaOfferExpiring) outcome.outcome_indicators.push({ type:'plea_active', label:'Active plea offer — evaluate charges, sentence, and immigration consequences before deciding', confidence:0.9, source:'plea_offer_pending', advisory:true });
    if (vs.padillaWarningNeeded) outcome.outcome_indicators.push({ type:'padilla_required', label:'Padilla warning required — document immigration consequences before any plea', confidence:1.0, source:'Padilla v. Kentucky (2010)', advisory:true });
    if (vs.vopCompound) outcome.outcome_indicators.push({ type:'vop_compound', label:'VOP compound emergency — client faces both criminal charge AND probation/parole revocation simultaneously', confidence:0.9, source:'supervised_release + new arrest' });
    if (vs.dualSovereigntyRisk) outcome.outcome_indicators.push({ type:'dual_sovereignty', label:'Federal parallel prosecution risk — state acquittal/conviction does not bar federal charges', confidence:0.7, source:'dual sovereignty doctrine', advisory:true });
    if (vs.volDepartureImminent) outcome.outcome_indicators.push({ type:'vol_departure', label:'🚨 Voluntary departure deadline within 14 days — missing triggers automatic 10-year bar + bond forfeiture', confidence:1.0, source:'vol_departure_date on matter' });
    if (vs.volDepartureMissed) outcome.outcome_indicators.push({ type:'vol_departure_missed', label:'Voluntary departure deadline MISSED — 10-year re-entry bar now active — evaluate withholding/CAT', confidence:1.0, source:'vol_departure_date exceeded' });
    if (vs.withholdingCATEvaluate) outcome.outcome_indicators.push({ type:'withholding_cat', label:'Asylum bar exceeded + detained — evaluate withholding of removal (§ 1231(b)(3)) and CAT relief — no 1-year bar', confidence:0.8, source:'AILA practice guides', advisory:true });
    if (vs.materialSupportScreen) outcome.outcome_indicators.push({ type:'material_support', label:'Material support screening required — potential 8 U.S.C. § 1182(a)(3)(B) bar — evaluate duress exception at intake', confidence:0.6, source:'INA § 212(a)(3)(B)', advisory:true });
    if (vs.lethalityExtreme) outcome.outcome_indicators.push({ type:'dv_lethality', label:'🚨 EXTREME DANGER — lethality score 8+ — victim at very high risk of lethal violence', confidence:0.85, source:'Campbell Danger Assessment' });
    if (vs.lethalityHigh && !vs.lethalityExtreme) outcome.outcome_indicators.push({ type:'dv_lethality', label:'HIGH DANGER — lethality score 4+ — safety planning required beyond TRO', confidence:0.75, source:'Campbell Danger Assessment', advisory:true });
    if (vs.firearmsurrenderRequired) outcome.outcome_indicators.push({ type:'firearm_surrender', label:'Firearm surrender required under DV TRO — 18 U.S.C. § 922(g)(8) — non-compliance is a federal crime (Rahimi 2024)', confidence:0.95, source:'United States v. Rahimi, 602 U.S. 680 (2024)', advisory:true });
    if (vs.bopExhaustionEligible) outcome.outcome_indicators.push({ type:'compassionate_release', label:'BOP 30-day exhaustion complete — § 3582(c)(1)(A) motion now eligible for filing in federal court', confidence:0.8, source:'18 U.S.C. § 3582(c)(1)(A)', advisory:true });
    if (vs.bopExhaustionPending) outcome.outcome_indicators.push({ type:'compassionate_release', label:'BOP compassionate release request pending — court filing available after 30-day lapse', confidence:0.7, source:'18 U.S.C. § 3582(c)(1)(A)', advisory:true });
    if (vs.iacDocumentNeeded) outcome.outcome_indicators.push({ type:'iac_documentation', label:'IAC documentation needed — record what prior counsel did/did not do before 1-year AEDPA window closes', confidence:0.85, source:'Strickland v. Washington (1984)', advisory:true });
    if (vs.hagueProceeding) outcome.outcome_indicators.push({ type:'hague', label:'Hague Convention proceeding — 1-year return petition deadline — file before settled-child defense becomes available', confidence:0.9, source:'Hague Convention, Art. 12', advisory:true });
    if (vs.juvenileSORRequired) outcome.outcome_indicators.push({ type:'juvenile_sor', label:'Juvenile sex offender registration may be required — verify state-specific requirements at disposition', confidence:0.7, source:'State SORA statutes', advisory:true });
    if (vs.firstStepActEligible) outcome.outcome_indicators.push({ type:'first_step_act', label:'First Step Act § 404(b) — crack cocaine sentence reduction may be available at sentencing', confidence:0.6, source:'First Step Act of 2018, § 404', advisory:true });

    // Sort using module-level SEVERITY_ORDER constant
    outcome.outcome_indicators.sort((a, b) => {
      const ai = SEVERITY_ORDER.indexOf(a.type);
      const bi = SEVERITY_ORDER.indexOf(b.type);
      // Unknown types go last; known types sort by position
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    outcome.computed_at = new Date().toISOString();
    res.json(outcome);
  } catch (e) {
    logger.error('[mi/outcome]', e.message);
    res.status(500).json({ error: 'Could not compute outcome.' });
  }
});

// GET /api/matter-intelligence/:matterId/motions
router.get('/:matterId/motions', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await getFirmCtx(db, req.user.id);
    const m   = await getMatter(db, req.params.matterId, ctx?.firm_id, req.user.id);
    if (!m) return err404(res, 'Matter not found.');
    if (!hasMinRank(ctx?.firm_role || '', 'associate')) return err403(res, 'Requires associate+.');

    const recs = computeMotionRecommendations(m);
    res.json({ matter_id: m.id, motions: recs, total: recs.length, computed_at: new Date().toISOString() });
  } catch (e) {
    logger.error('[mi/motions]', e.message);
    res.status(500).json({ error: 'Could not compute motion recommendations.' });
  }
});

// GET /api/matter-intelligence/:matterId/diversion
router.get('/:matterId/diversion', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await getFirmCtx(db, req.user.id);
    const m   = await getMatter(db, req.params.matterId, ctx?.firm_id, req.user.id);
    if (!m) return err404(res, 'Matter not found.');
    if (!hasMinRank(ctx?.firm_role || '', 'associate')) return err403(res, 'Requires associate+.');

    const recs = computeDiversionRecommendations(m);
    res.json({ matter_id: m.id, diversion_tracks: recs, total: recs.length, computed_at: new Date().toISOString() });
  } catch (e) {
    logger.error('[mi/diversion]', e.message);
    res.status(500).json({ error: 'Could not compute diversion recommendations.' });
  }
});

// GET /api/matter-intelligence/:matterId/escalation
router.get('/:matterId/escalation', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await getFirmCtx(db, req.user.id);
    const m   = await getMatter(db, req.params.matterId, ctx?.firm_id, req.user.id);
    if (!m) return err404(res, 'Matter not found.');
    if (!hasMinRank(ctx?.firm_role || '', 'paralegal')) return err403(res, 'Requires paralegal+.');

    const signals    = computeAllSignals(m);
    const escalation = signals.escalation;
    const critical   = escalation.level === 'critical';

    res.json({
      matter_id: m.id,
      ...escalation,
      recommended_sla: escalation.sla_hours
        ? `${escalation.sla_hours}h attorney contact required`
        : 'Standard response time',
      notify_partner: escalation.level !== 'normal',
      recommended_match_boost: critical,
      computed_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[mi/escalation]', e.message);
    res.status(500).json({ error: 'Could not compute escalation.' });
  }
});

// POST /api/matter-intelligence/:matterId/taxonomy
router.post('/:matterId/taxonomy', authRequired, routeLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await getFirmCtx(db, req.user.id);
    const m   = await getMatter(db, req.params.matterId, ctx?.firm_id, req.user.id);
    if (!m) return err404(res, 'Matter not found.');
    if (!hasMinRank(ctx?.firm_role || '', 'associate')) return err403(res, 'Requires associate+.');

    const taxonomy = classifyMatterTitle(m.title);

    // Vertical mapping defined at module level (TAXONOMY_VERTICAL)

    const suggestedVertical = TAXONOMY_VERTICAL[taxonomy] || m.vertical || 'general';

    // Auto-update vertical on matter if not set
    const taxonomyUpdated = !m.vertical || m.vertical === 'general';
    if (taxonomyUpdated) {
      await db.run(
        'UPDATE matters SET vertical=?, matter_taxonomy=?, updated_at=? WHERE id=?',
        [suggestedVertical, taxonomy, new Date().toISOString(), m.id]
      ).catch(() => null);
      await writeAuditLog(db, {
        user_id: req.user.id, firm_id: ctx?.firm_id,
        action: 'update', resource: 'matter_vertical_taxonomy',
        record_id: m.id,
        old_value: { vertical: m.vertical, matter_taxonomy: m.matter_taxonomy },
        new_value: { vertical: suggestedVertical, matter_taxonomy: taxonomy },
        ip: req.ip, ua: req.headers['user-agent'],
      }).catch(() => null);
    }

    res.json({
      matter_id: m.id,
      title: m.title,
      taxonomy,
      suggested_vertical: suggestedVertical,
      vertical_updated: taxonomyUpdated,
      computed_at: new Date().toISOString(),
      workflow_flags: {
        medMal: taxonomy === 'medical_malprac',
        classCertRequired: taxonomy === 'excessive_force' || taxonomy === 'conditions',
        capitalCase: taxonomy === 'capital',
        ucmjArticle: taxonomy === 'court_martial',
        icwa: /icwa|indian child|tribal/.test((m.title || '').toLowerCase()),
      },
    });
  } catch (e) {
    logger.error('[mi/taxonomy]', e.message);
    res.status(500).json({ error: 'Could not classify matter.' });
  }
});


export default router;
export { computeAllSignals, computeMotionRecommendations, computeDiversionRecommendations, classifyMatterTitle, evidenceBucket };

// GET /api/matter-intelligence/:id/analytics
router.get('/:id/analytics', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const matterId = parseInt(req.params.id, 10);
    // Pull together case analytics from related tables
    const events = await db.get(
      'SELECT COUNT(*) as n FROM case_events WHERE matter_id = ?', [matterId]
    ).catch(() => ({ n: 0 }));
    const docs = await db.get(
      'SELECT COUNT(*) as n FROM discovery_analyses WHERE user_id = ?', [req.user.id]
    ).catch(() => ({ n: 0 }));
    const timeline = await db.all(
      'SELECT entry_date, filing_type FROM docket_entries WHERE matter_id = ? ORDER BY entry_date DESC LIMIT 10',
      [matterId]
    ).catch(() => []);
    res.json({
      matter_id: matterId,
      event_count: events?.n || 0,
      document_count: docs?.n || 0,
      recent_timeline: timeline,
      analytics: {
        risk_score: 'medium',
        next_deadline: null,
        days_active: 0,
      }
    });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});
