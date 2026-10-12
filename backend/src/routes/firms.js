/**
 * routes/firms.js — Firm management and member RBAC
 *
 * POST   /api/firms                    — create a firm (any authenticated user)
 * GET    /api/firms/mine               — get current user's firm
 * PUT    /api/firms/:id                — update firm settings (firm_admin)
 *
 * GET    /api/firms/:id/members        — list members (partner+)
 * POST   /api/firms/:id/members/invite — invite by email (firm_admin)
 * PATCH  /api/firms/:id/members/:uid   — change role (firm_admin)
 * DELETE /api/firms/:id/members/:uid   — remove member (firm_admin)
 *
 * GET    /api/firms/:id/audit          — audit log (partner+)
 */

import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr,
         validateEmail, escapeLike }         from '../utils/routeHelpers.js';
import { Router }                             from 'express';
import { authRequired }                       from '../middleware/auth.js';
import { getDb }                              from '../db/index.js';
import { makeUserLimiter }                    from '../middleware/sharedAiLimiter.js';
import logger                                 from '../utils/logger.js';
import rateLimit                              from 'express-rate-limit';
import { apiLimiter }                         from '../middleware/rateLimiters.js';
import { requireFirmMember, ACTIVE_MEMBER_SQL, effectiveFirmRole } from '../middleware/rbac.js';
import { writeAuditLog, getAuditLog } from '../middleware/audit.js';

const router      = Router();
const firmLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 10, message: 'Too many firm operations.' });
const inviteLimiter    = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: 'Too many invitations — try again later.' });
const directoryLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// firms, firm_members, firm_invites tables managed by db/index.js Year 1 block.

// ── Helper: get user's firm membership ───────────────────────────────────────
async function getMembership(db, userId) {
  const row = await db.get(
    `SELECT fm.*, f.name as firm_name, f.owner_id, f.plan
     FROM firm_members fm
     JOIN firms f ON f.id = fm.firm_id
     WHERE fm.user_id=? AND ${ACTIVE_MEMBER_SQL}
     ORDER BY fm.firm_id ASC
     LIMIT 1`,
    [userId]
  ).catch(() => null);
  return row ? { ...row, role: effectiveFirmRole(row) } : null;
}

// ── POST /api/firms — create firm ─────────────────────────────────────────────
router.post('/', authRequired, firmLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { name } = req.body || {};
    if (!name?.trim()) return err400(res, 'Firm name is required.');

    // Check not already in a firm
    const existing = await getMembership(db, req.user.id);
    if (existing) {
      return res.status(409).json({
        error: `You are already a member of "${existing.firm_name}". Leave that firm first.`,
        code:  'already_in_firm',
      });
    }

    const r = await db.run(
      'INSERT INTO firms (name, owner_id, plan) VALUES (?,?,?)',
      [truncateStr(name.trim(), 200), req.user.id, 'advisor']
    );
    const firmId = r.lastID;

    // Auto-add creator as firm_admin
    await db.run(
      `INSERT INTO firm_members (firm_id, user_id, firm_role, role, invited_by)
       VALUES (?,?,?,?,?)`,
      [firmId, req.user.id, 'firm_admin', 'firm_admin', req.user.id]
    );

    // Update user record with firm_id
    // firm_id denorm — surface failures; mismatch causes authorization bugs
    try {
      await db.run('UPDATE users SET firm_id=? WHERE id=?', [firmId, req.user.id]);
    } catch (e) {
      logger.warn('[firms/create] firm_id sync failed — firm created but user.firm_id stale:', e?.message);
    }

    await writeAuditLog(db, {
      user_id: req.user.id,
      firm_id: firmId,
      action: 'create',
      resource: 'firm',
      record_id: firmId,
      new_value: { name: name.trim(), owner_id: req.user.id },
      ip: req.ip,
      ua: req.headers['user-agent'],
      request_id: req.requestId,
    });

    res.status(201).json({ id: firmId, name: name.trim(), owner_id: req.user.id, plan: 'advisor', your_role: 'firm_admin' });
  } catch (e) {
    logger.error('[firms/create]', e.message);
    res.status(500).json({ error: 'Could not create firm.' });
  }
});

