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
 * POST /api/auth/update-profile   { displayName?, email?, currentPassword? }
 *                                  a new email needs the current password and is used only after
 *                                  the link sent to it is opened; a phone number changes only
 *                                  through POST /api/me/phone/verify + /confirm (a texted code)
 * POST /api/auth/confirm-email    { token } — the link in the "confirm your new e-mail" message
 * POST /api/auth/forgot-password  { identifier } (email or phone; legacy { email }) — always 200
 *                                  once sent; stores a hashed reset token; e-mail or text message
 * POST /api/auth/reset-password   { token, password }
 * POST /api/auth/change-password  { currentPassword, newPassword }
 * POST /api/auth/logout           { refreshToken?, pushToken?, allDevices? }
 *
 * Session version (migration 51): every token carries users.token_version ("tv"). A password
 * change or reset, a confirmed new e-mail and logout { allDevices: true } add one to it
 * (bumpTokenVersion), so every token issued before stops working at once.
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
import { authRequired, invalidateUserCache, tokenVersionOf } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { purgeAccountData, exportAccount } from '../services/accountDeletion.js';
import logger from '../utils/logger.js';
import { passwordProblem, passwordProblemKey, DOUBLED_PIN } from '../utils/passwordPolicy.js';
import { sendSms, smsLive } from '../services/sms.js';
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
    // A new address waiting for its confirmation link (POST /auth/confirm-email).
    pendingEmail:     u.pending_email && u.pending_email_expires_at && new Date(u.pending_email_expires_at) > new Date() ? u.pending_email : null,
  };
}

/** The user row plus whether a bail-agent (bondsman) profile exists. */
function loadUser(db, id) {
  return db.get(
    `SELECT u.*, EXISTS (SELECT 1 FROM bondsman_profiles b WHERE b.user_id = u.id) AS has_bondsman_profile
       FROM users u WHERE u.id = ?`, [id]);
}

// ── Token issuing ─────────────────────────────────────────────────────────────
const tokenVersion = (user) => Number(user?.token_version || 0);

/**
 * Sign out every session of the account: a new session version (every access and
 * refresh token issued before is refused from now on) and no stored refresh tokens.
 * Run inside the caller's transaction; call invalidateUserCache(userId) after it commits.
 */
