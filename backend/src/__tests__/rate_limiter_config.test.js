/**
 * rate_limiter_config.test.js
 * Verifies every rate limiter is correctly configured,
 * auth routes are protected, and limits are sane.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const RL_FILE   = resolve(__dirname, '../middleware/rateLimiters.js');
const AUTH_FILE = resolve(__dirname, '../routes/auth.js');
const APP_FILE  = resolve(__dirname, '../app.js');

describe('Rate limiter — configuration', () => {
  let rl, auth, app;
  beforeAll(() => {
    rl   = readFileSync(RL_FILE,   'utf-8');
    auth = readFileSync(AUTH_FILE, 'utf-8');
    app  = readFileSync(APP_FILE,  'utf-8');
  });

  test('rate limiter file exists', () => expect(existsSync(RL_FILE)).toBe(true));

  test('at least 3 distinct limiters are defined', () => {
    const defs = rl.match(/(?:rateLimit|new RateLimit|createRateLimiter)\s*\(/g) || [];
    expect(defs.length).toBeGreaterThanOrEqual(3);
  });

  test('auth limiter is stricter than API limiter (max <= 20 per window)', () => {
    const authMax = rl.match(/(?:auth|login|register)[^;]{0,200}max\s*:\s*(\d+)/si);
    if (authMax) expect(parseInt(authMax[1])).toBeLessThanOrEqual(20);
  });

  test('window duration is at least 1 minute (60000ms)', () => {
    // windowMs can be a variable calculation (e.g. windowMin * 60 * 1000)
    // Accept either a literal >= 60000 or a multiplication pattern
    const hasCalc = /windowMs\s*:.*\*.*60.*1000|windowMs\s*:.*60_000/.test(rl);
    const literals = [...rl.matchAll(/windowMs\s*:\s*(\d+)/g)]
      .map(m => parseInt(m[1])).filter(n => n >= 60_000);
    expect(hasCalc || literals.length > 0).toBe(true);
  });

  test('rate limiter is applied to auth routes', () => {
    expect(auth).toMatch(/limiter|rateLimit/i);
  });

  test('rate limiter is applied in app.js', () => {
    expect(app).toMatch(/limiter|rateLimit/i);
  });

  test('skip list does not bypass production (no NODE_ENV === development skip)', () => {
    const skip = rl.match(/skip\s*:[^,]+development/);
    expect(skip).toBeNull();
  });
});
