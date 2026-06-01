/**
 * checkins.js — Post-release check-in system
 *
 * Two user types:
 *   Bondsman  — enrolls defendants, views check-in history, pays $9.99/month/defendant
 *   Defendant — submits daily check-in (GPS + selfie URL + notes), free
 *
 * Endpoints:
 *   POST /api/checkins/enroll              — bondsman enrolls a defendant
 *   GET  /api/checkins/enrollments         — bondsman sees their defendant list
 *   PUT  /api/checkins/enrollments/:id     — update/cancel enrollment
 *   POST /api/checkins/submit              — defendant submits a check-in
 *   GET  /api/checkins/history/:enrollmentId — bondsman views check-in log
 *   GET  /api/checkins/my                  — defendant sees their own check-ins
 *   GET  /api/checkins/status              — defendant gets today's check-in status
 */
import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import Stripe from 'stripe';
import logger from '../utils/logger.js';

const router = Router();

// GET /status — current user's check-in status (no enrollment ID required)
router.get('/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const today = new Date().toISOString().slice(0,10);
    const checked_in = await db.get(
      'SELECT id FROM checkins WHERE user_id=? AND date(created_at)=?',
      [req.user.id, today]
    );
    const streak = await db.get(
      'SELECT COUNT(*) as n FROM checkins WHERE user_id=? AND created_at >= datetime(\'now\',\'-30 days\')',
      [req.user.id]
    );
    res.json({ checked_in_today: !!checked_in, streak: streak?.n || 0 });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});

const checkinsLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: 'Check-in limit reached. Try again later.' });

const stripeKey = process.env.STRIPE_SECRET || '';
const stripe    = stripeKey ? new Stripe(stripeKey) : null;
const LIVE      = !!stripeKey;

const FEE_PER_DEFENDANT = 999; // $9.99/month

