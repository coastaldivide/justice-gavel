import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502,
         safeInt, safeFloat, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import rateLimit        from 'express-rate-limit';
import Stripe           from 'stripe';
import logger           from '../../utils/logger.js';

const stripeKey = process.env.STRIPE_SECRET || '';
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
const TIERS = {
  starter:         { name: 'Advisor',          price_id: process.env.STRIPE_ADVISOR_PRICE_ID,     monthly_cents: 999,  billing: 'monthly' },
  pro:             { name: 'Legal Pro',               price_id: process.env.STRIPE_LEGAL_PRO_PRICE_ID,         monthly_cents: 1999, billing: 'monthly' },
  attorney:        { name: 'Attorney Pro',      price_id: process.env.STRIPE_ATTORNEY_PRICE_ID,    monthly_cents: 4999, billing: 'monthly' },
  starter_annual:  { name: 'Advisor Annual',   price_id: process.env.STRIPE_ADVISOR_ANNUAL_ID,    monthly_cents: 799,  billing: 'annual'  },
  pro_annual:      { name: 'Pro Annual',        price_id: process.env.STRIPE_LEGAL_PRO_ANNUAL_ID,        monthly_cents: 1599, billing: 'annual'  },
  attorney_annual: { name: 'Attorney Annual',   price_id: process.env.STRIPE_ATTORNEY_ANNUAL_ID,  monthly_cents: 3999, billing: 'annual'  },
  legal_radar:  { name: 'Legal Radar',    price_id: process.env.STRIPE_LEGAL_RADAR_ID,    monthly_cents: 1999, billing: 'monthly' },
};

// ── Shared helpers ────────────────────────────────────────────────────────────
export function calcLeadFee(bailAmount) {
  const amt = parseFloat(bailAmount) || 0;
  if (amt <= 0)      return 2500;
  if (amt < 5000)    return 2500;
  if (amt < 25000)   return 5000;
  if (amt < 100000)  return 10000;
  return 15000;
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
