/**
 * billing/connections.js — Emergency family connection ($28.99) and Quick Connect ($20)
 * Part of the billing module. Mounted at /api/billing by billing/index.js
 */
import { logIgnored } from '../../utils/ignored.js';
import { stripe, LIVE, billingLimiter, getOrCreateStripeCustomer, stripeClient } from './_shared.js';
import { stripeConfigured } from '../../config.js';
import { err400, BUSINESS_CONSTANTS } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger             from '../../utils/logger.js';
import { calcStripeFee }  from '../../payments/stripe.js';
import { realArrestSql }  from '../../utils/arrestVisibility.js';
import { searchDirectory, formatLawyer, formatBailAgent } from '../../services/providerDirectory.js';
import { LAWYER_COLS, BAIL_COLS } from '../providers.js';
import { toE164 }         from '../../services/sms.js';
import { resolveLang, msg } from '../../i18n/index.js';

const router = Router();

// ── Family emergency connection — $28.99, one time ──────────────────────────
// For a family member of someone who was just arrested: 3 criminal-defense
// lawyers + 2 bail agents with a phone number, near the arrest (or the family
// member), revealed after a verified payment. Same flow as Quick Connect:
//
//   GET  /api/billing/family/quote     { price_cents, payments_live }  (public)
//   POST /api/billing/family/connect   { arrest_id?, family_name, family_phone, family_email?, lat?, lng?, state? }
//        → { requires_payment, client_secret, payment_intent_id, amount_cents } (contacts NOT returned yet)
//   POST /api/billing/family/confirm   { payment_intent_id } after the app's payment sheet succeeded:
//        checks the PaymentIntent with Stripe (this user, this package, succeeded), marks the
//        connection paid once and returns { arrest, attorneys, bail_agents }. Safe to repeat.
// Without a Stripe key every POST is 503 payments_unavailable (billing/index.js gate).
export const FAMILY_CONNECT_PRICE_CENTS = 2899;
const FC_LAWYERS = 3;
const FC_AGENTS = 2;
const say = (req, key, params) => msg(resolveLang(req), key, params);


/** Nearest listings with a phone: the family member's coordinates, else the arrest's / given state. */
async function pickFamilyContacts(db, { lat, lng, state }) {
  const vLat = lat != null && lat !== '' ? Number.parseFloat(lat) : NaN;
  const vLng = lng != null && lng !== '' ? Number.parseFloat(lng) : NaN;
  const near = Number.isFinite(vLat) && Number.isFinite(vLng) && Math.abs(vLat) <= 90 && Math.abs(vLng) <= 180;
  const st = /^[A-Za-z]{2}$/.test(String(state || '')) ? String(state).toUpperCase() : '';
  const opts = near ? { lat: vLat, lng: vLng, minResults: 10 } : st ? { state: st } : null;
  if (!opts) return { attorneys: [], bail_agents: [] };
  const lawyers = await db.all(`SELECT ${LAWYER_COLS} FROM lawyers l WHERE COALESCE(l.active, 1) = 1 AND l.phone IS NOT NULL AND l.phone <> ''`);
  const agents = await db.all(`SELECT ${BAIL_COLS} FROM bail_agents WHERE COALESCE(active, 1) = 1 AND phone IS NOT NULL AND phone <> ''`);
  const lw = searchDirectory(lawyers, opts).rows.slice(0, FC_LAWYERS);
  const ag = searchDirectory(agents, opts).rows.slice(0, FC_AGENTS);
  return { attorneys: lw.map(l => formatLawyer(l, Number.isFinite(l._dist) ? l._dist : null)), bail_agents: ag.map(a => formatBailAgent(a, Number.isFinite(a._dist) ? a._dist : null)) };
}

async function familyContactsByIds(db, lawyerIds, agentIds) {
  const load = async (table, cols, ids, fmt) => {
    if (!ids.length) return [];
    const key = table.endsWith(' l') ? 'l.id' : 'id';
    const rows = await db.all(`SELECT ${cols} FROM ${table} WHERE ${key} IN (${ids.map(() => '?').join(',')})`, ids);
    const byId = new Map(rows.map(r => [Number(r.id), r]));
    return ids.map(id => byId.get(id)).filter(Boolean).map(r => fmt(r));
  };
  return {
    attorneys: await load('lawyers l', LAWYER_COLS, lawyerIds, formatLawyer),
    bail_agents: await load('bail_agents', BAIL_COLS, agentIds, formatBailAgent),
  };
}
const idList = (s) => String(s || '').split(',').map(x => Number.parseInt(x, 10)).filter(n => Number.isSafeInteger(n) && n > 0);

async function arrestFor(db, arrestId) {
  if (!arrestId || !/^\d{1,15}$/.test(String(arrestId))) return null;
  // Paid path: sample/seed or taken-down rows are never attached to a purchase.
  return db.get(`SELECT id, name, booking_date, charges, bail_amount, county, state, jail_location FROM arrest_records
                  WHERE id = ? AND ${realArrestSql()} LIMIT 1`, [Number(arrestId)]).catch(() => null);
}

