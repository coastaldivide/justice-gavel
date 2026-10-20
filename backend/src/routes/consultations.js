/**
 * consultations.js — booking a consultation with a lawyer who is on Justice Gavel
 *
 *   GET  /api/consultations/pricing             platform fee per duration (the only prices shown or charged)
 *   GET  /api/consultations/slots/:lawyerId     bookable slots in the lawyer's zone (+ starts_at instants)
 *   GET  /api/consultations/prefill             notes suggested from the person's open case
 *   GET  /api/consultations                     the person's bookings
 *   POST /api/consultations/book                hold a slot + create the PaymentIntent (status pending_payment)
 *   POST /api/consultations/:id/confirm         after the payment sheet: checks the PaymentIntent, confirms,
 *                                               notifies the attorney (safe to repeat)
 *   POST /api/consultations/:id/cancel          cancel; full refund more than REFUND_CUTOFF_HOURS before the start
 *   POST /api/consultations/callback-request    ask a lawyer on the app to call back
 *
 * Only listings linked to a Justice Gavel account (lawyers.user_id or
 * attorney_profiles.lawyer_id) can be booked or messaged: anyone else would
 * never see the booking. For them the app offers the listing's phone instead.
 * Without a Stripe key /book answers 503 payments_unavailable.
 */
import { truncateStr, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import Stripe from 'stripe';
import logger from '../utils/logger.js';
import { sendPushToUser } from '../services/pushDelivery.js';
import { sendBookingConfirmation, sendAttorneyBookingAlert } from '../services/email.js';
import { validate, schemas } from '../validation/schemas.js';
import { PAYMENTS_UNAVAILABLE, stripeConfigured } from '../config.js';
import { resolveLang, msg, userLang, LOCALES } from '../i18n/index.js';
import {
  FEE_BY_DURATION, REFUND_CUTOFF_HOURS, PENDING_HOLD_MINUTES, pricing, usd,
  generateSlots, findSlot, lawyerTimeZone,
} from '../services/consultationSlots.js';

const slotsLimiter  = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Too many slot requests.' });
const listLimiter   = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many list requests.' });
const consultationsLimiter = makeUserLimiter({ windowMs: 3600000, max: 5, message: 'Consultation booking limit reached. Try again later.' });
const confirmLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many requests.' });

const router = Router();
let _stripe = null;
const stripe = () => {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET, { timeout: 20_000, maxNetworkRetries: 2 });
  return _stripe;
};

const BOOKING_COLS = `id, user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot, starts_at, time_zone,
  duration_min, platform_fee_cents, notes, status, created_at`;
const err = (res, status, lang, key, code, extra = {}) => res.status(status).json({ error: msg(lang, key), code, ...extra });

/** The listing + its linked account (null when the lawyer is not on Justice Gavel). */
function lawyerWithAccount(db, lawyerId) {
  return db.get(
    `SELECT l.id, l.name, l.phone, l.state,
            COALESCE(l.user_id, ap.user_id) AS account_id, ap.availability_schedule
       FROM lawyers l LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
      WHERE l.id = ? AND COALESCE(l.active, 1) = 1`, [lawyerId]);
}

/** Slots already taken: confirmed bookings, and payments still in progress (held briefly). */
async function bookedSet(db, lawyerId) {
  const rows = await db.all(
    `SELECT date_slot, time_slot FROM consultation_bookings
      WHERE lawyer_id = ? AND date_slot >= CURRENT_DATE - 1
        AND (status = 'confirmed' OR (status = 'pending_payment' AND created_at > NOW() - INTERVAL '${PENDING_HOLD_MINUTES} minutes'))
      LIMIT 2000`, [lawyerId]);
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  return new Set(rows.map(b => `${iso(b.date_slot)}|${b.time_slot}`));
}

