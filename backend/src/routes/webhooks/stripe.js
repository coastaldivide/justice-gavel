// PUBLIC ROUTE: Stripe webhook — authenticated by signature, not by JWT.
// Do NOT add authRequired here.
/**
 * webhooks/stripe.js — POST /webhooks/stripe and /api/webhooks/stripe (raw body,
 * see app.js). The handler, its signature check and its replay protection are in
 * services/stripeWebhook.js (also serving /api/billing/webhook).
 */
import { Router } from 'express';
import { stripeWebhookHandler } from '../../services/stripeWebhook.js';
import logger from '../../utils/logger.js';

const router = Router();
// The signature is computed over the exact bytes: the body must be the raw Buffer
// (express.raw in app.js). Anything else cannot be verified → 400, never processed.
router.post('/', (req, res, next) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    logger.warn('[webhooks/stripe] body is not the raw request bytes');
    return res.status(400).json({ error: 'webhook_signature_invalid', message: 'Webhook body must be the raw request' });
  }
  try { return stripeWebhookHandler(req, res, next); }
  catch (e) { logger.error('[webhooks/stripe]', e?.message); return res.status(500).json({ error: 'webhook_failed' }); }
});

export default router;
