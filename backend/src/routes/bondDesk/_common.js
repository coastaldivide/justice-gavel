/**
 * routes/bondDesk/_common.js — request helpers shared by the Bond Desk routers.
 */
import { resolveLang, msg } from '../../i18n/index.js';
import { getDb } from '../../db/index.js';
import logger from '../../utils/logger.js';
import { agentAccess } from '../../services/bondDesk/core.js';
import { isDate } from '../../services/bondDesk/money.js';
import { toE164 } from '../../services/sms.js';
import { getAttachmentStorage } from '../../services/attachmentStorage.js';

export class BdError extends Error {
  constructor(status, code, params) { super(code); this.status = status; this.code = code; this.params = params || {}; }
}

/** Send an error in the request's language: { error, code, ...params }. */
export function fail(req, res, e) {
  if (e instanceof BdError) {
    return res.status(e.status).json({ error: msg(resolveLang(req), `bd.err.${e.code}`, e.params), code: e.code, ...e.params });
  }
  logger.error({ err: e?.message, stack: e?.stack?.split('\n').slice(0, 3).join(' | ') }, '[bond-desk]');
  return res.status(500).json({ error: msg(resolveLang(req), 'bd.err.server'), code: 'server_error' });
}

/** Wrap an async handler: (req, res, db) → result; errors → fail(). */
export const handle = (fn) => async (req, res) => {
  try {
    const db = await getDb();
    await fn(req, res, db);
  } catch (e) { fail(req, res, e); }
};

/** Bail agent with a plan (or admin). Sets req.agentId. */
export async function requireBondDesk(req, res, next) {
  try {
    const db = await getDb();
    const a = await agentAccess(db, req.user);
    if (!a.allowed) return fail(req, res, new BdError(403, a.reason));
    req.agentId = Number(req.user.id);
    next();
  } catch (e) { fail(req, res, e); }
}

export async function requireStorage(req, res, next) {
  try {
    const s = await getAttachmentStorage();
    if (!s) return fail(req, res, new BdError(503, 'storage_unavailable'));
    req.storage = s;
    next();
  } catch (e) { fail(req, res, e); }
}

// ── Input ─────────────────────────────────────────────────────────────────────

export const id = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isSafeInteger(n) || n <= 0 || String(n) !== String(v).trim()) throw new BdError(404, 'not_found');
  return n;
};

/** Trimmed text (null when empty); 400 when longer than max. */
export function text(v, max, field, { required = false } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw new BdError(400, 'required', { field });
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new BdError(400, 'invalid', { field });
  const s = String(v).normalize('NFC').replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : '')).trim();
  if (s.length > max) throw new BdError(400, 'too_long', { field, max });
  if (required && !s) throw new BdError(400, 'required', { field });
  return s || null;
}

export function date(v, field, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BdError(400, 'required', { field });
    return null;
  }
  if (!isDate(v)) throw new BdError(400, 'bad_date', { field });
  return v;
}

export function cents(v, field, { min = 1, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BdError(400, 'required', { field });
    return null;
  }
  const n = typeof v === 'number' ? v : (/^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN);
  if (!Number.isSafeInteger(n) || n < min || n > 100_000_000_00) throw new BdError(400, 'bad_amount', { field });
  return n;
}

export function phone(v, field) {
  const s = text(v, 40, field);
  if (!s) return null;
  const e = toE164(s);
  if (!e) throw new BdError(400, 'bad_phone', { field });
  return e;
}

export function email(v, field) {
  const s = text(v, 254, field);
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new BdError(400, 'bad_email', { field });
  return s.toLowerCase();
}

export function oneOf(v, list, field, { required = true, fallback = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required && fallback === null) throw new BdError(400, 'required', { field });
    return fallback;
  }
  if (!list.includes(v)) throw new BdError(400, 'invalid', { field });
  return v;
}

/** A file download with safe headers. */
export function sendFile(res, bytes, { type, name, inline = false }) {
  res.set({
    'Content-Type': type,
    'Content-Length': String(bytes.length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${String(name).replace(/[^A-Za-z0-9 ._()-]/g, '_').slice(0, 120)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
  res.end(bytes);
}

export const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
