/**
 * billing/connections.js — Emergency family connection and QuickConnect — $20 instant matchmaking
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { logIgnored } from '../../utils/ignored.js';
import { stripe, LIVE, billingLimiter, getOrCreateStripeCustomer } from './_shared.js';
import { err400, BUSINESS_CONSTANTS } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';
import { calcStripeFee }  from '../../payments/stripe.js';
import { realArrestSql }  from '../../utils/arrestVisibility.js';

const router = Router();

// ── Family: $29 emergency connection ─────────────────────────────────────────
router.post('/family/connect', billingLimiter, authRequired, async (req, res) => {
  const { arrest_id, family_name = '', family_phone = '', family_email, payment_method_id } = req.body;
  if (!family_name || !family_phone) return err400(res, 'Name and phone required');

  try {
    const db = await getDb();

    // Get arrest (if provided) or use a default county
    let arrest = null;
    if (arrest_id) {
      // Paid path: sample/seed or taken-down rows are never attached to a purchase.
      arrest = await db.get(`SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney FROM arrest_records WHERE id = ? AND ${realArrestSql()} LIMIT 1`, [arrest_id]);
    }

    const county = arrest?.county || 'davidson';
    const state  = arrest?.state  || 'TN';

    // Find top 3 attorneys + 2 bail agents in the arrest's county and state.
    // (Previously `city LIKE ? OR city LIKE ? AND active = 1` ignored the state —
    // a county name like "Washington" matched 30 states — and, by AND/OR
    // precedence, let inactive listings through.)
    const attorneys = await db.all(
      `SELECT id, name, phone, address, rating, specialties FROM lawyers
       WHERE active = 1 AND UPPER(state) = ? AND (city LIKE ? OR city LIKE ?)
       ORDER BY rating DESC, free_consultation DESC
       LIMIT 3`,
      [state.toUpperCase(), `%${county}%`, `%Nashville%`]
    ).catch(() => []);

    const agents = await db.all(
      `SELECT id, name, phone, address, rating FROM bail_agents
       WHERE active = 1 AND UPPER(state) = ? AND (city LIKE ? OR city LIKE ?)
       ORDER BY rating DESC
       LIMIT 2`,
      [state.toUpperCase(), `%${county}%`, `%Nashville%`]
    ).catch(() => []);

    if (!LIVE) {
      // Demo mode — return mock connection
      const connection = await db.run(
        `INSERT INTO family_connections (arrest_id, family_name, family_phone, family_email, status, attorneys_sent, agents_sent, stripe_pi_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [arrest?.id || null, family_name, family_phone, family_email || null, 'paid',
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

    const pi = await stripe.paymentIntents.create(
      {
      amount: 2899,
      currency: 'usd',
      confirm: true,
      payment_method: payment_method_id,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: `Justice Gavel — Emergency Connection for ${family_name}`,
      metadata: { family_name, arrest_id: String(arrest?.id || 'unknown') }
    });

    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment failed', status: pi.status });
    }

    const connection = await db.run(
      `INSERT INTO family_connections (arrest_id, family_name, family_phone, family_email, status, attorneys_sent, agents_sent, stripe_pi_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [arrest?.id || null, family_name, family_phone, family_email || null, 'paid',
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
// One verified bail bondsman + one criminal defense lawyer near the person,
// one $20 charge (minus any account credit). No subscription.
//
//   GET  /api/billing/quickconnect/quote    price, the caller's credit, amount due
//   POST /api/billing/quickconnect          creates the PaymentIntent (contacts are NOT
//        { lat, lng, state }                returned yet) → { requires_payment, client_secret,
//                                           payment_intent_id, amount_cents }; when credit
//                                           covers the whole price the contacts come back now
//   POST /api/billing/quickconnect/confirm  after the app's payment sheet succeeded: checks the
//        { payment_intent_id }              PaymentIntent with Stripe (this user, this package,
//                                           status succeeded) and returns the contacts. Safe to
//                                           repeat: credit and revenue are booked once per PI.
// Without a Stripe key every POST is 503 payments_unavailable (billing/index.js gate).
const QC_BREAKDOWN = [
  { item: '1 Bail Bondsman Contact', price: '$10.00' },
  { item: '1 Criminal Defense Lawyer', price: '$10.00' },
];
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;

async function quickConnectQuote(db, userId) {
  const price = BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS;
  const row = await db.get('SELECT credit_cents FROM users WHERE id=?', [userId]).catch(() => null);
  const credit = Math.min(Math.max(0, Number(row?.credit_cents) || 0), price);
  return { price_cents: price, credit_cents: credit, amount_cents: price - credit };
}

/** Nearest by coordinates when valid; otherwise top-rated in the caller's state. */
async function pickQuickConnectContacts(db, { lat, lng, state }) {
  const vLat = lat != null && lat !== '' ? Number.parseFloat(lat) : NaN;
  const vLng = lng != null && lng !== '' ? Number.parseFloat(lng) : NaN;
  const hasCoords = Number.isFinite(vLat) && Number.isFinite(vLng) && Math.abs(vLat) <= 90 && Math.abs(vLng) <= 180;
  const st = String(state || 'TN').toUpperCase().slice(0, 2);
  const near = (table, cols) => db.all(
    `SELECT ${cols} FROM ${table} WHERE active = 1 AND phone IS NOT NULL
      ORDER BY ((? - lat)*(? - lat) + (? - lng)*(? - lng)) LIMIT 1`, [vLat, vLat, vLng, vLng]).catch(() => []);
  const inState = (table, cols) => db.all(
    `SELECT ${cols} FROM ${table} WHERE active = 1 AND phone IS NOT NULL AND UPPER(state) = ?
      ORDER BY rating DESC NULLS LAST LIMIT 1`, [st]).catch(() => []);
  const BAIL_COLS = 'id, name, phone, address, rating, lat, lng, hours';
  const LAW_COLS = 'id, name, phone, address, rating, specialties, free_consultation, lat, lng';
  let bondsmen = hasCoords ? await near('bail_agents', BAIL_COLS) : [];
  if (!bondsmen.length) bondsmen = await inState('bail_agents', BAIL_COLS);
  let lawyers = hasCoords ? await near('lawyers', LAW_COLS) : [];
  if (!lawyers.length) lawyers = await inState('lawyers', LAW_COLS);
  return { bondsman: bondsmen[0] || null, lawyer: lawyers[0] || null };
}

