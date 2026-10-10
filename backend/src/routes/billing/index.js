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
 *   webhooks.js       — POST /webhook (raw body — Stripe signature verification)
 *
 * To add a new billing feature:
 *   1. Decide which domain it belongs to (or create a new sub-router).
 *   2. Add the route in the appropriate file.
 *   3. No changes needed here unless mounting a brand-new sub-router.
 */

import express, { Router } from 'express';
import { stripeConfigured, PAYMENTS_UNAVAILABLE } from '../../config.js';

import subscriptionsRouter from './subscriptions.js';
import bondsmanRouter      from './bondsman.js';
import connectionsRouter   from './connections.js';
import consumerRouter      from './consumer.js';
import piLeadsRouter       from './pi_leads.js';
import webhooksRouter      from './webhooks.js';

const router = Router();

// ── Payments availability gate ────────────────────────────────────────────────
// Without a Stripe key every endpoint that would create/modify a charge or a
// subscription returns 503 payments_unavailable (no mock activations).
// Read-only GETs keep working (users are on the free tier) and so do the few
// POSTs that never touch Stripe.
const NO_STRIPE_NEEDED = [/^\/bondsman\/profile\/?$/, /^\/pi-lead\/submit\/?$/, /^\/webhook\/?$/];
router.use((req, res, next) => {
  if (stripeConfigured() || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (NO_STRIPE_NEEDED.some(re => re.test(req.path))) return next();
  return res.status(503).json({ ...PAYMENTS_UNAVAILABLE });
});

// ── Standard billing routes (JSON body) ───────────────────────────────────────
router.use('/', subscriptionsRouter);
router.use('/', bondsmanRouter);
router.use('/', connectionsRouter);
router.use('/', consumerRouter);
router.use('/', piLeadsRouter);

// ── Stripe webhook — MUST use raw body parser for signature verification ──────
// express.json() must NOT run before this route.
// The global express.json() in app.js uses a path exclusion via app.use()
// ordering; the webhook route is mounted last and uses its own raw middleware.
router.post('/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    // Attach raw body for Stripe verification
    req.rawBody = req.body;
    next();
  },
  webhooksRouter
);

// Re-export shared billing helpers for use by other modules
export { getOrCreateStripeCustomer, TIERS, stripe, LIVE } from './_shared.js';

export default router;
