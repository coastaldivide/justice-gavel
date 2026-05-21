/**
 * attorney/templates.js — Motion templates — list, create, approve
 */
import { err400, err401, err403, err404, err409, err422, err500, err502,
         safeInt, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }       from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb }        from '../../db/index.js';
import logger           from '../../utils/logger.js';
import { sanitiseField, sanitiseProfileFields, requireDefender, STATE_BAR_LOOKUP }
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';

const routeLimiter = makeUserLimiter(30, 60_000); // 30 req/min per user
  from './_helpers.js';

const router = Router();



// GET /api/attorney/templates — all templates for this user's office
router.get('/templates', authRequired, async (req, res) => {
  try {
    const ctx = await requireDefender(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    const { status = 'approved' } = req.query;
    const templates = await db.all(
      `SELECT mt.*, u.name as created_by_name, a.name as approved_by_name
       FROM motion_templates mt
       LEFT JOIN users u ON u.id = mt.created_by
       LEFT JOIN users a ON a.id = mt.approved_by
       WHERE mt.office_id = ? AND (? = 'all' OR mt.status = ?)
       ORDER BY mt.status = 'approved' DESC, mt.created_at DESC
       LIMIT 100`,
      [user.office_id || '', status, status]
    );
    return res.json({ templates, count: templates.length });
  } catch (e) { logger.error('[attorney/templates/list]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// POST /api/attorney/templates — create a new template
router.post('/templates', authRequired, routeLimiter, async (req, res) => {
  try {
    const ctx = await requireDefender(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    const { motion_type, title, content, notes = '' } = req.body;
    if (!motion_type || !title || !content)
      return err400(res, 'motion_type, title, content required');

    const r = await db.run(
      `INSERT INTO motion_templates (office_id, motion_type, title, content, notes, created_by, status)
       VALUES (?,?,?,?,?,?,?)`,
      [user.office_id || '', motion_type, title, content, notes, req.user.id,
       user.office_id ? 'pending' : 'approved']  // no office = self-approved
    );
    return res.status(201).json({ ok: true, id: r.lastID, status: user.office_id ? 'pending' : 'approved' });
  } catch (e) { logger.error('[attorney/templates/create]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// PATCH /api/attorney/templates/:id/approve — supervisor approves a template
router.patch('/templates/:id/approve', authRequired, routeLimiter, async (req, res) => {
  try {
    const ctx = await requireDefender(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    const { approved, rejection_reason = '' } = req.body;

    // Only admin/supervisor role can approve
    const membership = await db.get(
      `SELECT role FROM office_members WHERE user_id=? AND office_id=?`,
      [req.user.id, user.office_id || '']
    ).catch(() => null);
    if (!membership || !['admin','supervisor'].includes(membership.role))
      return res.status(403).json({ error: 'Supervisor or admin role required to approve templates' });

    await db.run(
      `UPDATE motion_templates SET status=?, approved_by=?, approved_at=datetime('now'),
       notes = CASE WHEN ? !== '' THEN notes || char(10) || 'Reviewer: ' || ? ELSE notes END
       WHERE id=? AND office_id=?`,
      [approved ? 'approved' : 'rejected', req.user.id,
       rejection_reason, rejection_reason,
       safeInt(req.params.id), user.office_id || '']
    );
    return res.json({ ok: true, status: approved ? 'approved' : 'rejected' });
  } catch (e) { logger.error('[attorney/templates/approve]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── CLE COURSES ───────────────────────────────────────────────────────────────

export default router;
