/**
 * billing/attorneyLeadFee.js — SINGLE SOURCE OF TRUTH for attorney lead fees
 * (personal injury, civil rights, employment, ICE detention).
 *
 * Every fee is FLAT per lead type. It never depends on injury severity or
 * expected case value: value-scaled fees look like a share of the attorney's
 * fee and implicate ABA Model Rules 5.4(a) and 7.2(b) (see ABA Formal
 * Opinion 501). Severity is still collected so attorneys can triage, but it
 * does not change the price.
 *
 * Used by routes/billing/pi_leads.js (the app's /billing/pi-lead/* flow) and
 * routes/pi_leads.js (/api/pi-leads/*). The app keeps a display fallback in
 * frontend/src/constants/leadFee.ts; lead_fee_consistency.test.js fails if
 * the two drift apart.
 *
 * Dependency-free on purpose.
 */

/** Personal injury (incl. medical malpractice): flat $250 per lead (Oct 2026: market midpoint,
 *  Google Local Services Ads legal $195–250, PI exclusive leads $250–600). */
export const PI_LEAD_FEE_CENTS = 25000;

const FEES_BY_TYPE = {
  personal_injury: PI_LEAD_FEE_CENTS,
  medical:         PI_LEAD_FEE_CENTS,
  civil_rights:    20000, // $200
  employment:      10000, // $100
  ice_detention:    7500, // $75
};

/** Normalise 'Personal Injury' / 'personal-injury' / 'Medical' → 'personal_injury' / 'medical'. */
export function normalizeLeadType(leadType) {
  return String(leadType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Flat fee in cents for a lead type. The second argument (severity / case
 * value) is accepted and ignored so call sites can't reintroduce tiering.
 * Unknown types default to the personal-injury fee.
 */
 
export function attorneyLeadFeeCents(leadType, _severity) {
  return FEES_BY_TYPE[normalizeLeadType(leadType)] ?? PI_LEAD_FEE_CENTS;
}

