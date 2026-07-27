import { getAvailableSlots, createSchedulingLink } from '../services/calendly.js';
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
import { sendPushToUser } from '../services/pushDelivery.js';
import { sendBookingConfirmation, sendAttorneyBookingAlert } from '../services/email.js';

const slotsLimiter  = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Too many slot requests.' });
const listLimiter   = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many list requests.' });
const consultationsLimiter = makeUserLimiter({ windowMs: 3600000, max: 5, message: 'Consultation booking limit reached. Try again later.' });
// Lazy Expo push client — same singleton pattern as cases.js / messages.js
let _expo = null;
async function getExpoConsult() {
  if (_expo) return _expo;
  const { Expo } = await import('expo-server-sdk');
  _expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return _expo;
}



// ── Parse "9:00 AM" → "09:00:00" for Date constructor ─────────────────────
function _parseTime(slot) {
  if (!slot) return '00:00:00';
  const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return '00:00:00';
  let h = parseInt(m[1], 10);
  const mins = m[2];
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${mins}:00`;
}

const router = Router();
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
const stripe    = stripeKey ? new Stripe(stripeKey) : null;
const LIVE      = !!stripeKey;

// Platform fee by duration
const FEE_BY_DURATION = { 15: 1000, 30: 1500, 60: 2500 };

// ── Generate available slots using attorney's stored schedule ─────────────────
// Reads attorney_profiles.availability_schedule (JSON) instead of generating
// the same 7 slots for every attorney. Falls back to Mon-Fri 9AM-5PM if
// no schedule is stored. Existing bookings are excluded by the GET handler.
function generateSlots(startDate = new Date(), schedule = null) {
  const slots   = [];
  const DAY_MAP = { 0:'sun',1:'mon',2:'tue',3:'wed',4:'thu',5:'fri',6:'sat' };
  const SLOT_TIMES = {
    morning:   ['9:00 AM','10:00 AM','11:00 AM'],
    afternoon: ['1:00 PM','2:00 PM','3:00 PM','4:00 PM'],
    evening:   ['5:00 PM','6:00 PM'],
  };
  // Default schedule: Mon-Fri, morning + afternoon
  const defaultSchedule = {
    mon:['morning','afternoon'], tue:['morning','afternoon'],
    wed:['morning','afternoon'], thu:['morning','afternoon'],
    fri:['morning','afternoon'],
  };
  const sched = schedule || defaultSchedule;

  for (let d = 1; d <= 14; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dow     = date.getDay();
    const dayKey  = DAY_MAP[dow];
    const daySlots = sched[dayKey] || [];
    if (!daySlots.length) continue; // attorney not available this day

    const label = date.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    });
    const iso = date.toISOString().slice(0, 10);

    for (const slotName of daySlots) {
      for (const time of (SLOT_TIMES[slotName] || [])) {
        slots.push({ date: iso, time, label, dayKey });
      }
    }
  }
  return slots;
}



// GET /api/consultations/slots/:lawyerId

// ── GET /consultations/prefill — return case data to pre-fill booking form ────
// Saves the defendant from re-typing their situation at booking time.
// Returns most recent active case: charge, state, preferred language.
router.get('/prefill', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const cas = await db.get(
      `SELECT c.id, c.title, c.status, c.state, c.charge_description,
              c.bail_amount, c.next_court_date,
              u.display_name AS client_name, u.phone AS client_phone
         FROM cases c
         JOIN users u ON u.id = c.user_id
        WHERE c.user_id = ?
          AND c.status NOT IN ('closed','archived')
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [req.user.id]
    );
    res.json({
      case_id:         cas?.id           || null,
      case_title:      cas?.title        || null,
      charge:          cas?.charge_description || null,
      state:           cas?.state        || null,
      bail_amount:     cas?.bail_amount  || null,
      next_court_date: cas?.next_court_date || null,
      client_name:     req.user.display_name || null,
      client_phone:    req.user.phone    || null,
      suggested_notes: cas
        ? `Case: ${cas.title}${cas.charge_description ? '. Charge: ' + cas.charge_description : ''}${cas.next_court_date ? '. Next court date: ' + cas.next_court_date : ''}.`
        : null,
    });
  } catch (e) {
    res.json({ case_id: null, suggested_notes: null });
  }
});

