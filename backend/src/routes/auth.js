import { logIgnored } from '../utils/ignored.js';
import { audit } from '../utils/audit.js';
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

import { err400, truncateStr, err404, sanitizeStr, validateEmail } from '../utils/routeHelpers.js';
import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import bcrypt from 'bcryptjs';
import { CONFIG } from '../config.js';
import jwt from 'jsonwebtoken';
import { authRequired } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { purgeAccountData, exportAccount } from '../services/accountDeletion.js';
import logger from '../utils/logger.js';
import { msg, reqMsg, resolveLang, requestedLang, normalizeLang } from '../i18n/index.js';

const IS_TEST = process.env.NODE_ENV === 'test';

// ── Secrets — always from env (config.js generates dev-only values; production
//    refuses to start without them). No hard-coded fallbacks. ──────────────────
const JWT_SECRET         = () => process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// ── Rate limits ───────────────────────────────────────────────────────────────
// Messages are written in the request's language (?lang= / Accept-Language).
const limitMessage = (key, code) => (req) => ({ error: msg(resolveLang(req), key), code });
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message:  limitMessage('auth.err.too_many_resets', 'too_many_resets'),
  standardHeaders: true, legacyHeaders: false,
  skip: () => IS_TEST,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: parseInt(process.env.AUTH_RATE_LIMIT || '10', 10),
  standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,     // only failures count toward the limit
  message: limitMessage('auth.err.too_many_logins', 'too_many_logins'),
  skip: () => IS_TEST,
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: parseInt(process.env.REGISTER_RATE_LIMIT || '5', 10),
  message: limitMessage('auth.err.too_many_registrations', 'too_many_registrations'),
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

/** What the app's navigator needs to send someone to their own home screen. */
const ATTORNEY_ROLES = new Set(['attorney', 'defender']);
function accountType(u) {
  if (ATTORNEY_ROLES.has(u.role) || Number(u.is_defender) === 1) return 'attorney';
  if (u.user_type === 'bail_agent' || u.has_bondsman_profile) return 'bail_agent';
  return 'consumer';
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
    accountType:      accountType(u),
    preferredLanguage: normalizeLang(u.preferred_language) || null,
  };
}

