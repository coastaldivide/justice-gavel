/**
 * logger.js — Lightweight structured logger
 *
 * Wraps console.* to:
 *   - Add ISO timestamp prefix
 *   - Silence debug/info logs when LOG_LEVEL=error (e.g. in test runners)
 *   - Structured JSON output when LOG_FORMAT=json (e.g. Railway, Datadog)
 *
 * Usage: import { logger } from '../utils/logger.js';
 *        logger.info('[server] Started');
 *        logger.error('[db] Connection failed', err);
 */

import { APP_VERSION } from './version.js';

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL   = LEVEL_ORDER[process.env.LOG_LEVEL?.toLowerCase()] ?? 1; // default: info
// One-line JSON when LOG_FORMAT=json. Production defaults to JSON (Railway /
// Datadog ingest one JSON object per line); set LOG_FORMAT=text to opt out.
const JSON_FORMAT = process.env.LOG_FORMAT === 'json'
  || (process.env.NODE_ENV === 'production' && !process.env.LOG_FORMAT);

const SERVICE_META = {
  service: 'justice-gavel-api',
  version: APP_VERSION,   // real version from package.json — see utils/version.js
  env:     process.env.NODE_ENV || 'development',
};

function fmt(level, args) {
  const ts = new Date().toISOString();
  if (JSON_FORMAT) {
    const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
    return [JSON.stringify({ ts, level, msg, ...SERVICE_META })];
  }
  return [ts, `[${level.toUpperCase()}]`, ...args];
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

// ── Request ID context ────────────────────────────────────────────────────────
// Usage: logger.info('[route] msg', { requestId: req.id })
// The request ID is set in app.js via crypto.randomUUID()
