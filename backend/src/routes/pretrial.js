/**
 * routes/pretrial.js — Pretrial Services Agency (B2G) API
 *
 * Reframes the defendant check-in system as a court-ordered
 * pretrial monitoring alternative to electronic ankle monitors.
 *
 * Business model:
 *   - Free for defendants (removes adoption barrier)
 *   - Courts/counties pay: $15-50/defendant/month
 *   - vs ankle monitors: $100-200/month + equipment costs
 *   - One county with 500 defendants = $7,500-25,000/month
 *
 * API consumers:
 *   - Court case management systems (Tyler Technologies, etc.)
 *   - Pretrial services agency officers
 *   - Judges needing compliance reports
 */

import { Router }     from 'express';
import { asyncRoute } from '../utils/routeHelpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/pretrial/compliance-report/:defendant_id
 * Generate a court-ready compliance report for a specific defendant.
 * Used by pretrial officers for weekly status reviews.
 */
router.get('/compliance-report/:defendant_id', authRequired, asyncRoute(async (req, res) => {
  const { defendant_id } = req.params;
  const { from_date, to_date } = req.query;

  const defendant = await req.db.get(
    'SELECT * FROM users WHERE id = ?', [defendant_id]
  );
  if (!defendant) return res.status(404).json({ error: 'Defendant not found' });

  const enrollment = await req.db.get(
    'SELECT * FROM checkin_enrollments WHERE user_id = ? AND status = ?',
    [defendant_id, 'active']
  );

  const checkins = await req.db.all(`
    SELECT created_at, location_lat, location_lng, verified,
           late_minutes, method, device_info
    FROM checkins
    WHERE user_id = ?
      AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
  `, [defendant_id, from_date ?? '2020-01-01', to_date ?? new Date().toISOString()]);

  const total    = checkins.length;
  const onTime   = checkins.filter(c => (c.late_minutes ?? 0) <= 15).length;
  const late     = checkins.filter(c => c.late_minutes > 15 && c.late_minutes <= 60).length;
  const missed   = (enrollment?.required_checkins ?? 0) - total;
  const verified = checkins.filter(c => c.verified).length;
  const rate     = total > 0 ? Math.round((onTime / total) * 100) : 0;

  const report = {
    defendant: {
      id:          defendant.id,
      name:        defendant.full_name ?? defendant.email,
      enrolled_at: enrollment?.created_at,
    },
    period: {
      from: from_date ?? enrollment?.created_at,
      to:   to_date ?? new Date().toISOString(),
    },
    summary: {
      compliance_rate_pct: rate,
      total_required:      enrollment?.required_checkins ?? 0,
      total_completed:     total,
      on_time:             onTime,
      late:                late,
      missed:              Math.max(0, missed),
      verified_location:   verified,
      risk_level:          rate >= 90 ? 'low' : rate >= 70 ? 'medium' : 'high',
    },
    recommendation: rate >= 90
      ? 'Defendant is fully compliant. No intervention recommended.'
      : rate >= 70
      ? 'Defendant has minor compliance issues. Recommend reminder outreach.'
      : 'Defendant has significant compliance issues. Recommend officer contact.',
    checkins: checkins.slice(0, 30), // most recent 30
    generated_at:  new Date().toISOString(),
    generated_by:  'Justice Gavel Pretrial Monitoring System',
  };

  return res.json({ data: report });
}));

/**
 * GET /api/pretrial/dashboard
 * Court officer dashboard: all defendants under monitoring
 */
router.get('/dashboard', authRequired, asyncRoute(async (req, res) => {
  const { agency_id, risk_level, date } = req.query;

  const defendants = await req.db.all(`
    SELECT
      u.id, u.full_name, u.phone,
      e.id AS enrollment_id, e.required_checkins, e.court_date, e.case_number,
      COUNT(c.id) AS checkins_completed,
      MAX(c.created_at) AS last_checkin,
      ROUND(100.0 * COUNT(c.id) / NULLIF(e.required_checkins, 0)) AS compliance_pct
    FROM checkin_enrollments e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN checkins c ON c.user_id = e.user_id
      AND c.created_at > NOW() - INTERVAL '30 days'
    WHERE e.status = 'active'
      AND e.agency_id = ?
    GROUP BY u.id, u.full_name, u.phone, e.id, e.required_checkins, e.court_date, e.case_number
    ORDER BY compliance_pct ASC NULLS FIRST
    LIMIT 100
  `, [agency_id ?? req.user.agency_id]);

  const summary = {
    total_enrolled:      defendants.length,
    high_risk:           defendants.filter(d => d.compliance_pct < 70).length,
    medium_risk:         defendants.filter(d => d.compliance_pct >= 70 && d.compliance_pct < 90).length,
    low_risk:            defendants.filter(d => d.compliance_pct >= 90).length,
    court_dates_today:   defendants.filter(d => d.court_date?.startsWith(date ?? '')).length,
  };

  return res.json({ data: { defendants, summary } });
}));

/**
 * POST /api/pretrial/enroll
 * Court officer enrolls a defendant in monitoring
 */
router.post('/enroll', authRequired, asyncRoute(async (req, res) => {
  const {
    defendant_id, case_number, court_date,
    required_checkins = 1, agency_id, officer_id,
    conditions = [],
  } = req.body;

  const enrollment = await req.db.get(
    `INSERT INTO checkin_enrollments
       (user_id, case_number, court_date, required_checkins, agency_id, officer_id,
        conditions, status, enrolled_by, enrolled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW())
     RETURNING *`,
    [defendant_id, case_number, court_date, required_checkins,
     agency_id, officer_id, JSON.stringify(conditions), req.user.id]
  );

  return res.status(201).json({ data: enrollment });
}));

export default router;
