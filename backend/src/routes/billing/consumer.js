/**
 * billing/consumer.js — consumer plan aliases and the platform revenue summary.
 * Mounted at /api/billing by billing/index.js.
 *
 *   POST /consumer/subscribe     same as POST /subscribe, consumer plans only
 *   GET  /consumer/subscription  the caller's consumer plan + the consumer price list
 *   GET  /admin/stats            platform revenue (super_admin only)
 */
import { Router }       from 'express';
import { isPlatformSuperAdmin } from '../../middleware/rbac.js';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import { stripeConfigured } from '../../config.js';
import { billingLimiter, TIERS } from './_shared.js';
import { startPlan, publicSub, tierList, billingFail } from './subscriptions.js';
import { PAID_STATUSES } from '../../services/entitlements.js';
import { resolveLang, msg } from '../../i18n/index.js';

const router = Router();
const PAID_SQL = PAID_STATUSES.map(s => `'${s}'`).join(',');

router.post('/consumer/subscribe', billingLimiter, authRequired, (req, res) => {
  if (typeof req.body?.tier !== 'string' || !req.body.tier.trim()) {
    return res.status(400).json({ error: msg(resolveLang(req), 'billing.err.bad_plan'), code: 'bad_plan' });
  }
  return startPlan(req, res, { audience: 'consumer' });
});

router.get('/consumer/subscription', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const cols = 'id, user_id, provider_type, tier, status, amount_cents, trial_ends_at, current_period_end, cancel_at_period_end, created_at';
    const row = (await db.get(`SELECT ${cols} FROM subscriptions WHERE user_id = ? AND provider_type = 'consumer' AND status IN (${PAID_SQL}) ORDER BY id DESC LIMIT 1`, [req.user.id]))
      || (await db.get(`SELECT ${cols} FROM subscriptions WHERE user_id = ? AND provider_type = 'consumer' AND status <> 'incomplete' ORDER BY id DESC LIMIT 1`, [req.user.id]));
    res.json({ subscription: publicSub(row), tiers: tierList('consumer'), payments_live: stripeConfigured() });
  } catch (e) { billingFail(req, res, e); }
});

// Platform revenue — super_admin only (live DB role, see middleware/auth.js).
router.get('/admin/stats', authRequired, async (req, res) => {
  if (!isPlatformSuperAdmin(req.user)) {
    return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  }
  try {
    const db = await getDb();
    const [subs, leads, piLeads, connections] = await Promise.all([
      db.all(`SELECT tier FROM subscriptions WHERE status IN ('active','past_due') LIMIT 100000`),
      db.get(`SELECT COUNT(*)::int AS total, COALESCE(SUM(lead_fee_cents), 0)::bigint AS revenue FROM lead_purchases WHERE status = 'charged'`),
      db.get(`SELECT COUNT(*)::int AS total, COALESCE(SUM(lead_fee_cents), 0)::bigint AS revenue FROM pi_leads WHERE status = 'accepted'`),
      db.get(`SELECT COUNT(*)::int AS total, COALESCE(SUM(amount_cents), 0)::bigint AS revenue FROM family_connections WHERE status = 'paid'`),
    ]);
    // Monthly recurring revenue at list price (annual plans count as a twelfth of the year).
    const mrr = subs.reduce((n, r) => n + (TIERS[r.tier]?.monthly_cents || 0), 0);
    res.json({ subscriptions: { total: subs.length, mrr_cents: mrr }, leads, case_leads: piLeads, family_connections: connections });
  } catch (e) { billingFail(req, res, e); }
});

export default router;
