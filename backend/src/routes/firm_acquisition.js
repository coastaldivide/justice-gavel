/**
 * routes/firm_acquisition.js — self-serve firm onboarding.
 *
 * Public:
 *   GET  /api/firm-acquisition/plans          firm plans on record (firm_pricing_configs; none yet)
 *   POST /api/firm-acquisition/lead           capture interest (e-mail + firm name)
 * Signed in:
 *   POST /api/firm-acquisition/trial          attorney accounts: create a firm + a free trial
 *   GET  /api/firm-acquisition/status         the caller's firm, trial days left / ended, seats, matters
 *   POST /api/firm-acquisition/upgrade        partner+: ask for a paid firm plan (a request, nothing changes)
 *   GET  /api/firm-acquisition/checklist      onboarding steps, worked out from the firm's real data
 *   POST /api/firm-acquisition/invite         firm admin: invite a colleague by e-mail (seat limit applies)
 *   GET  /api/firm-acquisition/invites        invites waiting for the caller's e-mail
 *   POST /api/firm-acquisition/invites/:id/accept   join that firm (seat limit applies)
 *
 * The trial needs no card and nothing is charged when it ends: there is no paid
 * firm plan to convert to yet (owner item). An ended trial keeps the firm and its
 * data; the screen says the trial ended and offers the plan request.
 * Every message is in the request's language (i18n firm.*).
 */
import { Router }       from 'express';
import { randomBytes }  from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import { loadFirmContext, hasMinRole } from '../middleware/rbac.js';
import { writeAuditLog } from '../middleware/audit.js';
import logger            from '../utils/logger.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { resolveLang, msg } from '../i18n/index.js';

const routeLimiter = makeUserLimiter({ windowMs: 60_000, max: 30 });
const router = Router();
const say = (req, k, p) => msg(resolveLang(req), `firm.${k}`, p);
const fail = (req, res, status, k, extra = {}) => res.status(status).json({ error: say(req, `err.${k}`), code: k, ...extra });

const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const TRIAL_DAYS = 14;          // free trial length — single source of truth
export const TRIAL_SEATS = 10;         // seats during the trial (a configured standard plan overrides)
const MAX_TRIALS      = 3;             // trials a person may start, ever
const PRO_ROLES       = new Set(['attorney', 'defender', 'admin', 'super_admin']);
const VALID_ORG_TYPES = ['nonprofit', 'public_defender', 'government', 'legal_aid', 'law_firm', 'solo', 'other'];
const VALID_TIERS     = ['standard', 'mission', 'government', 'enterprise'];
const INVITE_ROLES    = ['partner', 'associate', 'paralegal'];
export const VALID_VERTICALS = [
  'criminal_defense', 'civil_rights', 'white_collar', 'family', 'immigration',
  'personal_injury', 'public_defense', 'appellate', 'military', 'juvenile', 'general',
];

