// Sentry is initialised once in src/instrument.js. These helpers are kept for
// backwards compatibility with older imports.
import * as Sentry from '@sentry/node';

export function initSentry() { /* no-op — see src/instrument.js */ }

// Without SENTRY_DSN: a pass-through (req, res, next) middleware.
// With SENTRY_DSN: an Express error middleware that reports, then forwards the error.
export function sentryErrorHandler() {
  if (!process.env.SENTRY_DSN) return (req, res, next) => { if (typeof next === 'function') next(); };
  return (err, req, res, next) => {
    try { Sentry.captureException(err); } catch { /* ignore */ }
    if (typeof next === 'function') next(err);
  };
}
