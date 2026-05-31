/**
 * circuitBreaker.js — Wraps external API calls to prevent cascade failures
 *
 * States: CLOSED (normal) → OPEN (failing fast) → HALF_OPEN (testing)
 * Config: 5 failures in 10s → trip → 30s cooldown → test → close if OK
 */
import CircuitBreaker from 'opossum';
import logger         from './logger.js';

const defaultOptions = {
  timeout:          10000,   // 10s call timeout
  errorThresholdPercentage: 50,
  resetTimeout:     30000,   // 30s before half-open test
  rollingCountTimeout:  10000,
  volumeThreshold:  5,       // min calls before tripping
};

const breakers = new Map();

export function getBreaker(name, fn, options = {}) {
  if (breakers.has(name)) return breakers.get(name);

  const breaker = new CircuitBreaker(fn, { ...defaultOptions, ...options, name });

  breaker.on('open',     () => logger.warn(`[circuit] ${name} OPEN  — failing fast`));
  breaker.on('halfOpen', () => logger.info(`[circuit] ${name} HALF-OPEN — testing`));
  breaker.on('close',    () => logger.info(`[circuit] ${name} CLOSED — recovered`));
  breaker.fallback(() => { throw new Error(`${name} service unavailable — circuit open`); });

  breakers.set(name, breaker);
  return breaker;
}

// ── Pre-built breakers for common services ────────────────────────────────────
export const anthropicBreaker = (fn) => getBreaker('anthropic', fn, { timeout: 120000 });
export const stripeBreaker    = (fn) => getBreaker('stripe',    fn, { timeout: 10000  });
export const twilioBreaker    = (fn) => getBreaker('twilio',    fn, { timeout: 8000   });
export const sendgridBreaker  = (fn) => getBreaker('sendgrid',  fn, { timeout: 8000   });
