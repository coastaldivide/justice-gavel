import { safeInt } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import { buildLegacyRightsCard } from '../services/rightsContent.js';

const router = Router();

// ── Filtering helper ─────────────────────────────────────────────────────


const lessonsLimiter = makeUserLimiter({ windowMs: 3600000, max: 100, message: 'Lesson completion limit reached. Try again later.' });


router.get('/', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT id, title, category, body, body as content, difficulty, duration_min FROM lessons ORDER BY id ASC LIMIT 200');
    res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=3600');
    return res.json(rows);
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); res.status(500).json({ error: 'Could not load lessons' }); }
});

router.post('/:id/complete', authRequired, lessonsLimiter, async (req, res) => {
  try {
    const db = await getDb();
    // Always use authenticated user ID — never trust user_id from body
    const user_id = req.user.id;
    const lesson_id = safeInt(req.params.id);
    // Upsert progress
    const existing = await db.get('SELECT id, user_id, lesson_id, completed, completed_at FROM lesson_progress WHERE user_id=? AND lesson_id=? LIMIT 1', [user_id, lesson_id]);
    if (!existing) {
      await db.run(
        `INSERT INTO lesson_progress (user_id, lesson_id, completed, completed_at)
         VALUES (?,?,1,NOW())`,
        [user_id, lesson_id]
      );
    }
    // Award points
    await db.run(
      'INSERT INTO rewards (user_id, points, updated_at) VALUES (?,10, NOW()) ON CONFLICT(user_id) DO UPDATE SET points = rewards.points + 10, updated_at = NOW()',
      [user_id]
    );
    return res.json({ ok: true, pointsAwarded: 10 });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); res.status(500).json({ error: 'Could not mark complete' }); }
});

router.get('/progress/:userId', authRequired, async (req, res, next) => {
  if (req.params.userId === 'me') return next('route');      // handled by /progress/me below
  if (String(req.params.userId) !== String(req.user.id) && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'You can only view your own progress.' });
  }
  try {
    const db = await getDb();
    const rows = await db.all('SELECT lesson_id FROM lesson_progress WHERE user_id=? AND completed=1 LIMIT 1000', [req.params.userId]);
    const rewards = await db.get('SELECT points FROM rewards WHERE user_id=?', [req.params.userId]);
    return res.json({ completed: rows.map(r => r.lesson_id), points: rewards?.points || 0 });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message }); res.status(500).json({ error: 'Could not load progress' }); }
});

// ── GET /api/lessons/rights-card?state=XX ─────────────────────────────────────
// Legacy wallet-card shape, built from services/rightsContent.js (the same
// sourced content as GET /api/rights/:state). Public: guest core path.
router.get('/rights-card', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.json(buildLegacyRightsCard(req.query.state || 'US'));
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
    return res.json({ completed: completed.length, streak, lesson_ids: completed.map(r => r.lesson_id) });
  } catch (e) {
    logger.error({ msg: '[lessons]', error: e?.message });
    const statusCode = e?.status || e?.statusCode || 500;
        const clientMsg = statusCode < 500 ? (e?.message || 'Request failed') : 'An error occurred. Please try again.';
        return res.status(statusCode).json({ error: clientMsg, code: e?.code || 'internal_error' });
  }
});


// ── GET /lessons/streak/:userId — current streak and stats ───────────────
router.get('/streak/:userId', authRequired, async (req, res) => {
  const _rawUid = parseInt(req.params.userId, 10);
  const uid    = isNaN(_rawUid) || _rawUid <= 0 ? req.user.id : _rawUid;
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
  } catch {
    return res.status(500).json({ error: 'Could not fetch streak' });
  }
});

export default router;