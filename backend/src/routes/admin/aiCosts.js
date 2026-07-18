/**
 * routes/admin/aiCosts.js — AI cost visibility dashboard
 */
import { Router }     from 'express';
import { asyncRoute } from '../../utils/routeHelpers.js';
import { authRequired } from '../../middleware/auth.js';

const router = Router();

/** Daily cost breakdown */
router.get('/daily', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { days = 30 } = req.query;
  const costs = await req.db.all(`
    SELECT day, route, calls, total_cost_usd, avg_cost_per_call,
           avg_duration_ms, failed_calls
    FROM ai_daily_costs
    WHERE day > NOW() - INTERVAL '?? days'
    ORDER BY day DESC, total_cost_usd DESC
    LIMIT 500
  `.replace('??', parseInt(days)));
  return res.json({ data: costs });
}));

/** Current month total spend */
router.get('/summary', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const summary = await req.db.get(`
    SELECT
      COUNT(*)                    AS total_calls,
      SUM(cost_usd)               AS total_cost_usd,
      AVG(cost_usd)               AS avg_cost_per_call,
      SUM(input_tokens)           AS total_input_tokens,
      SUM(output_tokens)          AS total_output_tokens,
      COUNT(DISTINCT user_id)     AS unique_users,
      MAX(cost_usd)               AS max_single_call_cost,
      SUM(cost_usd) / NULLIF(COUNT(DISTINCT user_id), 0) AS cost_per_user
    FROM ai_usage_log
    WHERE queued_at > date_trunc('month', NOW())
  `);
  return res.json({ data: summary, month: new Date().toISOString().slice(0,7) });
}));

/** Top users by AI spend (find power users and potential abusers) */
router.get('/top-users', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const users = await req.db.all(`
    SELECT u.email, u.id AS user_id, s.total_cost_usd, s.total_calls,
           s.subscription_tier, s.month
    FROM ai_user_monthly_spend s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.month = date_trunc('month', NOW())
    ORDER BY s.total_cost_usd DESC
    LIMIT 50
  `);
  return res.json({ data: users });
}));

/** Route breakdown — which feature costs the most */
router.get('/by-route', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const routes = await req.db.all(`
    SELECT route,
           SUM(cost_usd)      AS total_cost_usd,
           COUNT(*)           AS calls,
           AVG(cost_usd)      AS avg_cost,
           AVG(duration_ms)   AS avg_ms
    FROM ai_usage_log
    WHERE queued_at > NOW() - INTERVAL '30 days'
    GROUP BY route
    ORDER BY total_cost_usd DESC
  `);
  return res.json({ data: routes });
}));

export default router;
