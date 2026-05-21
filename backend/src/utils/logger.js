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

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL   = LEVEL_ORDER[process.env.LOG_LEVEL?.toLowerCase()] ?? 1; // default: info
const JSON_FORMAT = process.env.LOG_FORMAT === 'json';

const SERVICE_META = {
  service: 'justice-gavel-api',
  version: process.env.npm_package_version || '2.8.0',
  env:     process.env.NODE_ENV || 'development',
};

function fmt(level, args) {
  const ts = new Date().toISOString();
  if (JSON_FORMAT) {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    return JSON.stringify({ ts, level, msg, ...SERVICE_META });
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
};

// Default export for convenience
export default logger;
