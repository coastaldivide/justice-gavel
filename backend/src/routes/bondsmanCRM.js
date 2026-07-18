/**
 * routes/bondsmanCRM.js — Bondsman lead pipeline and ROI dashboard
 *
 * Bondsmen need to see lead quality to keep paying.
 * This gives them: lead pipeline, conversion tracking, ROI calculator.
 */

import { Router } from 'express';
import { asyncRoute } from '../utils/routeHelpers.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

/** GET /api/bondsman/dashboard — main metrics view */
router.get('/dashboard', authRequired, asyncRoute(async (req, res) => {
  const userId = req.user.id;

  const [pipeline, revenue, recent] = await Promise.all([
    // Lead pipeline by stage
    req.db.all(`
      SELECT status,
             COUNT(*) AS count,
             SUM(bail_amount) AS total_bail,
             SUM(fee_charged) AS total_fees_paid
      FROM pi_leads
      WHERE bondsman_id = ? AND created_at > NOW() - INTERVAL '90 days'
      GROUP BY status
    `, [userId]),

    // Revenue summary
    req.db.get(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'closed')      AS leads_closed,
        SUM(bail_amount) FILTER (WHERE status='closed') AS bail_secured,
        SUM(fee_charged)                               AS total_fees_paid,
        -- ROI: bondsman makes 10% of bail on close
        SUM(bail_amount * 0.10) FILTER (WHERE status='closed') AS gross_revenue,
        SUM(bail_amount * 0.10) FILTER (WHERE status='closed')
          - SUM(fee_charged) FILTER (WHERE status='closed')    AS net_revenue
      FROM pi_leads
      WHERE bondsman_id = ? AND created_at > NOW() - INTERVAL '30 days'
    `, [userId]),

    // Recent leads with contact info
    req.db.all(`
      SELECT id, defendant_name, charge_type, bail_amount, county, state,
             status, fee_charged, contacted_at, created_at
      FROM pi_leads
      WHERE bondsman_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]),
  ]);

  const conversionRate = pipeline.length > 0
    ? Math.round(
        100 * (pipeline.find(p => p.status === 'closed')?.count ?? 0) /
        pipeline.reduce((s, p) => s + p.count, 0)
      )
    : 0;

  return res.json({
    data: {
      pipeline,
      revenue: {
        ...revenue,
        conversion_rate_pct: conversionRate,
        roi_multiple: revenue.total_fees_paid > 0
          ? ((revenue.net_revenue ?? 0) / revenue.total_fees_paid).toFixed(2)
          : null,
      },
      recent_leads: recent,
      generated_at: new Date().toISOString(),
    },
  });
}));

/** PATCH /api/bondsman/leads/:id — update lead status */
router.patch('/leads/:id', authRequired, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { status, notes, contacted_at } = req.body;

  const lead = await req.db.get(
    'SELECT * FROM pi_leads WHERE id = ? AND bondsman_id = ?',
    [id, req.user.id]
  );
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await req.db.run(`
    UPDATE pi_leads
    SET status = COALESCE(?, status),
        notes  = COALESCE(?, notes),
        contacted_at = COALESCE(?, contacted_at),
        updated_at = NOW()
    WHERE id = ?
  `, [status, notes, contacted_at, id]);

  return res.json({ data: { id, status: status ?? lead.status } });
}));

export default router;
