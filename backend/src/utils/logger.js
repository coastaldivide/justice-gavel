/**
 * logger.js — Lightweight structured logger
 *
 * Wraps console.* to:
 *   - Add ISO timestamp prefix
 *   - Silence debug/info logs when LOG_LEVEL=error (e.g. in test runners)
 *   - Structured JSON output when LOG_FORMAT=json (e.g. Render log streams, Datadog);
 *     production defaults to JSON
 *   - Stamp every line logged while handling a request with that request's
 *     id (request_id), via AsyncLocalStorage — see runWithRequestContext()
 *   - Redact secrets and personal data from EVERY line (utils/redact.js):
 *     passwords, tokens, API keys, Authorization headers, e-mail addresses,
 *     phone numbers. Nothing a caller passes reaches stdout unscrubbed.
 *
 * Usage: import { logger } from '../utils/logger.js';
 *        logger.info('[server] Started');
 *        logger.error('[db] Connection failed', err);
 *        logger.warn({ userId, err: e.message }, '[route] could not save');
 *          → JSON: {"ts":…,"level":"warn","msg":"[route] could not save",
 *                   "request_id":"…","userId":7,"err":"…",…}
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { APP_VERSION } from './version.js';
import { redact, redactString } from './redact.js';

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL   = LEVEL_ORDER[process.env.LOG_LEVEL?.toLowerCase()] ?? 1; // default: info
// One-line JSON when LOG_FORMAT=json. Production defaults to JSON (Render log
// streams / Datadog ingest one JSON object per line); set LOG_FORMAT=text to opt out.
const JSON_FORMAT = process.env.LOG_FORMAT === 'json'
  || (process.env.NODE_ENV === 'production' && !process.env.LOG_FORMAT);

const SERVICE_META = {
  service: 'justice-gavel-api',
  version: APP_VERSION,   // real version from package.json — see utils/version.js
  env:     process.env.APP_ENV || process.env.NODE_ENV || 'development',
};

// ── Request context ──────────────────────────────────────────────────────────
// app.js runs every request inside runWithRequestContext({ requestId }), so any
// log line written while that request is being handled — in a route, a
// service, the DB layer, the global error handler — carries its request_id.
const requestContext = new AsyncLocalStorage();

export function runWithRequestContext(ctx, fn) {
  return requestContext.run({ ...ctx }, fn);
}

/** The current request's id, or null outside a request. */
export function currentRequestId() {
  return requestContext.getStore()?.requestId ?? null;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Error);

function errorFields(e) {
  return { err: redactString(e.message), ...(e.code ? { code: e.code } : {}) };
}

function fmt(level, args) {
  const ts = new Date().toISOString();
  const requestId = currentRequestId();
  if (JSON_FORMAT) {
    // Structured fields: plain objects are merged into the line (redacted);
    // strings, errors and other values form the message.
    const fields = {};
    const parts = [];
    for (const a of args) {
      if (isPlainObject(a)) Object.assign(fields, redact(a));
      else if (a instanceof Error) { Object.assign(fields, errorFields(a)); parts.push(redactString(a.message)); }
      else if (typeof a === 'string') parts.push(redactString(a));
      else parts.push(redactString(JSON.stringify(redact(a)) ?? String(a)));
    }
    if (typeof fields.msg === 'string' && !parts.length) parts.push(fields.msg);
    delete fields.msg;
    const line = { ts, level, msg: parts.join(' '), ...(requestId ? { request_id: requestId } : {}), ...fields, ...SERVICE_META };
    return [JSON.stringify(line)];
  }
  const out = [ts, `[${level.toUpperCase()}]`];
  if (requestId) out.push(`[req ${requestId}]`);
  for (const a of args) {
    if (typeof a === 'string') out.push(redactString(a));
    else if (a instanceof Error) out.push(redactString(a.message));
    else out.push(redact(a));
  }
  return out;
}

export const logger = {
  debug: (...args) => {
    if (LEVEL_ORDER.debug >= MIN_LEVEL) console.debug(...fmt('debug', args));
  },
  info: (...args) => {
    if (LEVEL_ORDER.info >= MIN_LEVEL) console.log(...fmt('info', args));
  },
  warn: (...args) => {
    if (LEVEL_ORDER.warn >= MIN_LEVEL) console.warn(...fmt('warn', args));
  },
  error: (...args) => {
    if (LEVEL_ORDER.error >= MIN_LEVEL) console.error(...fmt('error', args));
  },
  fatal: (...args) => {
    console.error(...fmt('fatal', args));
  },
};

// Default export for convenience
export default logger;
