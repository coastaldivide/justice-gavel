/**
 * middleware/circuitBreaker.js — Circuit breaker for external services
 *
 * Prevents cascading failures when Anthropic / Stripe / Twilio are down.
 * States: CLOSED (normal) → OPEN (tripped) → HALF_OPEN (testing recovery)
 *
 * Thresholds:
 *   - Opens after 5 consecutive failures within 60s
 *   - Stays open for 30s before testing recovery
 *   - Returns fast 503 while open (no waiting for timeout)
 */

import logger from '../utils/logger.js';

const FAILURE_THRESHOLD  = 5;
const SUCCESS_THRESHOLD  = 2;
const TIMEOUT_MS         = 30_000;  // 30s open before retry
const WINDOW_MS          = 60_000;  // count failures within 60s window

const breakers = new Map();

function getBreaker(name) {
  if (!breakers.has(name)) {
    breakers.set(name, {
      state:        'CLOSED',
      failures:     0,
      successes:    0,
      lastFailTime: 0,
      openedAt:     0,
    });
  }
  return breakers.get(name);
}

export async function withBreaker(name, fn) {
  const b = getBreaker(name);
  const now = Date.now();

  if (b.state === 'OPEN') {
    if (now - b.openedAt < TIMEOUT_MS) {
      logger.warn(`[circuit:${name}] OPEN — fast fail`);
      const err = new Error(`${name} temporarily unavailable. Please try again shortly.`);
      err.code = 'CIRCUIT_OPEN';
      err.statusCode = 503;
      throw err;
    }
    // Transition to HALF_OPEN — let one request through
    b.state    = 'HALF_OPEN';
    b.successes = 0;
    logger.info(`[circuit:${name}] HALF_OPEN — testing recovery`);
  }

  try {
    const result = await fn();

    // Success path
    if (b.state === 'HALF_OPEN') {
      b.successes++;
      if (b.successes >= SUCCESS_THRESHOLD) {
        b.state    = 'CLOSED';
        b.failures = 0;
        logger.info(`[circuit:${name}] CLOSED — recovered`);
      }
    } else {
      b.failures = 0; // reset on success in CLOSED state
    }

    return result;
  } catch (e) {
    if (e.code === 'CIRCUIT_OPEN') throw e; // re-throw, don't count as new failure

    // Failure path
    b.failures++;
    b.lastFailTime = now;

    if (b.state === 'HALF_OPEN' || b.failures >= FAILURE_THRESHOLD) {
      b.state    = 'OPEN';
      b.openedAt = now;
      logger.error(`[circuit:${name}] OPENED — ${b.failures} failures`, e.message);
    }

    throw e;
  }
}

// Health status for /health endpoint
export function breakerStatus() {
  const status = {};
  for (const [name, b] of breakers) {
    status[name] = b.state;
  }
  return status;
}
