import { audit, AUDIT_ACTIONS } from '../utils/audit.js';
import { validate, schemas } from '../validation/schemas.js';
/**
 * /api/auth — Email-or-phone authentication
 *
 * POST /api/auth/register         { identifier, password, displayName?, isAttorney?, barNumber?, barState?, firmName? }
 *                                  identifier = email OR phone (+16155551234 / 6155551234)
 *                                  (legacy { email } / { phone } also accepted)
 * POST /api/auth/login            { identifier, password }   (legacy { email } accepted)
 * POST /api/auth/refresh          { refreshToken }  — single-use rotation
 *                                  OR no body + "Authorization: Bearer <access token>" (mobile app)
 * GET  /api/auth/me               current user
 * POST /api/auth/update-profile   { displayName?, phone?, email? }
 * POST /api/auth/forgot-password  { email } — always 200; stores a hashed reset token
 * POST /api/auth/reset-password   { token, password }
 * POST /api/auth/logout           { refreshToken? }
 *
 * Responses for register/login/refresh: { token, refreshToken, user }
 */

import { err400, truncateStr, err401, err404, sanitizeStr, validateEmail } from '../utils/routeHelpers.js';
import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import bcrypt from 'bcryptjs';
import { CONFIG } from '../config.js';
import jwt from 'jsonwebtoken';
import { authRequired } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';

const IS_TEST = process.env.NODE_ENV === 'test';

// ── Secrets — always from env (config.js generates dev-only values; production
//    refuses to start without them). No hard-coded fallbacks. ──────────────────
const JWT_SECRET         = () => process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// ── Rate limits ───────────────────────────────────────────────────────────────
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message:  { error: 'Too many password reset requests. Try again in 1 hour.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => IS_TEST,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: parseInt(process.env.AUTH_RATE_LIMIT || '10', 10),
  standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,     // only failures count toward the limit
  message: { error: 'Too many login attempts — please wait 15 minutes before trying again.' },
  skip: () => IS_TEST,
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: parseInt(process.env.REGISTER_RATE_LIMIT || '5', 10),
  message: { error: 'Too many accounts created from this device. Please try again in an hour.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => IS_TEST,
});

const router = Router();

// ── Identifier normalisation (email or phone) ────────────────────────────────
function normalizeIdentifier(raw = '') {
  const s = String(raw).trim().toLowerCase();
  if (s.includes('@')) return validateEmail(s) ? { type: 'email', value: s } : { type: 'unknown', value: s };
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return { type: 'phone', value: '+1' + digits };
  if (digits.length === 11 && digits[0] === '1') return { type: 'phone', value: '+' + digits };
  if (digits.length >= 7 && digits.length <= 15) return { type: 'phone', value: '+' + digits };
  return { type: 'unknown', value: s };
}
const pickIdentifier = (b = {}) => b.identifier || b.email || b.phone || '';

function defaultDisplayName(identifier, type) {
  if (type === 'email') {
    const local = identifier.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1).replace(/[._]/g, ' ');
  }
  if (type === 'phone') return '••• ' + identifier.replace(/\D/g, '').slice(-4);
  return 'User';
}

function publicUser(u) {
  return {
    id:               u.id,
    email:            u.email || null,
    phone:            u.phone || null,
    identifier:       u.login_identifier || u.email || u.phone || null,
    displayName:      u.display_name || u.name || (u.email ? u.email.split('@')[0] : 'User'),
    role:             u.role || 'user',
    subscriptionTier: u.subscription_tier || 'free',
    premium:          !!Number(u.is_premium || 0),
    createdAt:        u.created_at || null,
  };
}