router.get('/plans', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT tier_key, display_name, monthly_cents, annual_cents, seat_limit, matter_limit, ai_calls_daily, description
         FROM firm_pricing_configs WHERE active = 1 AND tier_key IS NOT NULL ORDER BY monthly_cents ASC`);
    res.json({ plans: rows, verticals: VALID_VERTICALS, trial_days: TRIAL_DAYS, trial_seats: TRIAL_SEATS });
  } catch (e) {
    logger.error('[firm-acq/plans]', e.message);
    fail(req, res, 500, 'server');
  }
});

router.post('/lead', routeLimiter, async (req, res) => {
  const { email, firm_name, vertical, org_size, message } = req.body || {};
  const mail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 200) : '';
  const name = typeof firm_name === 'string' ? sanitizeStr(firm_name, 200).trim() : '';
  if (!EMAIL_RE.test(mail)) return fail(req, res, 400, 'bad_email');
  if (name.length < 2) return fail(req, res, 400, 'name_required');
  const v = VALID_VERTICALS.includes(vertical) ? vertical : 'general';
  try {
    const db = await getDb();
    const existing = await db.get('SELECT id FROM acquisition_leads WHERE email = ? AND firm_name = ?', [mail, name]);
    if (existing) {
      await db.run('UPDATE acquisition_leads SET vertical = ?, updated_at = NOW() WHERE id = ?', [v, existing.id]);
      return res.json({ captured: true, id: Number(existing.id), existing: true });
    }
    const r = await db.run(
      'INSERT INTO acquisition_leads (email, firm_name, vertical, org_size, message) VALUES (?,?,?,?,?)',
      [mail, name, v, Math.max(0, Number.parseInt(org_size, 10) || 0), typeof message === 'string' ? sanitizeStr(truncateStr(message, 1000), 1000) : null]);
    res.status(201).json({ captured: true, id: r.lastID });
  } catch (e) {
    logger.error('[firm-acq/lead]', e.message);
    fail(req, res, 500, 'server');
  }
});

router.post('/trial', authRequired, routeLimiter, async (req, res) => {
  const { firm_name, vertical = 'general', org_type } = req.body || {};
  const name = typeof firm_name === 'string' ? firm_name.trim() : '';
  if (!PRO_ROLES.has(req.user.role) && Number(req.user.is_defender) !== 1) return fail(req, res, 403, 'attorney_only');
  if (name.length < 2) return fail(req, res, 400, 'name_required');
  if (!VALID_VERTICALS.includes(vertical)) return fail(req, res, 400, 'bad_vertical');
  if (org_type && !VALID_ORG_TYPES.includes(org_type)) return fail(req, res, 400, 'bad_org_type');
  try {
    const db = await getDb();
    const member = await db.get(`SELECT firm_id FROM firm_members WHERE user_id = ? AND COALESCE(status, 'active') = 'active' AND COALESCE(active, 1) = 1 LIMIT 1`, [req.user.id]);
    if (member) return fail(req, res, 409, 'already_member');
    const used = await db.get('SELECT COUNT(*)::int AS n FROM firm_trials WHERE user_id = ?', [req.user.id]);
    if (used.n >= MAX_TRIALS) return fail(req, res, 429, 'trial_limit');

    const std = await db.get(`SELECT seat_limit FROM firm_pricing_configs WHERE tier_key = 'standard' AND active = 1 LIMIT 1`);
    const seats = Number(std?.seat_limit) > 0 ? Number(std.seat_limit) : TRIAL_SEATS;
    const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
    const firmId = await db.transaction(async (tx) => {
      const f = await tx.run(
        `INSERT INTO firms (name, owner_id, vertical, pricing_tier, plan, seat_limit, created_at, updated_at)
         VALUES (?, ?, ?, 'standard', 'trial', ?, NOW(), NOW())`, [truncateStr(name, 200), req.user.id, vertical, seats]);
      const id = f.lastID;
      await tx.run(`INSERT INTO firm_members (firm_id, user_id, firm_role, role, status, active, joined_at) VALUES (?, ?, 'firm_admin', 'firm_admin', 'active', 1, NOW())`, [id, req.user.id]);
      await tx.run(`INSERT INTO firm_vertical_config (firm_id, vertical, updated_at) VALUES (?, ?, NOW()) ON CONFLICT DO NOTHING`, [id, vertical]);
      await tx.run(
        `INSERT INTO firm_trials (firm_id, user_id, vertical, org_type, trial_start, trial_end, ends_at, status, plan)
         VALUES (?, ?, ?, ?, NOW(), ?, ?, 'active', 'trial')`, [id, req.user.id, vertical, org_type || null, trialEnd, trialEnd]);
      return id;
    });
    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId, action: 'create', resource: 'firm_trial', record_id: firmId,
      new_value: { vertical, org_type: org_type || null }, ip: req.ip, ua: req.headers['user-agent'],
    });
    res.status(201).json({ created: true, firm_id: firmId, vertical, trial_end: trialEnd, seat_limit: seats, message: say(req, 'msg.trial_started', { days: TRIAL_DAYS }) });
  } catch (e) {
    logger.error('[firm-acq/trial]', e.message);
    fail(req, res, 500, 'server');
  }
});

/** Trial facts for a firm: { trial_active, trial_ended, trial_end, trial_days_left }. */
async function trialOf(db, firm) {
  const t = await db.get('SELECT COALESCE(trial_end, ends_at) AS trial_end, status FROM firm_trials WHERE firm_id = ? ORDER BY id DESC LIMIT 1', [firm.id]);
  if (!t?.trial_end) return { trial_active: false, trial_ended: false, trial_end: null, trial_days_left: 0 };
  const left = new Date(t.trial_end).getTime() - Date.now();
  const active = firm.plan === 'trial' && left > 0 && t.status !== 'cancelled';
  return { trial_active: active, trial_ended: firm.plan === 'trial' && !active, trial_end: t.trial_end, trial_days_left: active ? Math.ceil(left / 86_400_000) : 0 };
}

router.get('/status', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) {
      const std = await db.get(`SELECT seat_limit FROM firm_pricing_configs WHERE tier_key = 'standard' AND active = 1 LIMIT 1`);
      return res.json({
        has_firm: false, trial_active: false,
        trials_left: Math.max(0, MAX_TRIALS - (await db.get('SELECT COUNT(*)::int AS n FROM firm_trials WHERE user_id = ?', [req.user.id])).n),
        trial_days: TRIAL_DAYS, trial_seats: Number(std?.seat_limit) > 0 ? Number(std.seat_limit) : TRIAL_SEATS,
      });
    }
    const firm = await db.get('SELECT id, name, vertical, pricing_tier, plan, seat_limit, created_at FROM firms WHERE id = ?', [ctx.firm_id]);
    if (!firm) return res.json({ has_firm: false, trial_active: false });
    const [members, matters, pendingInvites, request] = await Promise.all([
      db.get(`SELECT COUNT(*)::int AS n FROM firm_members WHERE firm_id = ? AND COALESCE(status, 'active') = 'active' AND COALESCE(active, 1) = 1`, [firm.id]),
      db.get('SELECT COUNT(*)::int AS n FROM matters WHERE firm_id = ?', [firm.id]),
      db.get('SELECT COUNT(*)::int AS n FROM firm_invites WHERE firm_id = ? AND accepted = 0 AND expires_at > NOW()', [firm.id]),
      db.get(`SELECT target_tier, status, created_at FROM firm_upgrade_requests WHERE firm_id = ? ORDER BY id DESC LIMIT 1`, [firm.id]),
    ]);
    res.json({
      has_firm: true,
      firm: { ...firm, id: Number(firm.id), seat_limit: Number(firm.seat_limit || TRIAL_SEATS) },
      role: ctx.firm_role,
      ...(await trialOf(db, firm)),
      member_count: members.n, matter_count: matters.n, pending_invites: pendingInvites.n,
      upgrade_request: request || null,
    });
  } catch (e) {
    logger.error('[firm-acq/status]', e.message);
    fail(req, res, 500, 'server');
  }
});

router.post('/upgrade', authRequired, routeLimiter, async (req, res) => {
  const { target_tier, notes } = req.body || {};
  if (!VALID_TIERS.includes(target_tier)) return fail(req, res, 400, 'bad_tier');
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) return fail(req, res, 403, 'not_member');
    if (!hasMinRole(ctx.firm_role, 'partner')) return fail(req, res, 403, 'partner_only');
    const firm = await db.get('SELECT id, pricing_tier, plan FROM firms WHERE id = ?', [ctx.firm_id]);
    if (firm.plan !== 'trial' && firm.pricing_tier === target_tier) return fail(req, res, 409, 'same_tier');
    const open = await db.get(`SELECT id FROM firm_upgrade_requests WHERE firm_id = ? AND COALESCE(status, 'pending') = 'pending' AND target_tier = ?`, [firm.id, target_tier]);
    if (open) return res.json({ submitted: true, existing: true, to: target_tier, message: say(req, 'msg.upgrade_pending') });
    const r = await db.run(
      `INSERT INTO firm_upgrade_requests (firm_id, requested_by, current_tier, target_tier, notes, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [firm.id, req.user.id, firm.pricing_tier, target_tier, typeof notes === 'string' ? sanitizeStr(truncateStr(notes, 1000), 1000) : null]);
    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firm.id, action: 'create', resource: 'firm_upgrade_request', record_id: r.lastID,
      new_value: { from: firm.pricing_tier, to: target_tier }, ip: req.ip, ua: req.headers['user-agent'],
    });
    res.status(201).json({
      submitted: true, from: firm.pricing_tier, to: target_tier,
      message: say(req, target_tier === 'mission' || target_tier === 'government' ? 'msg.upgrade_verification' : 'msg.upgrade_requested'),
    });
  } catch (e) {
    logger.error('[firm-acq/upgrade]', e.message);
    fail(req, res, 500, 'server');
  }
});