router.get('/slots/:lawyerId', slotsLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const lawyerId = req.params.lawyerId;

    // Get already-booked slots for this lawyer in the next 14 days
    const booked = await db.all(
      `SELECT date_slot, time_slot FROM consultation_bookings
       WHERE lawyer_id = ? AND status NOT IN ('cancelled')
         AND date_slot >= date('now')`,
      [lawyerId]
    ).catch(() => []);

    const bookedSet = new Set(booked.map(b => `${b.date_slot}|${b.time_slot}`));

    // Load attorney's stored availability schedule (from attorney_profiles)
    const attyProfile = await db.get(
      `SELECT availability_schedule FROM attorney_profiles WHERE lawyer_id = ?`,
      [lawyerId]
    ).catch(() => null);
    let attySchedule = null;
    if (attyProfile?.availability_schedule) {
      try { attySchedule = JSON.parse(attyProfile.availability_schedule); } catch {}
    }

    // Generate slots using attorney's actual schedule (not deterministic defaults)
    const rawSlots = generateSlots(new Date(), attySchedule);
    const slots = rawSlots.map(day => ({
      ...day,
      times: day.times.map(t => ({
        ...t,
        available: t.available && !bookedSet.has(`${day.date}|${t.time}`),
      })),
    }));

    res.json({ lawyer_id: lawyerId, slots, source: 'generated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /api/consultations — user's bookings
router.get('/', authRequired, listLimiter, async (req, res) => {
  const page   = Math.max(0, parseInt(String(req.query.page  || '0'),  10));
  const pgSize = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, user_id, lawyer_id, lawyer_name, lawyer_phone, date_slot, time_slot, duration_min, notes, status, created_at FROM consultation_bookings WHERE user_id=? ORDER BY date_slot DESC, time_slot ASC LIMIT ? OFFSET ?
       ORDER BY date_slot ASC, time_slot ASC`,
      [req.user.id, pgSize, page * pgSize]
    );
    res.json({ consultations: rows, page, pageSize: pgSize, hasMore: rows.length === pgSize });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/consultations/book
router.post('/book', validate(schemas.consultations.book), authRequired, consultationsLimiter, async (req, res) => {
  const {
    lawyer_id, lawyer_name, lawyer_phone = '',
    date_slot = null, time_slot = null,
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
    let stripeClientSecret    = null;

    if (LIVE) {
      // Charge the platform fee
      const pi = await stripe.paymentIntents.create({
        amount:   feeCents,
        currency: 'usd',
        // automatic_payment_methods lets Stripe's Payment Sheet handle card UI
        automatic_payment_methods: { enabled: true },
        metadata: {
          user_id:     String(req.user.id),
          lawyer_name,
          date_slot,
          time_slot,
          type: 'consultation_booking',
        },
        description: `Justice Gavel — Consult booking: ${lawyer_name} on ${date_slot} at ${time_slot}`,
      });
      stripePaymentIntentId = pi.id;
      stripeClientSecret    = pi.client_secret;
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
      client_secret: stripeClientSecret,
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

    // ── Stripe refund — full refund if cancelled ≥2 hrs before slot ──────────
    let refundId   = null;
    let refundNote = 'No charge to refund (demo or free booking).';

    if (LIVE && booking.stripe_pi_id && booking.stripe_pi_id !== 'pi_mock_consult') {
      try {
        // Only refund if the appointment is still in the future (> 2 hrs)
        const slotDt = new Date(`${booking.date_slot}T${_parseTime(booking.time_slot)}`);
        const hoursUntil = (slotDt.getTime() - Date.now()) / 3_600_000;

        if (hoursUntil > 2) {
          const refund = await stripe.refunds.create({
            payment_intent: booking.stripe_pi_id,
            reason:         'requested_by_customer',
            metadata:       { booking_id: String(booking.id), cancelled_by: String(req.user.id) },
          });
          refundId   = refund.id;
          refundNote = `Full refund of $${(booking.platform_fee_cents / 100).toFixed(2)} issued.`;
        } else {
          refundNote = 'Cancellation within 2 hours of appointment — no refund per policy.';
        }
      } catch (refundErr) {
        // Non-fatal — still cancel the booking; flag for manual review
        logger.warn('[consultations/cancel] Stripe refund failed', refundErr?.message);
        refundNote = 'Refund pending manual review.';
      }
    }

    await db.run(
      `UPDATE consultation_bookings
          SET status      = 'cancelled',
              cancelled_at = datetime('now'),
              refund_id   = ?
        WHERE id = ?`,
      [refundId, safeInt(req.params.id)]
    );
    res.json({
      success: true,
      message: 'Booking cancelled.',
      refund:  refundNote,
      refund_id: refundId,
    });

    // ── Send confirmation email to defendant ──────────────────────────────────
    if (req.user.email) {
      sendBookingConfirmation({
        to:           req.user.email,
        clientName:   req.user.display_name || req.user.name || 'Client',
        attorneyName: lawyer_name,
        dateSlot:     date_slot,
        timeSlot:     time_slot,
        durationMin:  duration_min,
        feeDollars:   (feeCents / 100).toFixed(2),
        meetingLink,
        cancellationUrl: `https://justicegavel.app/consultations/${result.lastID}/cancel`,
      }).catch(e => logger.warn('[email] booking confirmation failed:', e?.message));
    }

    // ── Notify attorney (if they have a JTB account) ────────────────────────
    // If the lawyer is a registered Justice Gavel attorney, push them immediately.
    // This is the core two-sided marketplace notification.
    if (lawyer_id) {
      try {
        const attyUser = await db.get(
          `SELECT u.id, u.display_name FROM users u
            JOIN attorney_profiles ap ON ap.user_id = u.id
           WHERE ap.lawyer_id = ? LIMIT 1`,
          [lawyer_id]
        );
        if (attyUser) {
          await sendPushToUser(attyUser.id, {
            title: '📋 New Consultation Booked',
            body: `${req.user.display_name || 'A client'} booked a ${duration_min}-min consult on ${date_slot} at ${time_slot}`,
            data: {
              screen: 'AttorneyInbox',
              booking_id: result.lastID,
              client_name: req.user.display_name || '',
              date_slot,
              time_slot,
            },
            channelId: 'attorney_bookings',
          });
          logger.info({ msg: '[consultations] attorney notified', attyId: attyUser.id, bookingId: result.lastID });
          // Also send attorney an email with full client details
          if (attyUser.email) {
            const caseRow = await db.get(
              `SELECT title FROM cases c JOIN case_assignments ca ON ca.case_id=c.id WHERE ca.user_id=? ORDER BY ca.assigned_at DESC LIMIT 1`,
              [req.user.id]).catch(()=>null);
            sendAttorneyBookingAlert({
              to:          attyUser.email,
              attorneyName: attyUser.display_name || attyUser.name || 'Attorney',
              clientName:  req.user.display_name || req.user.name || 'Client',
              dateSlot:    date_slot,
              timeSlot:    time_slot,
              durationMin: duration_min,
              caseTitle:   caseRow?.title || null,
              clientEmail: req.user.email || null,
              clientPhone: req.user.phone || null,
              meetingLink,
            }).catch(e => logger.warn('[email] attorney alert failed:', e?.message));
          }
        }
      } catch (pushErr) {
        // Non-fatal — booking succeeded even if push fails
        logger.warn('[consultations] attorney push failed', pushErr?.message);
      }
    }
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
    ).catch(e => logger.warn('[consultations] callback_request insert:', e?.message));

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