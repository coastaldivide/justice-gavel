import { audit, AUDIT_ACTIONS } from '../../utils/audit.js';
/**
 * billing/webhooks.js — Stripe webhook handler
 *
 * Verifies Stripe signature before processing events.
 * IMPORTANT: Mounted in billing/index.js with express.raw() body parser —
 * do NOT run express.json() before this route or signature verification will fail.
 *
 * Set STRIPE_WEBHOOK_SECRET in Railway environment from:
 *   Stripe dashboard → Developers → Webhooks → signing secret
 *
 * Local testing: stripe listen --forward-to localhost:4000/api/billing/webhook
 */
import { stripe, LIVE, TIERS }                       from './_shared.js';
import { err400, err500, safeInt }                   from '../../utils/routeHelpers.js';
import express from 'express';
import { Router }                                    from 'express';
import { getDb }                                     from '../../db/index.js';
import logger                                        from '../../utils/logger.js';

import { sendEmail }       from '../../services/sendgrid.js';
import { sendPushToUser }  from '../../services/pushDelivery.js';


// ── Subscription state machine ─────────────────────────────────────────────────
// States: trialing → active → past_due → canceled | unpaid
// All transitions update the user's feature access in real time
const SUBSCRIPTION_STATES = {
  trialing:  { can_use_ai: true,  tier_locked: false },
  active:    { can_use_ai: true,  tier_locked: false },
  past_due:  { can_use_ai: true,  tier_locked: true  },  // grace period — don't cut off immediately
  canceled:  { can_use_ai: false, tier_locked: true  },
  unpaid:    { can_use_ai: false, tier_locked: true  },
  paused:    { can_use_ai: false, tier_locked: true  },
};

async function syncSubscriptionState(db, stripeSubId, newStatus, userId) {
  const state = SUBSCRIPTION_STATES[newStatus] || SUBSCRIPTION_STATES.canceled;
  await db.run(
    `UPDATE users SET
       subscription_tier   = CASE WHEN ? = 1 THEN subscription_tier ELSE 'free' END,
       subscription_status = ?,
       updated_at          = datetime('now')
     WHERE id = ?`,
    [state.tier_locked ? 0 : 1, newStatus, userId]
  ).catch(e => logger.error('[webhooks] syncSubscriptionState failed:', e.message));
}

const router = Router();

// ── POST /api/billing/webhook — Stripe webhook handler ────────────────────────
// Verifies Stripe signature before processing events.
// Set STRIPE_WEBHOOK_SECRET in .env from Stripe dashboard → Webhooks → signing secret.
// Register: stripe listen --forward-to localhost:4000/api/billing/webhook


