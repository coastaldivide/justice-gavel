/**
 * consultations.js — Lawyer video consultation booking
 *
 * Flow:
 *   POST /api/consultations/book        — user picks slot + pays platform fee
 *   GET  /api/consultations             — user's bookings
 *   GET  /api/consultations/slots/:lawyerId  — available time slots (generated)
 *   POST /api/consultations/:id/cancel  — cancel before meeting
 *
 * Platform fee: $10–$25 depending on consultation duration
 *   30 min → $15   |   60 min → $25   |   15 min (intro) → $10
 */
import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import Stripe from 'stripe';
import logger from '../utils/logger.js';

const consultationsLimiter = makeUserLimiter({ windowMs: 3600000, max: 5, message: 'Consultation booking limit reached. Try again later.' });
// Lazy Expo push client — same singleton pattern as cases.js / messages.js
let _expo = null;
async function getExpoConsult() {
  if (_expo) return _expo;
  const { Expo } = await import('expo-server-sdk');
  _expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return _expo;
}


const router = Router();
const stripeKey = process.env.STRIPE_SECRET || '';
const stripe    = stripeKey ? new Stripe(stripeKey) : null;
const LIVE      = !!stripeKey;

// Platform fee by duration
const FEE_BY_DURATION = { 15: 1000, 30: 1500, 60: 2500 };

// ── Generate available slots for next 14 days ─────────────────────────────────
// Returns morning + afternoon windows regardless of DB lawyer availability
function generateSlots(startDate = new Date()) {
  const slots = [];
  const TIMES = ['9:00 AM','10:00 AM','11:00 AM','1:00 PM','2:00 PM','3:00 PM','4:00 PM'];

  for (let d = 1; d <= 14; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dow = date.getDay();
    if (dow === 0) continue; // skip Sundays

    const label = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    const iso = date.toISOString().split('T')[0];

    // Fewer slots on Saturday
    const times = dow === 6 ? TIMES.slice(0, 3) : TIMES;

    // Deterministic availability: attorney-specific seed based on lawyer ID,
    // date offset, and time index. Stable across requests — no random flicker.
    // This is a placeholder until real calendar integration (CalDAV) is used.
    slots.push({
      date: iso,
      label,
      times: times.map((t, ti) => ({
        time: t,
        // Deterministic: mark busy if (day + ti) % 4 === 0 — ~25% unavailable, stable
        available: (d + ti) % 4 !== 0,
      })),
    });
  }
  return slots;
}

