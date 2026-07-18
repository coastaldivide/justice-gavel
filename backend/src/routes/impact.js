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

const router = Router();

/** GET /api/impact/report — generate impact report for grant applications */
router.get('/report', authRequired, asyncRoute(async (req, res) => {
  const { from_date, to_date } = req.query;
  const from = from_date ?? new Date(Date.now() - 365*24*3600*1000).toISOString().slice(0,10);
  const to   = to_date   ?? new Date().toISOString().slice(0,10);

  const [users, cases, expungements, checkins, translations, crisisAccess] = await Promise.all([
    req.db.get(`SELECT COUNT(*) AS count FROM users WHERE created_at BETWEEN ? AND ?`, [from, to]),
    req.db.get(`SELECT COUNT(*) AS count FROM cases WHERE created_at BETWEEN ? AND ?`, [from, to]),
    req.db.get(`SELECT COUNT(*) AS count FROM expungement_applications WHERE created_at BETWEEN ? AND ? AND status = 'submitted'`, [from, to]),
    req.db.get(`SELECT COUNT(*) AS count FROM checkins WHERE created_at BETWEEN ? AND ?`, [from, to]),
    req.db.get(`SELECT COUNT(*) AS count FROM translation_logs WHERE created_at BETWEEN ? AND ?`, [from, to]),
    req.db.get(`SELECT COUNT(DISTINCT user_id) AS count FROM session_events WHERE event = 'emergency_accessed' AND created_at BETWEEN ? AND ?`, [from, to]),
  ]);

  const report = {
    period: { from, to },
    headline_metrics: {
      people_served:           users.count,
      active_cases:            cases.count,
      expungement_petitions:   expungements.count,
      pretrial_checkins:       checkins.count,
      live_translations:       translations.count,
      emergency_help_accessed: crisisAccess.count,
    },
    impact_narrative: `During the period from ${from} to ${to}, Justice Gavel served
${users.count.toLocaleString()} individuals navigating the criminal justice system.
The platform facilitated ${expungements.count.toLocaleString()} expungement applications,
${translations.count.toLocaleString()} real-time legal translations, and
${crisisAccess.count.toLocaleString()} emergency legal help accesses.
${checkins.count.toLocaleString()} court-ordered check-ins were completed through the
pretrial monitoring alternative, helping defendants maintain compliance without ankle monitors.`,
    equity_metrics: {
      languages_served:    4,   // en, es, vi, pt
      states_covered:      51,  // all 50 + DC
      cost_to_user:        'Free and $19.99-49.99/month tiers',
      comparison_baseline: 'Traditional criminal defense attorney: $3,000-25,000+',
    },
    generated_at: new Date().toISOString(),
    contact: 'impact@justicegavel.app',
  };

  return res.json({ data: report });
}));

export default router;