/** "Tuesday, October 20 at 9:00 AM CDT" in the lawyer's zone and `lang`. */
function slotLabel(startsAt, timeZone, lang) {
  const d = new Date(startsAt);
  const loc = LOCALES[lang] || 'en-US';
  return `${d.toLocaleDateString(loc, { timeZone, weekday: 'long', month: 'long', day: 'numeric' })} · ${d.toLocaleTimeString(loc, { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
}

const shapeBooking = (b) => b && ({
  ...b,
  id: Number(b.id),
  date_slot: b.date_slot instanceof Date ? b.date_slot.toISOString().slice(0, 10) : b.date_slot,
  starts_at: b.starts_at ? new Date(b.starts_at).toISOString() : null,
  duration_min: Number(b.duration_min),
  platform_fee_cents: b.platform_fee_cents == null ? null : Number(b.platform_fee_cents),
  fee_display: b.platform_fee_cents == null ? null : usd(Number(b.platform_fee_cents)),
});

// ── GET /pricing ──────────────────────────────────────────────────────────────
router.get('/pricing', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ prices: pricing(), refund_cutoff_hours: REFUND_CUTOFF_HOURS, payments_live: stripeConfigured() });
});

// ── GET /prefill ──────────────────────────────────────────────────────────────
router.get('/prefill', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const cas = await db.get(
      `SELECT id, title, charge_description, next_court_date FROM cases
        WHERE user_id = ? AND deleted_at IS NULL AND status NOT IN ('closed','archived','Closed')
        ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
    const parts = cas ? [msg(lang, 'consult.prefill.case', { title: cas.title })] : [];
    if (cas?.charge_description) parts.push(msg(lang, 'consult.prefill.charge', { charge: cas.charge_description }));
    if (cas?.next_court_date) parts.push(msg(lang, 'consult.prefill.court', { date: String(cas.next_court_date).slice(0, 10) }));
    res.json({ case_id: cas?.id || null, case_title: cas?.title || null, suggested_notes: parts.length ? parts.join(' ') : null });
  } catch (e) {
    logger.warn('[consultations/prefill]', e?.message);
    res.json({ case_id: null, case_title: null, suggested_notes: null });
  }
});

