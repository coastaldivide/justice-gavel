/**
 * arrests.js — Public arrest record search API
 *
 * GET  /api/arrests/search?name=John&county=davidson
 * GET  /api/arrests/recent?county=davidson&limit=50
 * GET  /api/arrests/:id
 * GET  /api/arrests/stats/county/:county
 * POST /api/arrests/alert-test   (admin only)
 */

import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import express from 'express';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRequired as authMiddleware } from '../middleware/auth.js';
import { sendArrestAlerts } from '../services/arrest_alerts.js';
const alertsPipelineLimiter = makeUserLimiter(20, 60_000); // auto-generated rate limiter

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/providers.sqlite');

// Column allowlist for dynamic WHERE conditions
const ALLOWED_ARREST_COLS = new Set(['state','county','has_attorney','source','booking_date','bail_amount']);
function safeCondition(col, val, params) {
  if (!ALLOWED_ARREST_COLS.has(col)) return null;
  params.push(val);
  return `${col} = ?`;
}
const router = express.Router();

async function getDb() {
  return open({ filename: DB_PATH, driver: sqlite3.Database });
}

// Search by name or charge (family member looking up loved one)
router.get('/search', authMiddleware, async (req, res) => {
  const { name, county, state = 'TN', charge, limit = 20, offset = 0 } = req.query;

  if (!name && !charge && !county) {
    return err400(res, 'Provide name, charge, or county to search');
  }

  const db = await getDb();
  try {
    const conditions = [];
    const params = [];

    if (name) {
      conditions.push('LOWER(name) LIKE LOWER(?)');
      params.push(`%${name}%`);
    }
    if (county) {
      conditions.push('LOWER(county) = LOWER(?)');
      params.push(county);
    }
    if (charge) {
      conditions.push('LOWER(charges) LIKE LOWER(?)');
      params.push(`%${charge}%`);
    }
    if (state) {
      conditions.push('state = ?');
      params.push(state.toUpperCase());
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const records = await db.all(
      `SELECT id, name, booking_date, charges, bail_amount, court_date,
              has_attorney, jail_location, county, state, case_number
       FROM arrest_records
       ${where}
       ORDER BY booking_date DESC
       LIMIT ? OFFSET ?`,
      [...params, safeInt(limit), safeInt(offset)]
    );

    const total = await db.get(
      `SELECT COUNT(*) as n FROM arrest_records ${where}`,
      params
    );

    res.json({ records, total: total?.n ?? 0n, limit: safeInt(limit), offset: safeInt(offset) });
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Recent bookings by county (for attorney/bail agent dashboards)
router.get('/recent', authMiddleware, async (req, res) => {
  const { county, state = 'TN', hours = 24, no_attorney, has_bail, limit = 100 } = req.query;

  const db = await getDb();
  try {
    const conditions = [`created_at >= datetime('now', '-${safeInt(hours)} hours')`];
    const params = [];

    if (county) { conditions.push('LOWER(county) = LOWER(?)'); params.push(county); }
    if (state)  { conditions.push('state = ?'); params.push(state.toUpperCase()); }
    if (no_attorney === 'true') { conditions.push('has_attorney = 0'); }
    if (has_bail === 'true')    { conditions.push('bail_amount > 0'); }

    const records = await db.all(
      `SELECT id, name, booking_date, charges, bail_amount, status, city, county, state, has_attorney, source FROM arrest_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY booking_date DESC
       LIMIT ?`,
      [...params, safeInt(limit)]
    );

    res.set('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
    res.json({ records, count: records.length, window_hours: safeInt(hours) });
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Single arrest detail
router.get('/:id', authMiddleware, async (req, res) => {
  const db = await getDb();
  try {
    const record = await db.get(
      'SELECT id, name, booking_date, charges, bail_amount, status, city, county, state, has_attorney, source FROM arrest_records WHERE id = ?',
      [safeInt(req.params.id)]
    );
    if (!record) return err404(res, 'Record not found');
    res.json(record);
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// County stats — how many arrests, breakdown by charge type
router.get('/stats/county/:county', authMiddleware, async (req, res) => {
  const db = await getDb();
  try {
    const { days = 7 } = req.query;
    const county = req.params.county;

    const stats = await db.get(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN has_attorney = 0 THEN 1 ELSE 0 END) as no_attorney,
        SUM(CASE WHEN bail_amount > 0 THEN 1 ELSE 0 END) as has_bail,
        AVG(CASE WHEN bail_amount > 0 THEN bail_amount END) as avg_bail,
        MIN(bail_amount) as min_bail,
        MAX(bail_amount) as max_bail
       FROM arrest_records
       WHERE LOWER(county) = LOWER(?)
       AND created_at >= datetime('now', '-${safeInt(days)} days')`,
      [county]
    );

    res.json({ county, days: safeInt(days), ...stats });
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Manually trigger alert send (admin)
router.post('/send-alerts', authMiddleware, alertsPipelineLimiter, async (req, res) => {
  try {
    const result = await sendArrestAlerts();
    res.json({ success: true, ...result });
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message });
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Arrest monitors (Pro tier) ────────────────────────────────────────────────
// GET  /api/arrests/monitors          — list user's monitors
// POST /api/arrests/monitors          — add a monitor
// DELETE /api/arrests/monitors/:id   — remove a monitor

router.get('/monitors', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT id, user_id, name, county, state, notify_email, notify_sms, created_at FROM arrest_monitors WHERE user_id=? ORDER BY id DESC',
      [req.user.id]
    ).catch(() => []);
    res.json(rows);
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.post('/monitors', authMiddleware, async (req, res) => {
  const { watch_name, county = 'All', state = 'TN' } = req.body;

  if (watch_name) watch_name = truncateStr(watch_name, 200);  if (!watch_name) return err400(res, 'watch_name required');
  try {
    const db = await getDb();
    // Limit: 5 per user
    const count = await db.get('SELECT COUNT(*) as n FROM arrest_monitors WHERE user_id=? AND active=1', [req.user.id]).catch(()=>({n:0}));
    if (count.n >= 5) return res.status(429).json({ error: 'Monitor limit reached (5 max)' });
    const r = await db.run(
      'INSERT INTO arrest_monitors (user_id, watch_name, county, state, active) VALUES (?,?,?,?,1)',
      [req.user.id, watch_name.trim(), county.trim(), state.trim()]
    ).catch(() => null);
    res.status(201).json({ created: true, id: r?.lastID });
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

router.delete('/monitors/:id', authMiddleware, async (req, res) => {
    const idVal = safeInt(req.params.id);
    if (!idVal) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = await getDb();
    await db.run('UPDATE arrest_monitors SET active=0 WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    res.json({ removed: true });
  } catch (e) {
    logger.error({ msg: '[arrests]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

export default router;
