/**
 * routeHelpers.js — safe route wrapper utilities
 *
 * asyncRoute: wraps every route handler in try/catch.
 * Eliminates the class of bug where a route has no error handling.
 *
 * Before:
 *   router.get('/lawyers', async (req, res) => {
 *     const data = await db.all('SELECT ...');  // throws if DB unavailable
 *     res.json(data);                           // crash, no catch
 *   });
 *
 * After:
 *   router.get('/lawyers', asyncRoute(async (req, res) => {
 *     const data = await db.all('SELECT ...');
 *     res.json(data);
 *   }));
 *
 * Any unhandled throw → 500 JSON response with error detail in dev mode.
 * Never crashes the process. Never leaves the client hanging.
 */

import logger from './logger.js';

/**
 * Wraps an async route handler in a try/catch.
 * On error: logs, returns structured JSON error response.
 * Never crashes the process or leaves the connection open.
 */
export function asyncRoute(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      const status  = err.status || err.statusCode || 500;
      const message = err.expose ? err.message : 'An unexpected error occurred. Please try again.';
      const detail  = process.env.NODE_ENV !== 'production' ? err.message : undefined;

      logger.error({
        msg:    '[route_error]',
        method: req.method,
        url:    req.originalUrl,
        status,
        error:  err.message,
        stack:  process.env.NODE_ENV !== 'production' ? err.stack?.split('\n').slice(0,4).join(' | ') : undefined,
      });

      if (!res.headersSent) {
        res.status(status).json({
          error:  message,
          ...(detail ? { detail } : {}),
          path:   req.path,
          method: req.method,
        });
      }
    }
  };
}

/**
 * Wraps a synchronous route handler the same way.
 */
export function syncRoute(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Standard 400 / 403 / 404 helpers — keeps error format consistent.
 */
export const err400 = (res, message) => res.status(400).json({ error: message });
export const err403 = (res, message = 'Forbidden') => res.status(403).json({ error: message });
export const err404 = (res, message = 'Not found') => res.status(404).json({ error: message });
export const err500 = (res, message = 'Server error. Please try again.') => res.status(500).json({ error: message });

/**
 * Safe JSON parse — never throws.
 */
export function safeJson(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Safe integer parse — never NaN.
 */
export function safeInt(val, fallback = 0) {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? fallback : n;
}

/**
 * Safe float parse — never NaN.
 */
export function safeFloat(val, fallback = 0) {
  const n = parseFloat(String(val));
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Standardised success response — always { data, meta? }
 * Use instead of res.json({...}) to ensure consistent envelope
 */
export function sendData(res, data, meta = {}) {
  return res.json({ data, ...( Object.keys(meta).length ? { meta } : {} ) });
}
export function sendList(res, items, total) {
  return res.json({ data: items, meta: { total, count: items.length } });
}
export function sendCreated(res, data) {
  return res.status(201).json({ data });
}
