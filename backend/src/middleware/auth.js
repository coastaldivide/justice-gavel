/**
 * middleware/auth.js — JWT authentication middleware
 *
 * authRequired:
 *   - Verifies Bearer token signature and algorithm (HS256 pinned)
 *   - Checks token expiry (jwt.verify enforces exp automatically)
 *   - Verifies user still exists in DB (prevents ghost sessions)
 *   - In-process cache: user existence checked once per token, not per request
 *
 * optionalAuth:
 *   - Sets req.user if valid token present; proceeds regardless
 */

import jwt    from 'jsonwebtoken';
import logger from '../utils/logger.js';

const JWT_SECRET  = () => process.env.JWT_SECRET || 'dev_secret_change_me';
const ALGORITHMS  = ['HS256'];

// ── In-process revocation cache ───────────────────────────────────────────────
// Maps userId → { exists: bool, checkedAt: timestamp }
// Prevents a DB round-trip on every authenticated request.
// Cache TTL: 60 seconds. Deleted users are denied within 60s of deletion.
const USER_CACHE = new Map();
const CACHE_TTL_MS = 60_000;

async function userExists(userId) {
  const now    = Date.now();
  const cached = USER_CACHE.get(userId);
  if (cached && (now - cached.checkedAt) < CACHE_TTL_MS) {
    return cached.exists;
  }
  try {
    const { getDb } = await import('../db/index.js');
    const db = await getDb();
    const row = await db.get('SELECT id FROM users WHERE id=? LIMIT 1', [userId]);
    const exists = !!row;
    USER_CACHE.set(userId, { exists, checkedAt: now });
    // Evict old entries (keep cache bounded)
    if (USER_CACHE.size > 10000) {
      for (const [k, v] of USER_CACHE) {
        if (now - v.checkedAt > CACHE_TTL_MS * 2) USER_CACHE.delete(k);
      }
    }
    return exists;
  } catch {
    return true; // fail open — never deny on DB error
  }
}

export function authRequired(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.', code: 'missing_token' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET(), { algorithms: ALGORITHMS });
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

  // Verify user still exists in DB (ghost session protection)
  userExists(req.user.id).then(exists => {
    if (!exists) {
      return res.status(401).json({
        error: 'Account not found. Please log in again.',
        code:  'user_not_found',
      });
    }
    next();
  }).catch(() => next()); // fail open on DB error
}

export function optionalAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET(), { algorithms: ALGORITHMS });
    } catch {
      req.user = null;
    }
  }
  next();
}

// Explicitly invalidate a user's cache entry (call after deletion/suspension)
export function invalidateUserCache(userId) {
  USER_CACHE.delete(userId);
}

// Backward-compatibility alias
export const authMiddleware = authRequired;
