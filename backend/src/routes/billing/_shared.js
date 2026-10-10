import { validate, validateQuery, schemas } from '../../validation/schemas.js';
import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502,
         safeInt, safeFloat, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import rateLimit        from 'express-rate-limit';
import Stripe           from 'stripe';
import logger           from '../../utils/logger.js';

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
const stripe    = stripeKey ? new Stripe(stripeKey) : null;
const LIVE      = !!stripeKey;

// ── Billing rate limiter ───────────────────────────────────────────────────────
const billingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many billing requests — please try again later.' },
});

// ── Tier pricing (shared across all billing sub-routers) ──────────────────────
// ── Tier pricing ──────────────────────────────────────────────────────────────
// monthly_cents  = what we charge per billing period on the monthly plan
// annual_cents   = what we charge for the full year on the annual plan
// mo_equiv_cents = annual_cents / 12  (shown in UI as "only $X/mo")
// Upgrade order: legal_radar → advisor → legal_pro → esquire
const TIERS = {
  // ── Consumer monthly plans ─────────────────────────────────────────────────
  legal_radar: {
    name:          'Legal Radar',
    display_price: '$19.99/mo',
    price_id:      process.env.STRIPE_LEGAL_RADAR_ID,
    monthly_cents: 1999,          // $19.99
    annual_cents:  null,
    billing:       'monthly',
    tier_rank:     1,
  },
  advisor: {
    name:          '24 Hour Advisor',
    display_price: '$24.99/mo',
    price_id:      process.env.STRIPE_ADVISOR_PRICE_ID,
    monthly_cents: 2499,          // $24.99  ← was $29.99, corrected below Esquire
    annual_cents:  null,
    billing:       'monthly',
    tier_rank:     2,
  },
  legal_pro: {
    name:          'Legal Pro',
    display_price: '$34.99/mo',
    price_id:      process.env.STRIPE_LEGAL_PRO_PRICE_ID,
    monthly_cents: 3499,          // $34.99  ← was $29.00 (less than Advisor — wrong)
    annual_cents:  null,
    billing:       'monthly',
    tier_rank:     3,
  },
  esquire: {
    name:          'Justice Gavel Esquire',
    display_price: '$49.00/mo',
    price_id:      process.env.STRIPE_ESQUIRE_PRICE_ID,
    monthly_cents: 4900,          // $49.00
    annual_cents:  null,
    billing:       'monthly',
    tier_rank:     4,
  },

  // ── Annual plans (billed once/year, shown as monthly equivalent) ───────────
  // annual_cents = total annual charge  |  monthly_cents = annual_cents / 12
  advisor_annual: {
    name:          '24 Hour Advisor (Annual)',
    display_price: '$16.58/mo billed $199/yr',
    price_id:      process.env.STRIPE_ADVISOR_ANNUAL_ID,
    monthly_cents: 1658,          // $199/yr ÷ 12 = $16.58/mo  (33% discount)
    annual_cents:  19900,         // $199.00/yr
    billing:       'annual',
    tier_rank:     2,
    matches_monthly: 'advisor',
  },
  pro_annual: {
    name:          'Legal Pro (Annual)',
    display_price: '$24.92/mo billed $299/yr',
    price_id:      process.env.STRIPE_LEGAL_PRO_ANNUAL_ID,
    monthly_cents: 2492,          // $299/yr ÷ 12 = $24.92/mo  (29% discount)
    annual_cents:  29900,         // $299.00/yr
    billing:       'annual',
    tier_rank:     3,
    matches_monthly: 'legal_pro',
  },
  esquire_annual: {
    name:          'Justice Gavel Esquire (Annual)',
    display_price: '$34.17/mo billed $410/yr',
    price_id:      process.env.STRIPE_ESQUIRE_ANNUAL_ID,
    monthly_cents: 3417,          // $410/yr ÷ 12 = $34.17/mo  (30% discount)
    annual_cents:  41000,         // $410.00/yr
    billing:       'annual',
    tier_rank:     4,
    matches_monthly: 'esquire',
  },

  // ── Legacy aliases (keep for existing subscriptions / webhooks) ────────────
  starter_annual:  { name: 'Advisor Annual (legacy)', price_id: process.env.STRIPE_ADVISOR_ANNUAL_ID,
                     monthly_cents: 1658, annual_cents: 19900, billing: 'annual', tier_rank: 2, matches_monthly: 'advisor' },
  attorney_annual: { name: 'Esquire Annual (legacy)',  price_id: process.env.STRIPE_ESQUIRE_ANNUAL_ID,
                     monthly_cents: 3417, annual_cents: 41000, billing: 'annual', tier_rank: 4, matches_monthly: 'esquire' },
};

// Resolve tier from Stripe price ID (used in webhooks)
export function tierFromPriceId(priceId) {
  for (const [key, tier] of Object.entries(TIERS)) {
    if (tier.price_id === priceId) return key;
  }
  return null;
}