// Steps the app can check from the firm's own data (no self-reported ticks).
router.get('/checklist', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    let done = { vertical_set: false, team_invited: false, first_matter: false };
    if (ctx) {
      const [firm, team, matters] = await Promise.all([
        db.get('SELECT vertical FROM firms WHERE id = ?', [ctx.firm_id]),
        db.get(`SELECT (SELECT COUNT(*) FROM firm_members WHERE firm_id = ? AND COALESCE(active, 1) = 1) +
                       (SELECT COUNT(*) FROM firm_invites WHERE firm_id = ?) AS n`, [ctx.firm_id, ctx.firm_id]),
        db.get('SELECT COUNT(*)::int AS n FROM matters WHERE firm_id = ?', [ctx.firm_id]),
      ]);
      done = { vertical_set: !!firm?.vertical && firm.vertical !== 'general', team_invited: Number(team?.n || 0) > 1, first_matter: Number(matters?.n || 0) > 0 };
    }
    const checklist = Object.entries(done).map(([key, d]) => ({ key, done: d, required: true }));
    const n = checklist.filter(c => c.done).length;
    res.json({ checklist, completion_pct: Math.round(n / checklist.length * 100), required_done: n, required_total: checklist.length, fully_onboarded: n === checklist.length });
  } catch (e) {
    logger.error('[firm-acq/checklist]', e.message);
    fail(req, res, 500, 'server');
  }
});

