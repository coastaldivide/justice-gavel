/**
 * billing/connections.js — Emergency family connection and QuickConnect — $20 instant matchmaking
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
import { calcStripeFee }  from '../../payments/stripe.js';

const router = Router();

// ── Family: $29 emergency connection ─────────────────────────────────────────
router.post('/family/connect', authRequired, async (req, res) => {
  const { arrest_id, family_name, family_phone, family_email, payment_method_id } = req.body;
  if (!family_name || !family_phone) return err400(res, 'Name and phone required');

  try {
    const db = await getDb();

    // Get arrest (if provided) or use a default county
    let arrest = null;
    if (arrest_id) {
      arrest = await db.get('SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney FROM arrest_records WHERE id = ? LIMIT 1', [arrest_id]);
    }

    const county = arrest?.county || 'davidson';
    const state  = arrest?.state  || 'TN';

    // Find top 3 attorneys + 2 bail agents in county
    // Try providers.sqlite via the arrests DB path
    const attorneys = await db.all(
      `SELECT id, name, phone, address, rating, specialties FROM lawyers
       WHERE city LIKE ? OR city LIKE ?
       AND active = 1
       ORDER BY rating DESC, free_consultation DESC
       LIMIT 3`,
      [`%${county}%`, `%Nashville%`]
    ).catch(() => []);

    const agents = await db.all(
      `SELECT id, name, phone, address, rating FROM bail_agents
       WHERE city LIKE ? OR city LIKE ?
       AND active = 1
       ORDER BY rating DESC
       LIMIT 2`,
      [`%${county}%`, `%Nashville%`]
    ).catch(() => []);

    if (!LIVE) {
      // Demo mode — return mock connection
      const connection = await db.run(
        `INSERT INTO family_connections (arrest_id, family_name, family_phone, family_email, status, attorneys_sent, agents_sent, stripe_pi_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [arrest_id || null, family_name, family_phone, family_email || null, 'paid',
         JSON.stringify(attorneys.map(a => a.id)),
         JSON.stringify(agents.map(a => a.id)),
         'pi_mock_family']
      );
      return res.json({
        success: true,
        mock: true,
        connection_id: connection.lastID,
        attorneys,
        bail_agents: agents,
        arrest: arrest || null,
        message: 'Demo mode: configure STRIPE_SECRET to enable live payments.'
      });
    }

    // Live: charge $29 — require payment_method_id
    if (!payment_method_id) {
      return res.status(400).json({
        error: 'Payment method required. Please add a card to complete this purchase.',
        code: 'payment_method_required'
      });
    }

    const pi = await stripe.paymentIntents.create({
      amount: 2899,
      currency: 'usd',
      confirm: true,
      payment_method: payment_method_id,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: `Justice Gavel — Emergency Connection for ${family_name}`,
      metadata: { family_name, arrest_id: String(arrest_id || 'unknown') }
    });

    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment failed', status: pi.status });
    }

    const connection = await db.run(
      `INSERT INTO family_connections (arrest_id, family_name, family_phone, family_email, status, attorneys_sent, agents_sent, stripe_pi_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [arrest_id || null, family_name, family_phone, family_email || null, 'paid',
       JSON.stringify(attorneys.map(a => a.id)),
       JSON.stringify(agents.map(a => a.id)),
       pi.id]
    );

    res.json({
      success: true,
      connection_id: connection.lastID,
      attorneys,
      bail_agents: agents,
      arrest: arrest || null,
      message: 'Payment successful. Contact information revealed below.'
    });
  } catch (e) {
    logger.error('[billing] family connect error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Quick Connect Package — $10 bondsman + $10 lawyer = $20 total ─────────────
// POST /api/billing/quickconnect
// Returns one verified bail bondsman + one criminal defense lawyer near user.
// Charged as a single $20 transaction. No subscription. One-time.
router.post('/quickconnect', authRequired, async (req, res) => {
  const { lat, lng, county, state = 'TN', payment_method_id } = req.body;
  // Validate coordinates before use in SQL ORDER BY
  const validLat = lat ? parseFloat(lat) : null;
  const validLng = lng ? parseFloat(lng) : null;
  const hasCoords = validLat !== null && !isNaN(validLat) && validLng !== null && !isNaN(validLng);
  if (!lat && !county) return err400(res, 'Provide lat/lng or county');

  try {
    const db = await getDb();


    const finalAmountCents = Math.max(0, BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS - creditCents);   // $20 minus credit, floor $0
    const creditApplied    = Math.min(creditCents, 2000);        // never exceed the price

    // Find nearest bondsman
    let bondsmen = [];
    if (lat && lng) {
      bondsmen = await db.all(
        `SELECT id, name, phone, address, rating, lat, lng, hours
         FROM bail_agents
         WHERE active = 1 AND phone IS NOT NULL
         ORDER BY ((? - lat)*(? - lat) + (? - lng)*(? - lng))
         LIMIT 3`
      ,
          [validLat, validLat, validLng, validLng]        ).catch(() => []);
    }
    if (!bondsmen.length) {
      bondsmen = await db.all(
        `SELECT id, name, phone, address, rating, lat, lng, hours
         FROM bail_agents WHERE active = 1 AND phone IS NOT NULL
         ORDER BY rating DESC LIMIT 3`
      ).catch(() => []);
    }

    // Find nearest criminal defense lawyer
    let lawyers = [];
    if (lat && lng) {
      lawyers = await db.all(
        `SELECT id, name, phone, address, rating, specialties, free_consultation, lat, lng
         FROM lawyers
         WHERE active = 1 AND phone IS NOT NULL
         ORDER BY ((? - lat)*(? - lat) + (? - lng)*(? - lng))
         LIMIT 3`
      ,
          [validLat, validLat, validLng, validLng]        ).catch(() => []);
    }
    if (!lawyers.length) {
      lawyers = await db.all(
        `SELECT id, name, phone, address, rating, specialties, free_consultation, lat, lng
         FROM lawyers WHERE active = 1 AND phone IS NOT NULL
         ORDER BY rating DESC LIMIT 3`
      ).catch(() => []);
    }

    const bondsman = bondsmen[0] || null;
    const lawyer   = lawyers[0]   || null;

    if (!LIVE) {
      // Demo mode — mock charge (with credit applied)
      const demoCharged = finalAmountCents / 100;
      if (creditApplied > 0) {
          await db.run('UPDATE users SET credit_cents = MAX(0, credit_cents - ?) WHERE id=?',
          [creditApplied, req.user.id]).catch(()=>{});
      }
      return res.json({
        success: true,
        mock: true,
        charged: `$${demoCharged.toFixed(2)}`,
        credit_applied_cents: creditApplied,

        breakdown: [
          { item: '1 Bail Bondsman Contact', price: '$10.00' },
          { item: '1 Criminal Defense Lawyer', price: '$10.00' },

        ],
        bondsman,
        lawyer,
        message: 'Demo mode: configure STRIPE_SECRET to enable live payments.',
      });
    }

    // Live: single $20 Stripe charge
    if (!payment_method_id) {
      return res.status(400).json({
        error: 'Payment method required.',
        code: 'payment_method_required',
      });
    }

    const customerId = await getOrCreateStripeCustomer(req.user);
    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId })
        .catch(e => logger.warn('[billing/quickconnect] paymentMethod.attach:', e?.message));
    }

    const pi = await stripe.paymentIntents.create({
      amount:   finalAmountCents,
      currency: 'usd',
      customer: customerId,
      confirm:  true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' ,
        metadata: { user_id: String(req.user.id), source: 'connections' },
      },
      description: 'Justice Gavel — Quick Connect Package ($10 Bondsman + $10 Lawyer)',
      metadata: {
        user_id:    String(req.user.id),
        bondsman_id: String(bondsman?.id || ''),
        lawyer_id:   String(lawyer?.id   || ''),
        package:    'quickconnect',
      },
    });

    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment failed', status: pi.status });
    }


    if (creditApplied > 0) {
        await db.run('UPDATE users SET credit_cents = MAX(0, credit_cents - ?) WHERE id=?',
        [creditApplied, req.user.id]).catch(()=>{});
    }

    // Log revenue
    // Revenue log — surface failures; silent drop means business doesn't know payment received
    try {
      await db.run(
        `INSERT INTO revenue_log (source, recipient_type, gross_cents, stripe_fee_cents, net_cents, stripe_pi_id)
         VALUES (?,?,?,?,?,?)`,
        ['quickconnect', 'user', finalAmountCents, calcStripeFee(finalAmountCents),
         finalAmountCents - calcStripeFee(finalAmountCents), pi.id]
      );
    } catch (e) {
      logger.error('[billing/quickconnect] revenue_log insert failed — PI:', pi.id, e?.message);
    }

    res.json({
      success: true,
      charged: `$${(finalAmountCents/100).toFixed(2)}`,
      credit_applied_cents: creditApplied,

      breakdown: [
        { item: '1 Bail Bondsman Contact', price: '$10.00' },
        { item: '1 Criminal Defense Lawyer', price: '$10.00' },

      ],
      bondsman,
      lawyer,
    });
  } catch (e) {
    logger.error('[billing] quickconnect error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});


export default router;
