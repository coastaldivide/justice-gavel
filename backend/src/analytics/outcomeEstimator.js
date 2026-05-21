/**
 * JUSTICE GAVEL — OUTCOME ESTIMATOR
 * ─────────────────────────────────────────────────────────────────────────────
 * Produces factor-based analytical assessments of case outcomes.
 *
 * THIS IS NOT A PREDICTION ENGINE. It is a structured factor analysis tool
 * that applies published statistics to the specific factors present in a matter.
 * Every output includes:
 *   - The published base rate and its source
 *   - Which factors were identified in this matter
 *   - How each factor modified the base rate
 *   - What the estimated range is (not a point estimate)
 *   - Which assumptions were made
 *   - Mandatory attorney verification notice
 *
 * WHAT IT DOES NOT DO:
 *   - Predict what a specific judge or jury will decide
 *   - Use demographic characteristics of parties
 *   - Claim empirical precision it does not have
 *   - Recommend specific legal strategies (that is the attorney's role)
 *
 * OBJECTIVITY GUARANTEES:
 *   - All inputs are legal-factual (evidence strength, charge type, jurisdiction)
 *   - No personally identifying factors
 *   - All base rates are published, citable, and dated
 *   - Outputs show their work — every factor is named
 *   - Range bounds prevent false precision
 *   - Circuit split warnings surface automatically
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getRelevantEntries, getCircuitSplitEntries } from './precedentRegistry.js';

const ESTIMATOR_VERSION = '1.0.0';

// ─── PERMITTED INPUT FACTORS ──────────────────────────────────────────────────
// This whitelist is the bias firewall. Any factor NOT on this list
// cannot enter the computation. No proxy variables.
const PERMITTED_FACTORS = new Set([
  // Evidence
  'evidence_score', 'evidence_bucket', 'causation_type', 'injury_severity',
  // Charges / Legal
  'charge_type', 'taxonomy', 'vertical', 'is_capital',
  // Procedural
  'jurisdiction', 'prior_adjudications', 'prior_appeals', 'years_post_conviction',
  'hab_track', 'court_type', 'case_track', 'relief_type',
  // Matter state
  'vulnerability_level', 'cooperation_level', 'dpa_status',
  'damages_type', 'class_certification_status', 'asset_tier',
  // Immigration-specific
  'clock_days', 'detained', 'country_condition', 'years_us',
  // Military-specific
  'service_years', 'rank_e', 'prior_njp',
  // PI-specific
  'plaintiff_fault_pct', 'policy_limit', 'economic_damages',
  'noneconomic_damages', 'punitive_damages',
]);

// ─── FACTOR EXTRACTION ────────────────────────────────────────────────────────

function extractPermittedFactors(matter) {
  const factors = {};
  for (const [k, v] of Object.entries(matter)) {
    if (PERMITTED_FACTORS.has(k) && v !== null && v !== undefined) {
      factors[k] = v;
    }
  }
  // Add derived factors
  factors.evidence_bucket = evidenceBucket(matter.evidence_score);
  return factors;
}

function evidenceBucket(score) {
  // Number() handles all edge cases: undefined→NaN, null→0, ''→0, 'abc'→NaN.
  // Consistent with the safeInt pattern used in matter_intelligence.js.
  const s = Math.max(0, Math.min(100, Number(score) || 50));
  if (s < 25) return 'weak';
  if (s < 50) return 'contested';
  if (s < 75) return 'moderate';
  return 'strong';
}

// ─── FACTOR APPLICATION ───────────────────────────────────────────────────────

function applyFactors(baseRate, entryFactors, matterFactors) {
  if (!entryFactors || typeof entryFactors !== 'object') return { rate: baseRate, applied: [] };

  let rate = baseRate;
  const applied = [];
  let baseOverride = null;

  const eb = matterFactors.evidence_bucket;
  const coop = matterFactors.cooperation_level || 'unknown';
  const country = matterFactors.country_condition || 'stable';
  const track = matterFactors.case_track || 'delinquency';

  // Map entry factor keys to matter factor values
  const factorMatches = {
    evidence_strong:        eb === 'strong',
    evidence_weak:          eb === 'weak',
    evidence_moderate:      eb === 'moderate',
    prior_zero:             (matterFactors.prior_adjudications || 0) === 0,
    prior_one:              (matterFactors.prior_adjudications || 0) === 1,
    capital:                !!matterFactors.is_capital,
    detained:               !!matterFactors.detained,
    country_crisis:         country === 'crisis',
    country_deteriorating:  country === 'deteriorating',
    country_stable:         country === 'stable',
    full_cooperation:       coop === 'full_cooperation',
    proffer_agreement:      coop === 'proffer_agreement',
    limited_cooperation:    coop === 'limited_cooperation',
    no_cooperation:         coop === 'no_cooperation',
    self_disclosure:        matterFactors.dpa_status === 'evaluating' && coop === 'full_cooperation',
    self_reporting:         matterFactors.dpa_status === 'evaluating',
    class_certified:        matterFactors.class_certification_status === 'certified',
    compensatory_only:      matterFactors.damages_type === 'compensatory_only',
    injunctive_only:        matterFactors.damages_type === 'injunctive_only',
    catastrophic:           matterFactors.injury_severity === 'catastrophic',
    catastrophic_injury:    matterFactors.injury_severity === 'catastrophic',
    medmal:                 matterFactors.taxonomy === 'medical_malprac',
    auto_accident:          matterFactors.taxonomy === 'auto_accident',
    medical_malprac:        matterFactors.taxonomy === 'medical_malprac',
    products_liability:     matterFactors.taxonomy === 'mass_tort',
    vuln_crisis:            matterFactors.vulnerability_level === 'crisis',
    vuln_high:              matterFactors.vulnerability_level === 'high',
    prior_appeals_zero:     (matterFactors.prior_appeals || 0) === 0,
    de_novo:                matterFactors.hab_track === 'cert' || eb === 'strong',
    abuse_of_discretion:    eb === 'moderate' && matterFactors.hab_track !== 'cert',
    plain_error:            eb === 'weak' && matterFactors.hab_track !== 'cert',
    colorable_claim:        eb !== 'weak',
    aedpa_one_year:         (matterFactors.years_post_conviction || 0) >= 1,
    one_year_bar:           (matterFactors.clock_days || 0) > 365 && matterFactors.relief_type === 'asylum',
    violent:                false,  // violence never auto-applies positively to defendant
    weapon:                 false,  // weapon factor only applies via drug_charge check
    annual_cap:             true,   // always apply cancellation cap reduction
    first_offender:         (matterFactors.prior_adjudications || 0) === 0,
    drug_charge:            /drug|marijuana|heroin|meth|cocaine|fentanyl/.test((matterFactors.taxonomy || '').toLowerCase()),
    years_us_10_plus:       (matterFactors.years_us || 0) >= 10,
    years_us_15_plus:       (matterFactors.years_us || 0) >= 15,
    scotus_precedent:       false,  // requires attorney to specify
    admin_board:            matterFactors.court_type === 'admin_board',
  };

  // PASS 1: collect base_override (if any) — do NOT touch rate yet.
  // Separating override detection from multiplier application prevents
  // multipliers from applying to the wrong base value.
  const multiplierFactors = [];
  for (const [factorKey, factorData] of Object.entries(entryFactors)) {
    if (!factorMatches[factorKey]) continue;
    if (factorData.base_override !== undefined) {
      // Only the first matching override wins — later overrides are ignored.
      if (baseOverride === null) {
        baseOverride = factorData.base_override;
        applied.push({ factor: factorKey, effect: 'base_rate_override', value: baseOverride, note: factorData.note });
      }
    } else if (factorData.multiplier !== undefined) {
      multiplierFactors.push({ factorKey, factorData });
    }
  }

  // PASS 2: set the base (override or original), then apply multipliers once.
  if (baseOverride !== null) rate = baseOverride;
  for (const { factorKey, factorData } of multiplierFactors) {
    const before = rate;
    rate = rate * factorData.multiplier;
    applied.push({ factor: factorKey, effect: 'multiplier', value: factorData.multiplier, from: parseFloat(before.toFixed(3)), to: parseFloat(rate.toFixed(3)), note: factorData.note });
  }

  // Clamp to [0.02, 0.98] — never claim certainty
  rate = Math.max(0.02, Math.min(0.98, rate));

  return { rate, applied };
}

// ─── RANGE COMPUTATION ────────────────────────────────────────────────────────
// Never give a single number. Give an honest range that reflects
// the variance in the underlying data and the limitations of the analysis.

function computeRange(pointEstimate, entry) {
  const variance = entry.stat_n
    ? Math.min(0.15, Math.sqrt(pointEstimate * (1 - pointEstimate) / entry.stat_n) * 3)
    : 0.20;  // wider range when no sample size

  const low  = Math.max(0.02, pointEstimate - variance);
  const high = Math.min(0.98, pointEstimate + variance);
  return {
    low:   parseFloat(low.toFixed(2)),
    point: parseFloat(pointEstimate.toFixed(2)),
    high:  parseFloat(high.toFixed(2)),
    label: `${Math.round(low * 100)}%–${Math.round(high * 100)}%`,
  };
}

// ─── SIGNAL TIER LABELING ─────────────────────────────────────────────────────
// Replace confidence percentages with honest categorical labels.
// This is what attorneys actually need.

// Signal tier labels — attorney empowering, never discouraging.
// The tier names describe the STRATEGIC POSTURE of the case,
// not a prediction of who wins. Every tier has a clear path forward.
// 'STRATEGY FOCUS' does not mean losing — it means full strategic attention
// is required. Every case in any tier can be won or settled well.
function signalTier(point) {
  if (point >= 0.70) return { tier: 'STRONG POSITION',  color: 'green',  icon: '●' };
  if (point >= 0.50) return { tier: 'BALANCED FIELD',   color: 'yellow', icon: '◐' };
  if (point >= 0.30) return { tier: 'BUILD STRENGTH',   color: 'orange', icon: '◉' };
  return                    { tier: 'STRATEGY FOCUS',   color: 'blue',   icon: '⚑' };
}

// ─── MAIN ESTIMATOR ───────────────────────────────────────────────────────────

/**
 * computeOutcomeEstimate(matter)
 *
 * Returns a structured analytical report for a given matter.
 * Every conclusion is sourced. Every factor is named. Every range
 * is explicitly bounded. Attorney verification is mandatory.
 */
