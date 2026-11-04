/**
 * middleware/stagingTestClient.js — let the smoke test and route sweep run against STAGING.
 *
 * On Render (TRUST_PROXY=1) req.ip is the real IP of whoever calls — for the staging check in
 * GitHub Actions that is one CI runner. Every rate limiter then sees one client: the 5-per-hour
 * sign-up limit blocks a second smoke run (and the sweep, which signs up 6 users), and the smoke
 * test cannot trip each limiter from its own address.
 *
 * Staging only: when ALL of these hold
 *   - APP_ENV=staging (read on every request),
 *   - STAGING_TEST_KEY is set and at least 32 characters,
 *   - the request carries X-Staging-Test-Key equal to it (timing-safe compare),
 *   - X-Test-Client-Ip is a valid IPv4 / IPv6 address,
 * req.ip (what every limiter keys on) is replaced by X-Test-Client-Ip. Anything else leaves
 * req.ip alone. In production (APP_ENV != staging) the headers do nothing at all, and
 * scripts/check-env.js refuses a STAGING_TEST_KEY there.
 *
 * Both headers are removed from req.headers before any route, log line or error report sees
 * them (and utils/redact.js + instrument.js drop them too).
 */
import crypto from 'node:crypto';
import net from 'node:net';

export const KEY_HEADER = 'x-staging-test-key';
export const IP_HEADER = 'x-test-client-ip';
export const MIN_KEY_LENGTH = 32;

function appEnvNow(env) {
  const nodeEnv = env.NODE_ENV || 'development';
  return String(env.APP_ENV || (nodeEnv === 'production' ? 'production' : nodeEnv)).trim().toLowerCase();
}

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

/**
 * The client IP the test header asks for, or null when the header must be ignored.
 * Pure apart from reading `headers`; exported for tests.
 */
export function stagingTestClientIp(headers = {}, env = process.env) {
  if (appEnvNow(env) !== 'staging') return null;
  const want = String((env === process.env ? process.env.STAGING_TEST_KEY : env.STAGING_TEST_KEY) || '');
  if (want.length < MIN_KEY_LENGTH) return null;
  const got = headers[KEY_HEADER];
  if (typeof got !== 'string' || !got) return null;
  if (!crypto.timingSafeEqual(digest(got), digest(want))) return null;
  const ip = typeof headers[IP_HEADER] === 'string' ? headers[IP_HEADER].trim() : '';
  if (!ip || ip.length > 45 || net.isIP(ip) === 0) return null;
  return ip;
}

/** Express middleware — mount before every rate limiter. */
export function stagingTestClient({ env = process.env } = {}) {
  return (req, _res, next) => {
    const hasHeaders = req.headers[KEY_HEADER] !== undefined || req.headers[IP_HEADER] !== undefined;
    if (!hasHeaders) return next();
    const ip = stagingTestClientIp(req.headers, env);
    delete req.headers[KEY_HEADER];
    delete req.headers[IP_HEADER];
    if (ip) {
      // Express 5 defines req.ip as a getter on the prototype; an own property shadows it.
      Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true, writable: true });
      req.stagingTestClient = true;
    }
    next();
  };
}
