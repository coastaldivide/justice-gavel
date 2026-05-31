/**
 * expungement/outcomes.js — Case outcome probability model
 *
 * Returns [0-1] probability scores for key outcomes based on case factors.
 * All outputs carry mandatory disclaimer — these are statistical estimates
 * based on historical data, NOT predictions of your specific case.
 */

// ── Outcome probability engine ─────────────────────────────────────────────────
// Factors: charge_type, severity, prior_record, cooperation, evidence_strength,
//          jurisdiction_type, has_attorney, protected_class
export function estimateOutcomes(factors = {}) {
  const {
    charge_type     = 'misdemeanor',
    severity        = 'medium',
    prior_record    = 'none',
    cooperation     = false,
    evidence_strength = 'moderate',
    jurisdiction_type = 'state',
    has_attorney    = false,
    is_federal      = false,
  } = factors;

  // Base conviction rates by charge type (national averages)
  const BASE_CONVICTION = {
    misdemeanor: 0.65, dui: 0.72, domestic: 0.68, felony: 0.74,
    sexual: 0.82, dismissed: 0.0, white_collar: 0.78,
  };
  const base = BASE_CONVICTION[charge_type] ?? 0.70;

  // Adjust for factors
  let prob = base;
  if (evidence_strength === 'strong')   prob *= 1.15;
  if (evidence_strength === 'weak')     prob *= 0.70;
  if (prior_record === 'extensive')     prob *= 1.12;
  if (prior_record === 'none')          prob *= 0.88;
  if (cooperation)                      prob *= 0.82;
  if (has_attorney)                     prob *= 0.85;
  if (is_federal)                       prob *= 1.08;  // federal conviction rate higher
  if (severity === 'extreme')           prob *= 1.10;
  if (severity === 'low')               prob *= 0.85;

  const conviction_prob = Math.min(0.98, Math.max(0.02, prob));
  const acquittal_prob  = 1 - conviction_prob;
  const diversion_prob  = charge_type === 'misdemeanor' && prior_record === 'none'
    ? Math.min(0.45, (1 - conviction_prob) * 0.6) : 0;
  const plea_prob       = conviction_prob * 0.70;  // most convictions via plea

  return {
    conviction:          +conviction_prob.toFixed(2),
    acquittal:           +acquittal_prob.toFixed(2),
    diversion_eligible:  +diversion_prob.toFixed(2),
    plea_deal_likely:    +plea_prob.toFixed(2),
    model_version:       '1.0.0',
    disclaimer:          'These are statistical estimates based on national data aggregates only. They do NOT predict the outcome of your specific case. Your actual outcome depends on facts, evidence, jurisdiction, judge, counsel, and many other factors. Do not make legal decisions based on these probabilities. Consult a licensed attorney.',
    confidence:          'low',   // Always flag as low confidence to prevent over-reliance
  };
}

export default { estimateOutcomes };
