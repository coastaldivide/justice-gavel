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



// ── AI quota middleware — enforces free-tier message limits ───────────────────