// ── GET /api/firms/mine ───────────────────────────────────────────────────────
router.get('/mine', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const memb = await getMembership(db, req.user.id);
    if (!memb) return res.json({ firm: null, message: 'Not a member of any firm.' });

    const [firm, member_count, matter_count] = await Promise.all([
      db.get('SELECT id, name, owner_id, plan, created_at FROM firms WHERE id=?', [memb.firm_id]),
      db.get('SELECT COUNT(*) as n FROM firm_members WHERE firm_id=? AND active=1', [memb.firm_id]),
      db.get("SELECT COUNT(*) as n FROM matters WHERE firm_id=? AND status='active'", [memb.firm_id]).catch(() => ({ n: 0 })),
    ]);

    res.json({
      firm: { ...firm, member_count: member_count?.n, active_matters: matter_count?.n },
      your_role: memb.role,
      your_title: memb.title,
    });
  } catch (e) {
    logger.error('[firms/mine]', e.message);
    res.status(500).json({ error: 'Could not load firm.' });
  }
});

// ── PUT /api/firms/:id ────────────────────────────────────────────────────────
router.put('/:id', authRequired, requireFirmMember({ minRole: 'firm_admin' }), async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = req.firmMembership.firm_id;

    const { name } = req.body || {};
    if (!name?.trim()) return err400(res, 'name is required.');

    await db.run('UPDATE firms SET name=? WHERE id=?', [truncateStr(name.trim(), 200), firmId]);
    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId,
      action: 'update', resource: 'firm', record_id: firmId,
      new_value: { name: name.trim() },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    const firm = await db.get('SELECT id, name, owner_id, plan, created_at FROM firms WHERE id=?', [firmId]);
    res.json(firm);
  } catch (e) {
    logger.error('[firms/update]', e.message);
    res.status(500).json({ error: 'Could not update firm.' });
  }
});

// ── GET /api/firms/:id/members ────────────────────────────────────────────────
router.get('/:id/members', authRequired, requireFirmMember({ minRole: 'partner' }), async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = req.firmMembership.firm_id;

    const members = await db.all(
      `SELECT fm.id, COALESCE(fm.firm_role, fm.role) AS role, fm.title, fm.joined_at,
              u.id as user_id, u.display_name, u.email,
              inviter.display_name as invited_by_name,
              COUNT(DISTINCT mt.matter_id) as active_matters
       FROM firm_members fm
       JOIN users u ON u.id = fm.user_id
       LEFT JOIN users inviter ON inviter.id = fm.invited_by
       LEFT JOIN matter_teams mt ON mt.user_id=fm.user_id AND mt.active=1
       WHERE fm.firm_id=? AND ${ACTIVE_MEMBER_SQL}
       GROUP BY fm.id, u.id, u.display_name, u.email, inviter.display_name
       ORDER BY
         CASE COALESCE(fm.firm_role, fm.role)
           WHEN 'firm_admin'  THEN 1
           WHEN 'partner'     THEN 2
           WHEN 'associate'   THEN 3
           WHEN 'paralegal'   THEN 4
           WHEN 'client'      THEN 5
           WHEN 'viewer'      THEN 6
           ELSE 7
         END,
         u.display_name ASC`,
      [firmId]
    );

    res.json({ members, total: members.length, firm_id: firmId });
  } catch (e) {
    logger.error('[firms/members]', e.message);
    res.status(500).json({ error: 'Could not load members.' });
  }
});