// ── Token issuing ─────────────────────────────────────────────────────────────
async function issueTokenPair(user, db) {
  const pub = publicUser(user);
  const accessToken = jwt.sign(
    { id: user.id, role: pub.role, email: pub.email, phone: pub.phone, displayName: pub.displayName, premium: pub.premium },
    JWT_SECRET(),
    { expiresIn: CONFIG.JWT_EXPIRES_IN, algorithm: 'HS256' }
  );
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh', jti: crypto.randomUUID() },
    JWT_REFRESH_SECRET(),
    { expiresIn: CONFIG.JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' }
  );
  const decoded   = jwt.decode(refreshToken);
  const expiresAt = new Date((decoded?.exp ?? Math.floor(Date.now() / 1000) + 60 * 86400) * 1000).toISOString();
  await db.run(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, used)
     VALUES (?, ?, ?, 0) ON CONFLICT (user_id, token_hash) DO NOTHING`,
    [user.id, sha256(refreshToken), expiresAt]
  );
  return { token: accessToken, refreshToken, user: pub };
}

// ── Login lockout ─────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_MINUTES    = 15;

async function recordFailedLogin(db, userId) {
  const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
  await db.run(
    `UPDATE users
        SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
            lock_until = CASE WHEN COALESCE(failed_login_attempts, 0) + 1 >= ? THEN ? ELSE lock_until END
      WHERE id = ?`,
    [MAX_LOGIN_ATTEMPTS, lockUntil, userId]
  );
}
async function clearFailedLogins(db, userId) {
  await db.run('UPDATE users SET failed_login_attempts = 0, lock_until = NULL WHERE id = ?', [userId]);
}
function isAccountLocked(user) {
  if (!user.lock_until) return false;
  const t = new Date(user.lock_until).getTime();
  return Number.isFinite(t) && t > Date.now();
}

async function findUserByIdentifier(db, type, value) {
  return type === 'email'
    ? db.get(`SELECT * FROM users WHERE LOWER(email) = ? AND COALESCE(account_status, 'active') <> 'banned'`, [value])
    : db.get(`SELECT * FROM users WHERE (phone = ? OR login_identifier = ?) AND COALESCE(account_status, 'active') <> 'banned'`, [value, value]);
}

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', registerLimiter, validate(schemas.auth.register), async (req, res) => {
  try {
    const db = await getDb();
    const {
      password, displayName: rawDisplayName, name: rawName,
      isAttorney = false, barNumber = null, barState = null, practiceAreas = null, firmName = null,
    } = req.body || {};
    const identifier = pickIdentifier(req.body);
    if (!identifier || !password) return err400(res, 'identifier and password are required');
    if (String(password).length < 8) return err400(res, 'password must be at least 8 characters');

    const { type, value } = normalizeIdentifier(identifier);
    if (type === 'unknown') return err400(res, 'identifier must be a valid email or phone number');

    const exists = await findUserByIdentifier(db, type, value);
    const existsAny = exists || await db.get(
      type === 'email' ? 'SELECT id FROM users WHERE LOWER(email) = ?' : 'SELECT id FROM users WHERE phone = ?', [value]);
    if (existsAny) {
      return res.status(409).json({ error: `${type === 'email' ? 'Email' : 'Phone number'} already registered` });
    }

    const hash = await bcrypt.hash(password, 12);
    const rawDN = rawDisplayName || rawName;
    const safeDisplayName = rawDN ? truncateStr(sanitizeStr(String(rawDN), 100), 100).trim() : '';
    const name = safeDisplayName || defaultDisplayName(value, type);
    const userRole = isAttorney ? 'attorney' : 'user';
    const safeBarNumber = barNumber ? sanitizeStr(String(barNumber), 30) : null;
    const safeBarState  = barState  ? sanitizeStr(String(barState), 3).toUpperCase() : null;
    const safeFirmName  = firmName  ? truncateStr(sanitizeStr(String(firmName), 100), 100) : null;

    const user = await db.transaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO users
           (email, phone, password_hash, name, display_name, login_identifier,
            role, bar_number, bar_state, firm_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [type === 'email' ? value : null, type === 'phone' ? value : null,
         hash, name, name, value, userRole, safeBarNumber, safeBarState, safeFirmName]
      );
      if (isAttorney && r.lastID) {
        await tx.run(
          `INSERT INTO attorney_profiles
             (user_id, bar_number, bar_state, firm_name, practice_areas, bar_verification_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [r.lastID, safeBarNumber, safeBarState, safeFirmName, practiceAreas ? JSON.stringify(practiceAreas) : null]
        );
      }
      return tx.get('SELECT * FROM users WHERE id = ?', [r.lastID]);
    });
    if (!user) return res.status(500).json({ error: 'Registration failed' });

    const out = await issueTokenPair(user, db);
    audit?.('auth.register', { userId: user.id, req })?.catch?.(() => {});
    if (type === 'email') {
      import('../services/email.js')
        .then(m => m.sendWelcome(value, name))
        .catch(e => logger.warn('[auth/register] welcome email:', e.message));
    }
    res.status(201).json(out);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Account already registered' });
    logger.error('[auth/register]', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', authLimiter, validate(schemas.auth.login), async (req, res) => {
  try {
    const db = await getDb();
    const { password } = req.body || {};
    const identifier = pickIdentifier(req.body);
    if (!identifier || !password) return err400(res, 'identifier and password are required');

    const { type, value } = normalizeIdentifier(identifier);
    if (type === 'unknown') return err401(res, 'Invalid credentials. Please check your email/phone and password.');

    const user = await findUserByIdentifier(db, type, value);
    if (!user || !user.password_hash) {
      return err401(res, 'Invalid credentials. Please check your email/phone and password.');
    }
    if (isAccountLocked(user)) {
      const mins = Math.max(1, Math.ceil((new Date(user.lock_until) - Date.now()) / 60000));
      return res.status(423).json({ error: `Account temporarily locked. Try again in ${mins} minutes.`, code: 'account_locked' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await recordFailedLogin(db, user.id).catch(e => logger.warn('[auth/login] lockout update:', e.message));
      return err401(res, 'Invalid credentials. Please check your email/phone and password.');
    }
    if (user.failed_login_attempts || user.lock_until) await clearFailedLogins(db, user.id).catch(() => {});
    db.run('UPDATE users SET last_seen = ? WHERE id = ?', [new Date().toISOString(), user.id]).catch(() => {});

    res.json(await issueTokenPair(user, db));
  } catch (e) {
    logger.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get('/me', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return err404(res, 'User not found');
    res.json(publicUser(user));
  } catch (e) {
    logger.error('[auth/me]', e.message);
    res.status(500).json({ error: 'Could not load profile' });
  }
});

// ── POST /update-profile ──────────────────────────────────────────────────────
router.post('/update-profile', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { displayName: rawDN, phone, email } = req.body || {};
    const displayName = rawDN ? truncateStr(sanitizeStr(String(rawDN), 100), 100) : null;
    const updates = [];
    const vals = [];

    if (displayName?.trim()) {
      updates.push('display_name = ?', 'name = ?');
      vals.push(displayName.trim(), displayName.trim());
    }
    if (phone) {
      const { type, value } = normalizeIdentifier(phone);
      if (type !== 'phone') return err400(res, 'Invalid phone number');
      updates.push('phone = ?');
      vals.push(value);
    }
    if (email) {
      if (!validateEmail(email)) return err400(res, 'Invalid email format');
      updates.push('email = ?');
      vals.push(String(email).trim().toLowerCase());
    }
    if (updates.length === 0) return err400(res, 'Nothing to update');

    vals.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json(publicUser(user));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email or phone is already in use.' });
    logger.error('[auth/update-profile]', e.message);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// ── POST /forgot-password ─────────────────────────────────────────────────────
// Always 200 (prevents account enumeration). Stores only a SHA-256 of the token.
router.post('/forgot-password', resetLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase();
    if (!email) return err400(res, 'Email required');
    if (!validateEmail(email)) return err400(res, 'Invalid email format');
    const db   = await getDb();
    const user = await db.get('SELECT id, email FROM users WHERE LOWER(email) = ?', [email]);
    if (!user) return res.json({ sent: true });

    const token = crypto.randomBytes(32).toString('hex');
    const exp   = new Date(Date.now() + 3_600_000).toISOString();
    // Invalidate older outstanding tokens for this user, then store the new one
    await db.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await db.run('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, sha256(token), exp]);

    const base = (process.env.APP_URL || process.env.FRONTEND_URL || 'https://justicegavel.app').split(',')[0].trim().replace(/\/+$/, '');
    const url  = `${base}/reset-password?token=${token}`;
    try {
      const { sendPasswordReset } = await import('../services/email.js');
      await sendPasswordReset(user.email, url);
    } catch (e) { logger.warn('[auth/forgot-password/email]', e?.message); }
    res.json({ sent: true });
  } catch (e) {
    logger.error('[auth/forgot-password]', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /reset-password ──────────────────────────────────────────────────────
router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return err400(res, 'token and password are required');
    if (String(password).length < 8) return err400(res, 'password must be at least 8 characters');
    const db  = await getDb();
    const row = await db.get(
      'SELECT id, user_id FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [sha256(token)]
    );
    if (!row) return res.status(400).json({ error: 'Reset link is invalid or has expired.', code: 'invalid_reset_token' });
    const hash = await bcrypt.hash(password, 12);
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET password_hash = ?, failed_login_attempts = 0, lock_until = NULL WHERE id = ?', [hash, row.user_id]);
      await tx.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [row.user_id]);
      await tx.run('DELETE FROM refresh_tokens WHERE user_id = ?', [row.user_id]);   // sign out other sessions
    });
    res.json({ ok: true, message: 'Password updated. Please sign in.' });
  } catch (e) {
    logger.error('[auth/reset-password]', e.message);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

// ── POST /refresh ─────────────────────────────────────────────────────────────
router.post('/refresh', validate(schemas.auth.refresh), async (req, res) => {
  try {
    const db = await getDb();
    const { refreshToken } = req.body || {};

    if (refreshToken) {
      // 1. Verify signature + expiry
      let decoded;
      try {
        decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET(), { algorithms: ['HS256'] });
      } catch {
        return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'invalid_refresh' });
      }
      if (decoded.type !== 'refresh') {
        return res.status(401).json({ error: 'Not a refresh token', code: 'invalid_refresh' });
      }
      // 2. Single-use rotation: atomically mark this token used
      const marked = await db.run(
        `UPDATE refresh_tokens SET used = 1
          WHERE user_id = ? AND token_hash = ? AND used = 0 AND expires_at > NOW()`,
        [decoded.id, sha256(refreshToken)]
      );
      if (!marked.changes) {
        // Reuse of a rotated token → possible theft: revoke every session
        await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [decoded.id]).catch(() => {});
        return res.status(401).json({ error: 'Refresh token already used or expired', code: 'token_reuse' });
      }
      const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
      if (!user || user.account_status === 'banned') {
        return res.status(401).json({ error: 'Account not found', code: 'user_not_found' });
      }
      return res.json(await issueTokenPair(user, db));
    }

    // Mobile app path: no refresh token — re-issue from a still-valid access token
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    if (!token) return err400(res, 'refreshToken required');
    let claims;
    try {
      claims = jwt.verify(token, JWT_SECRET(), { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'token_expired' });
    }
    const user = await db.get('SELECT * FROM users WHERE id = ?', [claims.id]);
    if (!user || user.account_status === 'banned') {
      return res.status(401).json({ error: 'Account not found', code: 'user_not_found' });
    }
    res.json(await issueTokenPair(user, db));
  } catch (e) {
    logger.error('[auth/refresh]', e.message);
    res.status(500).json({ error: 'Could not refresh token' });
  }
});