/** The user row plus whether a bail-agent (bondsman) profile exists. */
function loadUser(db, id) {
  return db.get(
    `SELECT u.*, EXISTS (SELECT 1 FROM bondsman_profiles b WHERE b.user_id = u.id) AS has_bondsman_profile
       FROM users u WHERE u.id = ?`, [id]);
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
  return await (type === 'email'
    ? db.get(`SELECT * FROM users WHERE LOWER(email) = ? AND COALESCE(account_status, 'active') <> 'banned'`, [value])
    : db.get(`SELECT * FROM users WHERE (phone = ? OR login_identifier = ?) AND COALESCE(account_status, 'active') <> 'banned'`, [value, value]));
}

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', registerLimiter, validate(schemas.auth.register), async (req, res) => {
  const m = reqMsg(req);
  try {
    const db = await getDb();
    const {
      password, displayName: rawDisplayName, name: rawName,
      barNumber = null, barState = null, practiceAreas = null, firmName = null,
    } = req.body || {};
    // accountType: 'consumer' | 'attorney' | 'bail_agent' (legacy clients send isAttorney)
    const acctType = req.body?.accountType || (req.body?.isAttorney ? 'attorney' : 'consumer');
    const isAttorney = acctType === 'attorney';
    const identifier = pickIdentifier(req.body);
    if (!identifier || !password) return err400(res, m('auth.err.identifier_password_required'));
    if (String(password).length < 8) return err400(res, m('auth.err.password_short'));

    const { type, value } = normalizeIdentifier(identifier);
    if (type === 'unknown') return err400(res, m('auth.err.identifier_invalid'));

    const exists = await findUserByIdentifier(db, type, value);
    const existsAny = exists || await db.get(
      type === 'email' ? 'SELECT id FROM users WHERE LOWER(email) = ?' : 'SELECT id FROM users WHERE phone = ?', [value]);
    if (existsAny) {
      return res.status(409).json({ error: m(type === 'email' ? 'auth.err.email_taken' : 'auth.err.phone_taken'), code: 'already_registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const rawDN = rawDisplayName || rawName;
    const safeDisplayName = rawDN ? truncateStr(sanitizeStr(String(rawDN), 100), 100).trim() : '';
    const name = safeDisplayName || defaultDisplayName(value, type);
    const userRole = isAttorney ? 'attorney' : 'user';
    const safeBarNumber = barNumber ? sanitizeStr(String(barNumber), 30) : null;
    const safeBarState  = barState  ? sanitizeStr(String(barState), 3).toUpperCase() : null;
    const safeFirmName  = firmName  ? truncateStr(sanitizeStr(String(firmName), 100), 100) : null;

    // The language the person signed up in: reminders and e-mails use it.
    const lang = requestedLang(req);
    const userType = acctType === 'bail_agent' ? 'bail_agent' : null;
    const created = await db.transaction(async (tx) => {
      const r = await tx.run(
        `INSERT INTO users
           (email, phone, password_hash, name, display_name, login_identifier,
            role, bar_number, bar_state, firm_name, preferred_language, user_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [type === 'email' ? value : null, type === 'phone' ? value : null,
         hash, name, name, value, userRole, safeBarNumber, safeBarState, safeFirmName, lang, userType]
      );
      if (isAttorney && r.lastID) {
        await tx.run(
          `INSERT INTO attorney_profiles
             (user_id, bar_number, bar_state, firm_name, practice_areas, bar_verification_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [r.lastID, safeBarNumber, safeBarState, safeFirmName, practiceAreas ? JSON.stringify(practiceAreas) : null]
        );
      }
      return r.lastID;
    });
    const user = created ? await loadUser(db, created) : null;
    if (!user) return res.status(500).json({ error: m('auth.err.register_failed') });

    const out = await issueTokenPair(user, db);
    audit?.('auth.register', { userId: user.id, req })?.catch?.(() => {});
    if (type === 'email') {
      import('../services/email.js')
        .then(mod => mod.sendWelcome(value, name, lang || 'en'))
        .catch(e => logger.warn('[auth/register] welcome email:', e.message));
    }
    res.status(201).json(out);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: m('auth.err.email_taken'), code: 'already_registered' });
    logger.error('[auth/register]', e.message);
    res.status(500).json({ error: m('auth.err.register_failed') });
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────
const lockedMinutes = (user) => Math.max(1, Math.ceil((new Date(user.lock_until) - Date.now()) / 60000));

router.post('/login', authLimiter, validate(schemas.auth.login), async (req, res) => {
  const m = reqMsg(req);
  const badCredentials = () => res.status(401).json({ error: m('auth.err.invalid_credentials'), code: 'invalid_credentials' });
  try {
    const db = await getDb();
    const { password } = req.body || {};
    const identifier = pickIdentifier(req.body);
    if (!identifier || !password) return err400(res, m('auth.err.identifier_password_required'));

    const { type, value } = normalizeIdentifier(identifier);
    if (type === 'unknown') return badCredentials();

    const found = await findUserByIdentifier(db, type, value);
    if (!found || !found.password_hash) return badCredentials();
    if (isAccountLocked(found)) {
      return res.status(423).json({ error: m('auth.err.locked', { minutes: lockedMinutes(found) }), code: 'account_locked' });
    }

    const ok = await bcrypt.compare(password, found.password_hash);
    if (!ok) {
      await recordFailedLogin(db, found.id).catch(e => logger.warn('[auth/login] lockout update:', e.message));
      return badCredentials();
    }
    if (found.failed_login_attempts || found.lock_until) await clearFailedLogins(db, found.id).catch(logIgnored('routes/auth'));
    db.run('UPDATE users SET last_seen = ? WHERE id = ?', [new Date().toISOString(), found.id]).catch(logIgnored('routes/auth'));

    res.json(await issueTokenPair(await loadUser(db, found.id) || found, db));
  } catch (e) {
    logger.error('[auth/login]', e.message);
    res.status(500).json({ error: m('auth.err.login_failed') });
  }
});

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get('/me', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const user = await loadUser(db, req.user.id);
    if (!user) return err404(res, msg(resolveLang(req), 'auth.err.account_not_found'));
    res.json(publicUser(user));
  } catch (e) {
    logger.error('[auth/me]', e.message);
    res.status(500).json({ error: msg(resolveLang(req), 'auth.err.server') });
  }
});

