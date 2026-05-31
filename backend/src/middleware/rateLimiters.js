import { getDb } from '../db/index.js';
/**
 * rateLimiters.js — Centralized rate limit presets
 *
 * Provides named, pre-configured limiters for common route categories.
 * Import the appropriate limiter and apply as middleware.
 *
 * Usage:
 *   import { apiLimiter, writeLimiter, aiLimiter } from '../middleware/rateLimiters.js';
 *   router.get('/',  authRequired, apiLimiter,   handler);
 *   router.post('/', authRequired, writeLimiter,  handler);
 */

import rateLimit from 'express-rate-limit';

const makeOpts = (max, windowMin, message) => ({
  windowMs:       windowMin * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => String(req.user?.id || req.ip),
  message:         { error: message },
});

/** Standard read endpoints — 200/15 min per user */
export const apiLimiter = rateLimit(makeOpts(
  200, 15,
  'Too many requests — please slow down.'
));

/** Write/mutation endpoints — 60/15 min per user */
export const writeLimiter = rateLimit(makeOpts(
  60, 15,
  'Too many write requests — please wait before submitting again.'
));

/** AI-powered endpoints — 30/15 min per user (cost protection) */
export const aiLimiter = rateLimit(makeOpts(
  30, 15,
  'AI request limit reached — please wait before sending more AI requests.'
));

/** Auth endpoints — 10/15 min per IP (brute force protection) */
export const authLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many authentication attempts — try again in 15 minutes.' },
});

/** Upload/file endpoints — 20/hour per user */
export const uploadLimiter = rateLimit(makeOpts(
  20, 60,
  'Upload limit reached — maximum 20 uploads per hour.'
));

/** Public/unauthenticated endpoints — 100/15 min per IP */
export const publicLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Rate limit exceeded — please slow down.' },
});

// ── AI quota middleware — enforces free-tier message limits ───────────────────
// Free tier: 10 AI messages/day; Paid: unlimited (governed by rate limiter only)
export async function aiQuotaCheck(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return next();
    
    const db = await getDb();
    // Get subscription tier
    const sub = await db.get(
      `SELECT subscription_tier FROM users WHERE id = ?`, [userId]
    ).catch(() => null);
    
    const tier = sub?.subscription_tier || 'free';
    if (tier !== 'free') return next(); // paid users pass through
    
    // Count today's AI messages
    const today = new Date().toISOString().slice(0, 10);
    const usage = await db.get(
      `SELECT COUNT(*) as cnt FROM chat_messages 
       WHERE user_id = ? AND role = 'user' AND DATE(created_at) = ?`,
      [userId, today]
    ).catch(() => ({ cnt: 0 }));
    
    const FREE_DAILY_LIMIT = 10;
    if ((usage?.cnt || 0) >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error:    'Daily AI limit reached',
        limit:    FREE_DAILY_LIMIT,
        upgrade:  true,
        message:  `Free accounts get ${FREE_DAILY_LIMIT} AI messages per day. Upgrade to Legal Radar or higher for unlimited access.`,
      });
    }
    next();
  } catch {
    next(); // never block on quota errors
  }
}
