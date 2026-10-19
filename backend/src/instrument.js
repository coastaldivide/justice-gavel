/**
 * instrument.js — the ONE place Sentry is initialised.
 *
 * Loaded first by server.js (and via `node --import ./src/instrument.js` in the
 * start scripts so Sentry's ESM auto-instrumentation can hook express/http/pg).
 * No-op unless SENTRY_DSN is set. Idempotent.
 */
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import logger from './utils/logger.js';
import { defaultRelease } from './utils/version.js';
import { redact, redactString, stripQuery } from './utils/redact.js';

const FLAG = Symbol.for('justicegavel.sentry.initialised');

/**
 * Sentry beforeSend: nothing secret or personal leaves in an error report.
 * Request bodies, query strings, cookies and auth headers are dropped; the
 * message, exception values, extras, tags and breadcrumbs are scrubbed with
 * the same rules as the logger (utils/redact.js). Exported for tests.
 */
export function scrubSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.request) {
    const r = event.request;
    if (r.data !== undefined) r.data = '[Filtered]';
    delete r.cookies;
    delete r.query_string;
    if (r.url) r.url = stripQuery(r.url);
    if (r.headers) {
      const h = {};
      for (const [k, v] of Object.entries(r.headers)) {
        if (/^(authorization|cookie|set-cookie|x-admin-key|x-api-key|proxy-authorization)$/i.test(k)) continue;
        h[k] = redactString(String(v));
      }
      r.headers = h;
    }
  }
  if (event.user) event.user = event.user.id != null ? { id: event.user.id } : undefined;
  if (typeof event.message === 'string') event.message = redactString(event.message);
  if (event.logentry?.message) event.logentry.message = redactString(event.logentry.message);
  for (const ex of event.exception?.values || []) {
    if (typeof ex.value === 'string') ex.value = redactString(ex.value);
  }
  if (event.extra) event.extra = redact(event.extra);
  if (event.contexts) event.contexts = redact(event.contexts);
  if (event.tags) event.tags = redact(event.tags);
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb).filter(Boolean);
  return event;
}

export function scrubSentryBreadcrumb(crumb) {
  if (!crumb || typeof crumb !== 'object') return crumb;
  const out = { ...crumb };
  if (typeof out.message === 'string') out.message = redactString(out.message);
  if (out.data) {
    out.data = redact(out.data);
    if (typeof out.data.url === 'string') out.data.url = stripQuery(out.data.url);
  }
  return out;
}

if (process.env.SENTRY_DSN && !globalThis[FLAG]) {
  globalThis[FLAG] = true;
  const integrations = [];
  if (process.env.SENTRY_PROFILING !== 'false') {
    try {
      const { nodeProfilingIntegration } = await import('@sentry/profiling-node');
      integrations.push(nodeProfilingIntegration());
    } catch (e) {
      logger.warn('[sentry] profiling unavailable:', e.message);
    }
  }
  try {
    Sentry.init({
      dsn:              process.env.SENTRY_DSN,
      environment:      process.env.SENTRY_ENVIRONMENT || process.env.APP_ENV || process.env.NODE_ENV || 'development',
      // e.g. justice-gavel@8.7.60+<commit> on Render (RENDER_GIT_COMMIT)
      release:          process.env.SENTRY_RELEASE || defaultRelease(),
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === 'production' ? 0.1 : 1.0)),
      profileSessionSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1),
      profileLifecycle: 'trace',
      sendDefaultPii:   false,
      integrations,
      ignoreErrors: ['rate_limited', 'not_found', 'validation_error', 'unauthorized', 'token_expired'],
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    });
    logger.info('[sentry] initialised');
  } catch (e) {
    logger.error('[sentry] init failed — continuing without error tracking:', e.message);
  }
}

export { Sentry };
