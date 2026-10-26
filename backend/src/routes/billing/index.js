/**
 * billing/index.js — Billing module entry point
 *
 * Composes five focused sub-routers into a single Express router
 * mounted at /api/billing in app.js.
 *
 * Sub-router breakdown:
 *   subscriptions.js  — POST /subscribe, /cancel, /refund  + GET /subscription
 *   bondsman.js       — /bondsman/* profiles, leads, verified-badge
 *   connections.js    — /family/connect, /quickconnect
 *   consumer.js       — /consumer/*, /admin/stats
 *   pi_leads.js       — /pi-lead/*, /pi-leads
 *   casePass.js       — /case-pass (one-time 90-day pass)
 *   POST /webhook     — Stripe webhook (services/stripeWebhook.js; raw body)
 *
 * To add a new billing feature:
 *   1. Decide which domain it belongs to (or create a new sub-router).
 *   2. Add the route in the appropriate file.
 *   3. No changes needed here unless mounting a brand-new sub-router.
 */

import express, { Router } from 'express';
import { stripeConfigured, PAYMENTS_UNAVAILABLE } from '../../config.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { stripeWebhookHandler } from '../../services/stripeWebhook.js';
import { authRequired } from '../../middleware/auth.js';

import subscriptionsRouter from './subscriptions.js';
import bondsmanRouter      from './bondsman.js';
import connectionsRouter, { FAMILY_CONNECT_PRICE_CENTS } from './connections.js';
import consumerRouter      from './consumer.js';
import piLeadsRouter       from './pi_leads.js';
import casePassRouter      from './casePass.js';

const router = Router();

// ── Payments availability gate ────────────────────────────────────────────────
// Without a Stripe key every endpoint that would create/modify a charge or a
// subscription returns 503 payments_unavailable (no mock activations).
// Read-only GETs keep working (users are on the free tier) and so do the few
// POSTs that never touch Stripe.
// Every write here is for a signed-in person, so the sign-in check comes first:
// a guest gets 401 (sign in), never "payments are not available".
const NO_STRIPE_NEEDED = [/^\/bondsman\/profile\/?$/, /^\/pi-lead\/submit\/?$/,
  // Family Connect is free (no charge, no Stripe call) while its price is 0.
  ...(FAMILY_CONNECT_PRICE_CENTS <= 0 ? [/^\/family\/connect\/?$/] : [])];
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || /^\/webhook\/?$/.test(req.path)) return next();
  return authRequired(req, res, () => {
    if (stripeConfigured() || NO_STRIPE_NEEDED.some(re => re.test(req.path))) return next();
    return res.status(503).json({ ...PAYMENTS_UNAVAILABLE, message: msg(resolveLang(req), 'billing.err.payments_unavailable') });
  });
});

// ── Standard billing routes (JSON body) ───────────────────────────────────────
router.use('/', subscriptionsRouter);
router.use('/', bondsmanRouter);
router.use('/', connectionsRouter);
router.use('/', consumerRouter);
router.use('/', piLeadsRouter);
router.use('/', casePassRouter);

// ── Stripe webhook — raw body (app.js skips the JSON parser for this path) ───
// Same handler as /api/webhooks/stripe: signature check + replay protection.
router.post('/webhook', express.raw({ type: () => true, limit: '1mb' }), stripeWebhookHandler);

// Re-export shared billing helpers for use by other modules
export { getOrCreateStripeCustomer, TIERS, stripe, LIVE } from './_shared.js';

export default router;
