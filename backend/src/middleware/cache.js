/**
 * cache.js — HTTP cache headers middleware
 * Adds appropriate Cache-Control headers to API responses.
 */

export function cacheControl(maxAge = 0) {
  return (req, res, next) => {
    if (req.method === 'GET') {
      res.set('Cache-Control', maxAge > 0
        ? `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`
        : 'no-store');
    } else {
      res.set('Cache-Control', 'no-store');
    }
    next();
  };
}

// Preset durations
export const NO_CACHE     = cacheControl(0);
export const CACHE_1MIN   = cacheControl(60);
export const CACHE_5MIN   = cacheControl(300);
export const CACHE_1HR    = cacheControl(3600);
export const CACHE_1DAY   = cacheControl(86400);