export function computeOutcomeEstimate(matter) {
  const vertical  = matter.vertical || 'general';
  const taxonomy  = matter.taxonomy || null;
  const asOf      = new Date().toISOString().slice(0, 10);
  const factors   = extractPermittedFactors(matter);

  // Get applicable precedent entries
  const entries   = getRelevantEntries(vertical, taxonomy, asOf);
  const splitEnts = getCircuitSplitEntries(vertical);

  const analyses = [];
  const precedents = [];
  const warnings  = [];

  // ── Process each applicable registry entry ──────────────────────────────
  for (const entry of entries) {
    if (entry.source_type === 'statistics' && entry.stat_base !== null) {
      const { rate, applied } = applyFactors(entry.stat_base, entry.factors, factors);
      const range  = computeRange(rate, entry);
      const signal = signalTier(rate);

      analyses.push({
        entry_id:        entry.id,
        title:           entry.title,
        signal_tier:     signal.tier,
        signal_color:    signal.color,
        signal_icon:     signal.icon,
        base_rate:       entry.stat_base,
        base_rate_label: `${Math.round(entry.stat_base * 100)}%`,
        estimated_range: range,
        factors_applied: applied,
        factors_not_applied: Object.keys(entry.factors).filter(k => !applied.find(a => a.factor === k)),
        source:          entry.source,
        source_url:      entry.source_url,
        source_type:     entry.source_type,
        stat_year:       entry.stat_year,
        stat_n:          entry.stat_n,
        jurisdiction:    entry.jurisdiction,
        circuit_split:   entry.circuit_split,
        notes:           entry.notes,
        stale_after:     entry.stale_after,
        holding:         entry.holding,
        interpretation:  buildInterpretation(entry, factors, range, applied),
      });
    }

    // Precedent cases (non-statistical) — cited as authority
    if (entry.source_type === 'case') {
      precedents.push({
        entry_id:    entry.id,
        title:       entry.title,
        source:      entry.source,
        source_url:  entry.source_url,
        holding:     entry.holding,
        valid_from:  entry.valid_from,
        notes:       entry.notes,
        circuit_split: entry.circuit_split,
      });
    }
  }

  // ── Circuit split warnings ──────────────────────────────────────────────
  for (const se of splitEnts) {
    if (!warnings.some(w => w.entry_id === se.id)) {
      warnings.push({
        type:     'circuit_split',
        entry_id: se.id,
        message:  `Circuit split: ${se.title}`,
        detail:   se.notes,
        source:   se.source,
      });
    }
  }

  // ── Jurisdiction warning ────────────────────────────────────────────────
  if (!matter.jurisdiction || matter.jurisdiction === 'unknown') {
    warnings.push({
      type:    'missing_jurisdiction',
      message: 'Jurisdiction not set — analysis uses national averages',
      detail:  'Outcomes vary significantly by circuit and state. Set the jurisdiction field for more accurate analysis.',
    });
  }

  // ── Staleness check ─────────────────────────────────────────────────────
  const staleEntries = entries.filter(e => {
    if (!e.stale_after) return false;
    const days = (new Date(e.stale_after) - new Date()) / (1000 * 86400);
    return days < 180;
  });
  if (staleEntries.length > 0) {
    warnings.push({
      type:    'staleness_warning',
      message: `${staleEntries.length} reference(s) approaching review date`,
      detail:  staleEntries.map(e => `${e.title} (review: ${e.stale_after})`).join('; '),
    });
  }

  return {
    version:           ESTIMATOR_VERSION,
    computed_at:       new Date().toISOString(),
    matter_id:         matter.id,
    vertical,
    taxonomy,
    jurisdiction:      matter.jurisdiction || 'unknown',
    factors_evaluated: Object.keys(factors),
    analyses,
    precedents,
    warnings,
    // Mandatory disclosure — always returned, cannot be suppressed
    disclaimer: {
      required: true,
      text: 'This analysis applies published legal statistics and precedent to the factors present in this matter. It is a structured attorney research tool — not a prediction of how any specific court will rule. Every case has a path to the best possible outcome. This analysis identifies the strategic factors the attorney should focus on. Attorney judgment is required before any action is taken on the basis of this analysis.',
      methodology: `Factor-weighted base rates from published government statistics (BJS, EOIR, USSC, OJJDP). Base rates reflect population-level outcomes. Individual case results may differ substantially from population averages. Source citations are provided for independent attorney verification.`,
      bias_policy: 'This analysis uses only legally relevant factors: evidence strength, charge type, jurisdiction, procedural posture, and statutory qualifications. Demographic characteristics are never used.',
      update_policy: `Registry version ${ESTIMATOR_VERSION} as of ${asOf}. Registry is updated when new precedent is issued or statistics are published. Attorneys should verify currency of any cited authority independently.`,
    },
  };
}