export async function bumpTokenVersion(tx, userId) {
  await tx.run('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [userId]);
  await tx.run('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

async function issueTokenPair(user, db) {
  const pub = publicUser(user);
  const tv = tokenVersion(user);
  const accessToken = jwt.sign(
    { id: user.id, role: pub.role, email: pub.email, phone: pub.phone, displayName: pub.displayName, premium: pub.premium, tv },
    JWT_SECRET(),
    { expiresIn: CONFIG.JWT_EXPIRES_IN, algorithm: 'HS256' }
  );
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh', jti: crypto.randomUUID(), tv },
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
// Two layers (sandbox review 2026-11-12, bug 3). A flat per-account lock after 10
// failures let anyone who knew a phone number lock that person out (say, the night
// before court). Now:
//   • per account + client IP: 10 failures → that source waits LOCKOUT_MINUTES
//     (in memory; the owner on another network can still sign in)
//   • per account, any source: ACCOUNT_LOCK_THRESHOLD failures → the account locks
//     (database), the backstop against guessing from many addresses
// A successful sign-in or a password reset clears both.
//
// Both counts are rolling 15-minute windows that start over after a lock (sandbox review
// 2026-11-17, finding 4): before, the account count never went down, so once it reached the
// threshold ONE wrong password after each lock locked the account again. Now a lock needs
// ACCOUNT_LOCK_THRESHOLD failures within FAILURE_WINDOW_MINUTES, counted from zero again
// after every lock. Someone locked out can always reset the password (e-mail or text).
const MAX_LOGIN_ATTEMPTS     = 10;   // per account + source
const ACCOUNT_LOCK_THRESHOLD = 50;   // per account, all sources
const LOCKOUT_MINUTES        = 15;
const FAILURE_WINDOW_MINUTES = 15;
export const LOCKOUT = Object.freeze({ MAX_LOGIN_ATTEMPTS, ACCOUNT_LOCK_THRESHOLD, LOCKOUT_MINUTES, FAILURE_WINDOW_MINUTES });
const sourceFailures = new Map();   // `${userId}|${ip}` → { n, until }
const SOURCE_MAP_MAX = 50_000;
const sourceKey = (userId, req) => `${userId}|${req.ip || req.socket?.remoteAddress || 'unknown'}`;
function sourceLocked(userId, req) {
  const e = sourceFailures.get(sourceKey(userId, req));
  if (!e || !e.until) return 0;
  if (e.until <= Date.now()) { sourceFailures.delete(sourceKey(userId, req)); return 0; }
  return Math.ceil((e.until - Date.now()) / 60_000);
}
function recordSourceFailure(userId, req) {
  const k = sourceKey(userId, req);
  if (!sourceFailures.has(k) && sourceFailures.size >= SOURCE_MAP_MAX) {
    const now = Date.now();
    for (const [key, v] of sourceFailures) if (!v.until || v.until <= now) sourceFailures.delete(key);
    if (sourceFailures.size >= SOURCE_MAP_MAX) sourceFailures.delete(sourceFailures.keys().next().value);
  }
  const now = Date.now();
  let e = sourceFailures.get(k);
  // a new window when there is none, the last one is older than FAILURE_WINDOW_MINUTES or a lock ran out
  if (!e || (e.until && e.until <= now) || (!e.until && now - e.since > FAILURE_WINDOW_MINUTES * 60_000)) e = { n: 0, until: 0, since: now };
  e.n += 1;
  if (e.n >= MAX_LOGIN_ATTEMPTS) { e.until = now + LOCKOUT_MINUTES * 60_000; e.n = 0; }
  sourceFailures.set(k, e);
}
const clearSourceFailures = (userId) => {
  for (const k of sourceFailures.keys()) if (k.startsWith(`${userId}|`)) sourceFailures.delete(k);
};
/** Tests only. */
export const _resetLoginSources = () => sourceFailures.clear();

/**
 * One more failure in the account's rolling window. The window starts at the first failure
 * and lasts FAILURE_WINDOW_MINUTES; reaching ACCOUNT_LOCK_THRESHOLD inside it locks the
 * account for LOCKOUT_MINUTES and empties the count, so after the lock the account starts
 * from zero. → true when this failure locked the account.
 */
async function recordFailedLogin(db, userId) {
  const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
  const row = await db.get(
    `WITH cur AS (
       SELECT id,
              (failed_login_window_start IS NULL
               OR failed_login_window_start <= NOW() - make_interval(mins => ?)) AS fresh,
              COALESCE(failed_login_attempts, 0) AS n
         FROM users WHERE id = ? FOR UPDATE
     ), nxt AS (
       SELECT id, fresh, CASE WHEN fresh THEN 1 ELSE n + 1 END AS n FROM cur
     )
     UPDATE users u
        SET failed_login_attempts     = CASE WHEN nxt.n >= ? THEN 0 ELSE nxt.n END,
            failed_login_window_start = CASE WHEN nxt.n >= ? THEN NULL WHEN nxt.fresh THEN NOW() ELSE u.failed_login_window_start END,
            lock_until                = CASE WHEN nxt.n >= ? THEN ? ELSE u.lock_until END
       FROM nxt
      WHERE u.id = nxt.id
  RETURNING (nxt.n >= ?) AS locked`,
    [FAILURE_WINDOW_MINUTES, userId, ACCOUNT_LOCK_THRESHOLD, ACCOUNT_LOCK_THRESHOLD, ACCOUNT_LOCK_THRESHOLD, lockUntil, ACCOUNT_LOCK_THRESHOLD]
  );
  return !!row?.locked;
}
async function clearFailedLogins(db, userId) {
  await db.run('UPDATE users SET failed_login_attempts = 0, failed_login_window_start = NULL, lock_until = NULL WHERE id = ?', [userId]);
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
  let idType = null;
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
    { const why = passwordProblem(password); if (why) return err400(res, m(passwordProblemKey(why))); }

    const { type, value } = normalizeIdentifier(identifier);
    if (type === 'unknown') return err400(res, m('auth.err.identifier_invalid'));
    idType = type;

    const exists = await findUserByIdentifier(db, type, value);
    // Every account, banned ones included: one account per e-mail, phone and sign-in identifier.
    const existsAny = exists || await db.get(
      type === 'email'
        ? 'SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(login_identifier) = ? LIMIT 1'
        : 'SELECT id FROM users WHERE phone = ? OR LOWER(login_identifier) = ? LIMIT 1', [value, value]);
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
    if (e.code === '23505') {
      // Two sign-ups with the same identifier at the same moment: the unique index decides.
      return res.status(409).json({ error: m(idType === 'phone' ? 'auth.err.phone_taken' : 'auth.err.email_taken'), code: 'already_registered' });
    }
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
    const srcMinutes = sourceLocked(found.id, req);
    if (srcMinutes) {
      return res.status(423).json({ error: m('auth.err.locked', { minutes: srcMinutes }), code: 'account_locked' });
    }

    const ok = await bcrypt.compare(password, found.password_hash);
    if (!ok) {
      recordSourceFailure(found.id, req);
      await recordFailedLogin(db, found.id).catch(e => logger.warn('[auth/login] lockout update:', e.message));
      return badCredentials();
    }
    clearSourceFailures(found.id);
    if (found.failed_login_attempts || found.lock_until) await clearFailedLogins(db, found.id).catch(logIgnored('routes/auth'));
    db.run('UPDATE users SET last_seen = ? WHERE id = ?', [new Date().toISOString(), found.id]).catch(logIgnored('routes/auth'));

    const pair = await issueTokenPair(await loadUser(db, found.id) || found, db);
    // Accounts made with the old Quick Sign Up have a doubled 4-digit PIN as password:
    // sign them in, and tell the app to ask for a new one (POST /auth/change-password).
    res.json(DOUBLED_PIN.test(String(password)) ? { ...pair, password_change_required: true } : pair);
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
// { displayName?, email?, currentPassword? } (sandbox review 2026-11-17, finding 2).
// Before, a signed-in session alone could replace the account's e-mail and phone: whoever held
// a stolen token could move the account to their own address and then reset the password.
//   • displayName  changes at once.
//   • email        needs the current password and is NOT used until the link sent to the new
//                  address is opened (POST /confirm-email). The current address is told.
//   • phone        is refused here: a number is added or changed only by proving it with a
//                  texted code (POST /api/me/phone/verify + /confirm).
const EMAIL_CHANGE_HOURS = 24;
const appBase = () => (process.env.APP_URL || process.env.FRONTEND_URL || 'https://justicegavel.app').split(',')[0].trim().replace(/\/+$/, '');
const maskEmail = (addr) => {
  const [local = '', domain = ''] = String(addr || '').split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
};

router.post('/update-profile', authRequired, authLimiter, async (req, res) => {
  const m = reqMsg(req);
  try {
    const db = await getDb();
    const { displayName: rawDN, phone, email, currentPassword } = req.body || {};
    const displayName = rawDN ? truncateStr(sanitizeStr(String(rawDN), 100), 100) : null;
    const user = await loadUser(db, req.user.id);
    if (!user) return res.status(404).json({ error: m('auth.err.account_not_found') });

    // Phone: only through the texted-code flow. The same number again is not a change.
    if (phone != null && String(phone).trim() !== '') {
      const { type, value } = normalizeIdentifier(phone);
      if (type !== 'phone') return err400(res, m('auth.err.phone_invalid'));
      if (value !== user.phone) {
        return res.status(400).json({ error: m('auth.err.phone_change_verify'), code: 'phone_needs_verification' });
      }
    }

    // E-mail: password first, then a confirmation link to the new address.
    let newEmail = null;
    if (email != null && String(email).trim() !== '') {
      const addr = String(email).trim().toLowerCase();
      if (!validateEmail(addr)) return err400(res, m('auth.err.email_invalid'));
      if (addr !== String(user.email || '').toLowerCase()) newEmail = addr;
    }
    if (newEmail) {
      if (!currentPassword) return res.status(400).json({ error: m('auth.err.email_change_password'), code: 'password_required' });
      // 403, not 401: the session is valid — a 401 would sign the person out of the app.
      if (!user.password_hash || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
        return res.status(403).json({ error: m('auth.err.wrong_password'), code: 'incorrect_password' });
      }
      const taken = await db.get(
        'SELECT id FROM users WHERE (LOWER(email) = ? OR LOWER(login_identifier) = ?) AND id <> ? LIMIT 1',
        [newEmail, newEmail, user.id]);
      if (taken) return res.status(409).json({ error: m('auth.err.in_use'), code: 'in_use' });
      const { emailLive } = await import('../services/email.js');
      if (!emailLive()) return res.status(503).json({ error: m('auth.err.email_change_unavailable'), code: 'email_unavailable' });
    }

    if (!displayName?.trim() && !newEmail) return err400(res, m('auth.err.nothing_to_update'));

    if (displayName?.trim()) {
      await db.run('UPDATE users SET display_name = ?, name = ? WHERE id = ?', [displayName.trim(), displayName.trim(), user.id]);
    }
    if (newEmail) {
      const token = crypto.randomBytes(32).toString('hex');
      const exp = new Date(Date.now() + EMAIL_CHANGE_HOURS * 3_600_000).toISOString();
      await db.run('UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_expires_at = ? WHERE id = ?',
        [newEmail, sha256(token), exp, user.id]);
      const lang = requestedLang(req) || normalizeLang(user.preferred_language) || 'en';
      const { sendEmailChangeConfirm, sendEmailChangeNotice } = await import('../services/email.js');
      try {
        await sendEmailChangeConfirm(newEmail, `${appBase()}/confirm-email?token=${token}`, lang, EMAIL_CHANGE_HOURS);
      } catch (e) {
        await db.run('UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_expires_at = NULL WHERE id = ?', [user.id]);
        logger.warn('[auth/update-profile/confirm-email]', e?.message);
        return res.status(502).json({ error: m('auth.err.email_change_send_failed'), code: 'email_send_failed' });
      }
      if (user.email) {
        sendEmailChangeNotice(user.email, maskEmail(newEmail), lang)
          .catch(e => logger.warn('[auth/update-profile/notice]', e?.message));
      }
      audit?.('auth.email_change_requested', { userId: user.id, req })?.catch?.(() => {});
    }
    invalidateUserCache(user.id);
    const fresh = await loadUser(db, user.id);
    res.json({
      ...publicUser(fresh),
      ...(newEmail ? { email_pending: newEmail, message: m('auth.email_change_sent', { email: newEmail }) } : {}),
    });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: m('auth.err.in_use'), code: 'in_use' });
    logger.error('[auth/update-profile]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ── POST /confirm-email ───────────────────────────────────────────────────────
// { token } — opened from the link sent to the new address. The new address becomes the
// account's e-mail (and its sign-in identifier when it signed in with the old one), every
// session is signed out, and outstanding password-reset links stop working.
router.post('/confirm-email', resetLimiter, async (req, res) => {
  const m = reqMsg(req);
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!/^[0-9a-f]{64}$/.test(token)) return res.status(400).json({ error: m('auth.err.email_confirm_invalid'), code: 'invalid_email_token' });
    const db = await getDb();
    const result = await db.transaction(async (tx) => {
      const u = await tx.get(
        `SELECT id, email, login_identifier, pending_email FROM users
          WHERE pending_email_token = ? AND pending_email_expires_at > NOW() FOR UPDATE`, [sha256(token)]);
      if (!u || !u.pending_email) return { status: 400, code: 'invalid_email_token', key: 'auth.err.email_confirm_invalid' };
      const addr = String(u.pending_email).toLowerCase();
      const taken = await tx.get('SELECT id FROM users WHERE (LOWER(email) = ? OR LOWER(login_identifier) = ?) AND id <> ? LIMIT 1', [addr, addr, u.id]);
      if (taken) {
        await tx.run('UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_expires_at = NULL WHERE id = ?', [u.id]);
        return { status: 409, code: 'in_use', key: 'auth.err.in_use' };
      }
      const signsInWithOld = !u.login_identifier || String(u.login_identifier).toLowerCase() === String(u.email || '').toLowerCase();
      await tx.run(
        `UPDATE users SET email = ?, login_identifier = CASE WHEN ? THEN ? ELSE login_identifier END,
                pending_email = NULL, pending_email_token = NULL, pending_email_expires_at = NULL
          WHERE id = ?`, [addr, signsInWithOld, addr, u.id]);
      await tx.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [u.id]);
      await bumpTokenVersion(tx, u.id);
      return { status: 200, userId: u.id };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: m(result.key), code: result.code });
    invalidateUserCache(result.userId);
    audit?.('auth.email_changed', { userId: result.userId, req })?.catch?.(() => {});
    res.json({ ok: true, message: m('auth.email_changed') });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: m('auth.err.in_use'), code: 'in_use' });
    logger.error('[auth/confirm-email]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ── POST /forgot-password ─────────────────────────────────────────────────────
// { identifier } — the e-mail address or phone number the person signs in with (legacy
// { email }). Always 200 { sent: true } once a provider is configured (no account
// enumeration); stores only a SHA-256 of the token.
//   e-mail → the link by e-mail (503 email_unavailable without an e-mail provider)
//   phone  → the link by text message (503 sms_unavailable without Telnyx). Before
//            (finding 4) accounts made with a phone number had no way to reset at all.
// At most RESET_PER_HOUR links an hour and one a minute per account; more requests answer
// the same but send nothing.
const RESET_PER_HOUR = 3;
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const m = reqMsg(req);
  try {
    const raw = String(req.body?.identifier || req.body?.email || req.body?.phone || '').trim();
    if (!raw) return res.status(400).json({ error: m('auth.err.reset_identifier_required'), code: 'identifier_required' });
    const { type, value } = normalizeIdentifier(raw);
    if (type === 'unknown') {
      return res.status(400).json({ error: m(raw.includes('@') ? 'auth.err.email_invalid' : 'auth.err.identifier_invalid'), code: raw.includes('@') ? 'email_invalid' : 'identifier_invalid' });
    }
    // No provider configured: say so (the same for every address/number, so it reveals
    // nothing about which accounts exist) instead of "sent".
    const { emailLive } = await import('../services/email.js');
    if (type === 'email' && !emailLive()) return res.status(503).json({ error: m('auth.err.reset_email_unavailable'), code: 'email_unavailable' });
    if (type === 'phone' && !smsLive()) return res.status(503).json({ error: m('auth.err.reset_sms_unavailable'), code: 'sms_unavailable' });

    const db   = await getDb();
    const user = type === 'email'
      ? await db.get('SELECT id, email, phone, preferred_language FROM users WHERE LOWER(email) = ?', [value])
      : await db.get('SELECT id, email, phone, preferred_language FROM users WHERE phone = ? OR LOWER(login_identifier) = ? ORDER BY (phone = ?) DESC LIMIT 1', [value, value, value]);
    if (!user) return res.json({ sent: true });

    const recent = await db.get(
      `SELECT COUNT(*)::int AS n, MAX(created_at) AS last FROM password_resets
        WHERE user_id = ? AND created_at > NOW() - INTERVAL '1 hour'`, [user.id]);
    if (Number(recent?.n || 0) >= RESET_PER_HOUR || (recent?.last && Date.now() - new Date(recent.last).getTime() < 60_000)) {
      logger.info({ userId: user.id }, '[auth/forgot-password] throttled — nothing sent');
      return res.json({ sent: true });
    }
    if (type === 'phone' && await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [value]).catch(() => null)) {
      logger.info({ userId: user.id }, '[auth/forgot-password] number opted out of texts — nothing sent');
      return res.json({ sent: true });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const exp   = new Date(Date.now() + 3_600_000).toISOString();
    // Invalidate older outstanding tokens for this user, then store the new one
    await db.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await db.run('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, sha256(token), exp]);

    const url  = `${appBase()}/reset-password?token=${token}`;
    // In the language the person asked in, else the one saved on the account.
    const lang = requestedLang(req) || normalizeLang(user.preferred_language) || 'en';
    if (type === 'email') {
      try {
        const { sendPasswordReset } = await import('../services/email.js');
        await sendPasswordReset(user.email, url, lang);
      } catch (e) { logger.warn('[auth/forgot-password/email]', e?.message); }
    } else {
      const r = await sendSms({ to: value, body: msg(lang, 'auth.reset.sms', { link: url }) });
      if (!r?.ok) logger.warn({ reason: r?.error || r?.reason }, '[auth/forgot-password/sms] not sent');
    }
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
    { const why = passwordProblem(password); if (why) return err400(res, m(passwordProblemKey(why))); }
    const db  = await getDb();
    const row = await db.get(
      'SELECT id, user_id FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > NOW()',
      [sha256(token)]
    );
    if (!row) return res.status(400).json({ error: m('auth.err.reset_invalid'), code: 'invalid_reset_token' });
    const hash = await bcrypt.hash(password, 12);
    await db.transaction(async (tx) => {
      // A pending e-mail change is cancelled too: whoever asked for it knew the old password.
      await tx.run(`UPDATE users SET password_hash = ?, failed_login_attempts = 0, failed_login_window_start = NULL, lock_until = NULL,
                           pending_email = NULL, pending_email_token = NULL, pending_email_expires_at = NULL WHERE id = ?`, [hash, row.user_id]);
      await tx.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [row.user_id]);
      await bumpTokenVersion(tx, row.user_id);   // sign out every session, access tokens included
    });
    invalidateUserCache(row.user_id);
    clearSourceFailures(row.user_id);
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
      const user = await loadUser(db, decoded.id);
      if (!user || ['banned', 'suspended', 'deleted', 'disabled', 'locked_out'].includes(String(user.account_status || '').toLowerCase())) {
        return res.status(401).json({ error: 'Account not found', code: 'user_not_found' });
      }
      // 2. Issued before a password change / reset / sign-out-everywhere: refused, and nothing
      //    else happens — an old device refreshing must not sign out the session that made the
      //    change (its refresh row was deleted by bumpTokenVersion, not "used").
      if (tokenVersionOf(decoded) !== tokenVersion(user)) {
        return res.status(401).json({ error: msg(resolveLang(req), 'auth.err.session_expired'), code: 'session_revoked' });
      }
      // 3. Single-use rotation: atomically mark this token used
      const marked = await db.run(
        `UPDATE refresh_tokens SET used = 1
          WHERE user_id = ? AND token_hash = ? AND used = 0 AND expires_at > NOW()`,
        [decoded.id, sha256(refreshToken)]
      );
      if (!marked.changes) {
        // A token that was already rotated (its row is there, used) → possible theft: revoke
        // every session. A token whose row is gone (signed out) or expired is simply refused.
        const rotated = await db.get('SELECT 1 AS x FROM refresh_tokens WHERE user_id = ? AND token_hash = ? AND used = 1', [decoded.id, sha256(refreshToken)]);
        if (rotated) {
          // every session ends, access tokens included (a thief may hold one)
          await db.transaction((tx) => bumpTokenVersion(tx, decoded.id)).catch(logIgnored('routes/auth'));
          invalidateUserCache(decoded.id);
          return res.status(401).json({ error: 'Refresh token already used', code: 'token_reuse' });
        }
        return res.status(401).json({ error: 'Refresh token expired or signed out', code: 'invalid_refresh' });
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
    if (claims.type === 'refresh' || tokenVersionOf(claims) !== tokenVersion(user)) {
      return res.status(401).json({ error: msg(resolveLang(req), 'auth.err.session_expired'), code: 'session_revoked' });
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
    let aiFiles = [];
    await db.transaction(async (tx) => {
      ({ attachmentKeys, aiFiles = [] } = await purgeAccountData(tx, uid, { email: user.email }));
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
    // Files API copies of the user's documents (AI step 4): best effort now, the daily
    // ai-files-cleanup job retries any that fail.
    if (aiFiles.length) {
      import('../services/aiFiles.js').then(({ deleteRemoteFiles }) => deleteRemoteFiles(db, aiFiles)).catch(logIgnored('routes/auth'));
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

// ── POST /change-password ─────────────────────────────────────────────────────
// { currentPassword, newPassword } — signed-in users change their password. Used by
// accounts the old Quick Sign Up made with a doubled PIN (login answers
// password_change_required: true). Other sessions are signed out.
router.post('/change-password', authRequired, authLimiter, async (req, res) => {
  const m = reqMsg(req);
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return err400(res, m('auth.err.change_fields_required'));
    const why = passwordProblem(newPassword);
    if (why) return err400(res, m(passwordProblemKey(why)));
    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({ error: m('auth.err.password_same'), code: 'password_same' });
    }
    const db = await getDb();
    const row = await db.get('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    // 403, not 401: the session is valid — a 401 would sign the person out of the app.
    if (!row || !row.password_hash || !(await bcrypt.compare(String(currentPassword), row.password_hash))) {
      return res.status(403).json({ error: m('auth.err.wrong_password'), code: 'incorrect_password' });
    }
    const hash = await bcrypt.hash(String(newPassword), 12);
    await db.transaction(async (tx) => {
      await tx.run(`UPDATE users SET password_hash = ?, failed_login_attempts = 0, failed_login_window_start = NULL, lock_until = NULL,
                           pending_email = NULL, pending_email_token = NULL, pending_email_expires_at = NULL WHERE id = ?`, [hash, row.id]);
      // Reset links sent before the change stop working, and every other session ends
      // (the access tokens too — this request gets a new pair below).
      await tx.run('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [row.id]);
      await bumpTokenVersion(tx, row.id);
    });
    invalidateUserCache(row.id);
    clearSourceFailures(row.id);
    res.json({ ok: true, ...(await issueTokenPair(await loadUser(db, row.id), db)) });
  } catch (e) {
    logger.error('[auth/change-password]', e.message);
    res.status(500).json({ error: m('auth.err.server') });
  }
});

// ── POST /logout ──────────────────────────────────────────────────────────────
// { refreshToken?, pushToken?, allDevices? } — this device's push token stops
// receiving the account's notifications (the next person on the phone must not
// see them); with allDevices every session (access tokens included) and device token is removed.
router.post('/logout', authRequired, async (req, res) => {
  const m = reqMsg(req);
  try {
    const db = await getDb();
    const { refreshToken, allDevices, pushToken } = req.body || {};
    if (allDevices === true) {   // only a real yes ends every session (not "abc" or 1)
      // Every session on every device ends now, access tokens included (session version).
      await db.transaction(async (tx) => {
        await bumpTokenVersion(tx, req.user.id);
        await tx.run('DELETE FROM push_tokens WHERE user_id = ?', [req.user.id]);
      });
      invalidateUserCache(req.user.id);
    } else {
      if (refreshToken) {
        // Removed, not marked used: a used row means "rotated", and presenting a rotated token
        // again is treated as theft (every session ends) — a signed-out device must not do that.
        await db.run('DELETE FROM refresh_tokens WHERE user_id = ? AND token_hash = ?', [req.user.id, sha256(refreshToken)]);
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