router.get('/family/quote', (req, res) => {
  res.json({ price_cents: FAMILY_CONNECT_PRICE_CENTS, lawyers: FC_LAWYERS, bail_agents: FC_AGENTS, payments_live: stripeConfigured() });
});

router.post('/family/connect', billingLimiter, authRequired, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const familyName = String(b.family_name || '').trim().slice(0, 120);
  const familyPhone = toE164(b.family_phone);
  const familyEmail = String(b.family_email || '').trim().toLowerCase().slice(0, 254) || null;
  if (!familyName) return res.status(400).json({ error: say(req, 'family.err.name_required') });
  if (!familyPhone) return res.status(400).json({ error: say(req, 'family.err.phone_required') });
  if (familyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(familyEmail)) return res.status(400).json({ error: say(req, 'family.err.bad_email') });
  try {
    const db = await getDb();
    const arrest = await arrestFor(db, b.arrest_id);
    const { attorneys, bail_agents: agents } = await pickFamilyContacts(db, { lat: b.lat, lng: b.lng, state: arrest?.state || b.state });
    if (!attorneys.length && !agents.length) return res.status(404).json({ error: say(req, 'family.err.none_found'), code: 'none_found' });
    const customerId = await getOrCreateStripeCustomer(req.user);
    const pi = await stripeClient().paymentIntents.create({
      amount: FAMILY_CONNECT_PRICE_CENTS,
      currency: 'usd',
      customer: customerId || undefined,
      automatic_payment_methods: { enabled: true },
      description: 'Justice Gavel — Emergency family connection',
      metadata: {
        user_id: String(req.user.id), package: 'family_connect', arrest_id: String(arrest?.id || ''),
        lawyer_ids: attorneys.map(a => a.id).join(','), agent_ids: agents.map(a => a.id).join(','), source: 'connections',
      },
    });
    await db.run(
      `INSERT INTO family_connections (arrest_id, family_name, family_phone, family_email, status, attorneys_sent, agents_sent, stripe_pi_id, amount_cents)
       VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?)`,
      [arrest?.id || null, familyName, familyPhone, familyEmail, JSON.stringify(attorneys.map(a => a.id)),
        JSON.stringify(agents.map(a => a.id)), pi.id, FAMILY_CONNECT_PRICE_CENTS]);
    res.json({ requires_payment: true, client_secret: pi.client_secret, payment_intent_id: pi.id, amount_cents: FAMILY_CONNECT_PRICE_CENTS });
  } catch (e) {
    logger.error('[billing] family connect error:', e.message);
    res.status(500).json({ error: say(req, 'family.err.server') });
  }
});

router.post('/family/confirm', billingLimiter, authRequired, async (req, res) => {
  const piId = typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : '';
  if (!/^pi_[A-Za-z0-9_]+$/.test(piId)) return res.status(400).json({ error: say(req, 'family.err.payment_required') });
  try {
    const pi = await stripeClient().paymentIntents.retrieve(piId).catch(e => {
      if (e?.code === 'resource_missing' || e?.statusCode === 404 || /No such payment_intent/i.test(String(e?.message))) return null;
      throw e;
    });
    const md = pi?.metadata || {};
    if (md.package !== 'family_connect' || md.user_id !== String(req.user.id)) {
      return res.status(404).json({ error: say(req, 'family.err.payment_not_found') });
    }
    if (pi.status !== 'succeeded') {
      return res.status(402).json({ error: say(req, 'family.err.not_paid'), code: 'payment_not_completed', status: pi.status });
    }
    const db = await getDb();
    const conn = await db.get('SELECT id, status FROM family_connections WHERE stripe_pi_id = ? ORDER BY id LIMIT 1', [piId]);
    if (conn && conn.status !== 'paid') {
      await db.run(`UPDATE family_connections SET status = 'paid', updated_at = NOW() WHERE id = ?`, [conn.id]);
    }
    const seen = await db.get('SELECT id FROM revenue_log WHERE stripe_pi_id = ? LIMIT 1', [piId]).catch(() => null);
    if (!seen) {
      await db.run(
        `INSERT INTO revenue_log (source, recipient_type, gross_cents, stripe_fee_cents, net_cents, stripe_pi_id)
         VALUES ('family_connect', 'user', ?, ?, ?, ?)`,
        [pi.amount, calcStripeFee(pi.amount), pi.amount - calcStripeFee(pi.amount), piId]
      ).catch(e => logger.error('[billing/family] revenue_log insert failed — PI:', piId, e?.message));
    }
    const contacts = await familyContactsByIds(db, idList(md.lawyer_ids), idList(md.agent_ids));
    res.json({ success: true, connection_id: conn ? Number(conn.id) : null, charged_cents: pi.amount,
      arrest: await arrestFor(db, md.arrest_id), ...contacts });
  } catch (e) {
    logger.error('[billing] family confirm error:', e.message);
    res.status(500).json({ error: say(req, 'family.err.server') });
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
