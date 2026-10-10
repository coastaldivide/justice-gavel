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
  // Sentry is initialised exactly once in src/instrument.js (loaded first by
  // server.js). Kept as a no-op for backwards compatibility.
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
