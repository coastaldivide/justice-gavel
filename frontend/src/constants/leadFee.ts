/**
 * leadFee.ts — bail-bondsman lead fee shown in the app.
 *
 * The fee is FLAT (the same for every lead, whatever the bail amount). The
 * backend is the source of truth (backend/src/routes/billing/leadFee.js) and
 * sends it with every lead (`lead_fee_display`) and on
 * GET /billing/bondsman/tiers (`lead_fee`). This constant is only the display
 * fallback; backend/src/__tests__/lead_fee_consistency.test.js fails if it
 * drifts from the backend value.
 */

export const BONDSMAN_LEAD_FEE_CENTS = 7500;

export const BONDSMAN_LEAD_FEE_DISPLAY = `$${(BONDSMAN_LEAD_FEE_CENTS / 100).toFixed(0)}`;

/** Fee label for a lead: the server's value when present, else the flat fallback. */
export function leadFeeLabel(lead?: { lead_fee_display?: string | null; lead_fee_cents?: number | null } | null): string {
  if (lead?.lead_fee_display) return lead.lead_fee_display;
  if (typeof lead?.lead_fee_cents === 'number' && Number.isFinite(lead.lead_fee_cents) && lead.lead_fee_cents > 0) {
    return `$${(lead.lead_fee_cents / 100).toFixed(0)}`;
  }
  return BONDSMAN_LEAD_FEE_DISPLAY;
}
