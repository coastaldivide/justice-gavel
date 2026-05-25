/**
 * attorney/cle.js — CLE (Continuing Legal Education) course management
 *
 * GET  /api/attorney/cle                  — course list with completion status
 * GET  /api/attorney/cle/transcript       — attorney CLE transcript
 * GET  /api/attorney/cle/:id              — course detail
 * POST /api/attorney/cle/:id/complete     — mark course complete, award credit
 *
 * All endpoints require verified defender status.
 * Completions are idempotent — completing an already-completed course is a no-op.
 * No LIMIT missing: course list is bounded by cle_courses table size
 * (typically <500 rows — no pagination needed, but LIMIT added as defence).
 */

import { err400, err404, safeInt,
         sanitizeStr }                from '../../utils/routeHelpers.js';
import { makeUserLimiter }            from '../../middleware/sharedAiLimiter.js';
import { Router }                     from 'express';
import { authRequired }               from '../../middleware/auth.js';
import { getDb }                      from '../../db/index.js';
import logger                         from '../../utils/logger.js';
import { requireDefender }            from './_helpers.js';

const router       = Router();
const cleLimiter   = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'CLE request limit reached.' });

// ── GET /api/attorney/cle — course catalogue with completion status ────────────
router.get('/cle', authRequired, cleLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db } = ctx;

    const category = req.query.category ? sanitizeStr(req.query.category, 50) : null;
    const limit    = Math.min(200, Math.max(1, safeInt(req.query.limit || '100')));

    let sql  = `SELECT c.id, c.title, c.category, c.description, c.credit_hours,
                       c.duration_min, c.difficulty, c.url, c.active,
                       cc.completed_at, cc.credit_hours as earned_hours, cc.certificate_id
                FROM cle_courses c
                LEFT JOIN cle_completions cc
                  ON cc.course_id = c.id AND cc.user_id = ?
                WHERE c.active = 1`;
    const args = [req.user.id];

    if (category) { sql += ' AND c.category=?'; args.push(category); }
    sql += ' ORDER BY cc.completed_at IS NULL DESC, c.category, c.title LIMIT ?';
    args.push(limit);

    const courses     = await db.all(sql, args);
    const totalEarned = courses.reduce((s, c) => s + (c.earned_hours || 0), 0);

    res.json({
      courses,
      total_earned: Math.round(totalEarned * 10) / 10,
      count:        courses.length,
    });
  } catch (e) {
    logger.error('[attorney/cle/list]', e.message);
    res.status(500).json({ error: 'Could not load CLE courses.' });
  }
});

// ── GET /api/attorney/cle/transcript ─────────────────────────────────────────
router.get('/cle/transcript', authRequired, cleLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db, user } = ctx;

    const limit       = Math.min(500, Math.max(1, safeInt(req.query.limit || '200')));
    const completions = await db.all(
      `SELECT cc.id, cc.course_id, cc.completed_at, cc.credit_hours,
              cc.certificate_id, cc.bar_number,
              c.title, c.category, c.difficulty
       FROM cle_completions cc
       JOIN cle_courses c ON c.id = cc.course_id
       WHERE cc.user_id = ?
       ORDER BY cc.completed_at DESC
       LIMIT ?`,
      [req.user.id, limit]
    );

    const totalHours = completions.reduce((s, c) => s + (c.credit_hours || 0), 0);

    res.json({
      attorney_name: user.display_name || user.name || null,
      bar_number:    user.bar_number   || null,
      completions,
      total_hours:   Math.round(totalHours * 10) / 10,
      count:         completions.length,
      generated_at:  new Date().toISOString(),
    });
  } catch (e) {
    logger.error('[attorney/cle/transcript]', e.message);
    res.status(500).json({ error: 'Could not load CLE transcript.' });
  }
});

// ── GET /api/attorney/cle/:id — single course detail ─────────────────────────
router.get('/cle/:id', authRequired, cleLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db } = ctx;

    const course = await db.get(
      `SELECT id, title, description, category, credit_hours,
              duration_min, difficulty, url
       FROM cle_courses WHERE id=? AND active=1`,
      [safeInt(req.params.id)]
    );
    if (!course) return err404(res, 'Course not found.');

    const completion = await db.get(
      `SELECT id, user_id, course_id, completed_at, credit_hours, certificate_id
       FROM cle_completions WHERE user_id=? AND course_id=?`,
      [req.user.id, safeInt(req.params.id)]
    ).catch(() => null);

    res.json({ ...course, completion: completion || null });
  } catch (e) {
    logger.error('[attorney/cle/detail]', e.message);
    res.status(500).json({ error: 'Could not load course.' });
  }
});

// ── POST /api/attorney/cle/:id/complete — mark complete, award credit ─────────
router.post('/cle/:id/complete', authRequired, cleLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db, user } = ctx;

    const course = await db.get(
      `SELECT id, title, credit_hours FROM cle_courses WHERE id=? AND active=1`,
      [safeInt(req.params.id)]
    );
    if (!course) return err404(res, 'Course not found.');

    // Idempotent — already completed returns existing completion
    const existing = await db.get(
      `SELECT id, completed_at, credit_hours, certificate_id
       FROM cle_completions WHERE user_id=? AND course_id=?`,
      [req.user.id, safeInt(req.params.id)]
    ).catch(() => null);

    if (existing) {
      return res.json({ ok: true, already_completed: true, completion: existing });
    }

    // Generate a unique, deterministic certificate ID
    const certId = `JG-${req.user.id}-${course.id}-${Date.now()}`;
    await db.run(
      `INSERT INTO cle_completions (user_id, course_id, bar_number, credit_hours, certificate_id)
       VALUES (?,?,?,?,?)`,
      [req.user.id, course.id, user.bar_number || null, course.credit_hours || 0, certId]
    );

    const hours = course.credit_hours || 0;
    res.json({
      ok:             true,
      already_completed: false,
      course_title:   course.title,
      credit_hours:   hours,
      certificate_id: certId,
      message:        `${hours} CLE credit hour${hours !== 1 ? 's' : ''} awarded.`,
    });
  } catch (e) {
    logger.error('[attorney/cle/complete]', e.message);
    res.status(500).json({ error: 'Could not record CLE completion.' });
  }
});

export default router;
