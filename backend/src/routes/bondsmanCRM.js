/**
 * routes/bondsmanCRM.js — the bail agent's own book: purchased leads and clients.
 * Mounted at /api/bondsman. Bail-agent accounts (a bondsman profile) or staff only;
 * every row is the caller's own.
 *
 *   GET   /api/bondsman/dashboard     real counts: leads open now, bought, spent, pipeline, clients
 *   GET   /api/bondsman/leads         leads the agent bought (full record) with CRM status / notes
 *   PATCH /api/bondsman/leads/:id     { status: new|contacted|bonded|closed, notes? } on a purchase
 * Clients are the agent's check-in enrollments (routes/checkins.js; CheckInManager screen).
 * There are no estimates: no assumed premium rate, no "ROI".
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../i18n/index.js';
import { visibleArrestSql } from '../utils/arrestVisibility.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 60 });
const STATUSES = ['new', 'contacted', 'bonded', 'closed'];
const say = (req, k) => msg(resolveLang(req), `bondsman.err.${k}`);
const parseList = (v) => { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } };

async function requireAgent(req, res, next) {
  try {
    const db = await getDb();
    const p = await db.get('SELECT id, states, state, license_state FROM bondsman_profiles WHERE user_id = ?', [req.user.id]);
    if (!p && !['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: say(req, 'profile_required'), code: 'bondsman_profile_required' });
    req.agentProfile = p || null;
    next();
  } catch (e) {
    logger.error('[bondsman-crm]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
}
router.use(authRequired, limiter, requireAgent);

router.get('/dashboard', async (req, res) => {
  try {
    const db = await getDb();
    const me = req.user.id;
    const p = req.agentProfile;
    const state = parseList(p?.states)[0] || p?.state || p?.license_state || null;
    const [open, bought, recent, pipeline, clients] = await Promise.all([
      db.get(`SELECT COUNT(*)::int AS n FROM arrest_records ar
               WHERE ${visibleArrestSql('ar')} AND COALESCE(ar.has_attorney, 0) = 0 AND ar.bail_amount > 0
                 AND ar.created_at >= NOW() - INTERVAL '48 hours' ${state ? 'AND ar.state = ?' : ''}
                 AND NOT EXISTS (SELECT 1 FROM lead_purchases lp WHERE lp.arrest_id = ar.id AND lp.bondsman_id = ? AND lp.status = 'charged')`,
        state ? [state, me] : [me]),
      db.get(`SELECT COUNT(*)::int AS n, COALESCE(SUM(lead_fee_cents), 0)::bigint AS cents FROM lead_purchases WHERE bondsman_id = ? AND status = 'charged'`, [me]),
      db.get(`SELECT COUNT(*)::int AS n, COALESCE(SUM(lead_fee_cents), 0)::bigint AS cents FROM lead_purchases
               WHERE bondsman_id = ? AND status = 'charged' AND created_at >= NOW() - INTERVAL '30 days'`, [me]),
      db.all(`SELECT crm_status AS status, COUNT(*)::int AS n FROM lead_purchases WHERE bondsman_id = ? AND status = 'charged' GROUP BY crm_status`, [me]),
      db.get(`SELECT COUNT(*) FILTER (WHERE active = 1)::int AS active, COUNT(*)::int AS total FROM checkin_enrollments WHERE bondsman_id = ?`, [me]),
    ]);
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const r of pipeline) if (byStatus[r.status] !== undefined) byStatus[r.status] = r.n;
    res.json({
      state,
      leads_open_48h: open.n,
      leads_bought: bought.n, spent_cents: Number(bought.cents),
      leads_bought_30d: recent.n, spent_30d_cents: Number(recent.cents),
      pipeline: byStatus,
      clients_active: clients?.active || 0, clients_total: clients?.total || 0,
    });
  } catch (e) {
    logger.error('[bondsman/dashboard]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const db = await getDb();
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const rows = await db.all(
      `SELECT lp.id, lp.arrest_id, lp.lead_fee_cents, lp.crm_status, lp.crm_notes, lp.contacted_at, lp.created_at,
              ar.name, ar.booking_date, ar.charges, ar.bail_amount, ar.county, ar.state, ar.jail_location, ar.case_number, ar.court_date
         FROM lead_purchases lp JOIN arrest_records ar ON ar.id = lp.arrest_id
        WHERE lp.bondsman_id = ? AND lp.status = 'charged' ${status ? 'AND lp.crm_status = ?' : ''}
        ORDER BY lp.created_at DESC, lp.id DESC LIMIT 200`, status ? [req.user.id, status] : [req.user.id]);
    res.json({ leads: rows.map(r => ({ ...r, id: Number(r.id), arrest_id: Number(r.arrest_id), lead_fee_cents: Number(r.lead_fee_cents), bail_amount: Number(r.bail_amount) })) });
  } catch (e) {
    logger.error('[bondsman/leads]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
});

router.patch('/leads/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { status, notes } = req.body || {};
  if (status === undefined && notes === undefined) return res.status(400).json({ error: say(req, 'nothing_to_update'), code: 'nothing_to_update' });
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: say(req, 'bad_status'), code: 'bad_status' });
  if (notes !== undefined && notes !== null && typeof notes !== 'string') return res.status(400).json({ error: say(req, 'bad_status'), code: 'bad_notes' });
  try {
    const db = await getDb();
    const row = await db.get(
      `UPDATE lead_purchases
          SET crm_status = COALESCE(?, crm_status),
              crm_notes = CASE WHEN ? THEN ? ELSE crm_notes END,
              contacted_at = CASE WHEN ? IN ('contacted', 'bonded') AND contacted_at IS NULL THEN NOW() ELSE contacted_at END,
              updated_at = NOW()
        WHERE id = ? AND bondsman_id = ? AND status = 'charged'
        RETURNING id, crm_status, crm_notes, contacted_at`,
      [status ?? null, notes !== undefined, typeof notes === 'string' ? notes.trim().slice(0, 2000) : null, status ?? '', Number.isSafeInteger(id) ? id : 0, req.user.id]);
    if (!row) return res.status(404).json({ error: say(req, 'lead_not_found'), code: 'not_found' });
    res.json({ lead: { ...row, id: Number(row.id) } });
  } catch (e) {
    logger.error('[bondsman/leads/:id]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
});

export default router;