// Get effective monthly rate for display (annual = annual_cents/12, monthly = monthly_cents)
export function effectiveMonthlyRate(tierKey) {
  const tier = TIERS[tierKey];
  if (!tier) return 0;
  if (tier.billing === 'annual') return tier.annual_cents ? Math.round(tier.annual_cents / 12) : tier.monthly_cents;
  return tier.monthly_cents;
}

// ── Shared helpers ────────────────────────────────────────────────────────────
// ── Bondsman subscription tiers (flat recurring, no per-lead component) ───────────
// Per-lead fees on arrestees implicate runner-capper / barratry statutes
// (TX §38.12, FL §877.02, and equivalents in most states — some are felonies).
// Restructured to market-access subscriptions: bondsmen pay for geographic
// coverage, not per-lead delivery. Standard in licensed professional directories.
// ── Bondsman geographic tier subscriptions ────────────────────────────────────
// Three tiers based on market access (counties covered), not lead volume.
// No per-lead fees — pricing is for directory access and platform tools.
// Stripe price IDs: create these in Stripe Dashboard → Products → Bondsman [Tier]
//
// Create a Product for each in Stripe, then set the price IDs in Railway:
//   STRIPE_BONDSMAN_STARTER_ID   = price_xxxx  ($49/mo)
//   STRIPE_BONDSMAN_PRO_ID       = price_xxxx  ($149/mo)
//   STRIPE_BONDSMAN_MARKET_ID    = price_xxxx  ($349/mo)
//
// Revenue notes:
//   Pro ($149/mo) is the revenue-optimal tier — most active bondsmen need
//   2-3 counties, cost is covered by one bond written. 100 Pro seats = $14,900 MRR.
export const BONDSMAN_TIERS = {
  starter: {
    name:          'Bondsman Starter',
    monthly_cents: 4900,
    display:       '$49/mo',
    counties:      1,
    label:         '1 county · Arrival alerts · Case tracking',
    price_id:      process.env.STRIPE_BONDSMAN_STARTER_ID || null,
    // Annual option: $490/yr (2 months free, $40.83/mo effective)
    annual_cents:  49000,
    annual_price_id: process.env.STRIPE_BONDSMAN_STARTER_ANNUAL_ID || null,
  },
  pro: {
    name:          'Bondsman Pro',
    monthly_cents: 14900,
    display:       '$149/mo',
    counties:      3,
    label:         '3 counties · Priority inbox · CRM sync',
    price_id:      process.env.STRIPE_BONDSMAN_PRO_ID || null,
    // Annual option: $1,490/yr (2 months free, $124.17/mo effective)
    annual_cents:  149000,
    annual_price_id: process.env.STRIPE_BONDSMAN_PRO_ANNUAL_ID || null,
  },
  market: {
    name:          'Bondsman Market',
    monthly_cents: 34900,
    display:       '$349/mo',
    counties:      999,
    label:         'Full metro DMA · All features · API access',
    price_id:      process.env.STRIPE_BONDSMAN_MARKET_ID || null,
    // Annual option: $3,490/yr (2 months free, $290.83/mo effective)
    annual_cents:  349000,
    annual_price_id: process.env.STRIPE_BONDSMAN_MARKET_ANNUAL_ID || null,
  },
};

// Resolve bondsman tier from Stripe price ID (used in webhooks)
export function bondsTierFromPriceId(priceId) {
  for (const [key, tier] of Object.entries(BONDSMAN_TIERS)) {
    if (tier.price_id === priceId || tier.annual_price_id === priceId) return key;
  }
  return null;
}

export async function getOrCreateStripeCustomer(user) {
  if (!stripe) return null;
  try {
    const existing = await stripe.customers.list({ email: user.email, limit: 1 });
    if (existing.data.length) return existing.data[0].id;
    const customer = await stripe.customers.create({
      email:    user.email,
      name:     user.display_name || user.email,
      metadata: { user_id: String(user.id) },
    });
    return customer.id;
  } catch (e) {
    logger.error('[billing] getOrCreateStripeCustomer', e?.message);
    return null;
  }
}

export { stripe, LIVE, TIERS, billingLimiter };

// Flat bondsman lead fee — defined once in ./leadFee.js, re-exported for billing routers.
export { BONDSMAN_LEAD_FEE_CENTS, bondsmanLeadFeeCents, formatLeadFee, bondsmanLeadFeeInfo } from './leadFee.js';

/**
 * generateIdempotencyKey — creates a unique key per charge attempt.
 * Prevents duplicate charges if the client retries a request.
 * Format: userId_timestamp_random
 */
export function generateIdempotencyKey(userId, suffix = '') {
  return `${userId ?? 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2)}${suffix ? '_' + suffix : ''}`;
}