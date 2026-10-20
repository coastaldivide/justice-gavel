import { safeInt } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired, optionalAuth } from '../middleware/auth.js';

import { getDb } from '../db/index.js';
import { buildLegacyRightsCard } from '../services/rightsContent.js';
import { msg, resolveLang } from '../i18n/index.js';

const router = Router();

// ── Filtering helper ─────────────────────────────────────────────────────


const lessonsLimiter = makeUserLimiter({ windowMs: 3600000, max: 100, message: 'Lesson completion limit reached. Try again later.' });


const fail = (res, lang, status, key) => res.status(status).json({ error: key, code: key, message: msg(lang, `lessons.err.${key}`) });
const reqLang = (req) => resolveLang(req);

// GET /api/lessons — public (the "Know your rights" lessons are free to read).
// The lesson text is in English only (content: the column migration 22 reworded).
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, title, category, COALESCE(content, body) AS content, COALESCE(points, 10) AS points,
              difficulty, duration_min, 'en' AS language
         FROM lessons WHERE COALESCE(needs_review, 0) = 0 ORDER BY id ASC LIMIT 200`);
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=3600');
    return res.json(rows.map(r => ({ ...r, points: Number(r.points) })));
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); fail(res, reqLang(req), 500, 'load'); }
});

// POST /api/lessons/:id/complete — once per person per lesson; the lesson's points are added once.
router.post('/:id/complete', authRequired, lessonsLimiter, async (req, res) => {
  const lang = reqLang(req);
  try {
    const db = await getDb();
    const lesson = await db.get('SELECT id, COALESCE(points, 10) AS points FROM lessons WHERE id = ?', [safeInt(req.params.id)]);
    if (!lesson) return fail(res, lang, 404, 'not_found');
    const ins = await db.run(
      `INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at)
       VALUES (?, ?, 1, NOW()) ON CONFLICT (user_id, lesson_id) DO NOTHING`,
      [req.user.id, lesson.id]
    );
    const points = Number(lesson.points);
    if (ins.changes) {
      await db.run(
        'INSERT INTO rewards (user_id, points, updated_at) VALUES (?, ?, NOW()) ON CONFLICT(user_id) DO UPDATE SET points = rewards.points + excluded.points, updated_at = NOW()',
        [req.user.id, points]
      );
    }
    return res.json({ ok: true, lesson_id: Number(lesson.id), alreadyCompleted: !ins.changes, pointsAwarded: ins.changes ? points : 0 });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); fail(res, lang, 500, 'complete'); }
});

router.get('/progress/:userId', authRequired, async (req, res, next) => {
  if (req.params.userId === 'me') return next('route');      // handled by /progress/me below
  if (String(req.params.userId) !== String(req.user.id) && !['admin', 'super_admin'].includes(req.user.role)) {
    return fail(res, reqLang(req), 403, 'own_progress');
  }
  try {
    const db = await getDb();
    const rows = await db.all('SELECT lesson_id FROM lesson_progress WHERE user_id=? AND completed=1 LIMIT 1000', [req.params.userId]);
    const rewards = await db.get('SELECT points FROM rewards WHERE user_id=?', [req.params.userId]);
    return res.json({ completed: rows.map(r => r.lesson_id), points: rewards?.points || 0 });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); fail(res, reqLang(req), 500, 'load'); }
});

// ── GET /api/lessons/rights-card?state=XX ─────────────────────────────────────
// Legacy wallet-card shape, built from services/rightsContent.js (the same
// sourced content as GET /api/rights/:state). Public: guest core path.
router.get('/rights-card', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('Vary', 'Accept-Language');
    return res.json(buildLegacyRightsCard(req.query.state || 'US', resolveLang(req)));
  } catch (_e) {
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.', code: 'server_error' });
  }
});

// GET /api/lessons/progress/me — current user's streak + completed count
router.get('/progress/me', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const completed = await db.all(
      'SELECT lesson_id, completed_at FROM lesson_progress WHERE user_id=? AND completed=1 ORDER BY completed_at DESC LIMIT 1000',
      [req.user.id]
    );
    // Calculate streak
    const days = [...new Set(completed.filter(r => r.completed_at).map(r => new Date(r.completed_at).toISOString().slice(0,10)))].sort().reverse();
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < days.length; i++) {
      const d = new Date(days[i]); d.setHours(0,0,0,0);
      const expected = new Date(today); expected.setDate(today.getDate() - i);
      if (d.getTime() === expected.getTime()) streak++;
      else break;
    }
    const rewards = await db.get('SELECT points FROM rewards WHERE user_id=?', [req.user.id]);
    return res.json({ completed: completed.length, streak, lesson_ids: completed.map(r => Number(r.lesson_id)), points: Number(rewards?.points || 0) });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message });
    return fail(res, reqLang(req), 500, 'load');
  }
});


// ── GET /lessons/streak/:userId — current streak and stats ───────────────
router.get('/streak/:userId', authRequired, async (req, res) => {
  const _rawUid = parseInt(req.params.userId, 10);
  const uid    = isNaN(_rawUid) || _rawUid <= 0 ? req.user.id : _rawUid;
  // Your own streak only (staff may look at anyone's).
  if (String(uid) !== String(req.user.id) && !['admin', 'super_admin'].includes(req.user.role)) return fail(res, reqLang(req), 403, 'own_progress');
  try {
    const db = await getDb();
    const progress = await db.all(
      `SELECT DATE(completed_at) as day  -- Postgres: ::DATE; SQLite: DATE(), COUNT(*) as lessons
       FROM lesson_progress WHERE user_id = ? AND completed = 1
       AND completed_at > NOW() - INTERVAL '365 days'  -- Postgres/Supabase only
       GROUP BY day ORDER BY day DESC`,
      [uid]
    ).catch(() => []);

    // Calculate current streak (consecutive days)
    let streak = 0;
    let today  = new Date(); today.setHours(0,0,0,0);
    for (const row of progress) {
      const rowDay = new Date(row.day); rowDay.setHours(0,0,0,0);
      const diffDays = Math.round((today - rowDay) / 86400000);
      if (diffDays === streak) { streak++; today = rowDay; }
      else break;
    }

    const totalCompleted = await db.get(
      'SELECT COUNT(*) as n, COALESCE(SUM(l.points),0) as total_points FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE lp.user_id = ? AND lp.completed = true',
      [uid]
    ).catch(() => ({ n: 0, total_points: 0 }));

    return res.json({
      user_id:          uid,
      streak_days:      streak,
      total_completed:  totalCompleted?.n || 0,
      total_points:     totalCompleted?.total_points || 0,
      last_7_days:      progress.slice(0, 7),
    });
  } catch (e) {
    logger.error({ msg: '[lessons/streak]', error: e?.message });
    return fail(res, reqLang(req), 500, 'load');
  }
});

export default router;