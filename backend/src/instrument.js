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
import { APP_VERSION } from './utils/version.js';

const FLAG = Symbol.for('justicegavel.sentry.initialised');

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
      environment:      process.env.SENTRY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release:          process.env.SENTRY_RELEASE || `justice-gavel@${APP_VERSION}`,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.NODE_ENV === 'production' ? 0.1 : 1.0)),
      profileSessionSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1),
      profileLifecycle: 'trace',
      sendDefaultPii:   false,
      integrations,
      ignoreErrors: ['rate_limited', 'not_found', 'validation_error', 'unauthorized', 'token_expired'],
      beforeSend(event) {
        const data = event.request?.data;
        if (data && typeof data === 'object') {
          for (const k of ['password', 'token', 'refreshToken', 'ssn', 'newPassword', 'currentPassword']) {
            if (k in data) data[k] = '[REDACTED]';
          }
        }
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        return event;
      },
    });
    logger.info('[sentry] initialised');
  } catch (e) {
    logger.error('[sentry] init failed — continuing without error tracking:', e.message);
  }
}

export { Sentry };