// ── POST /api/firms/:id/members/invite ────────────────────────────────────────
router.post('/:id/members/invite', authRequired, firmLimiter, requireFirmMember({ minRole: 'firm_admin' }), async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = req.firmMembership.firm_id;

    const { email, role = 'associate', title } = req.body || {};
    if (!email) return err400(res, 'email is required.');
    if (!validateEmail(email)) return err400(res, 'Invalid email address.');

    const VALID_ROLES = ['partner','associate','paralegal','client','viewer'];
    if (!VALID_ROLES.includes(role)) return err400(res, `role must be one of: ${VALID_ROLES.join(', ')}`);

    const safeEmail = email.trim().toLowerCase();

    // Check if already a member
    const existingUser = await db.get('SELECT id FROM users WHERE email=?', [safeEmail]);
    if (existingUser) {
      const alreadyMember = await db.get(
        `SELECT fm.id FROM firm_members fm WHERE fm.firm_id=? AND fm.user_id=? AND ${ACTIVE_MEMBER_SQL}`,
        [firmId, existingUser.id]
      );
      if (alreadyMember) return res.status(409).json({ error: 'User is already a firm member.' });
    }

    // Create invite token
    const { randomBytes } = await import('crypto');
    const token     = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

    // Upsert invite (allow re-invite with new token)
    await db.run(
      `INSERT INTO firm_invites (firm_id, email, role, invited_by, token, expires_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
      [firmId, safeEmail, role, req.user.id, token, expiresAt]
    );

    // If user already has an account, auto-add them to the firm
    if (existingUser) {
      await db.run(
        `INSERT INTO firm_members (firm_id, user_id, firm_role, role, title, invited_by, active, status)
         VALUES (?,?,?,?,?,?,1,'active')
         ON CONFLICT (firm_id, user_id) DO UPDATE SET firm_role=excluded.firm_role, role=excluded.role,
           title=excluded.title, invited_by=excluded.invited_by, active=1, status='active'`,
        [firmId, existingUser.id, role, role, title || null, req.user.id]
      );
    }

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId,
      action: 'invite', resource: 'firm_member',
      record_id: firmId,
      new_value: { email: safeEmail, role },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.status(201).json({
      invited:    true,
      email:      safeEmail,
      role,
      token,
      expires_at: expiresAt,
      auto_added: !!existingUser,
      invite_url: `${process.env.CORS_ORIGIN || 'https://justicegavel.app'}/join-firm?token=${token}`,
    });
  } catch (e) {
    logger.error('[firms/invite]', e.message);
    res.status(500).json({ error: 'Could not create invite.' });
  }
});

// ── PATCH /api/firms/:id/members/:uid — change role ──────────────────────────
router.patch('/:id/members/:uid', authRequired, requireFirmMember({ minRole: 'firm_admin' }), async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = req.firmMembership.firm_id;
    const uid    = safeInt(req.params.uid);

    const { role, title } = req.body || {};
    const VALID_ROLES = ['partner','associate','paralegal','client','viewer','firm_admin'];
    if (role && !VALID_ROLES.includes(role)) return err400(res, `Invalid role.`);

    const before = await db.get(
      `SELECT COALESCE(fm.firm_role, fm.role) AS role, fm.title FROM firm_members fm
        WHERE fm.firm_id=? AND fm.user_id=? AND ${ACTIVE_MEMBER_SQL}`,
      [firmId, uid]
    );
    if (!before) return err404(res, 'Member not found.');

    const updates = []; const params = [];
    // Both role columns are written so every reader sees the same role.
    if (role)  { updates.push('role=?', 'firm_role=?');  params.push(role, role); }
    if (title !== undefined) { updates.push('title=?'); params.push(title ? truncateStr(sanitizeStr(title, 100), 100) : null); }
    if (!updates.length) return err400(res, 'Provide role or title to update.');

    params.push(firmId, uid);
    await db.run(`UPDATE firm_members SET ${updates.join(',')} WHERE firm_id=? AND user_id=?`, params);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId,
      action: 'update', resource: 'firm_member',
      record_id: uid,
      old_value: before,
      new_value: { role: role || before.role, title: title ?? before.title },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.json({ updated: true, user_id: uid, role: role || before.role });
  } catch (e) {
    logger.error('[firms/member/update]', e.message);
    res.status(500).json({ error: 'Could not update member.' });
  }
});

// ── DELETE /api/firms/:id/members/:uid — remove member ───────────────────────
router.delete('/:id/members/:uid', authRequired, requireFirmMember({ minRole: 'firm_admin' }), async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = req.firmMembership.firm_id;
    const uid    = safeInt(req.params.uid);
    if (uid === req.user.id) return err400(res, 'Cannot remove yourself. Transfer firm ownership first.');

    const before = await db.get(`SELECT COALESCE(fm.firm_role, fm.role) AS role FROM firm_members fm WHERE fm.firm_id=? AND fm.user_id=? AND ${ACTIVE_MEMBER_SQL}`, [firmId, uid]);
    if (!before) return err404(res, 'Member not found.');

    // Soft-delete — preserve joined_at and role for audit trail
    await db.run("UPDATE firm_members SET active=0, status='removed' WHERE firm_id=? AND user_id=?", [firmId, uid]);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: firmId,
      action: 'remove', resource: 'firm_member',
      record_id: uid,
      old_value: { role: before.role },
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.json({ removed: true, user_id: uid });
  } catch (e) {
    logger.error('[firms/member/remove]', e.message);
    res.status(500).json({ error: 'Could not remove member.' });
  }
});

// ── GET /api/firms/:id/audit — audit log ─────────────────────────────────────
router.get('/:id/audit', authRequired, requireFirmMember({ minRole: 'partner' }), async (req, res) => {
  try {
    const db     = await getDb();
    const firmId = req.firmMembership.firm_id;

    const { resource, action, user_id, limit = 50, offset = 0, since } = req.query;

    const result = await getAuditLog(db, {
      firm_id:  firmId,
      resource: resource ? sanitizeStr(resource, 50) : null,
      action:   action   ? sanitizeStr(action, 50)   : null,
      user_id:  user_id  ? safeInt(user_id)           : null,
      limit:    Math.min(safeInt(limit, 50), 200),
      offset:   safeInt(offset, 0),
      since:    since    ? sanitizeStr(since, 30)     : null,
    });

    res.json(result);
  } catch (e) {
    logger.error('[firms/audit]', e.message);
    res.status(500).json({ error: 'Could not load audit log.' });
  }
});

// ── POST /api/firms/accept-invite — accept a firm invite by token ─────────────
router.post('/accept-invite', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const { token } = req.body || {};
    if (!token) return err400(res, 'Invite token required.');

    const invite = await db.get(
      'SELECT id, firm_id, email, role, invited_by, token, expires_at FROM firm_invites WHERE token=? AND accepted=0 AND expires_at > NOW() LIMIT 1',
      [token]
    );
    if (!invite) return err404(res, 'Invite not found, already used, or expired.');

    // Verify the accepting user's email matches the invite
    const user = await db.get('SELECT id, email FROM users WHERE id=?', [req.user.id]);
    if (user.email !== invite.email) {
      return err403(res, `This invite was sent to ${invite.email}. Please log in with that account.`);
    }

    // Add to firm
    await db.run(
      `INSERT INTO firm_members (firm_id, user_id, firm_role, role, invited_by, active, status)
       VALUES (?,?,?,?,?,1,'active')
       ON CONFLICT (firm_id, user_id) DO UPDATE SET firm_role=excluded.firm_role, role=excluded.role,
         invited_by=excluded.invited_by, active=1, status='active'`,
      [invite.firm_id, req.user.id, invite.role, invite.role, invite.invited_by]
    );
    await db.run('UPDATE firm_invites SET accepted=1 WHERE id=?', [invite.id]);

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: invite.firm_id,
      action: 'join', resource: 'firm',
      record_id: invite.firm_id,
      ip: req.ip, ua: req.headers['user-agent'],
    });

    const firm = await db.get('SELECT id, name FROM firms WHERE id=?', [invite.firm_id]);
    res.json({ joined: true, firm, role: invite.role });
  } catch (e) {
    logger.error('[firms/accept-invite]', e.message);
    res.status(500).json({ error: 'Could not accept invite.' });
  }
});


// ── GET /firms/:id/invoice-summary — billable, paid, overdue totals ───────
// Firm finance is partner+ of THAT firm (PERMISSIONS.billing.read).
router.get('/:id/invoice-summary', authRequired, requireFirmMember({ minRole: 'partner' }), async (req, res) => {
  const fid = req.firmMembership.firm_id;
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT status, COALESCE(SUM(amount_cents),0) as total_cents, COUNT(*) as count
       FROM invoices WHERE firm_id = ? GROUP BY status`,
      [fid]
    ).catch(() => []);

    const summary = { billed: 0, paid: 0, overdue: 0, draft: 0 };
    for (const r of rows) {
      summary[r.status] = Math.round(r.total_cents / 100);
    }
    summary.outstanding = summary.billed - summary.paid;
    return res.json({ firm_id: fid, summary, currency: 'USD' });
  } catch {
    return res.status(500).json({ error: 'Could not fetch invoice summary' });
  }
});