// ── DELETE /account ───────────────────────────────────────────────────────────
router.delete('/account', authRequired, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return err400(res, 'Password required to delete account.');
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return err404(res, 'Account not found.');
    if (isAccountLocked(user)) {
      const mins = Math.ceil((new Date(user.lock_until) - new Date()) / 60000);
      return res.status(423).json({ error: `Account temporarily locked. Try again in ${mins} minutes.` });
    }
    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid) return err401(res, 'Incorrect password.');

    const uid = req.user.id;
    let attachmentKeys = [];
    await db.transaction(async (tx) => {
      // Child rows first. A missing table/column (schema drift) is skipped via
      // a SAVEPOINT so it cannot abort the whole transaction.
      const purge = async (sql, params) => {
        await tx.run('SAVEPOINT purge_step');
        try { await tx.run(sql, params); await tx.run('RELEASE SAVEPOINT purge_step'); }
        catch (e) {
          await tx.run('ROLLBACK TO SAVEPOINT purge_step');
          if (!['42P01', '42703'].includes(e.code)) throw e;
        }
      };
      await purge('DELETE FROM case_messages WHERE user_id = ? OR sender_id = ?', [uid, uid]);
      await purge('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?', [uid, uid]);
      await tx.run('SAVEPOINT purge_step');
      try {
        attachmentKeys = await tx.all('SELECT storage, storage_key FROM message_attachments WHERE uploader_id = ?', [uid]);
        await tx.run('RELEASE SAVEPOINT purge_step');
      } catch (e) {
        await tx.run('ROLLBACK TO SAVEPOINT purge_step');
        if (!['42P01', '42703'].includes(e.code)) throw e;
      }
      await purge('DELETE FROM message_attachments WHERE uploader_id = ?', [uid]);
      await purge('DELETE FROM case_events WHERE user_id = ?', [uid]);
      await purge('DELETE FROM cases WHERE user_id = ?', [uid]);
      await purge('DELETE FROM push_tokens WHERE user_id = ?', [uid]);
      await purge('DELETE FROM scheduled_pushes WHERE user_id = ?', [uid]);
      await purge('DELETE FROM subscriptions WHERE user_id = ?', [uid]);
      await purge('DELETE FROM saved_lawyers WHERE user_id = ?', [uid]);
      await purge('DELETE FROM consultations WHERE user_id = ?', [uid]);
      await purge('DELETE FROM motions WHERE user_id = ?', [uid]);
      await purge('DELETE FROM ai_jobs WHERE user_id = ?', [uid]);
      await purge('DELETE FROM chat_messages WHERE user_id = ?', [uid]);
      await purge('DELETE FROM refresh_tokens WHERE user_id = ?', [uid]);
      await purge('DELETE FROM password_resets WHERE user_id = ?', [uid]);
      await purge('DELETE FROM user_disclaimer_acceptance WHERE user_id = ?', [uid]);
      await tx.run('DELETE FROM users WHERE id = ?', [uid]);
      await purge('INSERT INTO account_deletion_log (deleted_at, reason) VALUES (NOW(), ?)', ['user_request']);
    });
    try { (await import('../middleware/auth.js')).invalidateUserCache?.(uid); } catch { /* ignore */ }
    // Remove the user's encrypted attachment files (best effort, after commit).
    if (attachmentKeys.length) {
      import('../services/attachmentStorage.js').then(async ({ getAttachmentStorage }) => {
        const storage = await getAttachmentStorage();
        for (const a of attachmentKeys) {
          if (storage && storage.kind === a.storage) await storage.remove(a.storage_key).catch(() => {});
        }
      }).catch(() => {});
    }
    res.json({ ok: true, message: 'Account permanently deleted.' });
  } catch (e) {
    logger.error('[auth/account/delete]', e.message);
    res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }
});

