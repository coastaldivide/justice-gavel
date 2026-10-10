// PUBLIC ROUTE: Stripe webhook — authenticated by signature, not by JWT
// Do NOT add authRequired here.

import { validate, schemas } from '../../validation/schemas.js';
/**
 * webhooks/stripe.js — Stripe payment event handler
 *
 * Listens for:
 *  payment_intent.succeeded     — charge confirmed → deliver lead
 *  payment_link.completed       — payment link paid → deliver lead
 *  invoice.payment_succeeded    — subscription payment → keep active
 *  invoice.payment_failed       — subscription failed → mark past_due
 *  customer.subscription.deleted — sub cancelled → update DB
 *
 * Stripe sends raw body — must use express.raw() before this route.
 * Signature verified with STRIPE_WEBHOOK_SECRET.
 */

import logger from '../../utils/logger.js';
import { Router } from 'express';
import { constructWebhookEvent, calcStripeFee } from '../../payments/stripe.js';
import { deliverLead } from '../../services/outbound_bot.js';
import { getDb } from '../../db/index.js';

const router = Router();

// Raw body needed for signature verification
router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.warn('[webhook:stripe] STRIPE_WEBHOOK_SECRET not set — rejecting unverifiable webhook');
    return res.status(400).json({ error: 'webhook_signature_invalid', message: 'Webhook signature could not be verified' });
  }
  const event = constructWebhookEvent(req.body, sig);
  if (!event) {
    logger.warn('[webhook:stripe] Signature verification failed');
    return res.status(400).json({ error: 'webhook_signature_invalid', message: 'Invalid Stripe signature' });
  }

  // Acknowledge Stripe immediately
  res.json({ received: true });

  // Process async
  setImmediate(async () => {
    try {
      const type = event.type;
      const data = event.data?.object;
      if (!type || !data) return;

      // Event received — processing

      switch (type) {

        // ── Lead payment via payment link ───────────────────────────────────
        case 'payment_intent.succeeded': {
          await handlePaymentIntentSucceeded(data);
          break;
        }

        // ── Subscription payment succeeded ──────────────────────────────────
        case 'invoice.payment_succeeded': {
          await handleInvoiceSucceeded(data);
          break;
        }

        // ── Subscription payment failed ─────────────────────────────────────
        case 'invoice.payment_failed': {
          await handleInvoiceFailed(data);
          break;
        }

        // ── Subscription updated (plan change / renewal) ──────────────────────────────
        case 'customer.subscription.updated': {
          const sub = data;
          const db2 = await getDb();
          await db2.run(
            `UPDATE subscriptions SET status = ?, plan = ?, updated_at = NOW()
              WHERE stripe_subscription_id = ? OR stripe_sub_id = ?`,
            [sub.status, sub.items?.data?.[0]?.price?.id || null, sub.id, sub.id]
          );
          break;
        }

        // ── Checkout session (one-time purchase) ────────────────────────────────────
        case 'checkout.session.completed': {
          // One-time payments handled via payment_intent.succeeded
          break;
        }

        // ── Subscription cancelled ──────────────────────────────────────────
        case 'customer.subscription.deleted': {
          await handleSubscriptionDeleted(data);
          break;
        }

        default:
          // Ignore unhandled event types
          break;
      }
    } catch (err) {
      logger.error('[webhook:stripe] Processing error:', err.message);
    }
  });
});

// ── payment_intent.succeeded ─────────────────────────────────────────────────
async function handlePaymentIntentSucceeded(pi) {
  const metadata       = pi.metadata || {};
  const arrestId       = parseInt(metadata.arrest_id) || null;
  const recipientPhone = metadata.recipient_phone || null;
  const stripeLinkId   = metadata.payment_link    || null;

  if (!arrestId) {
    // Not a bot lead sale — might be a family connection or app payment
    // Check family_connections table
    const db = await getDb();
    try {
      await db.run(
        `UPDATE family_connections SET status = 'paid', stripe_pi_id = ? WHERE stripe_pi_id = ?`,
        [pi.id, pi.id]
      ).catch(e => logger.warn('[webhook:stripe] family_connections update failed:', e?.message));
    } finally { /* shared pool — never closed here */ }
    return;
  }

  if (!recipientPhone) {
    logger.info(`[webhook:stripe] PI ${pi.id}: no recipient_phone in metadata — skipping delivery`);
    return;
  }

  // Deliver lead
  const result = await deliverLead({
    phone:                 recipientPhone,
    arrestId,
    stripeLinkId,
    stripePaymentIntentId: pi.id,
  });

  if (result.error) {
    logger.error(`[webhook:stripe] Lead delivery failed for PI ${pi.id}:`, result.error);
  } else {
    logger.info(`[webhook:stripe] Lead delivered — net $${((result.netCents || 0) / 100).toFixed(2)}`);
  }
}

// ── invoice.payment_succeeded ────────────────────────────────────────────────
async function handleInvoiceSucceeded(invoice) {
  const stripeCusId = invoice.customer;
  const subId       = invoice.subscription;
  if (!subId) return;

  const db = await getDb();
  try {
    const periodEnd = invoice.lines?.data?.[0]?.period?.end;
    await db.run(
      `UPDATE subscriptions
       SET status = 'active', current_period_end = ?, updated_at = NOW()
       WHERE stripe_sub_id = ?`,
      [periodEnd ? new Date(periodEnd * 1000).toISOString() : null, subId]
    ).catch(e => logger.warn('[webhook:stripe/invoice-succeeded] sub update failed:', e?.message));
    logger.info(`[webhook:stripe] Subscription ${subId} payment confirmed`);
    } finally { /* shared pool — never closed here */ }
}

// ── invoice.payment_failed ───────────────────────────────────────────────────
async function handleInvoiceFailed(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const db = await getDb();
  try {
    await db.run(
      `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE stripe_sub_id = ?`,
      [subId]
    ).catch(e => logger.warn('[webhook:stripe/invoice-failed] sub update failed:', e?.message));
    logger.info(`[webhook:stripe] Subscription ${subId} payment FAILED — marked past_due`);
    } finally { /* shared pool — never closed here */ }
}

// ── customer.subscription.deleted ───────────────────────────────────────────
async function handleSubscriptionDeleted(sub) {
  const db = await getDb();
  try {
    await db.run(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE stripe_sub_id = ?`,
      [sub.id]
    ).catch(e => logger.warn('[webhook:stripe/sub-deleted] sub update failed:', e?.message));
    } finally { /* shared pool — never closed here */ }
}

export default router;
