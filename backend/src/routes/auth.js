/**
 * /api/auth — Email-or-phone authentication
 *
 * POST /api/auth/register
 *   Body: { identifier, password, displayName? }
 *   identifier = email address OR phone number (e.g. +16155551234 or 6155551234)
 *
 * POST /api/auth/login
 *   Body: { identifier, password }
 *
 * GET /api/auth/me
 *   Returns current user from token
 *
 * POST /api/auth/update-profile
 *   Body: { displayName?, phone?, email? }
 */

import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import bcrypt from 'bcryptjs';
import { CONFIG } from '../config.js';
import jwt from 'jsonwebtoken';
import { authRequired } from '../middleware/auth.js';

// ── Brute-force protection on credential endpoints (10 req / 15 min per IP) ──
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';

// ── Login attempt tracking ────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_MINUTES    = 15;

async function recordFailedLogin(db, userId) {
  await db.run(
    `UPDATE users
       SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
           lock_until             = CASE
             WHEN COALESCE(failed_login_attempts, 0) + 1 >= ? 
             THEN datetime('now', '+${LOCKOUT_MINUTES} minutes')
             ELSE lock_until
           END
     WHERE id = ?`,
    [MAX_LOGIN_ATTEMPTS, userId]
  );
}

async function clearFailedLogins(db, userId) {
  await db.run(
    `UPDATE users SET failed_login_attempts = 0, lock_until = NULL WHERE id = ?`,
    [userId]
  );
}

async function isAccountLocked(user) {
  if (!user.lock_until) return false;
  return new Date(user.lock_until) > new Date();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 10,                      // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failures toward the limit
  message: { error: 'Too many login attempts — please wait 15 minutes before trying again.' },
  keyGenerator: (req) => req.ip,
});

// ── Account creation rate limit — 5 registrations per IP per hour ─────────────
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created from this device. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});


const ALLOWED_UPDATE_COLS = new Set([
  'display_name','phone','email','push_token','profile_pic',
  'notification_prefs','language','theme','biometric_enabled',
]);
function safeUpdateCols(updates) {
  return updates.filter(col => ALLOWED_UPDATE_COLS.has(col.split('=')[0].trim()));
}

// ── Auth-specific rate limiting — 10 attempts per 15 min per IP ──────────────
const authAttempts = new Map();
function authRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const WINDOW = 15 * 60 * 1000; // 15 minutes
  const MAX    = 10;
  const entry  = authAttempts.get(key) || { count: 0, start: now };
  if (now - entry.start > WINDOW) {
    entry.count = 1; entry.start = now;
  } else {
    entry.count++;
    if (entry.count > MAX) {
      return res.status(429).json({ error: 'Too many login attempts. Wait 15 minutes.' });
    }
  }
  authAttempts.set(key, entry);
  next();
}
const router = Router();

// ── Identifier normalization ──────────────────────────────────────────────────
// Accepts: email, +1XXXXXXXXXX, 1XXXXXXXXXX, XXXXXXXXXX (10 digits)

function normalizeIdentifier(raw = '') {
  const s = raw.trim().toLowerCase();
  // Email
  if (s.includes('@')) return { type: 'email', value: s };
  // Phone: strip everything except digits
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return { type: 'phone', value: '+1' + digits };
  if (digits.length === 11 && digits[0] === '1') return { type: 'phone', value: '+' + digits };
  if (digits.length > 6) return { type: 'phone', value: '+' + digits };
  return { type: 'unknown', value: s };
}

// Build display name from identifier if none provided
function defaultDisplayName(identifier, type) {
  if (type === 'email') {
    const local = identifier.split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1).replace(/[._]/g, ' ');
  }
  if (type === 'phone') {
    const digits = identifier.replace(/\D/g, '');
    return '••• ' + digits.slice(-4);
  }
  return 'User';
}

// ── JWT helper ────────────────────────────────────────────────────────────────

function sign(user) {
  const payload = {
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    displayName: user.display_name || user.name || defaultDisplayName(user.login_identifier || '', ''),
    premium: !!user.is_premium
  };
  const token = jwt.sign(
    payload,
    process.env.JWT_SECRET || 'dev_secret_change_me',
    { expiresIn: CONFIG.JWT_EXPIRES_IN }
  );
  return { token, user: payload };
}

// ── POST /register ────────────────────────────────────────────────────────────

