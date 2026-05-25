/**
 * billing/consumer.js — Consumer (end-user) subscription plans — subscribe, view status, admin stats
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { stripe, LIVE, TIERS, billingLimiter, getOrCreateStripeCustomer, calcLeadFee }
  from './_shared.js';
import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502,
         safeInt, safeFloat, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';

const router = Router();

// ── Consumer subscribe ────────────────────────────────────────────────────────
// POST /api/billing/consumer/subscribe
router.post('/consumer/subscribe', billingLimiter, authRequired, async (req, res) => {
  const { tier, payment_method_id } = req.body;
  const consumerTiers = ['advisor', 'pro', 'consumer_intel'];
  if (!consumerTiers.includes(tier)) {
    return err400(res, 'Invalid consumer tier. Options: starter, pro, consumer_intel');
  }
  const tierConfig = TIERS[tier];

  try {
    const db = await getDb();
    const existing = await db.get(
      'SELECT id, user_id, status, stripe_sub_id, stripe_customer_id, tier, provider_type, created_at, current_period_start, cancel_at_period_end FROM subscriptions WHERE user_id = ? AND status IN (?,?) AND provider_type = ?',
      [req.user.id, 'active', 'trialing', 'consumer']
    );
    if (existing) return res.status(409).json({ error: 'Already subscribed', subscription: existing });

    if (!LIVE) {
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7-day trial
      const sub = await db.run(
        `INSERT INTO subscriptions (user_id, provider_type, tier, status, amount_cents, trial_ends_at, stripe_sub_id, stripe_cus_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [req.user.id, 'consumer', tier, 'demo', tierConfig.monthly_cents, trialEnd, 'sub_mock_consumer', 'cus_mock_consumer']
      );
      return res.json({
        success: true, mock: true,
        subscription: { id: sub.lastID, tier, status: 'trialing', trial_ends_at: trialEnd, amount_cents: tierConfig.monthly_cents },
        message: `7-day free trial started for ${tierConfig.name} ($${(tierConfig.monthly_cents/100).toFixed(2)}/mo). Demo mode — no charge.`
      });
    }

    const customerId = await getOrCreateStripeCustomer(req.user);
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
      await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: payment_method_id } });
    }
    const stripeSub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price_data: { currency: 'usd', unit_amount: tierConfig.monthly_cents, product_data: { name: `Justice Gavel ${tierConfig.name}` }, recurring: { interval: 'month' } } }],
      trial_period_days: 7,
      metadata: { user_id: String(req.user.id), tier, provider_type: 'consumer' }
    });
    const trialEnd = new Date(stripeSub.trial_end * 1000).toISOString();
    const sub = await db.run(
      `INSERT INTO subscriptions (user_id, provider_type, tier, status, amount_cents, trial_ends_at, stripe_sub_id, stripe_cus_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, 'consumer', tier, 'trialing', tierConfig.monthly_cents, trialEnd, stripeSub.id, customerId]
    );
    res.json({
      success: true,
      subscription: { id: sub.lastID, tier, status: 'trialing', trial_ends_at: trialEnd },
      message: `7-day free trial. Billed $${(tierConfig.monthly_cents/100).toFixed(2)}/mo after ${new Date(trialEnd).toLocaleDateString()}.`
    });
  } catch (e) {
    logger.error('[billing] consumer subscribe:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /api/billing/consumer/subscription
router.get('/consumer/subscription', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sub = await db.get(
      `SELECT id, user_id, status, stripe_sub_id, stripe_customer_id, tier, provider_type, created_at, current_period_start, cancel_at_period_end FROM subscriptions WHERE user_id = ? AND provider_type = 'consumer' ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const consumerTiers = ['advisor', 'pro', 'consumer_intel'].map(k => ({ key: k, ...TIERS[k] }));
    res.json({ subscription: sub || null, tiers: consumerTiers, mock: !LIVE });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Admin stats ────────────────────────────────────────────────────────────────
router.get('/admin/stats', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const [subs, leads, connections] = await Promise.all([
      await db.get(`SELECT COUNT(*) as total, SUM(amount_cents) as mrr FROM subscriptions WHERE status IN ('active','trialing')`),
      db.get(`SELECT COUNT(*) as total, SUM(lead_fee_cents) as revenue FROM lead_purchases WHERE status = 'charged'`),
      db.get(`SELECT COUNT(*) as total, SUM(amount_cents) as revenue FROM family_connections WHERE status = 'paid'`),
    ]);
    res.json({ subscriptions: subs, leads, family_connections: connections });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFIED BADGE PROGRAM — $49/month
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/billing/bondsman/verified-badge/subscribe

export default router;
