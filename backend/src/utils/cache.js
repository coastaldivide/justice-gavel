/**
 * utils/cache.js — In-memory response cache for hot read endpoints
 *
 * Eliminates repeat DB reads on routes that return identical data
 * to every user (immigration rights, expungement rules, bail schedules).
 *
 * Usage:
 *   router.get('/rights', cacheFor(24 * 60), async (req, res) => {...});
 */

import NodeCache from 'node-cache';

// Standard cache: TTL in seconds, check expired every 60s
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

/**
 * Express middleware factory: cache route responses for `ttlMinutes` minutes.
 * Cache key = method + url + query string.
 *
 * Usage:
 *   router.get('/rights', cacheFor(60 * 24), handler);
 */
export function cacheFor(ttlMinutes = 5) {
  const ttlSecs = ttlMinutes * 60;
  return (req, res, next) => {
    const key = `${req.method}:${req.originalUrl}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(hit);
    }

    // Intercept res.json to store the response
    const original = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        cache.set(key, body, ttlSecs);
        res.setHeader('X-Cache', 'MISS');
      }
      return original(body);
    };
    next();
  };
}

/** Invalidate all cached routes matching a prefix. */
export function invalidateCache(prefix = '') {
  const keys = cache.keys().filter(k => k.includes(prefix));
  cache.del(keys);
  return keys.length;
}

/** Cache stats for the /health endpoint. */
export function cacheStats() {
  return cache.getStats();
}

export default cache;
