/**
 * routes/impact.js — Impact metrics and grant reporting
 *
 * DOJ Access to Justice grants require annual impact reports.
 * This endpoint auto-generates the data for those reports.
 *
 * Grant targets:
 *   DOJ Access to Justice Initiative
 *   MacArthur Foundation Safety and Justice Challenge
 *   Arnold Ventures Pretrial Justice
 *   Open Society Foundations
 */

import { Router } from 'express';
import { asyncRoute } from '../utils/routeHelpers.js';
import { authRequired } from '../middleware/auth.js';
import { requireStaff } from '../utils/staff.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A count, or null when the table / column does not exist on this database. */
async function count(db, sql, params) {
  try { return Number((await db.get(sql, params))?.count ?? 0); }
  catch (e) { logger.warn({ err: e.message }, '[impact] count unavailable'); return null; }
}

const router = Router();

/** GET /api/impact/report — platform-wide counts for grant reports (staff only). */
router.get('/report', authRequired, requireStaff(getDb), asyncRoute(async (req, res) => {
  const { from_date, to_date } = req.query;
  if ((from_date && !DAY.test(String(from_date))) || (to_date && !DAY.test(String(to_date)))) {
    return res.status(400).json({ error: 'validation_failed', message: 'from_date / to_date must be YYYY-MM-DD' });
  }
  const from = from_date ?? new Date(Date.now() - 365*24*3600*1000).toISOString().slice(0,10);
  const to   = to_date   ?? new Date().toISOString().slice(0,10);
  const db = await getDb();
  const span = [from, `${to}T23:59:59.999Z`];
  const [users, cases, expungements, checkins, translations, crisisAccess] = await Promise.all([
    count(db, `SELECT COUNT(*) AS count FROM users WHERE created_at BETWEEN ? AND ?`, span),
    count(db, `SELECT COUNT(*) AS count FROM cases WHERE created_at BETWEEN ? AND ?`, span),
    count(db, `SELECT COUNT(*) AS count FROM expungement_applications WHERE created_at BETWEEN ? AND ? AND status = 'submitted'`, span),
    count(db, `SELECT COUNT(*) AS count FROM checkins WHERE created_at BETWEEN ? AND ?`, span),
    count(db, `SELECT COUNT(*) AS count FROM translation_messages WHERE created_at BETWEEN ? AND ?`, span),
    count(db, `SELECT COUNT(DISTINCT user_id) AS count FROM session_events WHERE event = 'emergency_accessed' AND created_at BETWEEN ? AND ?`, span),
  ]);
  const n = (v) => (v == null ? 'n/a' : v.toLocaleString('en-US'));

  const report = {
    period: { from, to },
    headline_metrics: {
      people_served:           users,
      active_cases:            cases,
      expungement_petitions:   expungements,
      pretrial_checkins:       checkins,
      live_translations:       translations,
      emergency_help_accessed: crisisAccess,
    },
    impact_narrative: `During the period from ${from} to ${to}, Justice Gavel served
${n(users)} new accounts. The platform recorded ${n(expungements)} submitted expungement
applications, ${n(translations)} interpreted messages, ${n(crisisAccess)} people opening
emergency help, and ${n(checkins)} check-ins.`,
    equity_metrics: {
      languages_served:    4,   // en, es, vi, pt (the app's languages)
    },
    generated_at: new Date().toISOString(),
    contact: 'impact@justicegavel.app',
  };

  return res.json({ data: report });
}));

export default router;