// ── GET /slots/:lawyerId ──────────────────────────────────────────────────────
router.get('/slots/:lawyerId', slotsLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const lawyerId = safeInt(req.params.lawyerId);
  if (!lawyerId || lawyerId <= 0) return err(res, 400, lang, 'consult.err.bad_lawyer', 'bad_id');
  try {
    const db = await getDb();
    const lawyer = await lawyerWithAccount(db, lawyerId);
    if (!lawyer) return err(res, 404, lang, 'consult.err.lawyer_not_found', 'not_found');
    const base = { lawyer_id: lawyerId, lawyer_name: lawyer.name, lawyer_phone: lawyer.phone || null, prices: pricing(), refund_cutoff_hours: REFUND_CUTOFF_HOURS };
    if (!lawyer.account_id) {
      return res.json({ ...base, bookable: false, reason: 'not_on_app', message: msg(lang, 'consult.not_on_app'), time_zone: lawyerTimeZone(lawyer.state), slots: [] });
    }
    const slots = generateSlots({ timeZone: lawyerTimeZone(lawyer.state), schedule: lawyer.availability_schedule, booked: await bookedSet(db, lawyerId) });
    res.json({ ...base, bookable: true, time_zone: slots.time_zone, slots: slots.days });
  } catch (e) {
    logger.error('[consultations/slots]', e?.message);
    err(res, 500, lang, 'consult.err.server', 'server_error');
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', authRequired, listLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const page   = Math.max(0, safeInt(req.query.page, 0) || 0);
  const pgSize = Math.min(100, Math.max(1, safeInt(req.query.limit, 50) || 50));
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT ${BOOKING_COLS} FROM consultation_bookings WHERE user_id=?
        ORDER BY COALESCE(starts_at, date_slot::timestamptz) DESC LIMIT ? OFFSET ?`,
      [req.user.id, pgSize, page * pgSize]);
    res.json({ consultations: rows.map(shapeBooking), page, pageSize: pgSize, hasMore: rows.length === pgSize });
  } catch (e) {
    logger.error('[consultations/list]', e?.message);
    err(res, 500, lang, 'consult.err.server', 'server_error');
  }
});

// ── POST /book ────────────────────────────────────────────────────────────────
router.post('/book', authRequired, validate(schemas.consultations.book), consultationsLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const { lawyer_id, date_slot, time_slot, duration_min, notes = '' } = req.body;
  const feeCents = FEE_BY_DURATION[duration_min];
  try {
    const db = await getDb();
    const lawyer = await lawyerWithAccount(db, lawyer_id);
    if (!lawyer) return err(res, 404, lang, 'consult.err.lawyer_not_found', 'not_found');
    if (!lawyer.account_id) return err(res, 409, lang, 'consult.not_on_app', 'not_on_app');
    const tz = lawyerTimeZone(lawyer.state);
    const booked = await bookedSet(db, lawyer_id);
    const slots = generateSlots({ timeZone: tz, schedule: lawyer.availability_schedule, booked });
    const slot = findSlot(slots, date_slot, time_slot);
    if (!slot) return err(res, 400, lang, 'consult.err.bad_slot', 'bad_slot');
    if (!slot.available) return err(res, 409, lang, 'consult.err.slot_taken', 'slot_taken');
    const mine = await db.get(
      `SELECT id FROM consultation_bookings WHERE user_id = ? AND starts_at = ?
          AND (status = 'confirmed' OR (status = 'pending_payment' AND created_at > NOW() - INTERVAL '${PENDING_HOLD_MINUTES} minutes'))`,
      [req.user.id, slot.starts_at]);
    if (mine) return err(res, 409, lang, 'consult.err.you_have_one', 'already_booked');

    // Booking charges a platform fee — unavailable until Stripe is configured.
    if (!stripeConfigured()) return res.status(503).json({ ...PAYMENTS_UNAVAILABLE, message: msg(lang, 'payments.unavailable') });

    const safeNotes = notes ? truncateStr(sanitizeStr(String(notes), 2000), 2000).trim() : '';
    const ins = await db.run(
      `INSERT INTO consultation_bookings
         (user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot, starts_at, time_zone,
          duration_min, platform_fee_cents, notes, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending_payment')`,
      [req.user.id, lawyer.id, lawyer.name, lawyer.phone || null, date_slot, slot.time, slot.starts_at, tz,
       duration_min, feeCents, safeNotes]);
    const bookingId = ins.lastID;
    let pi;
    try {
      pi = await stripe().paymentIntents.create({
        amount: feeCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: { type: 'consultation_booking', user_id: String(req.user.id), booking_id: String(bookingId), lawyer_id: String(lawyer.id) },
        description: `Justice Gavel — consultation booking #${bookingId}`,
      }, { idempotencyKey: `consult_${req.user.id}_${bookingId}` });
    } catch (e) {
      await db.run(`UPDATE consultation_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?`, [bookingId]);
      logger.error('[consultations/book] PaymentIntent failed', e?.message);
      return err(res, 502, lang, 'consult.err.payment_setup', 'payment_setup_failed');
    }
    await db.run('UPDATE consultation_bookings SET stripe_pi_id = ? WHERE id = ?', [pi.id, bookingId]);
    const booking = await db.get(`SELECT ${BOOKING_COLS} FROM consultation_bookings WHERE id = ?`, [bookingId]);
    res.status(201).json({
      booking: shapeBooking(booking),
      requires_payment: true,
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      fee_display: usd(feeCents),
    });
  } catch (e) {
    logger.error('[consultations/book]', e?.message);
    err(res, 500, lang, 'consult.err.server', 'server_error');
  }
});

/** Push + e-mail to the attorney's account, and the confirmation e-mail to the client. */
async function notifyConfirmed(db, booking, lawyer, client) {
  const attyLang = await userLang(db, lawyer.account_id);
  const atty = await db.get('SELECT id, display_name, email FROM users WHERE id = ?', [lawyer.account_id]).catch(() => null);
  if (atty) {
    await sendPushToUser(atty.id, {
      title: msg(attyLang, 'consult.push.booked_title'),
      body: msg(attyLang, 'consult.push.booked_body', { name: client.display_name || msg(attyLang, 'consult.a_client'), minutes: booking.duration_min, when: slotLabel(booking.starts_at, booking.time_zone, attyLang) }),
      data: { screen: 'AttorneyInbox', booking_id: booking.id },
      channelId: 'attorney_bookings',
    }).catch(e => logger.warn('[consultations] attorney push failed', e?.message));
    if (atty.email) {
      sendAttorneyBookingAlert({
        to: atty.email, attorneyName: atty.display_name || 'Attorney', clientName: client.display_name || 'Client',
        dateSlot: booking.date_slot, timeSlot: slotLabel(booking.starts_at, booking.time_zone, 'en'),
        durationMin: booking.duration_min, caseTitle: null,
        clientEmail: client.email || null, clientPhone: client.phone || null, meetingLink: null,
      }).catch(e => logger.warn('[email] attorney alert failed:', e?.message));
    }
  }
  if (client.email) {
    sendBookingConfirmation({
      to: client.email, clientName: client.display_name || 'Client', attorneyName: booking.lawyer_name,
      dateSlot: booking.date_slot, timeSlot: slotLabel(booking.starts_at, booking.time_zone, 'en'),
      durationMin: booking.duration_min, feeDollars: (Number(booking.platform_fee_cents) / 100).toFixed(2),
      meetingLink: null, cancellationUrl: null,
    }).catch(e => logger.warn('[email] booking confirmation failed:', e?.message));
  }
}

