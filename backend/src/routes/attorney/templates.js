/**
 * attorney/templates.js — Motion templates — list, create, approve
 */
import { safeInt } from '../../utils/routeHelpers.js';
import { resolveLang, msg } from '../../i18n/index.js';
const say = (req, k) => msg(resolveLang(req), `attorney.err.${k}`);
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import logger           from '../../utils/logger.js';
import { requireAttorney } from './_helpers.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter({ windowMs: 60_000, max: 30 }); // 30 req/min per user

const router = Router();


// GET /api/attorney/templates — all templates for this user's office
router.get('/templates', authRequired, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    const status = ['approved', 'pending', 'rejected', 'all'].includes(req.query.status) ? req.query.status : 'approved';
    // The office's shared templates; without an office, the attorney's own.
    const scope = user.office_id ? 'mt.office_id = ?' : 'mt.office_id IS NULL AND mt.created_by = ?';
    const templates = await db.all(
      `SELECT mt.id, mt.motion_type, mt.title, mt.notes, mt.status, mt.created_at, mt.approved_at,
              u.display_name AS created_by_name, a.display_name AS approved_by_name
       FROM motion_templates mt
       LEFT JOIN users u ON u.id = mt.created_by
       LEFT JOIN users a ON a.id = mt.approved_by
       WHERE ${scope} AND (? = 'all' OR mt.status = ?)
       ORDER BY (mt.status = 'approved') DESC, mt.created_at DESC
       LIMIT 100`,
      [user.office_id || req.user.id, status, status]
    );
    return res.json({ templates, count: templates.length });
  } catch (e) { logger.error('[attorney/templates/list]', e.message); res.status(500).json({ error: say(req, 'server'), code: 'server_error' }); }
});

// POST /api/attorney/templates — create a new template
router.post('/templates', authRequired, routeLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    const { motion_type, title, content, notes = '' } = req.body;
    if (!motion_type || !title || !content)
      return res.status(400).json({ error: say(req, 'template_fields'), code: 'missing_fields' });

    const r = await db.run(
      `INSERT INTO motion_templates (office_id, motion_type, title, content, notes, created_by, status)
       VALUES (?,?,?,?,?,?,?)`,
      [user.office_id || null, String(motion_type).slice(0, 80), String(title).slice(0, 200), String(content).slice(0, 50000), String(notes || '').slice(0, 1000), req.user.id,
       user.office_id ? 'pending' : 'approved']  // no office = self-approved
    );
    return res.status(201).json({ ok: true, id: r.lastID, status: user.office_id ? 'pending' : 'approved' });
  } catch (e) { logger.error('[attorney/templates/create]', e.message); res.status(500).json({ error: say(req, 'server'), code: 'server_error' }); }
});

// PATCH /api/attorney/templates/:id/approve — supervisor approves a template
router.patch('/templates/:id/approve', authRequired, routeLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    const { approved, rejection_reason = '' } = req.body;

    // Only admin/supervisor role can approve
    const membership = await db.get(
      `SELECT role FROM office_members WHERE user_id=? AND office_id=?`,
      [req.user.id, user.office_id || 0]
    ).catch(() => null);
    if (!membership || !['admin','supervisor'].includes(membership.role))
      return res.status(403).json({ error: say(req, 'supervisor_only'), code: 'forbidden' });

    const r = await db.run(
      `UPDATE motion_templates SET status=?, approved_by=?, approved_at=NOW(),
       notes = CASE WHEN COALESCE(?, '') <> '' THEN COALESCE(notes, '') || chr(10) || 'Reviewer: ' || ? ELSE notes END
       WHERE id=? AND office_id=?`,
      [approved ? 'approved' : 'rejected', req.user.id,
       rejection_reason || '', rejection_reason || '',
       safeInt(req.params.id), user.office_id || null]
    );
    if (!r.changes) return res.status(404).json({ error: say(req, 'template_not_found'), code: 'not_found' });
    return res.json({ ok: true, status: approved ? 'approved' : 'rejected' });
  } catch (e) { logger.error('[attorney/templates/approve]', e.message); res.status(500).json({ error: say(req, 'server'), code: 'server_error' }); }
});

// ── CLE COURSES ───────────────────────────────────────────────────────────────

export default router;
