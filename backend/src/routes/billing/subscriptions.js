/**
 * billing/subscriptions.js — Attorney & general subscriptions — subscribe, view, cancel, refund
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { stripe, LIVE, TIERS, billingLimiter, getOrCreateStripeCustomer, calcLeadFee }
  from './_shared.js';
import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502,
         safeInt, safeFloat, sanitizeStr, validateEmail, withTransaction} from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';

// ── Generate Stripe idempotency key ────────────────────────────────────────────
// Key format: userId-priceId-5minuteBucket
// This means the same user subscribing to the same plan within 5 minutes
// uses the same idempotency key → Stripe returns the same result, no double charge
function stripeIdempotencyKey(userId, priceId, action = 'sub') {
  const bucket = Math.floor(Date.now() / 300000); // 5-minute windows
  return `${action}-${userId}-${String(priceId || 'none').slice(-12)}-${bucket}`;
}

const router = Router();

router.post('/subscribe', billingLimiter, authRequired, async (req, res) => {
  const { tier = 'advisor', payment_method_id, provider_type = 'lawyer' } = req.body;
  const tierConfig = TIERS[tier];
  if (!tierConfig) return err400(res, 'Invalid tier. Options: starter, pro, attorney, starter_annual, pro_annual, attorney_annual, legal_radar');

  try {
    const db = await getDb();

    // Check existing subscription
    const existing = await db.get(
      'SELECT id, user_id, status, stripe_sub_id, stripe_customer_id, tier, provider_type, created_at, current_period_start, cancel_at_period_end FROM subscriptions WHERE user_id = ? AND status IN (?,?) AND provider_type = ?',
      [req.user.id, 'active', 'trialing', provider_type]
    );
    if (existing) return res.status(409).json({ error: 'Already subscribed', subscription: existing });

    if (!LIVE) {
      // Demo mode — create mock subscription
      const isAnnual = tierConfig.billing === 'annual';
      const trialDays = isAnnual ? 7 : 30;
      const trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
      const sub = await db.run(
        `INSERT INTO subscriptions (user_id, provider_type, tier, status, amount_cents, trial_ends_at, stripe_sub_id, stripe_cus_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [req.user.id, provider_type, tier, 'demo', tierConfig.monthly_cents, trialEnd, 'sub_mock_demo', 'cus_mock_demo']
      );
      return res.json({
        success: true,
        mock: true,
        subscription: { id: sub.lastID, tier, status: 'trialing', trial_ends_at: trialEnd, amount_cents: tierConfig.monthly_cents },
        message: `${isAnnual ? '7' : '30'}-day free trial started for ${tierConfig.name}. No credit card charged in demo mode.`
      });
    }

    // Live Stripe subscription
    const customerId = await getOrCreateStripeCustomer(req.user);

    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: payment_method_id } });
    }

    // Create subscription — annual tiers use yearly interval
    const isAnnual = tierConfig.billing === 'annual';
    const stripeSub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price_data: { currency: 'usd', unit_amount: tierConfig.monthly_cents,
        product_data: { name: `Justice Gavel — ${tierConfig.name}` },
        recurring: { interval: isAnnual ? 'year' : 'month' }
      }}],
      trial_period_days: isAnnual ? 7 : 30,
      metadata: { user_id: String(req.user.id), tier, provider_type }
    }, { idempotencyKey: stripeIdempotencyKey(req.user?.id, tierConfig?.price_id || tier || 'checkout') });

    const trialEnd = new Date(stripeSub.trial_end * 1000).toISOString();
    const sub = await db.run(
      `INSERT INTO subscriptions (user_id, provider_type, tier, status, amount_cents, trial_ends_at, stripe_sub_id, stripe_cus_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, provider_type, tier, 'trialing', tierConfig.monthly_cents, trialEnd, stripeSub.id, customerId]
    );

    res.json({
      success: true,
      subscription: { id: sub.lastID, tier, status: 'trialing', trial_ends_at: trialEnd },
      message: `30-day free trial started. You won't be charged until ${new Date(trialEnd).toLocaleDateString()}.`
    });
  } catch (e) {
    logger.error('[billing] subscribe error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Get subscription status ───────────────────────────────────────────────────
router.get('/subscription', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sub = await db.get(
      `SELECT id, user_id, status, stripe_sub_id, stripe_customer_id, tier, provider_type, created_at, current_period_start, cancel_at_period_end FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );

    const tiers = Object.entries(TIERS).map(([key, val]) => ({ key, ...val }));
    res.json({ subscription: sub || null, tiers, mock: !LIVE });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Cancel subscription ────────────────────────────────────────────────────────
router.post('/cancel', billingLimiter, authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sub = await db.get(
      'SELECT id, user_id, status, stripe_sub_id, stripe_customer_id, tier, provider_type, created_at, current_period_start, cancel_at_period_end FROM subscriptions WHERE user_id = ? AND status IN (?,?)',
      [req.user.id, 'active', 'trialing']
    );
    if (!sub) return err404(res, 'No active subscription found');

    if (LIVE && sub.stripe_sub_id && !sub.stripe_sub_id.startsWith('sub_mock')) {
      await stripe.subscriptions.cancel(sub.stripe_sub_id);
    }

    await db.run(
      'UPDATE subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ['cancelled', sub.id]
    );

    res.json({ success: true, message: 'Subscription cancelled.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /refund — Request a subscription refund ──────────────────────────────
// Refund Policy (mirrors top legal services platforms):
//   - Trial period (7 days): full refund, no questions asked
//   - Within 48 hours of first charge: full refund
//   - 3–30 days after charge: prorated refund, case-by-case review
//   - After 30 days: no refund (subscription already provided access)
//   - Per-document purchases (motions, discovery): no refund once generated
//   - Exceptions: documented billing errors always refunded regardless of timing
//
// Refund processing: via Stripe refund API (stripe.refunds.create).
// All refund requests logged for FTC compliance and dispute resolution.
router.post('/refund', billingLimiter, authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { reason, additional_info } = req.body || {};
    if (!reason) {
      return err400(res, 'reason required (billing_error | unsatisfied | accidental | other)');
    }

    const VALID_REASONS = ['billing_error','unsatisfied','accidental','duplicate','other'];
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}` });
    }

    // Get the user's most recent completed charge
    const sub = await db.get(
      `SELECT id, user_id, status, stripe_sub_id, stripe_customer_id, tier, provider_type, created_at, current_period_start, cancel_at_period_end FROM subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!sub) {
      return err404(res, 'No subscription found for your account.');
    }

    // Determine eligibility
    const chargedAt = sub.current_period_start
      ? new Date(sub.current_period_start * 1000)
      : new Date(sub.created_at);
    const daysSinceCharge = (Date.now() - chargedAt.getTime()) / (1000 * 60 * 60 * 24);
    const isInTrialWindow  = daysSinceCharge <= 7;
    const isIn48HrWindow   = daysSinceCharge <= 2;
    const isIn30DayWindow  = daysSinceCharge <= 30;
    const isBillingError   = reason === 'billing_error';

    // Automatic approval conditions
    const autoApprove = isInTrialWindow || isIn48HrWindow || isBillingError;

    // Log the request regardless of outcome
    await db.run(
      `INSERT INTO refund_requests
         (user_id, subscription_id, stripe_sub_id, reason, additional_info,
          days_since_charge, auto_approve, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
      [
        req.user.id,
        sub.id,
        sub.stripe_sub_id || null,
        reason,
        additional_info || null,
        Math.round(daysSinceCharge),
        autoApprove ? 1 : 0,
        autoApprove ? 'pending_stripe' : 'pending_review',
      ]
    ).catch(() => {}); // don't fail the request if logging fails

    // Process automatic refunds via Stripe
    if (autoApprove && LIVE && sub.stripe_sub_id && !sub.stripe_sub_id.startsWith('sub_mock')) {
      try {
        // Retrieve the latest invoice to get the payment intent
        const invoices = await stripe.invoices.list({
          subscription: sub.stripe_sub_id,
          limit: 1,
        });
        const latestInvoice = invoices.data?.[0];
        const paymentIntentId = latestInvoice?.payment_intent;

        if (paymentIntentId) {
          // Issue full refund for trial/48hr/billing error; prorated for others
          const refundAmount = isIn30DayWindow && !isIn48HrWindow && !isBillingError
            ? Math.round((1 - daysSinceCharge / 30) * (latestInvoice?.amount_paid || 0))
            : undefined; // undefined = full refund

          const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            ...(refundAmount ? { amount: refundAmount } : {}),
            reason:         reason === 'billing_error' ? 'duplicate' : 'requested_by_customer',
            metadata: {
              user_id:     String(req.user.id),
              days_since:  String(Math.round(daysSinceCharge)),
              jg_reason:   reason,
            },
          });

          // Update refund log
          await db.run(
            `UPDATE refund_requests SET status='refunded', stripe_refund_id=? WHERE user_id=? ORDER BY id DESC LIMIT 1`,
            [refund.id, req.user.id]
          ).catch(() => {});

          // Cancel the subscription
          await stripe.subscriptions.cancel(sub.stripe_sub_id).catch(() => {});
          await db.run(
            `UPDATE subscriptions SET status='refunded' WHERE id=?`,
            [sub.id]
          );

          // Notify user
          const { sendEmail } = await import('../services/sendgrid.js');
          const { sendPushToUser } = await import('../services/pushDelivery.js');
          const user = await db.get('SELECT email FROM users WHERE id=?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
          const refundDollars = ((refund.amount || latestInvoice?.amount_paid || 0) / 100).toFixed(2);

          await sendPushToUser(req.user.id, {
            title: '✅ Refund Approved',
            body:  `$${refundDollars} will appear on your statement within 5–10 business days.`,
            data:  { screen: 'Settings' },
          }).catch(() => {});

          await sendEmail({
            to:      user?.email,
            subject: 'Justice Gavel — Refund Confirmed',
            text: [
              `Your refund of $${refundDollars} has been approved and processed.`,
              ``,
              `Refund ID: ${refund.id}`,
              `Reason: ${reason}`,
              ``,
              `Refunds typically appear on your statement within 5–10 business days,`,
              `depending on your bank or card issuer.`,
              ``,
              `Your subscription has been cancelled. You can resubscribe at any time.`,
              ``,
              `Questions? Contact support@justicegavel.app`,
              ``,
              `— The Justice Gavel Team`,
            ].join('\n'),
          }).catch(() => {});

          return res.json({
            ok:             true,
            status:         'refunded',
            refund_id:      refund.id,
            amount_dollars: refundDollars,
            message:        `Refund of $${refundDollars} approved. Funds typically arrive within 5–10 business days.`,
          });
        }
      } catch (stripeErr) {
        logger.error('[billing/refund] Stripe error:', stripeErr.message);
        // Fall through to manual review

    // Fall through to manual review path below
  }
    }

    // Cases that require manual review (30+ days, prorated, or Stripe failure)
    const { sendEmail } = await import('../services/sendgrid.js');
    const user = await db.get('SELECT email FROM users WHERE id=?', [req.user.id]);
    await sendEmail({
      to:      process.env.ADMIN_EMAIL || 'admin@justicegavel.app',
      subject: `[Refund Request] ${user?.email} — ${reason} — ${Math.round(daysSinceCharge)}d since charge`,
      text: [
        `User: ${user?.email} (ID: ${req.user.id})`,
        `Subscription: ${sub.stripe_sub_id || 'N/A'}`,
        `Reason: ${reason}`,
        `Days since charge: ${Math.round(daysSinceCharge)}`,
        `Auto-approve eligible: ${autoApprove}`,
        `Additional info: ${additional_info || 'none'}`,
        ``,
        `Review and process at: ${process.env.ADMIN_PANEL_URL || 'https://admin.justicegavel.app'}/refunds`,
      ].join('\n'),
    }).catch(() => {});

    const pendingMsg = isIn30DayWindow
      ? 'Your refund request is under review. Our team will respond within 1–2 business days.'
      : 'Your request has been received. Refunds are available within 30 days of charge. Our team will review your request and respond within 2 business days.';

    return res.json({
      ok:      true,
      status:  'pending_review',
      message: pendingMsg,
    });
  } catch (e) {
    logger.error('[billing/refund]', e.message);
    return res.status(500).json({ error: 'Could not process refund request. Please contact support@justicegavel.app.' });
  }
});


export default router;