// ── POST /:id/confirm ─────────────────────────────────────────────────────────
router.post('/:id/confirm', authRequired, confirmLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const id = safeInt(req.params.id);
  if (!id || id <= 0) return err(res, 400, lang, 'consult.err.bad_booking', 'bad_id');
  if (!stripeConfigured()) return res.status(503).json({ ...PAYMENTS_UNAVAILABLE, message: msg(lang, 'payments.unavailable') });
  try {
    const db = await getDb();
    const booking = await db.get(`SELECT ${BOOKING_COLS}, stripe_pi_id FROM consultation_bookings WHERE id = ? AND user_id = ?`, [id, req.user.id]);
    if (!booking) return err(res, 404, lang, 'consult.err.booking_not_found', 'not_found');
    if (booking.status === 'confirmed') return res.json({ booking: shapeBooking(booking), already_confirmed: true });
    if (booking.status !== 'pending_payment' || !booking.stripe_pi_id) return err(res, 409, lang, 'consult.err.not_pending', 'not_pending');
    const pi = await stripe().paymentIntents.retrieve(booking.stripe_pi_id);
    const md = pi?.metadata || {};
    if (md.type !== 'consultation_booking' || md.booking_id !== String(id) || md.user_id !== String(req.user.id)) {
      return err(res, 404, lang, 'consult.err.booking_not_found', 'not_found');
    }
    if (pi.status !== 'succeeded') return err(res, 402, lang, 'consult.err.not_paid', 'payment_not_completed', { status: pi.status });
    const upd = await db.run(`UPDATE consultation_bookings SET status = 'confirmed', confirmed_at = NOW() WHERE id = ? AND status = 'pending_payment'`, [id]);
    const fresh = await db.get(`SELECT ${BOOKING_COLS} FROM consultation_bookings WHERE id = ?`, [id]);
    if (upd.changes) {
      const lawyer = await lawyerWithAccount(db, booking.lawyer_id);
      const client = await db.get('SELECT id, display_name, email, phone FROM users WHERE id = ?', [req.user.id]);
      if (lawyer?.account_id) notifyConfirmed(db, shapeBooking(fresh), lawyer, client || {}).catch(e => logger.warn('[consultations] notify failed', e?.message));
    }
    res.json({ booking: shapeBooking(fresh), message: msg(lang, 'consult.confirmed') });
  } catch (e) {
    logger.error('[consultations/confirm]', e?.message);
    err(res, 500, lang, 'consult.err.server', 'server_error');
  }
});