router.post('/register', authRateLimit, registerLimiter, async (req, res) => {
  let db;
  try {
    db = await getDb();
    const { identifier, password, displayName: rawDisplayName } = req.body || {};
    const safeDisplayName = rawDisplayName ? truncateStr(sanitizeStr(String(rawDisplayName), 100), 100) : null;
    if (!identifier || !password) {
      return err400(res, 'identifier and password are required');
    }
    if (password.length < 8) {
      return err400(res, 'password must be at least 8 characters');
    }

    const { type, value } = normalizeIdentifier(identifier);
    if (type === 'unknown') {
      return err400(res, 'identifier must be a valid email or phone number');
    }

    // Check uniqueness
    const field = type === 'email' ? 'email' : type === 'phone' ? 'phone' : null;
  if (!field) return err400(res, 'Invalid type. Must be email or phone.');
    const SAFE_FIELDS = new Set(['email','phone','login_identifier']);
    if (!SAFE_FIELDS.has(field)) return err400(res, 'Invalid field');
    const exists = await db.get(field === 'email' ? 'SELECT id FROM users WHERE email = ?' : 'SELECT id FROM users WHERE phone = ?', [value]);
    if (exists) {
      return res.status(409).json({ error: `${type === 'email' ? 'Email' : 'Phone number'} already registered` });
    }

    const hash = await bcrypt.hash(password, 10);
    const name = safeDisplayName?.trim() || defaultDisplayName(value, type);

    await db.run('BEGIN');
    const r = await db.run(
      `INSERT INTO users (email, phone, password_hash, name, display_name, login_identifier)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        type === 'email' ? value : null,
        type === 'phone' ? value : null,
        hash,
        name,
        name,
        value
      ]
    );

    const user = await db.get('SELECT * FROM users WHERE id = ?', [r.lastID]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await db.run('COMMIT');
    await clearFailedLogins(db, user.id).catch(() => {});
    res.json(sign(user));
  } catch (e) {
    // ROLLBACK if db was initialized
    try { await db.run('ROLLBACK'); } catch (_) {}
    logger.error('[auth/register]', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────

router.post('/login', authRateLimit, authLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return err400(res, 'identifier and password are required');
    }

    const { type, value } = normalizeIdentifier(identifier);
    const field = type === 'email' ? 'email' : type === 'phone' ? 'phone' : null;
  if (!field) return err400(res, 'Invalid type. Must be email or phone.');

    const SAFE_FIELDS_Q = new Set(['email','phone','login_identifier']);
    if (!SAFE_FIELDS_Q.has(field)) throw new Error('Invalid field');
    const user = await db.get(
      field === 'email'
        ? 'SELECT * FROM users WHERE email = ? AND account_status != \'banned\''
        : 'SELECT * FROM users WHERE phone = ? AND account_status != \'banned\'',
      [value]
    );
    if (!user) {
      return err401(res, 'Invalid credentials. Please check your email/phone and password.');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return err401(res, 'Invalid credentials. Please check your email/phone and password.');
    }

    res.json(sign(user));
  } catch (e) {
    logger.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /me ───────────────────────────────────────────────────────────────────

router.get('/me', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.query(
      'SELECT id, identifier, display_name, role, subscription_tier, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows.rows?.[0] ?? rows[0];
    if (!user) return err404(res, 'User not found');
    res.json({
      id:                user.id,
      identifier:        user.identifier,
      displayName:       user.display_name,
      role:              user.role,
      subscriptionTier:  user.subscription_tier,
      createdAt:         user.created_at,
    });
  } catch (e) {
    // Fallback: return what we have from the JWT
    logger.warn('[auth/me] db error, returning JWT payload:', e.message);
    res.json({
      id:               req.user.id,
      identifier:       req.user.identifier,
      displayName:      req.user.displayName || req.user.display_name,
      role:             req.user.role || 'consumer',
      subscriptionTier: req.user.subscriptionTier || 'free',
    });
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
      const { value } = normalizeIdentifier(phone);
      updates.push('phone = ?');
      vals.push(value);
    }
    if (email?.includes('@')) {
      updates.push('email = ?');
      vals.push(email.trim().toLowerCase());
    }

    if (updates.length === 0) return err400(res, 'Nothing to update');

    vals.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    res.json(sign(user).user);
  } catch (e) {
    logger.error('[auth/update-profile]', e.message);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
  if (email && !validateEmail(email)) return err400(res, 'Invalid email format');
    if (!email) return err400(res, 'Email required');
    const db   = await getDb();
    const user = await db.get(
      'SELECT id, email FROM users WHERE email = ? COLLATE NOCASE',
      [email.trim()]
    );
    // Always 200 — prevents email enumeration
    if (!user) return res.json({ sent: true });
    const crypto = await import('crypto');
    const token  = crypto.randomBytes(32).toString('hex');
    const exp    = new Date(Date.now() + 3_600_000).toISOString();
    // password_resets table managed by db/index.js
    try {
      await db.run(
        'INSERT OR REPLACE INTO password_resets (user_id, token, expires_at, used) VALUES (?,?,?,false)',
        [user.id, token, exp]
      );
    } catch (_dbErr) {
      // Table may not exist in demo mode — create it
      await db.run(
        'CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT UNIQUE, expires_at TEXT, used INTEGER DEFAULT 0)'
      ).catch(() => {});
      await db.run(
        'INSERT OR REPLACE INTO password_resets (user_id, token, expires_at) VALUES (?,?,?)',
        [user.id, token, exp]
      ).catch(() => {});
    }
    const base = process.env.CORS_ORIGIN || 'https://justicegavel.app';
    const url  = `${base}/reset-password?token=${token}`;
    // sendEmail imported from sendgrid service
    try {
      const { sendEmail } = await import('../services/sendgrid.js');
      await sendEmail(
        user.email,
        'Reset your Justice Gavel password',
        `Click this link to reset your password (expires in 1 hour):\n\n${url}\n\nIf you did not request this, you can ignore this email.`
      );
    } catch (e) { logger.warn('[auth/forgot-password/email]', e?.message); }
    res.json({ sent: true });
  } catch (e) { logger.error('[auth/forgot-password]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── POST /api/auth/refresh — exchange valid token for a fresh one ─────────────
router.post('/refresh', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await db.get(
      'SELECT id, display_name, email, role FROM users WHERE id=?',
      [req.user.id]
    ).catch(() => null);
    if (!user) return err404(res, 'Invalid credentials');

    const jwt = await import('jsonwebtoken');
    const newToken = jwt.default.sign(
      { id: user.id, role: user.role || 'user', email: user.email },
      process.env.JWT_SECRET || 'dev_secret_change_me',
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );
    res.status(201).json({ token: newToken, user: { id: user.id, name: user.display_name, email: user.email } });
  } catch (e) {
    logger.error('[auth/refresh]', e.message);
    res.status(500).json({ error: 'Could not refresh token' });
  }
});

// ── Account deletion (App Store required) ─────────────────────────────────
// DELETE /api/auth/account
// Permanently deletes the user, all cases, messages, push tokens, subscriptions.
// Requires password confirmation for security.
router.delete('/account', authRequired, async (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return err400(res, 'Password required to delete account.');
  }
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return err404(res, 'Account not found.');

    // Verify password before deletion
    // Check account lockout first
    if (await isAccountLocked(user)) {
      const mins = Math.ceil((new Date(user.lock_until) - new Date()) / 60000);
      return res.status(423).json({ error: `Account temporarily locked. Try again in ${mins} minutes.` });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return err401(res, 'Incorrect password.');

    // Delete all user data in dependency order
    await db.run('DELETE FROM messages        WHERE sender_id   = ? OR recipient_id = ?', [req.user.id, req.user.id]);
    await db.run('DELETE FROM cases           WHERE user_id     = ?', [req.user.id]);
    await db.run('DELETE FROM push_tokens     WHERE user_id     = ?', [req.user.id]);
    await db.run('DELETE FROM scheduled_pushes WHERE user_id   = ?', [req.user.id]);
    await db.run('DELETE FROM subscriptions   WHERE user_id     = ?', [req.user.id]);
    await db.run('DELETE FROM saved_lawyers   WHERE user_id     = ?', [req.user.id]);
    await db.run('DELETE FROM consultations   WHERE user_id     = ?', [req.user.id]);
    await db.run('DELETE FROM motions         WHERE user_id     = ?', [req.user.id]);
    await db.run('DELETE FROM ai_jobs         WHERE user_id     = ?', [req.user.id]);
    // Delete the user record last
    await db.run('DELETE FROM users           WHERE id          = ?', [req.user.id]);

    // Log deletion for compliance (anonymised — no PII)
    await db.run(
      'INSERT OR IGNORE INTO account_deletion_log (deleted_at, region) VALUES (datetime(\'now\'), ?)',
      [req.headers['cf-ipcountry'] || 'unknown']
    ).catch(() => {}); // table may not exist — non-fatal

    res.json({ ok: true, message: 'Account permanently deleted.' });
  } catch (e) {
    logger.error('[auth/account/delete]', e.message);
    res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }
});

// ── GDPR data export ───────────────────────────────────────────────────────
// GET /api/auth/export
// Returns all user data as JSON — required for GDPR/CCPA compliance
router.get('/export', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const [user, cases_, messages, motions, consultations, savedLawyers] = await Promise.all([
      await db.get('SELECT id, email, name, phone, created_at FROM users WHERE id = ?', [req.user.id]),
      db.all('SELECT id, title, status, created_at, updated_at FROM cases WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', [req.user.id]),
      db.all('SELECT id, case_id, sender_id, sender_role, lang, created_at FROM messages WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at DESC LIMIT 500', [req.user.id, req.user.id]),
      db.all('SELECT id, user_id, case_id, title, type, status, created_at FROM motions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [req.user.id]).catch(() => []),
      db.all('SELECT id, user_id, lawyer_id, status, scheduled_at, created_at FROM consultations WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [req.user.id]).catch(() => []),
      db.all('SELECT id, user_id, lawyer_id, created_at FROM saved_lawyers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', [req.user.id]).catch(() => []),
    ]);

    res.json({
      exported_at: new Date().toISOString(),
      notice: 'This export contains all personal data Justice Gavel holds for your account.',
      data: { profile: user, cases: cases_, messages, motions, consultations, savedLawyers },
    });
  } catch (e) {
    logger.error('[auth/export]', e.message);
    res.status(500).json({ error: 'Could not export data. Please try again.' });
  }
});


// POST /logout — invalidate session and clear push token
// Clears push_token so stale device tokens don't accumulate on logout
router.post('/logout', authRequired, async (req, res) => {
  try {
    const db = await getDb();
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
           updated_at = datetime('now')
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


export default router;