// ─── INTERPRETATION BUILDER ───────────────────────────────────────────────────
// Builds plain-English attorney-facing interpretation of the analysis.
// Shows the math. Names the factors. Never says "you will win."

function buildInterpretation(entry, factors, range, applied) {
  const baseLabel = `${Math.round(entry.stat_base * 100)}%`;
  const rangeLabel = range.label;
  const year = entry.stat_year || 'recent year';
  const jurisdiction = entry.jurisdiction === 'federal' ? 'federal courts' :
                       entry.jurisdiction === 'national' ? 'courts nationally' :
                       `${entry.jurisdiction} courts`;

  let text = `Published data shows a ${baseLabel} base rate for this outcome in ${jurisdiction} (${year}, n=${entry.stat_n?.toLocaleString() || 'not reported'}).`;

  if (applied.length === 0) {
    text += ` No matter-specific factors were identified to adjust this baseline.`;
  } else {
    const favorable   = applied.filter(a => a.effect === 'multiplier' && a.value > 1.0);
    const needsWork   = applied.filter(a => a.effect === 'multiplier' && a.value < 1.0);
    const overrides   = applied.filter(a => a.effect === 'base_rate_override');

    if (overrides.length > 0) {
      text += ` Matter type adjusts the base rate (${overrides[0].note}).`;
    }
    if (favorable.length > 0) {
      text += ` Supportive factors: ${favorable.map(f => f.note).join('; ')}.`;
    }
    if (needsWork.length > 0) {
      text += ` Factors requiring attorney attention: ${needsWork.map(f => f.note).join('; ')}.`;
    }
  }

  text += ` Estimated range for this matter: ${rangeLabel}. This range reflects statistical variance — individual outcomes may fall outside it.`;

  if (entry.circuit_split) {
    text += ` ⚑ Circuit split: jurisdiction strategy is critical here — different circuits apply different standards. Verifying current circuit-specific precedent is a high-priority attorney action.`;
  }

  return text;
}

export default computeOutcomeEstimate;
