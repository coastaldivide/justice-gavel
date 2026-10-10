/**
 * billing/leadFee.js — SINGLE SOURCE OF TRUTH for the bail-bondsman lead fee.
 *
 * The fee is FLAT. It does not depend on the bail amount, charge or county.
 * Per-lead fees scaled to the bail amount look like compensation for
 * soliciting/steering a specific arrestee and implicate runner-capper /
 * barratry statutes (e.g. TX Penal Code §38.12, FL Stat. §877.02 and similar
 * rules in most states). Billing was switched to a flat fee for that reason;
 * every place that computes, charges, logs or quotes a bondsman lead fee
 * (billing routes, outbound bot SMS/payment links, lead delivery revenue log,
 * pricing endpoints) must use these exports.
 *
 * The app keeps a display fallback in frontend/src/constants/leadFee.ts;
 * backend/src/__tests__/lead_fee_consistency.test.js fails if they diverge.
 *
 * Dependency-free on purpose so services (outbound_bot.js) can import it
 * without pulling in the billing routers.
 */

/** Flat bondsman lead fee in cents ($100.00). */
export const BONDSMAN_LEAD_FEE_CENTS = 10000;

/**
 * Lead fee for an arrest record. Accepts (and ignores) the arrest/bail amount
 * so call sites cannot accidentally reintroduce bail-scaled pricing.
 */
// eslint-disable-next-line no-unused-vars
export function bondsmanLeadFeeCents(_arrestOrBail) {
  return BONDSMAN_LEAD_FEE_CENTS;
}

/** "$100" — display string for a fee in cents (defaults to the flat lead fee). */
export function formatLeadFee(cents = BONDSMAN_LEAD_FEE_CENTS) {
  return `$${(cents / 100).toFixed(0)}`;
}

/** Public description used by pricing endpoints. */
export function bondsmanLeadFeeInfo() {
  return {
    cents:   BONDSMAN_LEAD_FEE_CENTS,
    display: formatLeadFee(),
    model:   'flat',
    note:    'Flat fee per accepted lead. It does not depend on the bail amount.',
  };
}
