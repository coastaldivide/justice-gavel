import { TIERS } from '../routes/billing/plans.js';
import { ANTHROPIC_MESSAGES_URL } from './ai.js';
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
  if (str === null || str === undefined || str === '') return fallback;
  if (typeof str === 'object') return str;   // jsonb columns arrive already parsed
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Safe integer parse — never NaN.
 */
export function safeInt(val, fallback = 0) {
  const n = parseInt(String(val), 10);
  // 30-digit ids parse to 1e30, which no bigint column accepts → fallback.
  return Number.isSafeInteger(n) ? n : fallback;
}

/** True for a string with something other than whitespace (never throws on objects / arrays). */
export function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** A body value as trimmed text: strings and finite numbers; anything else → ''. */
export function asText(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
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


// ── Additional helpers expected by route files ─────────────────────────────────

export function err401(res, msg = 'Authentication required.')     { return res.status(401).json({ error: msg }); }
export function err409(res, msg = 'Conflict.')                    { return res.status(409).json({ error: msg }); }
export function err422(res, msg = 'Unprocessable entity.')        { return res.status(422).json({ error: msg }); }
export function err502(res, msg = 'Upstream service error.')      { return res.status(502).json({ error: msg }); }

export function sanitizeStr(s, maxLen = 2000) {
  if (s == null || s === undefined) return '';
  return String(s).replaceAll('\0', '').trim().slice(0, maxLen);
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

export function escapeLike(s, maxLen = 100) {
  // Callers pass maxLen (search/resources/legaldata/courthouses use 100); it used to be ignored.
  return String(s || '').slice(0, maxLen).replace(/[%_\\]/g, '\\$&');
}


export function buildWhere(conditions, allowedCols = null) {
  // Keys are interpolated into SQL, so only plain identifiers (and, when an
  // allow-list is given, only listed columns) are accepted.
  const entries = Object.entries(conditions || {})
    .filter(([k, v]) => v !== undefined && v !== null && ADMIN_COL_PATTERN.test(k)
      && (!allowedCols || allowedCols.has(k)));
  const clauses = entries.map(([k]) => `${k} = ?`);
  const values  = entries.map(([, v]) => v);
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


// ── Business constants used across billing/route files ────────────────────────
export const BUSINESS_CONSTANTS = {
  // Plan prices: read from routes/billing/plans.js (the price list the server
  // charges from) — never a second copy of the amounts.
  LEGAL_RADAR_CENTS:       TIERS.legal_radar.monthly_cents,   // $19.99/month
  ADVISOR_PRICE_CENTS:     TIERS.advisor.monthly_cents,       // $24.99/month
  LEGAL_PRO_PRICE_CENTS:   TIERS.legal_pro.monthly_cents,     // $34.99/month
  ESQUIRE_PRICE_CENTS:     TIERS.esquire.monthly_cents,       // $49.00/month
  ADVISOR_ANNUAL_CENTS:    TIERS.advisor_annual.annual_cents, // $199/year
  LEGAL_PRO_ANNUAL_CENTS:  TIERS.pro_annual.annual_cents,     // $299/year
  ESQUIRE_ANNUAL_CENTS:    TIERS.esquire_annual.annual_cents, // $410/year
  // (no bondsman "verified badge": that product was removed in section G)
  QUICKCONNECT_PRICE_CENTS: 2000,   // $20 one-time: $10 bondsman contact + $10 lawyer contact
  // Feature limits
  MAX_FREE_AI_MSGS:         3, // must equal FREE_CHAT_MESSAGES_PER_DAY (routes/chat/_helpers.js)
  FREE_CASE_LIMIT:          3,
  TRIAL_DAYS:               7,
};

export const LIMITS = {
  AI_MESSAGES_FREE:  15,   // raised from 5 — crisis users need real help before paywall
  AI_MESSAGES_BASIC: 40,   // raised from 20 — Basic tier substantive value
  CASES_FREE:         5,   // raised from 3 — allow full case tracking for active matter
  CASES_PAID:        Infinity,
  EXPORT_MAX_ROWS:   5000,
};

export const API_URLS = {
  ANTHROPIC:    ANTHROPIC_MESSAGES_URL,
  GOOGLE_PLACES:'https://maps.googleapis.com/maps/api/place',
  CALENDLY:     'https://api.calendly.com/v2',
};

// ── Admin table/column allow-lists ─────────────────────────────────────────
const ADMIN_TABLES = new Set([
  // Provider directory — the /api/admin/lawyers and /api/admin/bail consoles (H4).
  'lawyers','bail_agents',
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

/** Column list as an ARRAY of validated identifiers (for INSERT column lists). Throws on an invalid name. */
export function safeAdminColList(cols) {
  if (!Array.isArray(cols) || cols.length === 0) throw Object.assign(new Error('No columns'), { status: 400 });
  for (const c of cols) {
    if (!ADMIN_COL_PATTERN.test(c)) throw Object.assign(new Error('Invalid column'), { status: 400 });
  }
  return cols;
}
