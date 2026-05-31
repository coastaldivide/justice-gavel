/**
 * routeHelpers.js — Shared utilities for all route handlers
 * Eliminates 150+ duplicate error blocks and centralises validation.
 */

import logger from './logger.js';

// ── Error responses (never leak e.message to client) ─────────────────────────
export const err400 = (res, msg)      => res.status(400).json({ error: msg });
export const err401 = (res, msg = 'Authentication required') => res.status(401).json({ error: msg });
export const err403 = (res, msg = 'Access denied')           => res.status(403).json({ error: msg });
export const err404 = (res, msg = 'Not found')               => res.status(404).json({ error: msg });
export const err409 = (res, msg)      => res.status(409).json({ error: msg });
export const err422 = (res, msg)      => res.status(422).json({ error: msg });
export const err429 = (res, msg = 'Too many requests — slow down') => res.status(429).json({ error: msg });
export const err502 = (res)           => res.status(502).json({ error: 'Upstream service unavailable. Try again shortly.' });
export function err500(res, context = '', _err = null) {
  if (_err) logger.error(`[${context}]`, typeof _err === 'object' ? _err.message : _err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

// ── Input validation ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s\-(.)]{7,20}$/;

export const validateEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v.trim());
export const validatePhone  = (v) => typeof v === 'string' && PHONE_RE.test(v.trim());
export const normalizeEmail = (v) => (v || '').trim().toLowerCase();
export const normalizePhone = (v) => (v || '').replace(/[^\d+]/g, '');
export const sanitizeStr    = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export const safeInt        = (v, fallback = 0) => { const n = parseInt(String(v ?? fallback), 10); return isNaN(n) ? fallback : n; };
export const safeFloat      = (v, fallback = 0, min = -Infinity, max = Infinity) => { const n = parseFloat(String(v ?? fallback)); return isNaN(n) ? fallback : Math.max(min, Math.min(max, n)); };
export const validCoords    = (lat, lng) => { const la = safeFloat(lat), ln = safeFloat(lng); return (la >= -90 && la <= 90 && ln >= -180 && ln <= 180) ? [la, ln] : null; };

// ── IDOR ownership guard ──────────────────────────────────────────────────────
export const ownsResource = (row, userId, field = 'user_id') =>
  !!row && String(row[field]) === String(userId);

// ── Safe SQL WHERE builder ────────────────────────────────────────────────────
export function buildWhere(filters = {}, allowedCols = new Set()) {
  const conditions = [], params = [];
  for (const [col, val] of Object.entries(filters)) {
    if (!allowedCols.has(col) || val === undefined || val === null || val === '') continue;
    conditions.push(`${col} = ?`);
    params.push(val);
  }
  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

export function buildOrderBy(sortBy, allowedCols, defaultCol = 'id', dir = 'DESC') {
  const col = allowedCols.has(sortBy) ? sortBy : defaultCol;
  return `ORDER BY ${col} ${dir === 'ASC' ? 'ASC' : 'DESC'}`;
}

// ── Shared constants ──────────────────────────────────────────────────────────
export const LIMITS = {
  PAGE_SIZE: 20, MAX_PAGE: 100,
  TEXT: 2000, TITLE: 200, NOTE: 5000,
  JWT_SECS: 604800,   // 7 days
  OTP_MS:   600000,   // 10 minutes
};

export const API_URLS = {
  ANTHROPIC:  'https://api.anthropic.com/v1/messages',
  OPENAI_STT: 'https://api.openai.com/v1/audio/transcriptions',
};

// ── SQL-safe table name guard ─────────────────────────────────────────────────
/** Validates a table name against a whitelist. Throws 400 if not allowed. */
const ADMIN_ALLOWED_TABLES = new Set([
  'lawyers','bail_agents','users','subscriptions','reviews','recovery_agents',
  'motions','feedback','arrest_records','consultation_bookings',
]);
export function safeTable(tableName) {
  const clean = String(tableName || '').replace(/[^a-z_]/gi, '');
  if (!ADMIN_ALLOWED_TABLES.has(clean)) {
    const err = new Error(`Table not permitted: ${clean}`);
    err.status = 400;
    throw err;
  }
  return clean;
}

/** Filters column names against a per-table allowlist before INSERT/UPDATE */
const ADMIN_COL_WHITELIST = {
  lawyers:     new Set(['name','city','state','phone','address','lat','lng','specialties','rating','active','verified','bar_verified','website']),
  bail_agents: new Set(['name','city','state','phone','address','lat','lng','rating','active','verified','license_number']),
  recovery_agents: new Set(['name','city','state','phone','address','lat','lng','rating','active','license_number','armed_certified','available_24_7']),
  users:       new Set(['display_name','email','phone','is_verified','is_attorney','is_bondsman','role','active']),
};
export function safeAdminCols(table, cols) {
  const allowed = ADMIN_COL_WHITELIST[table];
  if (!allowed) return [];
  return (cols || []).filter(col => allowed.has(col.split(/\s*=\s*/)[0].trim()));
}

// ── Input truncation ──────────────────────────────────────────────────────────
// Use for any free-text field from req.body before storing to DB or AI prompt.
// Prevents excessively long inputs from DoS-ing the AI or bloating the DB.
export const FIELD_LIMITS = {
  name:        200,
  comment:     1000,
  notes:       5000,
  bio:         2000,
  content:     10000,
  text:        4000,
  description: 1000,
  title:       255,
  email:       254,   // RFC 5321 max
  phone:       20,
  address:     500,
};

/**
 * Truncate a string to a field-specific max length.
 * @param {string} val - Input value
 * @param {keyof typeof FIELD_LIMITS | number} field - Field name or explicit max
 * @returns {string} Truncated string
 */
export function truncateStr(val, field) {
  if (val == null) return '';
  const str = String(val);
  const max  = typeof field === 'number' ? field : (FIELD_LIMITS[field] ?? 1000);
  return str.slice(0, max);
}

// ── Business rule constants ────────────────────────────────────────────────────
// Named constants for all magic numbers used in business logic.
// Centralising here makes it easy to update pricing/limits in one place.
export const BUSINESS_CONSTANTS = {
  // Subscription trial periods (days)
  TRIAL_DAYS_MONTHLY:      30,
  TRIAL_DAYS_ANNUAL:       7,
  TRIAL_DAYS_CONSUMER:     7,

  // Pricing (cents)
  QUICKCONNECT_PRICE_CENTS:  2000,   // $20.00
  BONDSMAN_BADGE_CENTS:      4900,   // $49.00/month
  CONSULTATION_BASE_CENTS:   1500,   // $15.00
  MIN_CHARGE_CENTS:          50,     // Stripe minimum

  // Refund windows (hours)
  REFUND_AUTO_HOURS:         48,
  REFUND_PRORATED_DAYS:      30,

  // Rate limits
  AI_MESSAGES_PER_DAY_FREE:  3,
  AI_MESSAGES_PER_HOUR_PRO:  60,
  MAX_SAVED_LAWYERS:         50,
  MAX_CASES:                 100,
  MAX_MESSAGES_PER_THREAD:   500,

  // Timeouts (ms)
  JWT_EXPIRY:                '24h',
  PUSH_RETENTION_DELAY_DAYS: 1,
  COURT_REMINDER_DAYS:       [14, 7, 3, 1],

  // DB limits
  DEFAULT_PAGE_SIZE:         20,
  MAX_PAGE_SIZE:             50,
  MAX_SEARCH_RESULTS:        100,
  PROVIDERS_SEARCH_LIMIT:    200,
};

export const {
  TRIAL_DAYS_MONTHLY, TRIAL_DAYS_ANNUAL, TRIAL_DAYS_CONSUMER,
  QUICKCONNECT_PRICE_CENTS, BONDSMAN_BADGE_CENTS, CONSULTATION_BASE_CENTS,
  MIN_CHARGE_CENTS, REFUND_AUTO_HOURS, REFUND_PRORATED_DAYS,
  AI_MESSAGES_PER_DAY_FREE, AI_MESSAGES_PER_HOUR_PRO,
  MAX_SAVED_LAWYERS, MAX_CASES, MAX_MESSAGES_PER_THREAD,
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_SEARCH_RESULTS, PROVIDERS_SEARCH_LIMIT,
} = BUSINESS_CONSTANTS;


// ── SQL LIKE wildcard escaping ────────────────────────────────────────────────
// Prevents users from crafting search terms that match everything (%%) or
// cause excessive table scans with deeply nested patterns (%%%).
export function escapeLike(val, maxLen = 100) {
  if (!val) return '';
  return String(val)
    .slice(0, maxLen)
    .replace(/[%_\\]/g, '\\$&'); // escape %, _, \
}

// ── HTML tag stripping ────────────────────────────────────────────────────────
// Use on any user-submitted free-text field that may be rendered in the app.
// Strips tags but preserves the text content: "<b>hello</b>" → "hello"
export function stripHtml(val) {
  if (!val) return '';
  return String(val)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // remove scripts first
    .replace(/<[^>]+>/g, '')                            // strip all tags
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')        // decode entities
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .trim();
}

// ── Transaction wrapper ────────────────────────────────────────────────────────
// Usage: await withTransaction(db, async (db) => { await db.run(...); ... });
// Falls back gracefully if the DB adapter does not support transactions.
export async function withTransaction(db, fn) {
  try {
    await db.run('BEGIN').catch(() => {});
    const result = await fn(db);
    await db.run('COMMIT').catch(() => {});
    return result;
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ── Standardised error response ───────────────────────────────────────────────
export const errResponse = (res, status, message, code) =>
  res.status(status).json({ error: message, code: code || ('err_' + status), status });

// ── Pagination helper ─────────────────────────────────────────────────────────
// Usage: const { limit, offset } = parsePagination(req);
// Returns: { limit: number (1-200), offset: number (>=0) }
export function parsePagination(req, defaultLimit = 50) {
  const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit  || defaultLimit, 10) || defaultLimit));
  const offset = Math.max(0, parseInt(req.query.offset || 0, 10) || 0);
  return { limit, offset };
}

export function paginatedResponse(res, { data, total, limit, offset }) {
  const hasMore = offset + data.length < total;
  res.json({
    data,
    pagination: {
      total,
      limit,
      offset,
      returned: data.length,
      has_more: hasMore,
      next_offset: hasMore ? offset + limit : null,
    },
  });
}