// ── POST /update-profile ──────────────────────────────────────────────────────
router.post('/update-profile', authRequired, async (req, res) => {
  const m = reqMsg(req);
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
      if (type !== 'phone') return err400(res, m('auth.err.phone_invalid'));
      updates.push('phone = ?');
      vals.push(value);
    }
    if (email) {
      if (!validateEmail(email)) return err400(res, m('auth.err.email_invalid'));
      updates.push('email = ?');
      vals.push(String(email).trim().toLowerCase());
    }
    if (updates.length === 0) return err400(res, m('auth.err.nothing_to_update'));

    vals.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals);
    const user = await loadUser(db, req.user.id);
    if (!user) return res.status(404).json({ error: m('auth.err.account_not_found') });
    res.json(publicUser(user));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: m('auth.err.in_use'), code: 'in_use' });
    logger.error('[auth/update-profile]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ── POST /forgot-password ─────────────────────────────────────────────────────
// Always 200 (prevents account enumeration). Stores only a SHA-256 of the token.
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const m = reqMsg(req);
  try {
    const email = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: m('auth.err.email_required'), code: 'email_required' });
    if (!validateEmail(email)) return res.status(400).json({ error: m('auth.err.email_invalid'), code: 'email_invalid' });
    // No e-mail provider configured: say so (the same for every address, so it
    // reveals nothing about which accounts exist) instead of "sent".
    const { emailLive } = await import('../services/email.js');
    if (!emailLive()) return res.status(503).json({ error: m('auth.err.reset_email_unavailable'), code: 'email_unavailable' });
    const db   = await getDb();
    const user = await db.get('SELECT id, email, preferred_language FROM users WHERE LOWER(email) = ?', [email]);
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
      // In the language the person asked in, else the one saved on the account.
      await sendPasswordReset(user.email, url, requestedLang(req) || normalizeLang(user.preferred_language) || 'en');
    } catch (e) { logger.warn('[auth/forgot-password/email]', e?.message); }
    res.json({ sent: true });
  } catch (e) {
    logger.error('[auth/forgot-password]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ── POST /reset-password ──────────────────────────────────────────────────────
router.post('/reset-password', resetLimiter, async (req, res) => {
  const m = reqMsg(req);
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return err400(res, m('auth.err.reset_fields_required'));
    if (String(password).length < 8) return err400(res, m('auth.err.password_short'));
    const db  = await getDb();
    const row = await db.get(
      'SELECT id, user_id FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [sha256(token)]
    );
    if (!row) return res.status(400).json({ error: m('auth.err.reset_invalid'), code: 'invalid_reset_token' });
    const hash = await bcrypt.hash(password, 12);
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET password_hash = ?, failed_login_attempts = 0, lock_until = NULL WHERE id = ?', [hash, row.user_id]);
      await tx.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [row.user_id]);
      await tx.run('DELETE FROM refresh_tokens WHERE user_id = ?', [row.user_id]);   // sign out other sessions
    });
    res.json({ ok: true, message: m('auth.reset_done') });
  } catch (e) {
    logger.error('[auth/reset-password]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
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
        await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [decoded.id]).catch(logIgnored('routes/auth'));
        return res.status(401).json({ error: 'Refresh token already used or expired', code: 'token_reuse' });
      }
      const user = await loadUser(db, decoded.id);
      if (!user || ['banned', 'suspended', 'deleted', 'disabled', 'locked_out'].includes(String(user.account_status || '').toLowerCase())) {
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
      return res.status(401).json({ error: msg(resolveLang(req), 'auth.err.session_expired'), code: 'token_expired' });
    }
    const user = await loadUser(db, claims.id);
    // Same disabled-account rule as middleware/auth.js — a suspended or deleted
    // account must not be able to mint fresh tokens either.
    if (!user || ['banned', 'suspended', 'deleted', 'disabled', 'locked_out'].includes(String(user.account_status || '').toLowerCase())) {
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
  const m = reqMsg(req);
  const { password } = req.body || {};
  if (!password) return err400(res, m('auth.err.delete_password_required'));
  try {
    const db = await getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return err404(res, m('auth.err.account_not_found'));
    if (isAccountLocked(user)) {
      return res.status(423).json({ error: m('auth.err.locked', { minutes: lockedMinutes(user) }), code: 'account_locked' });
    }
    // 403, not 401: the session is valid — a 401 would sign the person out of the app.
    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid) return res.status(403).json({ error: m('auth.err.wrong_password'), code: 'incorrect_password' });

    const uid = req.user.id;
    // Every table that references the user is handled by one registry
    // (services/accountDeletion.js): own rows deleted, other people's records
    // de-linked, owned firms handed to a remaining member — no orphans.
    let attachmentKeys = [];
    await db.transaction(async (tx) => {
      ({ attachmentKeys } = await purgeAccountData(tx, uid, { email: user.email }));
      await tx.run('DELETE FROM users WHERE id = ?', [uid]);
      await tx.run('SAVEPOINT deletion_log');
      try {
        await tx.run('INSERT INTO account_deletion_log (deleted_at, reason) VALUES (NOW(), ?)', ['user_request']);
        await tx.run('RELEASE SAVEPOINT deletion_log');
      } catch (e) {
        await tx.run('ROLLBACK TO SAVEPOINT deletion_log');
        logger.warn('[auth/account/delete] deletion log row not written:', e.message);
      }
    });
    try { (await import('../middleware/auth.js')).invalidateUserCache?.(uid); } catch { /* ignore */ }
    // Remove the user's encrypted attachment files (best effort, after commit).
    if (attachmentKeys.length) {
      import('../services/attachmentStorage.js').then(async ({ getAttachmentStorage }) => {
        const storage = await getAttachmentStorage();
        for (const a of attachmentKeys) {
          if (storage && storage.kind === a.storage) await storage.remove(a.storage_key).catch(logIgnored('routes/auth'));
        }
      }).catch(logIgnored('routes/auth'));
    }
    res.json({ ok: true, message: m('auth.deleted') });
  } catch (e) {
    logger.error('[auth/account/delete]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ── GET /export — GDPR/CCPA data export ───────────────────────────────────────
// Everything the account holds (same registry as account deletion), secrets
// omitted, encrypted notes/messages decrypted for their owner.
async function sendExport(req, res) {
  try {
    const db = await getDb();
    const { profile, data, truncated } = await exportAccount(db, req.user.id);
    await audit('compliance.data_export_requested', { userId: req.user.id, req }).catch(logIgnored('routes/auth'));
    res.setHeader('Content-Disposition', 'attachment; filename="justice-gavel-export.json"');
    res.json({
      exported_at: new Date().toISOString(),
      format:      'json',
      version:     '2.0',
      notice:      'This export contains all personal data Justice Gavel holds for your account. Handle it securely.',
      ...(truncated.length ? { truncated_tables: truncated } : {}),
      data: {
        profile,
        // Stable keys the app and older clients read:
        cases:         data.cases || [],
        messages:      [...(data.case_messages || []), ...(data.messages || [])],
        motions:       data.motions || [],
        consultations: [...(data.consultations || []), ...(data.consultation_bookings || [])],
        savedLawyers:  data.saved_lawyers || [],
        chat:          data.chat_sessions || [],
        // Every other table, by name:
        tables:        data,
      },
    });
  } catch (e) {
    logger.error('[auth/export]', e.message);
    res.status(500).json({ error: msg(resolveLang(req), 'auth.err.server') });
  }
}
router.get('/export', authRequired, sendExport);

// ── POST /logout ──────────────────────────────────────────────────────────────
// { refreshToken?, pushToken?, allDevices? } — this device's push token stops
// receiving the account's notifications (the next person on the phone must not
// see them); with allDevices every session and device token is removed.
router.post('/logout', authRequired, async (req, res) => {
  const m = reqMsg(req);
  try {
    const db = await getDb();
    const { refreshToken, allDevices, pushToken } = req.body || {};
    if (allDevices) {
      await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.user.id]);
      await db.run('DELETE FROM push_tokens WHERE user_id = ?', [req.user.id]);
    } else {
      if (refreshToken) {
        await db.run('UPDATE refresh_tokens SET used = 1 WHERE user_id = ? AND token_hash = ?', [req.user.id, sha256(refreshToken)]);
      }
      if (pushToken) {
        await db.run('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [req.user.id, String(pushToken).slice(0, 300)]);
      }
    }
    await db.run('UPDATE users SET push_token = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true, message: m('auth.logged_out') });
  } catch (e) {
    logger.error('[auth/logout]', e?.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ─── CURRENT TOS VERSION — update this when ToS changes ──────────────────────
// Format: MAJOR.MINOR — increment MAJOR for material changes (user must re-accept),
// MINOR for typo fixes / clarifications (no re-accept required).
export const CURRENT_TOS_VERSION = '2.2'; // must equal TOS_VERSION in frontend/src/constants/terms.ts (2.2: Oct 2026 legal accuracy review)

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
  const m = reqMsg(req);
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
    if (!checkbox_tos) return res.status(400).json({ error: m('auth.tos.err.terms'), code: 'tos_unchecked' });
    if (!checkbox_no_advice) return res.status(400).json({ error: m('auth.tos.err.no_advice'), code: 'no_advice_unchecked' });
    if (!scroll_completed) return res.status(400).json({ error: m('auth.tos.err.scroll'), code: 'tos_not_read' });

    // Only accept the current version — prevents replay of old acceptances
    const version = tos_version || CURRENT_TOS_VERSION;
    if (version !== CURRENT_TOS_VERSION) {
      return res.status(400).json({
        error: m('auth.tos.err.version', { version: CURRENT_TOS_VERSION }),
        code: 'tos_version_mismatch',
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
      message: m('auth.tos.accepted'),
    });
  } catch (e) {
    logger.error('[auth/accept-tos]', e.message);
    res.status(500).json({ error: m('auth.tos.err.save') });
  }
});



// POST /api/auth/disclaimer/accept — record disclaimer acceptance
router.post('/disclaimer/accept', authRequired, async (req, res) => {
  try {
    const { recordDisclaimerAcceptance } = await import('../middleware/disclaimer.js');
    const result = await recordDisclaimerAcceptance(req.user.id, req);
    res.json(result);
  } catch (e) {
    logger.error('[auth/disclaimer/accept]', e?.message);
    res.status(500).json({ error: msg(resolveLang(req), 'auth.tos.err.save') });
  }
});

// GET /api/auth/disclaimer/status — check if user needs to accept
router.get('/disclaimer/status', authRequired, async (req, res) => {
  try {
    const { checkDisclaimerStatus } = await import('../middleware/disclaimer.js');
    res.json(await checkDisclaimerStatus(req.user.id));
  } catch (e) {
    logger.error('[auth/disclaimer/status]', e?.message);
    res.status(500).json({ error: msg(resolveLang(req), 'auth.err.server') });
  }
});


// GET /api/auth/data/export — same export (older clients)
router.get('/data/export', authRequired, sendExport);

export default router;