/**
 * middleware/auth.js — JWT authentication middleware
 *
 * authRequired:
 *   - Verifies Bearer token signature and algorithm (HS256 pinned)
 *   - Checks token expiry (jwt.verify enforces exp automatically) — expired and
 *     invalid tokens get distinct 401 codes
 *   - Loads the CURRENT user row (role, account status, admin/defender flags,
 *     tier) from the database and overwrites the claims baked into the token.
 *     Every authorization decision downstream (req.user.role, …) therefore
 *     reflects the live DB state, not a role that may be 30 days old.
 *   - In-process cache: the DB row is re-read at most once per CACHE_TTL_MS
 *     (60 s) per user. A demoted, banned or deleted user loses access within
 *     the TTL on every instance, immediately on the instance that made the
 *     change (invalidateUserCache).
 *   - Fails CLOSED: if the DB cannot be reached the request gets 503
 *     auth_unavailable instead of being waved through.
 *
 * optionalAuth:
 *   - Sets req.user if a valid token is present (with the same live DB state);
 *     proceeds regardless — an invalid, expired or disabled-account token is
 *     treated as anonymous.
 */

import '../config.js';   // ensures JWT_SECRET is populated (dev) before first use
import jwt    from 'jsonwebtoken';
import logger from '../utils/logger.js';

// Always set: required in production, generated per-process in dev (config.js)
const JWT_SECRET  = () => process.env.JWT_SECRET;
const ALGORITHMS  = ['HS256'];

/** Account states that may not authenticate. */
const DISABLED_STATUSES = new Set(['banned', 'suspended', 'deleted', 'disabled', 'locked_out']);

// ── Live-principal cache ──────────────────────────────────────────────────────
// Maps userId → { principal: object|null, checkedAt: timestamp }
// Prevents a DB round-trip on every authenticated request. TTL 60 s.
const USER_CACHE   = new Map();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX    = 10_000;

/**
 * The in-memory jest run has no database (DATABASE_URL unset, NODE_ENV=test):
 * there the token claims are used as-is so unit suites that sign their own
 * tokens keep working. Whenever a database is configured — production, and the
 * Postgres-backed integration/security suites — the live row is authoritative.
 */
function dbBacked() {
  return !(process.env.NODE_ENV === 'test' && !process.env.DATABASE_URL);
}

const PRINCIPAL_COLS =
  'id, role, account_status, is_admin, is_defender, subscription_tier, email, display_name, bar_verified';

/**
 * Load the live authorization state for a user id. Returns null when the user
 * does not exist. Throws on DB error (callers fail closed).
 */
export async function loadPrincipal(userId) {
  const now    = Date.now();
  const key    = String(userId);
  const cached = USER_CACHE.get(key);
  if (cached && (now - cached.checkedAt) < CACHE_TTL_MS) return cached.principal;

  const { getDb } = await import('../db/index.js');
  const db  = await getDb();
  const row = await db.get(`SELECT ${PRINCIPAL_COLS} FROM users WHERE id = ? LIMIT 1`, [userId]);
  const principal = row ? {
    id:                Number(row.id),
    role:              row.role || 'user',
    account_status:    row.account_status || 'active',
    is_admin:          Number(row.is_admin || 0),
    is_defender:       Number(row.is_defender || 0),
    subscription_tier: row.subscription_tier || 'free',
    bar_verified:      Number(row.bar_verified || 0),
    email:             row.email || null,
    display_name:      row.display_name || null,
  } : null;

  USER_CACHE.set(key, { principal, checkedAt: now });
  if (USER_CACHE.size > CACHE_MAX) {
    for (const [k, v] of USER_CACHE) {
      if (now - v.checkedAt > CACHE_TTL_MS) USER_CACHE.delete(k);
    }
    // Still too big (all entries fresh) → drop the oldest insertion-order half.
    if (USER_CACHE.size > CACHE_MAX) {
      let n = Math.floor(USER_CACHE.size / 2);
      for (const k of USER_CACHE.keys()) { if (n-- <= 0) break; USER_CACHE.delete(k); }
    }
  }
  return principal;
}

/** Merge the live DB principal over the verified token claims. */
function applyPrincipal(claims, p) {
  return {
    ...claims,
    id:                p.id,
    role:              p.role,
    account_status:    p.account_status,
    is_admin:          p.is_admin,
    is_defender:       p.is_defender,
    subscription_tier: p.subscription_tier,
    tier:              p.subscription_tier,
    bar_verified:      p.bar_verified,
    email:             p.email ?? claims.email ?? null,
    displayName:       p.display_name || claims.displayName || null,
    display_name:      p.display_name || claims.displayName || null,
    // A firm role is never trusted from a token — firm context is loaded from
    // firm_members per request (middleware/rbac.js).
    firm_role:         undefined,
  };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET(), { algorithms: ALGORITHMS });
}

export function authRequired(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.', code: 'missing_token' });
  }

  let claims;
  try {
    claims = verifyToken(token);
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({
        error:      'Session expired. Please log in again.',
        code:       'token_expired',
        expired_at: e.expiredAt,
      });
    }
    if (e.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid authentication token.',
        code:  'invalid_token',
      });
    }
    logger.warn('[auth] unexpected jwt error:', e.message);
    return res.status(401).json({ error: 'Authentication failed.', code: 'auth_error' });
  }
  // Refresh tokens are signed with a different secret, but never accept a
  // token that declares itself as one here.
  if (!claims || claims.type === 'refresh' || claims.id == null) {
    return res.status(401).json({ error: 'Invalid authentication token.', code: 'invalid_token' });
  }

  if (!dbBacked()) {
    req.user = claims;
    return next();
  }

  loadPrincipal(claims.id).then(p => {
    if (!p) {
      return res.status(401).json({
        error: 'Account not found. Please log in again.',
        code:  'user_not_found',
      });
    }
    if (DISABLED_STATUSES.has(String(p.account_status).toLowerCase())) {
      return res.status(401).json({
        error: 'This account is disabled.',
        code:  'account_disabled',
      });
    }
    req.user = applyPrincipal(claims, p);
    next();
  }).catch(e => {
    // Fail closed — never authorize without knowing the account's current state.
    logger.error('[auth] principal lookup failed:', e?.message);
    if (!res.headersSent) {
      res.status(503).json({ error: 'Authentication is temporarily unavailable. Please try again.', code: 'auth_unavailable' });
    }
  });
}

export function optionalAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return next();
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    req.user = null;
    return next();
  }
  if (!claims || claims.type === 'refresh' || claims.id == null) { req.user = null; return next(); }
  if (!dbBacked()) { req.user = claims; return next(); }
  loadPrincipal(claims.id).then(p => {
    req.user = (p && !DISABLED_STATUSES.has(String(p.account_status).toLowerCase()))
      ? applyPrincipal(claims, p) : null;
    next();
  }).catch(() => { req.user = null; next(); });   // anonymous on DB error — grants nothing
}

/** Explicitly invalidate a user's cache entry (call after role change, deletion, suspension). */
export function invalidateUserCache(userId) {
  if (userId == null) { USER_CACHE.clear(); return; }
  USER_CACHE.delete(String(userId));
}

// Backward-compatibility alias
export const authMiddleware = authRequired;