async function contactsById(db, bondsmanId, lawyerId) {
  const bondsman = bondsmanId ? await db.get('SELECT id, name, phone, address, rating, lat, lng, hours FROM bail_agents WHERE id = ?', [bondsmanId]).catch(() => null) : null;
  const lawyer = lawyerId ? await db.get('SELECT id, name, phone, address, rating, specialties, free_consultation, lat, lng FROM lawyers WHERE id = ?', [lawyerId]).catch(() => null) : null;
  return { bondsman: bondsman || null, lawyer: lawyer || null };
}

/** Book the credit and the revenue for one paid (or credit-covered) purchase, once. */
async function bookQuickConnect(db, userId, { amountCents, creditCents, piId }) {
  if (piId) {
    const seen = await db.get('SELECT id FROM revenue_log WHERE stripe_pi_id = ? LIMIT 1', [piId]).catch(() => null);
    if (seen) return;
  }
  if (creditCents > 0) {
    await db.run('UPDATE users SET credit_cents = GREATEST(0, credit_cents - ?) WHERE id=?', [creditCents, userId])
      .catch(logIgnored('routes/billing/connections'));
  }
  try {
    await db.run(
      `INSERT INTO revenue_log (source, recipient_type, gross_cents, stripe_fee_cents, net_cents, stripe_pi_id)
       VALUES (?,?,?,?,?,?)`,
      ['quickconnect', 'user', amountCents, calcStripeFee(amountCents), amountCents - calcStripeFee(amountCents), piId || null]
    );
  } catch (e) {
    // a silent drop means the business doesn't know a payment was received
    logger.error('[billing/quickconnect] revenue_log insert failed — PI:', piId, e?.message);
  }
}

router.get('/quickconnect/quote', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    res.json({ ...(await quickConnectQuote(db, req.user.id)), payments_live: LIVE });
  } catch (e) {
    logger.error('[billing] quickconnect quote error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/quickconnect', billingLimiter, authRequired, async (req, res) => {
  const { lat = null, lng = null, county = '', state = 'TN' } = req.body || {};
  if (!lat && !county && !req.body?.state) return err400(res, 'Provide lat/lng or county');
  try {
    const db = await getDb();
    const quote = await quickConnectQuote(db, req.user.id);
    const { bondsman, lawyer } = await pickQuickConnectContacts(db, { lat, lng, state });
    if (!bondsman && !lawyer) return res.status(404).json({ error: 'No bail bondsman or lawyer with a phone number was found near you.', code: 'none_found' });

    if (quote.amount_cents === 0) {
      await bookQuickConnect(db, req.user.id, { amountCents: 0, creditCents: quote.credit_cents, piId: null });
      return res.json({ success: true, charged: usd(0), credit_applied_cents: quote.credit_cents, breakdown: QC_BREAKDOWN, bondsman, lawyer });
    }

    const customerId = await getOrCreateStripeCustomer(req.user);
    const pi = await stripe.paymentIntents.create({
      amount:   quote.amount_cents,
      currency: 'usd',
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      description: 'Justice Gavel — Quick Connect Package ($10 Bondsman + $10 Lawyer)',
      metadata: {
        user_id:      String(req.user.id),
        package:      'quickconnect',
        bondsman_id:  String(bondsman?.id || ''),
        lawyer_id:    String(lawyer?.id || ''),
        credit_cents: String(quote.credit_cents),
        source:       'connections',
      },
    });
    res.json({ requires_payment: true, client_secret: pi.client_secret, payment_intent_id: pi.id, amount_cents: quote.amount_cents });
  } catch (e) {
    logger.error('[billing] quickconnect error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

router.post('/quickconnect/confirm', billingLimiter, authRequired, async (req, res) => {
  const piId = typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : '';
  if (!/^pi_[A-Za-z0-9_]+$/.test(piId)) return err400(res, 'payment_intent_id required');
  try {
    const pi = await stripe.paymentIntents.retrieve(piId).catch(e => {
      if (e?.code === 'resource_missing' || e?.statusCode === 404 || /No such payment_intent/i.test(String(e?.message))) return null;
      throw e;
    });
    const md = pi?.metadata || {};
    if (md.package !== 'quickconnect' || md.user_id !== String(req.user.id)) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment failed', code: 'payment_not_completed', status: pi.status });
    }
    const db = await getDb();
    const credit = Math.max(0, Number.parseInt(md.credit_cents, 10) || 0);
    await bookQuickConnect(db, req.user.id, { amountCents: pi.amount, creditCents: credit, piId });
    const { bondsman, lawyer } = await contactsById(db, Number(md.bondsman_id) || null, Number(md.lawyer_id) || null);
    res.json({ success: true, charged: usd(pi.amount), credit_applied_cents: credit, breakdown: QC_BREAKDOWN, bondsman, lawyer });
  } catch (e) {
    logger.error('[billing] quickconnect confirm error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

export default router;