// ── Stripe webhook handler — extracted for readability ───────────────────────
async function handleStripeWebhook(event, db) {
  const type = event.type;

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const status = sub.status; // 'active' | 'canceled' | 'past_due' | 'unpaid'
    const userId = sub.metadata?.user_id;
    if (userId) {
      const active = ['active','trialing'].includes(status);
      await db.run(
        `UPDATE subscriptions SET status=?, stripe_status=?, updated_at=datetime('now') WHERE stripe_sub_id=?`,
        [active ? 'active' : 'canceled', status, sub.id]
      ).catch(() => {});
    }
  }
}

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    logger.warn('[billing/webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification');
    return res.json({ received: true, mock: true });
  }

  let event;
  try {
    const StripeLib = (await import('stripe')).default;
    const stripeVerify = new StripeLib(process.env.STRIPE_SECRET || '');
    event = stripeVerify.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    logger.error('[billing/webhook] Signature verification failed:', err.message);
    return err400(res, 'Webhook signature verification failed.');
  }

  try {
    const db = await getDb();
    switch (event.type) {
      case 'customer.subscription.deleted':
      await audit(AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED, { userId: event?.data?.object?.metadata?.user_id });
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status; // 'active' | 'canceled' | 'past_due' | 'unpaid'
        if (sub.metadata?.user_id) {
          await db.run(
            `UPDATE subscriptions SET status=?, updated_at=datetime('now')
             WHERE user_id=? AND stripe_sub_id=?`,
            [status, sub.metadata.user_id, sub.id]
          ).catch(() => {});
        }
        break;
      }
      case 'invoice.payment_failed':
      // Dunning: mark past_due, notify user, retain access during grace period
      await syncSubscriptionState(db, event.data.object.subscription, 'past_due',
        event.data.object.customer);
      logger.warn('[webhooks] payment failed — marking past_due for customer:',
        event.data.object.customer); {
        const inv = event.data.object;
        const userId = inv.subscription_details?.metadata?.user_id || null;
        logger.warn('[billing/webhook] Payment failed:', inv.customer_email, 'sub:', inv.subscription);

        // Push notification to user
        if (userId) {
          await sendPushToUser(userId, {
            title: '⚠️ Payment Failed',
            body: 'Your Justice Gavel payment failed. Please update your payment method to keep your subscription.',
            data: { screen: 'Settings', tab: 'billing' },
          }).catch(() => {});
        }

        // Email notification
        if (inv.customer_email) {
          await sendEmail({
            to: inv.customer_email,
            subject: 'Action Required: Justice Gavel Payment Failed',
            text: [
              'Hi there,',
              '',
              'Your Justice Gavel subscription payment did not go through.',
              'Please update your payment method to continue accessing your legal tools.',
              '',
              'Update at: https://justicegavel.app/settings/billing',
              '',
              'If you have questions, reply to this email.',
              '',
              '— The Justice Gavel Team',
            ].join('\n'),
            html: `<p>Hi there,</p>
<p>Your Justice Gavel subscription payment did not go through.</p>
<p><strong><a href="https://justicegavel.app/settings/billing">Update your payment method →</a></strong></p>
<p>If you have questions, reply to this email.</p>
<p>— The Justice Gavel Team</p>`,
          }).catch(() => {});
        }
        break;
      }
      case 'checkout.session.completed': {
        // One-time payments: Quick Connect, Family Connect, per-doc analysis
        const session = event.data.object;
        const userId = session.metadata?.user_id || null;
        const amountDollars = ((session.amount_total || 0) / 100).toFixed(2);
        const productName = session.metadata?.product_name || 'Justice Gavel Service';

        // checkout.session.completed handled — push/email sent above

        // Push: immediate confirmation
        if (userId) {
          await sendPushToUser(userId, {
            title: '✅ Payment Confirmed',
            body: `${productName} — $${amountDollars} received. Thank you!`,
            data: { screen: 'Home' },
          }).catch(() => {});
        }

        // Email receipt
        if (session.customer_email || session.customer_details?.email) {
          const toEmail = session.customer_email || session.customer_details.email;
          await sendEmail({
            to: toEmail,
            subject: `Receipt: ${productName} — Justice Gavel`,
            text: [
              `Your payment of $${amountDollars} for ${productName} was successful.`,
              '',
              `Reference: ${session.id}`,
              '',
              'Thank you for using Justice Gavel.',
              '— The Justice Gavel Team',
            ].join('\n'),
            html: `<p>Your payment of <strong>$${amountDollars}</strong> for <strong>${productName}</strong> was successful.</p>
<p style="color:#666;font-size:12px">Reference: ${session.id}</p>
<p>Thank you for using Justice Gavel.</p>
<p>— The Justice Gavel Team</p>`,
          }).catch(() => {});
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        // Successful subscription renewal — confirm access and send receipt
        const inv = event.data.object;
        const userId = inv.subscription_details?.metadata?.user_id
          || inv.lines?.data?.[0]?.metadata?.user_id || null;
        const amountDollars = ((inv.amount_paid || 0) / 100).toFixed(2);
        const planName = inv.lines?.data?.[0]?.description || 'Justice Gavel Subscription';

        // Update subscription status to active (handles recovery from past_due)
        if (inv.subscription && userId) {
          await db.run(
            `UPDATE subscriptions SET status='active', updated_at=datetime('now')
             WHERE user_id=? AND stripe_sub_id=?`,
            [userId, inv.subscription]
          ).catch(() => {});
        }

        // Push confirmation
        if (userId) {
          await sendPushToUser(userId, {
            title: '✅ Subscription Renewed',
            body: `${planName} — $${amountDollars}. Your access continues uninterrupted.`,
            data: { screen: 'Home' },
          }).catch(() => {});
        }

        // Email receipt
        if (inv.customer_email) {
          await sendEmail({
            to: inv.customer_email,
            subject: `Receipt: ${planName} renewal — Justice Gavel`,
            text: [
              `Your ${planName} has been renewed for $${amountDollars}.`,
              '',
              `Billing period: ${new Date(inv.period_start * 1000).toLocaleDateString()} — ${new Date(inv.period_end * 1000).toLocaleDateString()}`,
              `Invoice: ${inv.id}`,
              '',
              'Manage your subscription at: https://justicegavel.app/settings/billing',
              '',
              '— The Justice Gavel Team',
            ].join('\n'),
            html: `<p>Your <strong>${planName}</strong> has been renewed for <strong>$${amountDollars}</strong>.</p>
<p style="color:#666;font-size:12px">Billing period: ${new Date(inv.period_start * 1000).toLocaleDateString()} — ${new Date(inv.period_end * 1000).toLocaleDateString()}<br>Invoice: ${inv.id}</p>
<p><a href="https://justicegavel.app/settings/billing">Manage subscription →</a></p>
<p>— The Justice Gavel Team</p>`,
          }).catch(() => {});
        }
        break;
      }
  
    // ── 24-Hour Advisor (one-time payment) ──────────────────────────
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const uid = pi.metadata?.user_id;
      if (uid) {
        const db = await getDb();
        await db.run(
          `UPDATE users SET subscription_tier='advisor', advisor_expires_at=datetime('now','+1 day') WHERE id=?`,
          [uid]
        ).catch(() => {});
        await sendPushToUser(db, Number(uid), {
          title: '✅ 24-Hour Access Active',
          body:  'Your Justice Gavel Advisor access is live for the next 24 hours.',
        }).catch(() => {});
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      const uid = pi.metadata?.user_id;
      if (uid) {
        const db = await getDb();
        await sendPushToUser(db, Number(uid), {
          title: '⚠️ Payment Failed',
          body:  'Your payment could not be processed. Please update your payment method.',
        }).catch(() => {});
      }
      break;
    }

    // ── Trial ending soon ────────────────────────────────────────────
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object;
      const uid = sub.metadata?.user_id;
      if (uid) {
        const db = await getDb();
        await sendPushToUser(db, Number(uid), {
          title: '⏰ Trial Ends Soon',
          body:  'Your free trial ends in 3 days. Add a payment method to keep access.',
        }).catch(() => {});
      }
      break;
    }

    // ── Refund issued ────────────────────────────────────────────────
    case 'charge.refunded': {
      const charge = event.data.object;
      const uid    = charge.metadata?.user_id;
      if (uid) {
        const db = await getDb();
        const amt = (charge.amount_refunded / 100).toFixed(2);
        await sendPushToUser(db, Number(uid), {
          title: '💳 Refund Issued',
          body:  `A refund of $${amt} has been issued to your original payment method.`,
        }).catch(() => {});
      }
      break;
    }

    default:
        // unhandled event type — ignored (expected for new Stripe events)
    }
    res.json({ received: true, type: event.type });
  } catch (e) {
    res.status(500).json({ error: 'Webhook handler error. Please try again.' });
  }
});



export default router;
