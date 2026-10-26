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

export const BONDSMAN_LEAD_FEE_CENTS = 10000;

export const BONDSMAN_LEAD_FEE_DISPLAY = `$${(BONDSMAN_LEAD_FEE_CENTS / 100).toFixed(0)}`;

/** Fee label for a lead: the server's value when present, else the flat fallback. */
export function leadFeeLabel(lead?: { lead_fee_display?: string | null; lead_fee_cents?: number | null } | null): string {
  if (lead?.lead_fee_display) return lead.lead_fee_display;
  if (typeof lead?.lead_fee_cents === 'number' && Number.isFinite(lead.lead_fee_cents) && lead.lead_fee_cents > 0) {
    return `$${(lead.lead_fee_cents / 100).toFixed(0)}`;
  }
  return BONDSMAN_LEAD_FEE_DISPLAY;
}

/**
 * Attorney lead fee for personal-injury leads — FLAT, never scaled by injury
 * severity. Source of truth: backend/src/routes/billing/attorneyLeadFee.js
 * (PI_LEAD_FEE_CENTS); lead_fee_consistency.test.js fails if they drift.
 */
export const PI_LEAD_FEE_CENTS = 25000;

export const PI_LEAD_FEE_DISPLAY = `$${(PI_LEAD_FEE_CENTS / 100).toFixed(0)}`;

/**
 * Attorney lead fees by lead type — FLAT per type (source of truth:
 * backend/src/routes/billing/attorneyLeadFee.js, published on
 * GET /billing/pi-lead/fees; lead_fee_consistency.test.js fails if they drift).
 */
export const ATTORNEY_LEAD_FEE_CENTS: Readonly<Record<string, number>> = Object.freeze({
  personal_injury: 25000,
  medical:         25000,
  civil_rights:    20000,
  employment:      10000,
  ice_detention:    7500,
});

/** 'Personal Injury' / 'civil-rights' → 'personal_injury' / 'civil_rights' (same rule as the backend). */
export const normalizeLeadType = (type: string): string => String(type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** "$250" for a lead type (the server's value when given, else the fallback table). */
export function attorneyLeadFeeDisplay(type: string, serverFees?: Record<string, string> | null): string {
  const key = normalizeLeadType(type);
  if (serverFees?.[key]) return serverFees[key];
  const cents = ATTORNEY_LEAD_FEE_CENTS[key] ?? PI_LEAD_FEE_CENTS;
  return `$${(cents / 100).toFixed(0)}`;
}
