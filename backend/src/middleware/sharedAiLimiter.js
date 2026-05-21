/**
 * sharedAiLimiter.js — Per-user AI rate limiting
 *
 * Complements the per-IP aiLimiter in each route.
 * Tracks AI calls per authenticated user across ALL AI routes combined.
 *
 * Limits: 60 AI calls per user per hour (across chat, motions, research, discovery, translate)
 * At $0.03/call average, max exposure per user per hour = $1.80
 *
 * Usage:
 *   import { perUserAiLimit } from '../middleware/sharedAiLimiter.js';
 *   router.post('/generate', authRequired, perUserAiLimit, async (req, res) => { ... });
 */

const userCalls = new Map(); // userId → [timestamp, timestamp, ...]
const WINDOW_MS  = 60 * 60 * 1000; // 1 hour
const MAX_CALLS  = 60;              // 60 AI calls per user per hour

// Purge stale entries every 10 minutes to prevent memory growth
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [uid, times] of userCalls) {
    const fresh = times.filter(t => t > cutoff);
    if (fresh.length === 0) userCalls.delete(uid);
    else userCalls.set(uid, fresh);
  }
}, 10 * 60 * 1000);

export function perUserAiLimit(req, res, next) {
  // Only applies to authenticated users — guests use IP-based limiting only
  if (!req.user?.id) return next();

  const uid    = String(req.user.id);
  const now    = Date.now();
  const cutoff = now - WINDOW_MS;

  const times = (userCalls.get(uid) || []).filter(t => t > cutoff);

  if (times.length >= MAX_CALLS) {
    const oldest     = Math.min(...times);
    const resetInSec = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    const resetInMin = Math.ceil(resetInSec / 60);
    return res.status(429).json({
      error: `AI usage limit reached. You have used ${MAX_CALLS} AI calls this hour. Resets in ${resetInMin} minute${resetInMin !== 1 ? 's' : ''}.`,
      retry_after_seconds: resetInSec,
      limit: MAX_CALLS,
      window: '1 hour',
    });
  }

  times.push(now);
  userCalls.set(uid, times);
  res.setHeader('X-AI-Calls-Used',      String(times.length));
  res.setHeader('X-AI-Calls-Remaining', String(MAX_CALLS - times.length));
  next();
}

// ── General per-user rate limiter factory ─────────────────────────────────────
// Usage: const limiter = makeUserLimiter({ windowMs: 60_000, max: 10, message: '...' })
// router.post('/', authRequired, limiter, handler)
export function makeUserLimiter({ windowMs = 60_000, max = 10, message = 'Too many requests' } = {}) {
  const calls = new Map();

  // Purge stale entries every windowMs
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [uid, times] of calls) {
      const fresh = times.filter(t => t > cutoff);
      if (!fresh.length) calls.delete(uid);
      else calls.set(uid, fresh);
    }
  }, windowMs);

  return function userRateLimiter(req, res, next) {
    // Unauthenticated requests bypass — they hit IP-level limits at the nginx/CDN layer
    if (!req.user?.id) return next();
    const uid    = String(req.user.id);
    const now    = Date.now();
    const cutoff = now - windowMs;
    const times  = (calls.get(uid) || []).filter(t => t > cutoff);
    if (times.length >= max) {
      const oldest     = Math.min(...times);
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retry_after_seconds: retryAfter });
    }
    times.push(now);
    calls.set(uid, times);
    next();
  };
}