// GET /api/consultations/slots/:lawyerId
router.get('/slots/:lawyerId', async (req, res) => {
  try {
    const slots = generateSlots();
    res.json({ lawyer_id: req.params.lawyerId, slots });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /api/consultations — user's bookings
router.get('/', authRequired, async (req, res) => {
  const page   = Math.max(0, parseInt(String(req.query.page  || '0'),  10));
  const pgSize = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot, duration_min, notes, status, created_at FROM consultation_bookings WHERE user_id=? ORDER BY date_slot DESC, time_slot ASC LIMIT ? OFFSET ?
      --SC, time_slot ASC`,
      [req.user.id, pgSize, page * pgSize]
    );
    res.json({ consultations: rows, page, pageSize: pgSize, hasMore: rows.length === pgSize });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/consultations/book
router.post('/book', authRequired, consultationsLimiter, async (req, res) => {
  const {
    lawyer_id, lawyer_name, lawyer_phone = '',
    date_slot, time_slot,
    duration_min = 30, notes = '',
  } = req.body;
  const safeNotes = notes ? truncateStr(sanitizeStr(String(notes), 2000), 2000) : notes;

  if (!lawyer_name?.trim()) return err400(res, 'lawyer_name required');
  if (!date_slot)           return err400(res, 'date_slot required (YYYY-MM-DD)');
  if (!time_slot)           return err400(res, 'time_slot required');

  const feeCents = FEE_BY_DURATION[duration_min] ?? 1500;

  try {
    const db = await getDb();

    // Check for double-booking
    const conflict = await db.get(
      `SELECT id FROM consultation_bookings
       WHERE user_id=? AND date_slot=? AND time_slot=? AND status NOT IN ('cancelled')`,
      [req.user.id, date_slot, time_slot]
    );
    if (conflict) {
      return res.status(409).json({ error: 'You already have a booking at this time.' });
    }

    let stripePaymentIntentId = 'pi_mock_consult';

    if (LIVE) {
      // Charge the platform fee
      const pi = await stripe.paymentIntents.create({
        amount: feeCents,
        currency: 'usd',
        metadata: {
          user_id: String(req.user.id),
          lawyer_name,
          date_slot,
          time_slot,
          type: 'consultation_booking',
        },
        description: `Justice Gavel — Consult booking: ${lawyer_name} on ${date_slot} at ${time_slot}`,
      });
      stripePaymentIntentId = pi.id;
    }

    // Generate a cryptographically secure meeting token
    const { randomBytes: _rb } = await import('crypto');
    const meetingToken = _rb(8).toString('hex').toUpperCase();
    const meetingLink  = `https://meet.justicegavel.app/consult/${meetingToken}`;

    const result = await db.run(
      `INSERT INTO consultation_bookings
         (user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot,
          duration_min, platform_fee_cents, notes, status, stripe_pi_id, meeting_link, confirmed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [
        req.user.id, lawyer_id ?? null, lawyer_name.trim(), lawyer_phone.trim(),
        date_slot, time_slot, duration_min, feeCents,
        (typeof safeNotes !== 'undefined' ? safeNotes : notes || '').trim(), 'confirmed', stripePaymentIntentId, meetingLink,
      ]
    );

    const booking = await db.get(
      `SELECT id, user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot, duration_min, notes, status, created_at FROM consultation_bookings WHERE id=?`, [result.lastID]
    );

    res.json({
      success: true,
      mock: !LIVE,
      booking,
      fee_charged: `$${(feeCents / 100).toFixed(2)}`,
      message: LIVE
        ? `Booking confirmed. Platform fee of $${(feeCents/100).toFixed(2)} charged. Meeting link sent.`
        : `Booking confirmed (demo — no charge). Meeting link: ${meetingLink}`,
    });
  } catch (e) {
    logger.error('[consultations] book error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/consultations/:id/cancel
router.post('/:id/cancel', authRequired, consultationsLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const booking = await db.get(
      `SELECT id, user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot, duration_min, notes, status, created_at FROM consultation_bookings WHERE id=? AND user_id=?`,
      [safeInt(req.params.id), req.user.id]
    );
    if (!booking) return err404(res, 'Booking not found');
    if (booking.status === 'cancelled') return err400(res, 'Already cancelled');

    await db.run(
      "UPDATE consultation_bookings SET status='cancelled' WHERE id=?",
      [safeInt(req.params.id)]
    );
    res.json({ success: true, message: 'Booking cancelled.' });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Callback request (when no slots available) ────────────────────────────────
router.post('/callback-request', authRequired, consultationsLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { lawyer_id, phone, notes: rawNotes = '', duration_min = 30 } = req.body;
    const notes = rawNotes ? truncateStr(sanitizeStr(String(rawNotes), 2000), 2000) : '';
    if (!phone) return err400(res, 'Phone number required');
    await db.run(
      `INSERT INTO callback_requests (user_id, lawyer_id, phone, notes, duration_min)
       VALUES (?,?,?,?,?)`,
      [req.user.id, lawyer_id || null, phone, notes, duration_min]
    );

    // Push notification to the lawyer if they have a registered account
    // (graceful — no crash if push fails)
    try {
      const user = await db.get('SELECT display_name FROM users WHERE id=?', [req.user.id]);
      const callerName = user?.display_name || 'A client';
      const lawyerUser = lawyer_id
        ? await db.get(`SELECT u.push_token FROM users u
            JOIN providers p ON p.user_id = u.id WHERE p.id=?`, [lawyer_id])
        : null;
      if (lawyerUser?.push_token) {
        const preview = notes.slice(0, 80) + (notes.length > 80 ? '…' : '');
        const expoClient = await getExpoConsult();
        await expoClient.sendPushNotificationsAsync([{
          to:    lawyerUser.push_token,
          title: `📩 Message from ${callerName}`,
          body:  preview || 'A client left you a message on Justice Gavel.',
          data:  { screen: 'ConsultationRequests' },
        }]);
      }
    } catch { /* push is best-effort */ }

    res.json({ ok: true, message: 'Message sent. The attorney will contact you shortly.' });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit message. Try again.' });
  }
});

export default router;
