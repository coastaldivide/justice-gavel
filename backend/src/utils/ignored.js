/**
 * ignored.js — for best-effort steps whose failure must not fail the request
 * (a push after a message was saved, an audit row, a cache refresh). The error
 * is still never silent: it is logged (scrubbed by the logger) with where it
 * happened, so a broken side-effect shows up in the logs and Sentry breadcrumbs.
 *
 *   sendPush(...).catch(logIgnored('messages/notify'));
 */
import logger from './logger.js';

export function logIgnored(where) {
  return (e) => {
    logger.warn({ where, err: e?.message ?? String(e) }, '[best-effort] step failed (request continued)');
  };
}
