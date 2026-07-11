import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router }    from 'express';
import rateLimit from 'express-rate-limit';

import { getDb }        from '../db/index.js';
import { optionalAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';
const router = Router();

// ── Input sanitizer (XSS prevention for feedback fields) ─────────────────
const sanitize = str => String(str || '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#x27;').replace(/\/g,'&#x2F;')
  .trim();


const feedbackLimiter = rateLimit({ windowMs: 10*60*1000, max: 5, message: { error: 'Too many submissions. Try again in 10 minutes.' } });

router.post('/', feedbackLimiter, optionalAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { rating = 5, comment: rawComment = '' } = req.body || {};
    const comment = rawComment ? truncateStr(sanitizeStr(String(rawComment), 1000), 1000) : '';
    const userId = req.user?.id || 'anon'; // prefer authenticated user; fall back to anon
    const r = safeInt(rating);
    if (isNaN(r) || r < 1 || r > 5) return err400(res, 'rating must be 1–5');
    const result = await db.run(
      'INSERT INTO feedback (user_id, rating, comment) VALUES (?,?,?)',
      [String(userId), r, String(comment).substring(0, 1000)]
    );
    const row = await db.get('SELECT id, user_id, rating, comment, created_at FROM feedback WHERE id=?', [result.lastID]);
    // Award 5 points for feedback (authenticated users only)
    if (req.user?.id) {
      await db.run(
        'INSERT INTO rewards (user_id, points) VALUES (?,5) ON CONFLICT(user_id) DO UPDATE SET points=points+5, updated_at=datetime("now")',
        [String(userId)]
      ).catch(() => {});
    }
    res.json({ ...row, pointsAwarded: 5 });
  } catch (e) {
    logger.error('[feedback]', e.message);
    res.status(500).json({ error: 'Could not save feedback' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const db = await getDb();
    const avg = await db.get('SELECT AVG(rating) as avg, COUNT(*) as total FROM feedback');
    res.json({ averageRating: Math.round((avg?.avg ?? 0) * 10) / 10, totalResponses: avg?.total });
  } catch (e) {
    res.status(500).json({ error: 'Could not load summary' });
  }
});


// ── POST /feedback/ui — in-app UI feedback from beta users ────────────────
// screen: which screen had the issue
// issue: brief description
// contact: optional email/phone for follow-up
router.post('/ui', async (req, res) => {
  const raw = req.body || {};
  const screen = sanitize(raw.screen).slice(0, 100);
  const issue  = sanitize(raw.issue).slice(0, 2000);
  const contact= sanitize(raw.contact).slice(0, 200);
  const device_info = sanitize(raw.device_info).slice(0, 500);
  if (!issue?.trim()) return res.status(400).json({ error: 'issue description required' });

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO feedback (user_id, screen, issue, contact, device_info, created_at)
       VALUES (?,?,?,?,?,NOW())`,
      [req.user?.id || null, screen || 'unknown', issue.slice(0, 2000),
       contact?.slice(0, 200) || null, device_info?.slice(0, 500) || null]
    ).catch(() => {});

    // Notify Slack (non-blocking)
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: [
            '*New UI Feedback*',
            `Screen: ${screen || 'unknown'}`,
            `Issue: ${issue.slice(0, 500)}`,
            contact ? `Contact: ${contact}` : null,
          ].filter(Boolean).join('\n'),
        }),
      }).catch(() => {});
    }

    return res.json({ received: true, message: 'Thank you — your feedback helps us improve Justice Gavel.' });
  } catch (e) {
    return res.status(500).json({ error: 'Could not submit feedback' });
  }
});

export default router;
