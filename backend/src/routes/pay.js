/**
 * routes/pay.js — Payment session creation
 *
 * POST /api/pay/create   — create a payment session (Stripe, etc.)
 * POST /api/pay/checkout — fixed $10 Stripe checkout (convenience wrapper)
 *
 * All errors log e.message (not the full Error object) so PM2/CloudWatch
 * receives readable strings instead of [object Object].
 *
 * Rate limiting: 10 requests per hour per user — prevents payment spam.
 */

import { makeUserLimiter }       from '../middleware/sharedAiLimiter.js';
import { err400, safeInt,
         sanitizeStr }           from '../utils/routeHelpers.js';
import { Router }                from 'express';
import { authRequired }          from '../middleware/auth.js';
import { createPaymentSession }  from '../payments/orchestrator.js';
import logger                    from '../utils/logger.js';

// ── Generate Stripe idempotency key ────────────────────────────────────────────
// Key format: userId-priceId-5minuteBucket
// This means the same user subscribing to the same plan within 5 minutes
// uses the same idempotency key → Stripe returns the same result, no double charge
function stripeIdempotencyKey(userId, priceId, action = 'sub') {
  const bucket = Math.floor(Date.now() / 300000); // 5-minute windows
  return `${action}-${userId}-${String(priceId || 'none').slice(-12)}-${bucket}`;
}

const router     = Router();
const payLimiter = makeUserLimiter({
  windowMs: 3_600_000, // 1 hour
  max:      10,
  message:  'Payment session limit reached. Please wait before creating another session.',
});

const VALID_METHODS    = new Set(['stripe', 'stripe_ach', 'manual']);
const VALID_CURRENCIES = new Set(['USD', 'CAD', 'EUR', 'GBP']);

// ── POST /api/pay/create ──────────────────────────────────────────────────────
router.post('/create', authRequired, payLimiter, async (req, res) => {
  try {
    const {
      amount       = 10,
      currency     = 'USD',
      method       = 'stripe',
      meta         = {},
      cryptoSymbol,   // reserved for future crypto payments
    } = req.body || {};

    // Validate and sanitize inputs
    const safeAmount   = Math.max(1, Math.min(safeInt(amount, 10), 100_000)); // $0.01 – $1,000
    const safeCurrency = VALID_CURRENCIES.has(String(currency).toUpperCase())
      ? String(currency).toUpperCase()
      : 'USD';
    const safeMethod   = VALID_METHODS.has(String(method).toLowerCase())
      ? String(method).toLowerCase()
      : 'stripe';

    const out = await createPaymentSession({
      method:   safeMethod,
      amount:   safeAmount,
      currency: safeCurrency,
      user:     req.user,
      meta:     {
        ...(typeof meta === 'object' ? meta : {}),
        cryptoSymbol: cryptoSymbol ? sanitizeStr(String(cryptoSymbol), 10) : undefined,
      },
    });

    res.json(out);
  } catch (e) {
    logger.error('[pay/create]', e.message);

    // Distinguish config errors from runtime errors — cleaner client messages
    const isConfigError = /key|Stripe|secret|configured/i.test(e.message || '');
    if (isConfigError) {
      return res.status(503).json({
        error: 'Payment processor is not configured. Contact support.',
        code:  'payment_not_configured',
      });
    }

    res.status(500).json({
      error: 'Payment processing error. Please try again or contact support.',
      code:  'payment_error',
    });
  }
});

// ── POST /api/pay/checkout ────────────────────────────────────────────────────
// Fixed $10 USD Stripe checkout — quick purchase flow (e.g. Quick Connect).
// Amount is intentionally hardcoded — this endpoint exists for simplicity.
router.post('/checkout', authRequired, payLimiter, async (req, res) => {
  try {
    const out = await createPaymentSession({
      method:   'stripe',
      amount:   10,
      currency: 'USD',
      user:     req.user,
      meta:     { source: 'checkout' },
    });
    res.json(out);
  } catch (e) {
    // Log the message, not the Error object (avoids [object Object] in logs)
    logger.error('[pay/checkout]', e.message);
    res.status(500).json({
      error: 'Checkout failed. Please try again.',
      code:  'checkout_error',
    });
  }
});

export default router;
