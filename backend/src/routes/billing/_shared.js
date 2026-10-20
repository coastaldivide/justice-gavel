import rateLimit        from 'express-rate-limit';
import Stripe           from 'stripe';
import logger           from '../../utils/logger.js';
import { resolveLang, msg } from '../../i18n/index.js';

// Plans, prices and features: ./plans.js is the single source of truth.
export { TIERS, BONDSMAN_TIERS, PLAN_FEATURES, FEATURES, planFeatures, monthlyKey, chargeFor, bondsmanCharge, planForPrice, usd } from './plans.js';
import { BONDSMAN_TIERS } from './plans.js';

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
const stripe    = stripeKey ? new Stripe(stripeKey, { timeout: 20_000, maxNetworkRetries: 2 }) : null;
const LIVE      = !!stripeKey;

// ── Billing rate limiter ───────────────────────────────────────────────────────
const billingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: msg(resolveLang(req), 'billing.err.rate_limited'), code: 'rate_limited' }),
});

// Resolve bondsman tier from Stripe price ID (used in webhooks)
export function bondsTierFromPriceId(priceId) {
  for (const [key, tier] of Object.entries(BONDSMAN_TIERS)) {
    if (priceId && (tier.price_id === priceId || tier.annual_price_id === priceId)) return key;
  }
  return null;
}

let lateStripe = null;
/**
 * The Stripe client: the one made at boot, or — when the key was set after the
 * process started (a test, a hot config reload) — one made on first use.
 * Null without a key (the billing gate answers 503 before any route needs it).
 */
export function stripeClient() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
  if (!key) return null;
  if (!lateStripe) lateStripe = new Stripe(key, { timeout: 20_000, maxNetworkRetries: 2 });
  return lateStripe;
}

/** The Stripe customer for a user (found by e-mail, created once). Null without Stripe or on error. */
export async function getOrCreateStripeCustomer(user) {
  const s = stripeClient();
  if (!s) return null;
  try {
    if (user.email) {
      const existing = await s.customers.list({ email: user.email, limit: 1 });
      if (existing?.data?.length) return existing.data[0].id;
    }
    const customer = await s.customers.create({
      email:    user.email || undefined,
      name:     user.display_name || user.email || undefined,
      metadata: { user_id: String(user.id) },
    });
    return customer.id;
  } catch (e) {
    logger.error('[billing] getOrCreateStripeCustomer', e?.message);
    return null;
  }
}

export { stripe, LIVE, billingLimiter };

// Flat bondsman lead fee — defined once in ./leadFee.js, re-exported for billing routers.
export { BONDSMAN_LEAD_FEE_CENTS, bondsmanLeadFeeCents, formatLeadFee, bondsmanLeadFeeInfo } from './leadFee.js';

/**
 * generateIdempotencyKey — creates a unique key per charge attempt.
 * Format: userId_timestamp_random
 */
export function generateIdempotencyKey(userId, suffix = '') {
  return `${userId ?? 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2)}${suffix ? '_' + suffix : ''}`;
}
