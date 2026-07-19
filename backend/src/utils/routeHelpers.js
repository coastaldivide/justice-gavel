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

// ── Additional helpers expected by route files ─────────────────────────────────

export function err401(res, msg = 'Authentication required.')     { return res.status(401).json({ error: msg }); }
export function err409(res, msg = 'Conflict.')                    { return res.status(409).json({ error: msg }); }
export function err422(res, msg = 'Unprocessable entity.')        { return res.status(422).json({ error: msg }); }
export function err502(res, msg = 'Upstream service error.')      { return res.status(502).json({ error: msg }); }

export function sanitizeStr(s, maxLen = 2000) {
  if (s == null || s === undefined) return '';
  return String(s).replace(/\x00/g,'').trim().slice(0, maxLen);
}

export function truncateStr(s, maxLen = 500) {
  if (s == null) return null;
  const str = String(s).trim();
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

export function normalizeEmail(email) {
  if (!email) return null;
  return String(email).toLowerCase().trim();
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

export function escapeLike(s) {
  return String(s || '').replace(/[%_\\]/g, '\\$&');
}

export function parsePagination(query, defaults = { limit: 20, offset: 0 }) {
  const limit  = Math.min(Math.max(parseInt(query?.limit  || defaults.limit,  10) || defaults.limit,  1), 200);
  const offset = Math.max(parseInt(query?.offset || defaults.offset, 10) || defaults.offset, 0);
  return { limit, offset };
}

export function buildWhere(conditions) {
  const clauses = Object.entries(conditions)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k]) => `${k} = ?`);
  const values = Object.entries(conditions)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([, v]) => v);
  return clauses.length
    ? { where: `WHERE ${clauses.join(' AND ')}`, values }
    : { where: '', values: [] };
}

export async function ownsResource(dbOrRow, tableOrUserId, id, userId, idCol = 'id', ownerCol = 'user_id') {
  // Dual-mode: ownsResource(row, userId) checks an already-fetched row
  //            ownsResource(db, table, id, userId) queries the DB
  if (tableOrUserId !== null && typeof tableOrUserId !== 'string') {
    // 2-arg mode: (row, userId) — row already fetched
    const row = dbOrRow;
    const uid = tableOrUserId;
    if (!row) return false;
    const rowOwner = row[ownerCol] ?? row.user_id;
    return String(rowOwner) === String(uid);
  }
  // 5-arg mode: (db, table, id, userId, ...)
  const db = dbOrRow;
  const table = tableOrUserId;
  const row = await db.get(
    `SELECT ${idCol} FROM ${table} WHERE ${idCol} = ? AND ${ownerCol} = ?`,
    [id, userId]
  );
  return !!row;
}

export async function withTransaction(db, fn) {
  try {
    await db.run('BEGIN');
    const result = await fn();
    await db.run('COMMIT');
    return result;
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ── Business constants used across billing/route files ────────────────────────
export const BUSINESS_CONSTANTS = {
  BONDSMAN_BADGE_CENTS:   4900,   // $49/month
  ADVISOR_PRICE_CENTS:    2900,   // $29/month
  LEGAL_PRO_PRICE_CENTS:  4900,   // $49/month
  LEGAL_RADAR_CENTS:      9900,   // $99/month
  MAX_FREE_AI_MSGS:       5,
  FREE_CASE_LIMIT:        3,
  TRIAL_DAYS:             7,
};

export const LIMITS = {
  AI_MESSAGES_FREE:  5,
  AI_MESSAGES_BASIC: 20,
  CASES_FREE:        3,
  CASES_PAID:        Infinity,
  EXPORT_MAX_ROWS:   5000,
};

export const API_URLS = {
  JUDYRECORDS:  'https://api.judyrecords.com/v1',
  GOOGLE_PLACES:'https://maps.googleapis.com/maps/api/place',
  CALENDLY:     'https://api.calendly.com/v2',
};

// ── Admin table/column allow-lists ─────────────────────────────────────────
const ADMIN_TABLES = new Set([
  'users','cases','matters','resources','lessons','bail_rates',
  'providers','bondsman_profiles','bar_questions','checkins',
  'video_sessions','ai_jobs','audit_log','rewards',
]);
const ADMIN_COL_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function safeTable(name) {
  if (!ADMIN_TABLES.has(name)) throw Object.assign(new Error('Unknown table'), { status: 400 });
  return name;
}
export function safeAdminCols(cols) {
  if (!Array.isArray(cols) || cols.length === 0) return '*';
  const valid = cols.filter(c => ADMIN_COL_PATTERN.test(c));
  return valid.length ? valid.join(', ') : '*';
}