// ── Bondsman: enroll a defendant ──────────────────────────────────────────────
router.post('/enroll', authRequired, checkinsLimiter, async (req, res) => {
  const {
    defendant_name, defendant_phone = '', defendant_email = '',
    case_number = '', court_date = '', check_in_freq = 'daily',
  } = req.body;

  if (!defendant_name?.trim()) {
    return err400(res, 'defendant_name is required');
  }

  try {
    const db = await getDb();

    // Count active enrollments for this bondsman
    const count = await db.get(
      "SELECT COUNT(*) as n FROM checkin_enrollments WHERE bondsman_id=? AND active=1",
      [req.user.id]
    );
    const activeCount = count?.n ?? 0;

    // In live mode: charge per-defendant fee (simplified — flat monthly per seat)
    let stripeSubId = `sub_mock_checkin_${Date.now()}`;
    if (LIVE && activeCount > 0) {
      // In production you'd add a subscription item for each defendant
      // For demo, we just record the intent
      stripeSubId = `sub_checkin_${req.user.id}_${Date.now()}`;
    }

    const result = await db.run(
      `INSERT INTO checkin_enrollments
         (bondsman_id, defendant_name, defendant_phone, defendant_email,
          case_number, court_date, check_in_freq, active, monthly_fee_cents, stripe_sub_id)
       VALUES (?,?,?,?,?,?,?,1,?,?)`,
      [
        req.user.id, defendant_name.trim(), defendant_phone.trim(),
        defendant_email.trim(), case_number.trim(), court_date || null,
        check_in_freq, FEE_PER_DEFENDANT, stripeSubId,
      ]
    );

    const enrollment = await db.get(
      'SELECT id, bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq, active, monthly_fee_cents, stripe_sub_id, created_at FROM checkin_enrollments WHERE id=?', [result.lastID]
    );

    res.json({
      success: true,
      enrollment,
      fee: `$${(FEE_PER_DEFENDANT / 100).toFixed(2)}/month`,
      mock: !LIVE,
      message: LIVE
        ? `${defendant_name} enrolled. $9.99/month added to your bill.`
        : `${defendant_name} enrolled (demo). In production, $9.99/month would be billed.`,
    });
  } catch (e) {
    logger.error('[checkins] enroll:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Bondsman: list their enrollments ─────────────────────────────────────────
router.get('/enrollments', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const enrollments = await db.all(
      `SELECT e.*,
         (SELECT COUNT(*) FROM checkin_records cr WHERE cr.enrollment_id = e.id) as total_checkins,
         (SELECT COUNT(*) FROM checkin_records cr WHERE cr.enrollment_id = e.id
            AND cr.checked_in_at >= date('now')) as checkins_today,
         (SELECT checked_in_at FROM checkin_records cr WHERE cr.enrollment_id = e.id
            ORDER BY cr.checked_in_at DESC LIMIT 1) as last_checkin
       FROM checkin_enrollments e
       WHERE e.bondsman_id=?
       ORDER BY e.active DESC, e.created_at DESC`,
      [req.user.id]
    );

    const totalActive = enrollments.filter(e => e.active).length;
    res.json({
      enrollments,
      total_active: totalActive,
      monthly_cost: `$${((totalActive * FEE_PER_DEFENDANT) / 100).toFixed(2)}/month`,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Bondsman: deactivate enrollment ──────────────────────────────────────────
router.put('/enrollments/:id', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const enroll = await db.get(
      'SELECT id, bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq, active, monthly_fee_cents, stripe_sub_id, created_at FROM checkin_enrollments WHERE id=? AND bondsman_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    if (!enroll) return err404(res, 'Enrollment not found');

    const { active } = req.body;
    await db.run(
      'UPDATE checkin_enrollments SET active=? WHERE id=?',
      [active ? 1 : 0, safeInt(req.params.id)]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Bondsman: view check-in history for one defendant ─────────────────────────
router.get('/history/:enrollmentId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    // Verify ownership
    const enroll = await db.get(
      'SELECT id, bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq, active, monthly_fee_cents, stripe_sub_id, created_at FROM checkin_enrollments WHERE id=? AND bondsman_id=?',
      [req.params.enrollmentId, req.user.id]
    );
    if (!enroll) return err404(res, 'Enrollment not found');

    const records = await db.all(
      `SELECT id, enrollment_id, checked_in_at, check_in_type, notes, verified,
              location_lat, location_lng, photo_uri
       FROM checkin_records WHERE enrollment_id=?
       ORDER BY checked_in_at DESC LIMIT 60`,
      [req.params.enrollmentId]
    );

    // Build compliance summary (last 30 days)
    const last30 = records.filter(r => {
      const d = new Date(r.checked_in_at);
      return (Date.now() - d.getTime()) < 30 * 24 * 60 * 60 * 1000;
    });

    res.json({
      enrollment: enroll,
      records,
      compliance: {
        last_30_days: last30.length,
        missed: Math.max(0, 30 - last30.length),
        rate: last30.length > 0 ? `${Math.round((last30.length / 30) * 100)}%` : '0%',
        last_checkin: records[0]?.checked_in_at || null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Defendant: submit a check-in ──────────────────────────────────────────────
router.post('/submit', authRequired, checkinsLimiter, async (req, res) => {
  // No auth required — defendants may not have accounts
  // They identify by enrollment_id + name match
  const {
    enrollment_id, defendant_name = null,
    lat = null, lng = null, location_label = '',
    selfie_url = '', notes = '',
    device_info = '',
  } = req.body;
  const safeNotes = notes ? truncateStr(sanitizeStr(String(notes), 2000), 2000) : '';

  if (!enrollment_id) return err400(res, 'enrollment_id required');

  try {
    const db = await getDb();
    const enroll = await db.get(
      'SELECT id, bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq, active, monthly_fee_cents, stripe_sub_id, created_at FROM checkin_enrollments WHERE id=? AND active=1',
      [enrollment_id]
    );
    if (!enroll) return err404(res, 'Enrollment not found or inactive');

    // Check if already checked in today
    const todayCheckin = await db.get(
      `SELECT id FROM checkin_records
       WHERE enrollment_id=? AND checked_in_at >= date('now')`,
      [enrollment_id]
    );
    if (todayCheckin) {
      return res.status(409).json({ error: 'Already checked in today.', already_done: true });
    }

    const record = await db.run(
      `INSERT INTO checkin_records
         (enrollment_id, lat = null, lng = null, location_label, selfie_url, notes, status, device_info)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        enrollment_id, lat || null, lng || null, location_label,
        selfie_url, safeNotes, 'submitted', device_info,
      ]
    );

    res.json({
      success: true,
      record_id: record.lastID,
      message: '✓ Check-in submitted. Your bondsman has been notified.',
      checked_in_at: new Date().toISOString(),
      next_due: 'Tomorrow by 11:59 PM',
    });
  } catch (e) {
    logger.error('[checkins] submit:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Defendant: get today's status ─────────────────────────────────────────────
router.get('/status/:enrollmentId', async (req, res) => {
  try {
    const db = await getDb();
    const enroll = await db.get(
      'SELECT id, bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq, active, monthly_fee_cents, stripe_sub_id, created_at FROM checkin_enrollments WHERE id=?', [req.params.enrollmentId]
    );
    if (!enroll) return err404(res, 'Enrollment not found');

    const todayCheckin = await db.get(
      `SELECT id, enrollment_id, checked_in_at, check_in_type, notes, verified, location_lat, location_lng
       FROM checkin_records
       WHERE enrollment_id=? AND checked_in_at >= date('now')
       ORDER BY checked_in_at DESC LIMIT 1`,
      [req.params.enrollmentId]
    );

    const totalCheckins = await db.get(
      'SELECT COUNT(*) as n FROM checkin_records WHERE enrollment_id=?',
      [req.params.enrollmentId]
    );

    res.json({
      enrollment: enroll,
      checked_in_today: !!todayCheckin,
      last_checkin: todayCheckin,
      total_checkins: totalCheckins?.n || 0,
      streak: await (async () => {
        try {
          const rows = await db.all(
            `SELECT date(checked_in_at) as day FROM checkin_records
             WHERE enrollment_id=? ORDER BY checked_in_at DESC LIMIT 30`,
            [req.params.enrollmentId]
          );
          let streak = 0;
          const today = new Date().toISOString().split('T')[0];
          let expected = today;
          for (const row of rows) {
            if (row.day === expected) {
              streak++;
              const d = new Date(expected);
              d.setDate(d.getDate() - 1);
              expected = d.toISOString().split('T')[0];
            } else break;
          }
          return streak;
        } catch (e) { logger.warn('[checkins/streak]', e?.message); return 0; }
      })()
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Defendant: their check-in history ────────────────────────────────────────
router.get('/my/:enrollmentId', async (req, res) => {
  try {
    const db = await getDb();
    const records = await db.all(
      `SELECT id, enrollment_id, checked_in_at, check_in_type, notes, verified, location_lat, location_lng FROM checkin_records WHERE enrollment_id=?
       ORDER BY checked_in_at DESC LIMIT 30`,
      [req.params.enrollmentId]
    );
    res.json(records);
  } catch (e) {
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

export default router;

// GET /api/family/contacts — list user's emergency contacts
router.get('/family-contacts', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const contacts = await db.all(
      'SELECT * FROM family_contacts WHERE user_id = ? ORDER BY created_at ASC',
      [req.user.id]
    ).catch(() => []);
    res.json({ contacts });
  } catch(e) { res.status(500).json({ error: 'Internal server error.', code: 'server_error' }); }
});
