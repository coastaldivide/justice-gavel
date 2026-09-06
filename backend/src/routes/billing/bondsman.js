import { validate, schemas } from '../../validation/schemas.js';
/**
 * billing/bondsman.js — Bondsman profiles, leads marketplace, and Verified Badge subscription
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { stripe, LIVE, TIERS, billingLimiter, getOrCreateStripeCustomer,
         BONDSMAN_TIERS, bondsTierFromPriceId, generateIdempotencyKey }
  from './_shared.js';

// Flat lead fee — $75 regardless of bail amount.
// Per-lead fees scaled to bail amount implicate runner-capper statutes
// (TX §38.12, FL §877.02). See billing/_shared.js for the removed calcLeadFee.
const FLAT_LEAD_FEE_CENTS = 7500; // $75.00
import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502,
         safeInt, safeFloat, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';

const router = Router();

// ── Bondsman: save profile ────────────────────────────────────────────────────
router.post('/bondsman/profile', billingLimiter, authRequired, async (req, res) => {
  const { company_name, license_number, license_state = '', counties = [], states = [], min_bail = 0, max_bail = 999999 } = req.body;
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO bondsman_profiles (user_id, company_name, license_number, license_state, counties, states, min_bail_amount, max_bail_amount)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         company_name = excluded.company_name,
         license_number = excluded.license_number,
         license_state = excluded.license_state,
         counties = excluded.counties,
         states = excluded.states,
         min_bail_amount = excluded.min_bail_amount,
         max_bail_amount = excluded.max_bail_amount`,
      [req.user.id, company_name, license_number, license_state, JSON.stringify(counties), JSON.stringify(states), min_bail, max_bail]
    );
    res.json({ success: true, message: 'Profile saved' });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.get('/bondsman/profile', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.get('SELECT id, user_id, name, phone, email, address, city, state, zip_code, ' +
       'license_number, license_state, years_experience, bio, photo_url, ' +
       'service_radius_km, languages, verified_badge, badge_expires_at, ' +
       'active, created_at ' +
       'FROM bondsman_profiles WHERE user_id = ?', [req.user.id]);
    res.json({ profile: profile || null });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Bondsman: get available leads ─────────────────────────────────────────────
router.get('/leads', authRequired, async (req, res) => {
  const { county, state = 'TN', hours = 48, limit = 50 } = req.query;
  try {
    const db = await getDb();

    // Build query for recent arrests without attorney, with bail set
    const conditions = [
      `ar.has_attorney = 0`,
      `ar.bail_amount > 0`,
      `ar.created_at >= datetime('now', '-${safeInt(hours)} hours')`
    ];
    const params = [];

    if (county) { conditions.push('LOWER(ar.county) = LOWER(?)'); params.push(county); }
    if (state)  { conditions.push('ar.state = ?'); params.push(state.toUpperCase()); }

    const records = await db.all(
      `SELECT
        ar.id, ar.name, ar.booking_date, ar.charges, ar.bail_amount,
        ar.county, ar.state, ar.jail_location,
        lp.id as already_purchased
       FROM arrest_records ar
       LEFT JOIN lead_purchases lp ON lp.arrest_id = ar.id AND lp.bondsman_id = ? AND lp.status = 'charged'
       WHERE ${conditions.join(' AND ')}
       ORDER BY ar.bail_amount DESC, ar.booking_date DESC
       LIMIT ?`,
      [req.user.id, ...params, safeInt(limit)]
    );

    // Add computed lead fee and mask contact info for unpurchased
    const leads = records.map(r => ({
      ...r,
      lead_fee_cents: FLAT_LEAD_FEE_CENTS,
      lead_fee_display: `$${(FLAT_LEAD_FEE_CENTS / 100).toFixed(0)}`,
      purchased: !!r.already_purchased,
      // Only reveal full name and contact if purchased
      name: r.already_purchased ? r.name : r.name.split(' ')[0] + ' ' + (r.name.split(' ')[1]?.[0] || '') + '.',
    }));

    res.json({ leads, count: leads.length, mock: !LIVE });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Bondsman: accept lead (charge card) ───────────────────────────────────────
router.post('/leads/:id/accept', billingLimiter, authRequired, async (req, res) => {
  const arrestId = safeInt(req.params.id);
  const { payment_method_id } = req.body;

  let db;
  try {
    db = await getDb();
    await db.exec("BEGIN IMMEDIATE");  // Atomic: charge + record together

    // Get arrest record
    const arrest = await db.get('SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney FROM arrest_records WHERE id = ? LIMIT 1', [arrestId]);
    if (!arrest) return err404(res, 'Arrest record not found');
    if (!arrest.bail_amount || arrest.bail_amount <= 0) return err400(res, 'No bail set on this record');

    // Check not already purchased
    const existing = await db.get(
      'SELECT id FROM lead_purchases WHERE bondsman_id = ? AND arrest_id = ? AND status = ?',
      [req.user.id, arrestId, 'charged']
    );
    if (existing) return res.status(409).json({ error: 'Already purchased this lead', arrest });

    const feeCents = FLAT_LEAD_FEE_CENTS;

    if (!LIVE) {
      // Demo mode — mock purchase
      await db.run(
        `INSERT INTO lead_purchases (bondsman_id, arrest_id, bail_amount, lead_fee_cents, status, contact_revealed, stripe_pi_id)
         VALUES (?,?,?,?,?,?,?)`,
        [req.user.id, arrestId, arrest.bail_amount, feeCents, 'charged', 1, 'pi_mock_demo']
      );
      await db.run('UPDATE bondsman_profiles SET leads_accepted = leads_accepted + 1 WHERE user_id = ?', [req.user.id]);
      return res.json({
        success: true,
        mock: true,
        fee_charged: `$${(feeCents / 100).toFixed(0)}`,
        arrest,  // Full record revealed
        message: `Lead accepted (demo). In production, $${(feeCents/100).toFixed(0)} would be charged to your card.`
      });
    }

    // Live Stripe charge
    const customerId = await getOrCreateStripeCustomer(req.user);
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
    }

    const piIdempotencyKey = `pi_${req.user.id}_${req.params.id}_${Date.now()}`;
    const pi = await stripe.paymentIntents.create(
      {
      amount: feeCents,
      currency: 'usd',
      customer: customerId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: `Lead: ${arrest.name} — Bail $${arrest.bail_amount?.toLocaleString()} — ${arrest.county} County`,
      metadata: { bondsman_id: String(req.user.id), arrest_id: String(arrestId) }
    });

    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment failed', status: pi.status });
    }

    await db.run(
      `INSERT INTO lead_purchases (bondsman_id, arrest_id, bail_amount, lead_fee_cents, status, contact_revealed, stripe_pi_id)
       VALUES (?,?,?,?,?,?,?)`,
      [req.user.id, arrestId, arrest.bail_amount, feeCents, 'charged', 1, pi.id]
    );
    await db.run('UPDATE bondsman_profiles SET leads_accepted = leads_accepted + 1 WHERE user_id = ?', [req.user.id]);
    await db.exec('COMMIT');
    res.json({ success: true, fee_charged: `$${(feeCents/100).toFixed(0)}`, arrest });
  } catch (e) {
    if (db) try { await db.run('ROLLBACK'); } catch (_) { logger?.warn?.("[bondsman] suppressed:", _?.message); }
    logger.error('[billing] accept lead error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});


// ── Verified Badge subscription ──────────────────────────────────────────────
router.post('/bondsman/verified-badge/subscribe', billingLimiter, authRequired, async (req, res) => {
  try {
    const db = await getDb();

    // Check existing
    const existing = await db.get(
      "SELECT id, user_id, stripe_sub_id, stripe_customer_id, status, created_at, current_period_start, cancel_at_period_end FROM verified_badge_subscriptions WHERE user_id=? AND status='active'",
      [req.user.id]
    );
    if (existing) return res.status(409).json({ error: 'Already have an active Verified Badge subscription.' });

    const feeCents = BUSINESS_CONSTANTS.BONDSMAN_BADGE_CENTS; // $49/month
    const renewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (!LIVE) {
      await db.run(
        `INSERT INTO verified_badge_subscriptions
           (user_id, status, stripe_sub_id, stripe_cus_id, amount_cents, renews_at)
         VALUES (?,?,?,?,?,?)`,
        [req.user.id, 'active', 'sub_mock_badge', 'cus_mock_badge', feeCents, renewsAt]
      );
      // Mark bondsman profile as verified
      await db.run(
        `UPDATE bondsman_profiles SET verified_badge=1, badge_expires_at=? WHERE user_id=?`,
        [renewsAt, req.user.id]
      );
      return res.json({
        success: true, mock: true,
        message: '✓ Verified Badge activated! Your listings now show the "Verified by Justice Gavel" badge.',
        renews_at: renewsAt,
        fee: '$49/month',
      });
    }

    // Live Stripe
    const customerId = await getOrCreateStripeCustomer(req.user);
    const stripeSub = await stripe.subscriptions.create(
      {
      customer: customerId,
      items: [{ price_data: { currency: 'usd', unit_amount: feeCents,
        product_data: { name: 'Justice Gavel — Verified Bondsman Badge' },
        recurring: { interval: 'month' }
      }}],
      metadata: { user_id: String(req.user.id), type: 'verified_badge' }
    });

    await db.run(
      `INSERT INTO verified_badge_subscriptions
         (user_id, status, stripe_sub_id, stripe_cus_id, amount_cents, renews_at)
       VALUES (?,?,?,?,?,?)`,
      [req.user.id, 'active', stripeSub.id, customerId, feeCents, new Date(stripeSub.current_period_end * 1000).toISOString()]
    );
    await db.run(
      `UPDATE bondsman_profiles SET verified_badge=1, badge_expires_at=? WHERE user_id=?`,
      [new Date(stripeSub.current_period_end * 1000).toISOString(), req.user.id]
    );

    res.json({ success: true, message: '✓ Verified Badge activated!', fee: '$49/month' });
  } catch (e) {
    logger.error('[billing] verified-badge subscribe:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /api/billing/bondsman/verified-badge/status
router.get('/bondsman/verified-badge/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sub = await db.get(
      "SELECT id, user_id, stripe_sub_id, stripe_customer_id, status, created_at, current_period_start, cancel_at_period_end FROM verified_badge_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );
    const profile = await db.get(
      'SELECT verified_badge, badge_expires_at FROM bondsman_profiles WHERE user_id=?',
      [req.user.id]
    );
    res.json({
      active: sub?.status === 'active' || false,
      subscription: sub || null,
      verified_badge: !!profile?.verified_badge,
      badge_expires_at: profile?.badge_expires_at || null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/billing/bondsman/verified-badge/cancel
router.post('/bondsman/verified-badge/cancel', billingLimiter, authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sub = await db.get(
      "SELECT id, user_id, stripe_sub_id, stripe_customer_id, status, created_at, current_period_start, cancel_at_period_end FROM verified_badge_subscriptions WHERE user_id=? AND status='active'",
      [req.user.id]
    );
    if (!sub) return err404(res, 'No active badge subscription found.');

    if (LIVE && sub.stripe_sub_id && !sub.stripe_sub_id.startsWith('sub_mock')) {
      await stripe.subscriptions.cancel(sub.stripe_sub_id);
    }
    await db.run(
      "UPDATE verified_badge_subscriptions SET status='cancelled', cancelled_at=datetime('now') WHERE id=?",
      [sub.id]
    );
    await db.run(
      "UPDATE bondsman_profiles SET verified_badge=0 WHERE user_id=?",
      [req.user.id]
    );
    res.json({ success: true, message: 'Badge subscription cancelled. Badge removed from your listings.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// PI / CIVIL RIGHTS ATTORNEY LEAD MARKETPLACE
// Flat $75 per lead — no severity or bail-amount tiering.
// Per-lead fees scaled to case value implicate Rule 5.4(a) / 7.2(b).
// See: backend/src/routes/pi_leads.js for the lead fee logic.
// ════════════════════════════════════════════════════════════════════════

// Lead fee tiers for PI/civil — based on reported severity



// ══════════════════════════════════════════════════════════════════════════════
// BONDSMAN GEOGRAPHIC TIER SUBSCRIPTIONS
// Starter $49/mo (1 county) | Pro $149/mo (3 counties) | Market $349/mo (DMA)
// These replace the standalone Verified Badge subscription.
// A bondsman subscribes to a tier and gets the badge as part of membership.
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/billing/bondsman/tiers — list available tiers and pricing
router.get('/bondsman/tiers', async (req, res) => {
  const tiers = Object.entries(BONDSMAN_TIERS).map(([key, t]) => ({
    key,
    name:          t.name,
    display:       t.display,
    monthly_cents: t.monthly_cents,
    counties:      t.counties,
    label:         t.label,
    has_stripe:    !!t.price_id,
    // Annual option — 2 months free
    annual_display: `$${(t.annual_cents / 100).toFixed(0)}/yr`,
    annual_savings: `Save $${((t.monthly_cents * 12 - t.annual_cents) / 100).toFixed(0)}/yr`,
  }));
  res.json({ tiers, recommended: 'pro' });
});

// GET /api/billing/bondsman/subscription — current tier status
router.get('/bondsman/subscription', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const sub = await db.get(
      `SELECT id, tier, status, stripe_sub_id, amount_cents, renews_at, cancel_at_period_end
         FROM bondsman_subscriptions
        WHERE user_id = ? AND status IN ('active','past_due')
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!sub) return res.json({ active: false, tier: null });
    const tierDef = BONDSMAN_TIERS[sub.tier] || {};
    res.json({
      active:             sub.status === 'active',
      tier:               sub.tier,
      counties_covered:   tierDef.counties || 0,
      display:            tierDef.display  || '',
      renews_at:          sub.renews_at,
      cancel_at_period_end: sub.cancel_at_period_end,
      mock:               !LIVE,
    });
  } catch (e) {
    logger.error('[billing] bondsman/subscription GET:', e?.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/billing/bondsman/subscribe — subscribe to a geographic tier
router.post('/bondsman/subscribe', billingLimiter, authRequired, async (req, res) => {
  const { tier = 'pro', billing = 'monthly' } = req.body;

  if (!BONDSMAN_TIERS[tier]) {
    return res.status(400).json({ error: `Unknown tier: ${tier}. Use starter, pro, or market.` });
  }
  const tierDef   = BONDSMAN_TIERS[tier];
  const isAnnual  = billing === 'annual';
  const priceId   = isAnnual ? tierDef.annual_price_id : tierDef.price_id;
  const amtCents  = isAnnual ? tierDef.annual_cents    : tierDef.monthly_cents;

  try {
    const db = await getDb();

    // Block duplicate active subscription
    const existing = await db.get(
      `SELECT id, tier FROM bondsman_subscriptions
        WHERE user_id = ? AND status = 'active'`,
      [req.user.id]
    );
    if (existing) {
      return res.status(409).json({
        error:        `Already subscribed to ${existing.tier} tier. Cancel first to change plans.`,
        current_tier: existing.tier,
        change_url:   '/bondsman/subscription/change',
      });
    }

    const renewsAt = isAnnual
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() +  30 * 24 * 60 * 60 * 1000).toISOString();

    if (!LIVE || !priceId) {
      // Demo mode — no real Stripe charge
      await db.run(
        `INSERT INTO bondsman_subscriptions
           (user_id, tier, status, stripe_sub_id, stripe_cus_id, amount_cents, billing_period, renews_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [req.user.id, tier, 'active', `sub_mock_${tier}`, `cus_mock`, amtCents, billing, renewsAt]
      );
      await db.run(
        `UPDATE bondsman_profiles SET verified_badge=1, badge_expires_at=?, tier=? WHERE user_id=?`,
        [renewsAt, tier, req.user.id]
      );
      return res.json({
        success: true, mock: !LIVE || !priceId,
        message: `✅ ${tierDef.name} activated (${isAnnual ? 'annual' : 'monthly'}).`,
        tier,
        counties:   tierDef.counties,
        display:    tierDef.display,
        renews_at:  renewsAt,
        note:       !priceId
          ? `Set STRIPE_BONDSMAN_${tier.toUpperCase()}_ID in Railway to enable real payments.`
          : undefined,
      });
    }

    // Live Stripe subscription
    const customerId = await getOrCreateStripeCustomer(req.user);
    const idemKey    = generateIdempotencyKey(req.user.id, `bondsman_${tier}`);

    const stripeSub = await stripe.subscriptions.create(
      {
        customer:         customerId,
        items:            [{ price: priceId }],
        metadata:         { user_id: String(req.user.id), tier, type: 'bondsman_tier' },
        payment_settings: { save_default_payment_method: 'on_subscription' },
      },
      { idempotencyKey: idemKey }
    );

    if (stripeSub.status !== 'active' && stripeSub.status !== 'trialing') {
      return res.status(402).json({ error: 'Payment incomplete', status: stripeSub.status });
    }

    await db.run(
      `INSERT INTO bondsman_subscriptions
         (user_id, tier, status, stripe_sub_id, stripe_cus_id, amount_cents, billing_period, renews_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, tier, 'active', stripeSub.id, customerId, amtCents, billing,
       new Date(stripeSub.current_period_end * 1000).toISOString()]
    );
    await db.run(
      `UPDATE bondsman_profiles SET verified_badge=1, badge_expires_at=?, tier=? WHERE user_id=?`,
      [new Date(stripeSub.current_period_end * 1000).toISOString(), tier, req.user.id]
    );

    res.json({
      success:   true,
      tier,
      counties:  tierDef.counties,
      display:   tierDef.display,
      renews_at: new Date(stripeSub.current_period_end * 1000).toISOString(),
    });
  } catch (e) {
    logger.error('[billing] bondsman/subscribe:', e?.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/billing/bondsman/subscription/cancel
router.post('/bondsman/subscription/cancel', billingLimiter, authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const sub = await db.get(
      `SELECT id, stripe_sub_id, tier FROM bondsman_subscriptions
        WHERE user_id = ? AND status = 'active'`,
      [req.user.id]
    );
    if (!sub) return res.status(404).json({ error: 'No active bondsman subscription.' });

    if (LIVE && sub.stripe_sub_id && !sub.stripe_sub_id.startsWith('sub_mock')) {
      // Cancel at period end (bondsman keeps access until paid-through date)
      await stripe.subscriptions.update(sub.stripe_sub_id, { cancel_at_period_end: true });
      await db.run(
        `UPDATE bondsman_subscriptions SET cancel_at_period_end=1 WHERE id=?`,
        [sub.id]
      );
      return res.json({ success: true, message: 'Subscription will cancel at end of billing period.' });
    }

    // Demo mode — immediate cancel
    await db.run(
      `UPDATE bondsman_subscriptions SET status='cancelled', cancelled_at=datetime('now') WHERE id=?`,
      [sub.id]
    );
    await db.run(`UPDATE bondsman_profiles SET verified_badge=0, tier=NULL WHERE user_id=?`, [req.user.id]);
    res.json({ success: true, message: 'Subscription cancelled.' });
  } catch (e) {
    logger.error('[billing] bondsman/subscription/cancel:', e?.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/billing/bondsman/subscription/change — upgrade or downgrade tier
router.post('/bondsman/subscription/change', billingLimiter, authRequired, async (req, res) => {
  const { tier } = req.body;
  if (!BONDSMAN_TIERS[tier]) {
    return res.status(400).json({ error: `Unknown tier: ${tier}` });
  }
  const newTier = BONDSMAN_TIERS[tier];
  if (!newTier.price_id) {
    return res.status(400).json({ error: `Stripe not configured for ${tier} tier. Set STRIPE_BONDSMAN_${tier.toUpperCase()}_ID.` });
  }
  try {
    const db  = await getDb();
    const sub = await db.get(
      `SELECT id, stripe_sub_id, tier FROM bondsman_subscriptions WHERE user_id=? AND status='active'`,
      [req.user.id]
    );
    if (!sub) return res.status(404).json({ error: 'No active subscription to change.' });
    if (sub.tier === tier) return res.json({ success: true, message: `Already on ${tier} tier.` });

    if (LIVE && sub.stripe_sub_id && !sub.stripe_sub_id.startsWith('sub_mock')) {
      // Stripe proration handles the billing adjustment automatically
      const stripeSubObj = await stripe.subscriptions.retrieve(sub.stripe_sub_id);
      await stripe.subscriptions.update(sub.stripe_sub_id, {
        items:          [{ id: stripeSubObj.items.data[0].id, price: newTier.price_id }],
        proration_behavior: 'always_invoice',
      });
    }

    await db.run(
      `UPDATE bondsman_subscriptions SET tier=?, amount_cents=? WHERE id=?`,
      [tier, newTier.monthly_cents, sub.id]
    );
    await db.run(`UPDATE bondsman_profiles SET tier=? WHERE user_id=?`, [tier, req.user.id]);

    res.json({
      success:  true,
      new_tier: tier,
      counties: newTier.counties,
      display:  newTier.display,
      message:  `Switched to ${newTier.name}. Proration applied to next invoice.`,
    });
  } catch (e) {
    logger.error('[billing] bondsman/subscription/change:', e?.message);
    res.status(500).json({ error: 'Server error' });
  }
});


export default router;