// ── POST /:id/cancel ──────────────────────────────────────────────────────────
router.post('/:id/cancel', authRequired, consultationsLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const id = safeInt(req.params.id);
  if (!id || id <= 0) return err(res, 400, lang, 'consult.err.bad_booking', 'bad_id');
  try {
    const db = await getDb();
    const booking = await db.get(
      `SELECT ${BOOKING_COLS}, stripe_pi_id FROM consultation_bookings WHERE id=? AND user_id=?`, [id, req.user.id]);
    if (!booking) return err(res, 404, lang, 'consult.err.booking_not_found', 'not_found');
    if (booking.status === 'cancelled') return err(res, 409, lang, 'consult.err.already_cancelled', 'already_cancelled');

    let refundId = null;
    let refundKey = 'consult.refund.none';
    if (booking.status === 'confirmed' && booking.stripe_pi_id && stripeConfigured()) {
      const startMs = booking.starts_at ? new Date(booking.starts_at).getTime() : NaN;
      const hoursUntil = (startMs - Date.now()) / 3_600_000;
      if (Number.isFinite(hoursUntil) && hoursUntil > REFUND_CUTOFF_HOURS) {
        try {
          const refund = await stripe().refunds.create({
            payment_intent: booking.stripe_pi_id, reason: 'requested_by_customer',
            metadata: { booking_id: String(booking.id), cancelled_by: String(req.user.id) },
          }, { idempotencyKey: `consult_refund_${booking.id}` });
          refundId = refund.id;
          refundKey = 'consult.refund.full';
        } catch (refundErr) {
          logger.warn('[consultations/cancel] Stripe refund failed', refundErr?.message);
          refundKey = 'consult.refund.manual';
        }
      } else {
        refundKey = 'consult.refund.too_late';
      }
    }
    await db.run(`UPDATE consultation_bookings SET status = 'cancelled', cancelled_at = NOW(), refund_id = ? WHERE id = ?`, [refundId, id]);
    res.json({ success: true, message: msg(lang, 'consult.cancelled'), refund: msg(lang, refundKey, { fee: usd(Number(booking.platform_fee_cents) || 0), hours: REFUND_CUTOFF_HOURS }), refund_id: refundId });
  } catch (e) {
    logger.error('[consultations/cancel]', e?.message);
    if (!res.headersSent) err(res, 500, lang, 'consult.err.server', 'server_error');
  }
});

// ── POST /callback-request ────────────────────────────────────────────────────
// Only for a lawyer on the app: their account gets the request (push + inbox).
// The person's phone / e-mail goes to that one attorney, because they asked for a call.
router.post('/callback-request', authRequired, consultationsLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const lawyerId = safeInt(req.body?.lawyer_id);
  const contact = typeof req.body?.phone === 'string' ? sanitizeStr(req.body.phone, 120).trim() : '';
  const notes = req.body?.notes ? truncateStr(sanitizeStr(String(req.body.notes), 2000), 2000).trim() : '';
  const duration = [15, 30, 60].includes(Number(req.body?.duration_min)) ? Number(req.body.duration_min) : 30;
  if (!lawyerId || lawyerId <= 0) return err(res, 400, lang, 'consult.err.bad_lawyer', 'bad_id');
  const digits = contact.replace(/\D/g, '');
  if (!(contact.includes('@') && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) && !(digits.length >= 10 && digits.length <= 15)) {
    return err(res, 400, lang, 'consult.err.bad_contact', 'bad_contact');
  }
  try {
    const db = await getDb();
    const lawyer = await lawyerWithAccount(db, lawyerId);
    if (!lawyer) return err(res, 404, lang, 'consult.err.lawyer_not_found', 'not_found');
    if (!lawyer.account_id) return err(res, 409, lang, 'consult.not_on_app', 'not_on_app');
    const ins = await db.run(
      `INSERT INTO callback_requests (user_id, lawyer_id, phone, notes, duration_min) VALUES (?,?,?,?,?)`,
      [req.user.id, lawyerId, contact, notes, duration]);
    const attyLang = await userLang(db, lawyer.account_id);
    const caller = await db.get('SELECT display_name FROM users WHERE id = ?', [req.user.id]).catch(() => null);
    await sendPushToUser(lawyer.account_id, {
      title: msg(attyLang, 'consult.push.callback_title', { name: caller?.display_name || msg(attyLang, 'consult.a_client') }),
      body: notes ? notes.slice(0, 80) + (notes.length > 80 ? '…' : '') : msg(attyLang, 'consult.push.callback_body'),
      data: { screen: 'AttorneyInbox', callback_id: ins.lastID },
      channelId: 'attorney_bookings',
    }).catch(e => logger.warn('[consultations] callback push failed', e?.message));
    res.status(201).json({ ok: true, id: ins.lastID, message: msg(lang, 'consult.callback_sent', { name: lawyer.name }) });
  } catch (e) {
    logger.error('[consultations/callback-request]', e?.message);
    err(res, 500, lang, 'consult.err.callback_failed', 'server_error');
  }
});

export default router;