// ── GET /export — GDPR/CCPA data export ───────────────────────────────────────
router.get('/export', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const opt = (p) => p.catch(() => []);
    const [user, cases_, motions, consultations, savedLawyers] = await Promise.all([
      db.get('SELECT id, email, name, display_name, phone, role, created_at FROM users WHERE id = ?', [req.user.id]),
      opt(db.all('SELECT id, title, status, created_at, updated_at FROM cases WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', [req.user.id])),
      opt(db.all('SELECT * FROM motions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [req.user.id])),
      opt(db.all('SELECT * FROM consultations WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [req.user.id])),
      opt(db.all('SELECT * FROM saved_lawyers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [req.user.id])),
    ]);
    res.json({
      exported_at: new Date().toISOString(),
      notice: 'This export contains all personal data Justice Gavel holds for your account.',
      data: { profile: user, cases: cases_, motions, consultations, savedLawyers },
    });
  } catch (e) {
    logger.error('[auth/export]', e.message);
    res.status(500).json({ error: 'Could not export data. Please try again.' });
  }
});

// ── POST /logout ──────────────────────────────────────────────────────────────
router.post('/logout', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const { refreshToken, allDevices } = req.body || {};
    if (allDevices) {
      await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.id]);
    } else if (refreshToken) {
      await db.run('UPDATE refresh_tokens SET used = 1 WHERE user_id = ? AND token_hash = ?', [req.user.id, sha256(refreshToken)]);
    }
    await db.run('UPDATE users SET push_token = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true, message: 'Logged out successfully.' });
  } catch (e) {
    logger.error('[auth/logout]', e?.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── CURRENT TOS VERSION — update this when ToS changes ──────────────────────
// Format: MAJOR.MINOR — increment MAJOR for material changes (user must re-accept),
// MINOR for typo fixes / clarifications (no re-accept required).
export const CURRENT_TOS_VERSION = '2.1';

// ─── GET /api/auth/tos-status ─────────────────────────────────────────────────
// Returns whether the authenticated user needs to accept the ToS (or a new version).
// Called on app launch — if needs_acceptance=true, show the clickwrap modal.
router.get('/tos-status', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get(
      'SELECT tos_version_accepted, tos_accepted_at FROM users WHERE id=?',
      [req.user.id]
    ).catch(() => null);

    if (!user) return res.status(404).json({ error: 'User not found.' });

    const needs_acceptance = (user.tos_version_accepted !== CURRENT_TOS_VERSION);
    res.json({
      needs_acceptance,
      current_version:   CURRENT_TOS_VERSION,
      accepted_version:  user.tos_version_accepted || null,
      accepted_at:       user.tos_accepted_at      || null,
    });
  } catch (e) {
    logger.error('[auth/tos-status]', e.message);
    res.status(500).json({ error: 'Could not retrieve ToS status.' });
  }
});

// ─── POST /api/auth/accept-tos ────────────────────────────────────────────────
// Records the user's clickwrap acceptance of the ToS.
// Both checkboxes must be checked. Scroll completion is tracked by client.
// Creates an immutable audit log entry.
router.post('/accept-tos', authRequired, async (req, res) => {
  try {
    const {
      tos_version,
      scroll_completed  = true,
      checkbox_tos      = false,
      checkbox_no_advice = false,
      platform,
      device_id,
    } = req.body || {};

    // Validate both required checkboxes
    if (!checkbox_tos) {
      return res.status(400).json({
        error: 'You must check "I have read and agree to the Terms of Service."',
      });
    }
    if (!checkbox_no_advice) {
      return res.status(400).json({
        error: 'You must check "I understand that Justice Gavel is not a law firm and does not provide legal advice."',
      });
    }
    if (!scroll_completed) {
      return res.status(400).json({
        error: 'Please scroll through the Terms of Service before accepting.',
      });
    }

    // Only accept the current version — prevents replay of old acceptances
    const version = tos_version || CURRENT_TOS_VERSION;
    if (version !== CURRENT_TOS_VERSION) {
      return res.status(400).json({
        error: `ToS version mismatch. Please reload and accept version ${CURRENT_TOS_VERSION}.`,
        current_version: CURRENT_TOS_VERSION,
      });
    }

    // Hash the IP for audit purposes (not storing raw IP — privacy-preserving)
    const rawIp  = req.ip || req.connection?.remoteAddress || 'unknown';
    const crypto = await import('crypto');
    const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 16);

    const acceptedAt = new Date().toISOString();
    const db = await getDb();

    // Update user record (fast lookup for login flow)
    await db.run(
      `UPDATE users
       SET tos_accepted_at = ?, tos_version_accepted = ?, tos_platform = ?, tos_ip_hash = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [acceptedAt, version, platform || null, ipHash, req.user.id]
    );

    // Immutable audit log entry — never updated, only appended
    await db.run(
      `INSERT INTO tos_acceptance_log
         (user_id, tos_version, accepted_at, platform, ip_hash, device_id,
          scroll_completed, checkbox_tos, checkbox_no_advice, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, version, acceptedAt,
        platform || null, ipHash,
        device_id ? String(device_id).slice(0, 100) : null,
        scroll_completed ? 1 : 0,
        checkbox_tos      ? 1 : 0,
        checkbox_no_advice ? 1 : 0,
        req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 200) : null,
      ]
    );

    logger.info(`[auth/accept-tos] user ${req.user.id} accepted ToS v${version} on ${platform || 'unknown'}`);

    res.json({
      ok:           true,
      accepted_at:  acceptedAt,
      version,
      message: 'Terms of Service accepted. Thank you.',
    });
  } catch (e) {
    logger.error('[auth/accept-tos]', e.message);
    res.status(500).json({ error: 'Could not record acceptance. Please try again.' });
  }
});



// POST /api/auth/disclaimer/accept — record disclaimer acceptance
router.post('/disclaimer/accept', authRequired, async (req, res) => {
  try {
    const { recordDisclaimerAcceptance } = await import('../middleware/disclaimer.js');
    const result = await recordDisclaimerAcceptance(req.user.id, req);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Could not record acceptance.' });
  }
});

// GET /api/auth/disclaimer/status — check if user needs to accept
router.get('/disclaimer/status', authRequired, async (req, res) => {
  const { checkDisclaimerStatus } = await import('../middleware/disclaimer.js');
  const status = await checkDisclaimerStatus(req.user.id);
  res.json(status);
});


// GET /api/auth/data/export — GDPR/CCPA data portability
// Returns all user data as a downloadable JSON
router.get('/data/export', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;

    const [user, cases, checkins, messages, subscriptions, auditLog] = await Promise.all([
      db.get('SELECT id, display_name, email, role, created_at FROM users WHERE id=?', [userId]),
      db.all('SELECT * FROM cases WHERE user_id=? AND deleted_at IS NULL', [userId]),
      db.all('SELECT * FROM checkins WHERE user_id=? LIMIT 500', [userId]),
      db.all('SELECT role, content, created_at FROM chat_messages WHERE user_id=? LIMIT 1000', [userId]),
      db.all('SELECT tier, status, created_at FROM subscriptions WHERE user_id=?', [userId]),
      db.all('SELECT action, entity_type, created_at FROM audit_log WHERE user_id=? LIMIT 200', [userId]),
    ]).catch(() => [null, [], [], [], [], []]);

    await audit('compliance.data_export_requested', { userId, req });

    res.json({
      export_date:   new Date().toISOString(),
      format:        'json',
      version:       '1.0',
      user,
      cases,
      checkins,
      chat_messages: messages,
      subscriptions,
      audit_log:     auditLog,
      disclaimer:    'This export contains all personal data associated with your account. Handle securely.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Export failed.' });
  }
});

export default router;