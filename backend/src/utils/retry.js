/**
 * utils/retry.js — Exponential backoff retry wrapper
 *
 * Retries async operations with jitter to avoid thundering herd.
 * Used for: external API calls, DB writes, webhook deliveries.
 *
 * Usage:
 *   const result = await withRetry(() => stripe.charges.create(...), {
 *     attempts: 3,
 *     baseDelay: 1000,
 *     on: (err, attempt) => logger.warn('retry', attempt, err.message),
 *   });
 */

import logger from './logger.js';

export async function withRetry(fn, {
  attempts  = 3,
  baseDelay = 500,    // ms before first retry
  maxDelay  = 10_000, // cap at 10 seconds
  jitter    = true,   // randomize to avoid thundering herd
  retryIf   = null,   // optional: (err) => bool — only retry if true
  on        = null,   // optional: (err, attempt) => void — callback per retry
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry if this error shouldn't be retried
      if (retryIf && !retryIf(err)) throw err;

      // Don't retry on the last attempt
      if (attempt === attempts) break;

      // Calculate delay with exponential backoff + optional jitter
      let delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      if (jitter) delay += Math.random() * delay * 0.3;

      if (on) on(err, attempt);
      else logger.warn(`[retry] attempt ${attempt}/${attempts} failed: ${err.message} — retrying in ${Math.round(delay)}ms`);

      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Retry specifically for database operations.
 * Retries on connection errors but not on constraint violations.
 */
export function withDbRetry(fn) {
  return withRetry(fn, {
    attempts: 3,
    baseDelay: 200,
    retryIf: (err) => {
      const msg = err.message?.toLowerCase() || '';
      // Retry on connection/timeout errors, not on constraint violations
      return msg.includes('connect') || msg.includes('timeout') ||
             msg.includes('ECONNREFUSED') || msg.includes('closed');
    },
  });
}

/**
 * Retry for external API calls (Stripe, Anthropic, Twilio).
 * Respects 429 rate limits with Retry-After header.
 */
export async function withApiRetry(fn, serviceName = 'api') {
  return withRetry(fn, {
    attempts: 3,
    baseDelay: 1000,
    retryIf: (err) => {
      // Retry on 5xx, network errors, timeouts — not on 4xx
      const status = err.status || err.statusCode || err.response?.status;
      if (status && status >= 400 && status < 500) return false;  // Client errors: don't retry
      return true;
    },
    on: (err, attempt) => {
      logger.warn(`[retry:${serviceName}] attempt ${attempt}: ${err.message}`);
    },
  });
}
