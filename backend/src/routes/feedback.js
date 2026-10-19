/**
 * routes/feedback.js — app feedback (rating + comment) and beta UI issue reports.
 *
 * POST /api/feedback        rating 1–5 + optional comment. Works signed in or
 *                           anonymously (user_id NULL); signed-in users earn 5 points.
 * GET  /api/feedback/summary aggregate rating.
 * POST /api/feedback/ui     beta UI issue report (screen, issue, optional contact).
 *
 * User text is stored as typed (control characters stripped, never HTML-encoded);
 * it is escaped only where it is rendered into another format (the Slack ping).
 */
import { fetchWithTimeout } from '../utils/http.js';
import { Router }    from 'express';
import rateLimit     from 'express-rate-limit';

import { getDb }        from '../db/index.js';
import { optionalAuth } from '../middleware/auth.js';
import { err400 }       from '../utils/routeHelpers.js';
import { sanitizeStr }  from '../utils/sanitize.js';
import logger from '../utils/logger.js';

const router = Router();

const feedbackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in 10 minutes.' },
});

/** Clean user text for storage and cap its length (null when empty). */
function cleanText(value, maxLen) {
  if (value === undefined || value === null) return null;
  const s = sanitizeStr(String(value)).slice(0, maxLen);
  return s || null;
}

/** Slack mrkdwn only treats &, < and > specially. */
const slackEscape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The signed-in user's numeric id, or null for anonymous feedback. */
function feedbackUserId(req) {
  const id = Number(req.user?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.post('/', feedbackLimiter, optionalAuth, async (req, res) => {
  const { rating = 5, comment: rawComment = '' } = req.body || {};
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return err400(res, 'rating must be 1–5');
  const comment = cleanText(rawComment, 1000) || '';
  const userId = feedbackUserId(req);

  try {
    const db = await getDb();
    const result = await db.run(
      'INSERT INTO feedback (user_id, rating, comment) VALUES (?,?,?)',
      [userId, r, comment]
    );
    const row = await db.get('SELECT id, rating, comment, created_at FROM feedback WHERE id=?', [result.lastID]);
    let pointsAwarded = 0;
    if (userId) {
      await db.run(
        'INSERT INTO rewards (user_id, points) VALUES (?,5) ON CONFLICT(user_id) DO UPDATE SET points = rewards.points + 5, updated_at = NOW()',
        [userId]
      ).then(() => { pointsAwarded = 5; })
        .catch(e => logger.warn('[feedback] reward points not awarded:', e.message));
    }
    res.status(201).json({ ...row, anonymous: !userId, pointsAwarded });
  } catch (e) {
    logger.error('[feedback]', e.message);
    res.status(500).json({ error: 'Could not save feedback' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const db = await getDb();
    const avg = await db.get('SELECT AVG(rating) as avg, COUNT(rating) as total FROM feedback WHERE rating IS NOT NULL');
    res.json({ averageRating: Math.round(Number(avg?.avg ?? 0) * 10) / 10, totalResponses: Number(avg?.total ?? 0) });
  } catch {
    res.status(500).json({ error: 'Could not load summary' });
  }
});

// ── POST /feedback/ui — in-app UI feedback from beta users ────────────────
// screen: which screen had the issue · issue: description · contact: optional
router.post('/ui', feedbackLimiter, optionalAuth, async (req, res) => {
  const raw = req.body || {};
  const issue = cleanText(raw.issue, 2000);
  if (!issue) return res.status(400).json({ error: 'issue description required' });
  const screen      = cleanText(raw.screen, 100) || 'unknown';
  const contact     = cleanText(raw.contact, 200);
  const device_info = cleanText(raw.device_info, 500);

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO feedback (user_id, screen, issue, contact, device_info, created_at)
       VALUES (?,?,?,?,?,NOW())`,
      [feedbackUserId(req), screen, issue, contact, device_info]
    );
  } catch (e) {
    logger.error('[feedback/ui]', e.message);
    return res.status(500).json({ error: 'Could not submit feedback' });
  }

  // Notify Slack (non-blocking)
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [
          '*New UI Feedback*',
          `Screen: ${slackEscape(screen)}`,
          `Issue: ${slackEscape(issue.slice(0, 500))}`,
          contact ? `Contact: ${slackEscape(contact)}` : null,
        ].filter(Boolean).join('\n'),
      }),
    }).catch(() => {});
  }

  return res.json({ received: true, message: 'Thank you — your feedback helps us improve Justice Gavel.' });
});

export default router;
