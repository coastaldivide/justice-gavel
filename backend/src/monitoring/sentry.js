/**
 * monitoring/sentry.js — Sentry error tracking initialization
 *
 * Captures ALL unhandled errors, rejected promises, and explicit
 * Sentry.captureException() calls. Attaches user context, request
 * details, and breadcrumbs to every error report.
 *
 * Severity levels we alert on:
 *   fatal   → SEV-1: page on-call immediately
 *   error   → SEV-2: email + Slack within 5 minutes
 *   warning → SEV-3: daily digest
 *   info    → logged only
 */

import * as Sentry from '@sentry/node';

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn:         process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release:     `justice-gavel@${process.env.npm_package_version || '6.6.0'}`,

    // Capture 100% of errors in production (performance traces at 10%)
    tracesSampleRate:    process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sampleRate:          1.0,

    // Attach request data to all events
    integrations: [
      Sentry.httpIntegration({ breadcrumbs: true }),
    ],

    // Scrub sensitive fields before sending to Sentry
    beforeSend(event) {
      // Never send passwords, tokens, or SSNs to Sentry
      if (event.request?.data) {
        const data = event.request.data;
        if (data.password)     data.password     = '[REDACTED]';
        if (data.token)        data.token        = '[REDACTED]';
        if (data.refreshToken) data.refreshToken = '[REDACTED]';
        if (data.ssn)          data.ssn          = '[REDACTED]';
      }
      return event;
    },

    // Ignore intentional errors (rate limits, not found, validation)
    ignoreErrors: [
      'rate_limited',
      'not_found',
      'validation_error',
      'unauthorized',
      'token_expired',
    ],
  });

  console.info('[sentry] initialized — DSN set, environment:', process.env.NODE_ENV);
}

/**
 * Attach user context to all subsequent Sentry events in this request.
 * Call after authRequired middleware resolves.
 */
export function setSentryUser(req) {
  if (req?.user?.id) {
    Sentry.setUser({
      id:    String(req.user.id),
      role:  req.user.role,
      // Never set email or name — privacy
    });
  }
}

/**
 * Capture a critical error and escalate immediately.
 * Use for SEV-1 conditions: DB down, auth broken, payment system failure.
 */
export function captureCritical(message, extras = {}) {
  Sentry.withScope(scope => {
    scope.setLevel('fatal');
    scope.setExtras(extras);
    scope.setTag('severity', 'SEV-1');
    Sentry.captureMessage(message);
  });
}

export { Sentry };
