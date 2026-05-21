import logger from '../../utils/logger.js';
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

import { Router }        from 'express';
import express           from 'express';

import subscriptionsRouter from './subscriptions.js';
import bondsmanRouter      from './bondsman.js';
import connectionsRouter   from './connections.js';
import consumerRouter      from './consumer.js';
import piLeadsRouter       from './pi_leads.js';
import webhooksRouter      from './webhooks.js';

const router = Router();

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
export { calcLeadFee, getOrCreateStripeCustomer, TIERS, stripe, LIVE } from './_shared.js';

export default router;