// ── GET /firms/:id/time-entries — billable time grouped by matter ─────────
router.get('/:id/time-entries', authRequired, requireFirmMember({ minRole: 'partner' }), async (req, res) => {
  const fid = req.firmMembership.firm_id;
  try {
    const db = await getDb();
    const entries = await db.all(
      `SELECT te.matter_id, m.title as matter_title,
              SUM(te.duration_minutes) as total_minutes,
              SUM(te.duration_minutes * te.rate_cents / 60) as billable_cents,
              COUNT(*) as entry_count
       FROM time_entries te
       LEFT JOIN matters m ON m.id = te.matter_id
       WHERE te.firm_id = ?
       GROUP BY te.matter_id, m.title
       ORDER BY billable_cents DESC LIMIT 50`,
      [fid]
    ).catch(() => []);

    return res.json({
      firm_id: fid,
      entries: entries.map(e => ({
        ...e,
        total_hours:     Math.round(e.total_minutes / 60 * 10) / 10,
        billable_dollars: Math.round(e.billable_cents / 100),
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Could not fetch time entries' });
  }
});

// ── GET /firms/trial-status — current trial days remaining ─────────────────
router.get('/trial-status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const trial = await db.get(
      `SELECT ft.firm_id, ft.trial_end_at, ft.plan,
              GREATEST(0, EXTRACT(DAY FROM ft.trial_end_at - NOW())) as days_remaining
       FROM firm_trials ft
       JOIN firm_members fm ON fm.firm_id = ft.firm_id
       WHERE fm.user_id = ? AND ${ACTIVE_MEMBER_SQL} AND ft.active = true LIMIT 1`,
      [req.user.id]
    ).catch(() => null);

    if (!trial) return res.json({ in_trial: false });
    return res.json({
      in_trial:        true,
      days_remaining:  parseInt(trial.days_remaining, 10),
      plan:            trial.plan,
      trial_ends:      trial.trial_end_at,
    });
  } catch {
    return res.status(500).json({ error: 'Could not fetch trial status' });
  }
});


// ── GET /firms/directory — public list of firms accepting new clients ──────
router.get('/directory', directoryLimiter, async (req, res) => {
  const { practice_area, page = '1' } = req.query;
    const state = req.query.state
      ? req.query.state.replace(/[^A-Z]/gi,'').toUpperCase().slice(0,2) // 2-char alpha only
      : null;
  const offset = (parseInt(page, 10) - 1) * 20;
  try {
    const db = await getDb();
    const params = [];
    let sql = `SELECT f.id, f.name, f.city, f.state, f.practice_areas,
                      f.accepting_clients, f.free_consultation, f.website, COUNT(fm.id) as attorney_count
               FROM firms f
               LEFT JOIN firm_members fm ON fm.firm_id = f.id AND fm.active = 1
               WHERE f.public_listing = true AND f.accepting_clients = true `;
    if (state)          { sql += 'AND f.state = ? '; params.push(state); }
    if (practice_area)  { sql += 'AND f.practice_areas ILIKE ? '; params.push('%' + escapeLike(String(practice_area).slice(0, 100)) + '%'); }
    sql += 'GROUP BY f.id ORDER BY attorney_count DESC, f.name ASC LIMIT 20 OFFSET ?';
    params.push(offset);
    const firms = await db.all(sql, params);
    // Get total count for pagination
    const countRow = await db.get(
      `SELECT COUNT(*) as n FROM firms WHERE public_listing = true AND accepting_clients = true` +
      (state ? ' AND state = ?' : ''),
      state ? [state] : []
    ).catch(() => ({ n: 0 }));
    return res.json({
      firms,
      page:        parseInt(page, 10),
      count:       firms.length,
      total_count: parseInt(countRow?.n ?? 0, 10),
      total_pages: Math.ceil((countRow?.n ?? 0) / 20),
    });
  } catch {
    return res.status(500).json({ error: 'Could not load firm directory' });
  }
});

// ── GET /firms/:id/public-profile — public firm card for clients ───────────
router.get('/:id/public-profile', apiLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid firm ID' });
  try {
    const db = await getDb();
    const firm = await db.get(
      `SELECT id, name, city, state, practice_areas, accepting_clients,
              free_consultation, website, phone, description
       FROM firms WHERE id = ? AND public_listing = true`,
      [id]
    ).catch(() => null);
    if (!firm) return res.status(404).json({ error: 'Firm not found or not public' });
    const members = await db.all(
      `SELECT u.id, u.display_name, fm.firm_role FROM firm_members fm
       JOIN users u ON u.id = fm.user_id WHERE fm.firm_id = ? AND fm.active = 1 LIMIT 10`,
      [id]
    ).catch(() => []);
    return res.json({ ...firm, attorneys: members });
  } catch {
    return res.status(500).json({ error: 'Could not load firm profile' });
  }
});

// ── POST /firms/:id/invite — send email invitation to join firm ───────────
router.post('/:id/invite', authRequired, inviteLimiter, requireFirmMember({ minRole: 'firm_admin' }), async (req, res) => {
  const fid         = req.firmMembership.firm_id;
  const { email } = req.body || {};
  // Invites can only grant a real firm tier below firm_admin.
  const role = ['partner','associate','paralegal','client','viewer'].includes(req.body?.role) ? req.body.role : 'associate';
  if (!email || !validateEmail(String(email))) return res.status(400).json({ error: 'A valid email is required' });
  try {
    const db = await getDb();
    const firm = await db.get('SELECT name, invite_code FROM firms WHERE id = ?', [fid]).catch(() => null);
    if (!firm) return res.status(404).json({ error: 'Firm not found' });

    // Store invitation
    await db.run(
      `INSERT INTO firm_invites (firm_id, invited_by, email, role, created_at)
       VALUES (?,?,?,?,NOW()) ON CONFLICT (firm_id, email) DO UPDATE SET role=?, created_at=NOW()`,
      [fid, req.user.id, email.toLowerCase(), role, role]
    );

    // Send invitation email (non-blocking)
    const { sendEmail } = await import('../services/email.js').catch(() => ({}));
    if (sendEmail) {
      sendEmail({
        to:      email,
        subject: `You've been invited to join ${firm.name} on Justice Gavel`,
        text:    `You have been invited to join the ${firm.name} team on Justice Gavel.

Download the app and use code ${firm.invite_code} to join your firm.

Justice Gavel: https://justicegavel.com`,
      }).catch(() => {});
    }

    return res.status(201).json({ invited: true, email, firm_name: firm.name });
  } catch {
    return res.status(500).json({ error: 'Could not send invitation' });
  }
});

// ── GET /firms/referral/:code — look up firm by referral code ─────────────
router.get('/referral/:code', apiLimiter, async (req, res) => {
  const code = req.params.code?.toUpperCase().trim();
  if (!code || code.length < 4) return res.status(400).json({ error: 'Invalid code' });
  try {
    const db = await getDb();
    const firm = await db.get(
      `SELECT id, name, city, state, practice_areas, free_consultation
       FROM firms WHERE UPPER(invite_code) = ? AND public_listing = true`,
      [code]
    ).catch(() => null);
    if (!firm) return res.status(404).json({ error: 'Firm not found. Check your code and try again.' });
    return res.json({ found: true, firm });
  } catch {
    return res.status(500).json({ error: 'Could not look up referral code' });
  }
});

export default router;