/** Active members + open invites must stay within the firm's seats. */
async function seatsLeft(db, firmId) {
  const f = await db.get('SELECT seat_limit FROM firms WHERE id = ?', [firmId]);
  const used = await db.get(`SELECT COUNT(*)::int AS n FROM firm_members WHERE firm_id = ? AND COALESCE(status, 'active') = 'active' AND COALESCE(active, 1) = 1`, [firmId]);
  return Number(f?.seat_limit || TRIAL_SEATS) - used.n;
}

router.post('/invite', authRequired, routeLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 200) : '';
  const role = INVITE_ROLES.includes(req.body?.role) ? req.body.role : 'associate';
  if (!EMAIL_RE.test(email)) return fail(req, res, 400, 'bad_email');
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    if (!ctx) return fail(req, res, 403, 'not_member');
    if (!hasMinRole(ctx.firm_role, 'firm_admin')) return fail(req, res, 403, 'admin_only');
    const already = await db.get(
      `SELECT fm.id FROM firm_members fm JOIN users u ON u.id = fm.user_id
        WHERE fm.firm_id = ? AND LOWER(u.email) = ? AND COALESCE(fm.status, 'active') = 'active' AND COALESCE(fm.active, 1) = 1`, [ctx.firm_id, email]);
    if (already) return fail(req, res, 409, 'already_in_firm');
    if (await seatsLeft(db, ctx.firm_id) <= 0) return fail(req, res, 403, 'no_seats');
    const token = randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await db.run(
      `INSERT INTO firm_invites (firm_id, email, role, invited_by, token, expires_at, accepted) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (firm_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by,
         token = excluded.token, expires_at = excluded.expires_at, accepted = 0`,
      [ctx.firm_id, email, role, req.user.id, token, expires]);
    await writeAuditLog(db, { user_id: req.user.id, firm_id: ctx.firm_id, action: 'invite', resource: 'firm_member', record_id: ctx.firm_id, new_value: { role }, ip: req.ip, ua: req.headers['user-agent'] });
    res.status(201).json({ invited: true, email, role, expires_at: expires, message: say(req, 'msg.invited', { email }) });
  } catch (e) {
    logger.error('[firm-acq/invite]', e.message);
    fail(req, res, 500, 'server');
  }
});

router.get('/invites', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT fi.id, fi.role, fi.expires_at, f.name AS firm_name, u.display_name AS invited_by_name
         FROM firm_invites fi JOIN firms f ON f.id = fi.firm_id LEFT JOIN users u ON u.id = fi.invited_by
        WHERE LOWER(fi.email) = LOWER(?) AND fi.accepted = 0 AND fi.expires_at > NOW()
        ORDER BY fi.id DESC LIMIT 20`, [req.user.email || '']);
    res.json({ invites: rows.map(r => ({ ...r, id: Number(r.id) })) });
  } catch (e) {
    logger.error('[firm-acq/invites]', e.message);
    fail(req, res, 500, 'server');
  }
});

router.post('/invites/:id/accept', authRequired, routeLimiter, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  try {
    const db = await getDb();
    const inv = await db.get(
      `SELECT id, firm_id, role, invited_by FROM firm_invites
        WHERE id = ? AND LOWER(email) = LOWER(?) AND accepted = 0 AND expires_at > NOW()`, [Number.isSafeInteger(id) ? id : 0, req.user.email || '']);
    if (!inv) return fail(req, res, 404, 'invite_not_found');
    const member = await db.get(`SELECT firm_id FROM firm_members WHERE user_id = ? AND COALESCE(status, 'active') = 'active' AND COALESCE(active, 1) = 1 LIMIT 1`, [req.user.id]);
    if (member && Number(member.firm_id) !== Number(inv.firm_id)) return fail(req, res, 409, 'already_member');
    if (!member && await seatsLeft(db, inv.firm_id) <= 0) return fail(req, res, 403, 'no_seats');
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO firm_members (firm_id, user_id, firm_role, role, invited_by, active, status, joined_at)
         VALUES (?, ?, ?, ?, ?, 1, 'active', NOW())
         ON CONFLICT (firm_id, user_id) DO UPDATE SET firm_role = excluded.firm_role, role = excluded.role, active = 1, status = 'active'`,
        [inv.firm_id, req.user.id, inv.role, inv.role, inv.invited_by]);
      await tx.run('UPDATE firm_invites SET accepted = 1 WHERE id = ?', [inv.id]);
    });
    await writeAuditLog(db, { user_id: req.user.id, firm_id: inv.firm_id, action: 'join', resource: 'firm', record_id: inv.firm_id, ip: req.ip, ua: req.headers['user-agent'] });
    res.json({ joined: true, firm_id: Number(inv.firm_id), role: inv.role, message: say(req, 'msg.joined') });
  } catch (e) {
    logger.error('[firm-acq/invites/accept]', e.message);
    fail(req, res, 500, 'server');
  }
});

export default router;
