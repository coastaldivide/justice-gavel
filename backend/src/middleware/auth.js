/**
 * middleware/auth.js — JWT authentication middleware
 *
 * authRequired:
 *   - Verifies the Bearer token signature and algorithm
 *   - Checks token expiry (jwt.verify enforces exp automatically)
 *   - Rejects expired tokens with a clear message distinguishing
 *     "expired" from "invalid" so clients can trigger a token refresh
 *
 * optionalAuth:
 *   - Sets req.user if a valid token is present, proceeds regardless
 *   - Used on public endpoints that have richer behavior when authenticated
 *
 * Both use HS256 algorithm-pinning to prevent algorithm confusion attacks.
 */

import jwt    from 'jsonwebtoken';
import logger from '../utils/logger.js';

const JWT_SECRET  = () => process.env.JWT_SECRET || 'dev_secret_change_me';
const ALGORITHMS  = ['HS256'];

export function authRequired(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.', code: 'missing_token' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET(), { algorithms: ALGORITHMS });
    next();
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
}

export function optionalAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET(), { algorithms: ALGORITHMS });
    } catch {
      // Token invalid or expired — proceed unauthenticated
      req.user = null;
    }
  }
  next();
}

// Backward-compatibility alias
export const authMiddleware = authRequired;
