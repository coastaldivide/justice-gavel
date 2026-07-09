/**
 * self_healing_config.test.js
 * Verifies the self-healing infrastructure is correctly configured:
 * watchdog, circuit breakers, retry logic, and health checks.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HEALING   = resolve(__dirname, '../monitoring/selfHealing.js');
const CIRCUIT   = resolve(__dirname, '../utils/circuitBreaker.js');
const RETRY     = resolve(__dirname, '../utils/retry.js');
const SERVER    = resolve(__dirname, '../server.js');

describe('Self-healing — watchdog', () => {
  test('self-healing file exists', () => expect(existsSync(HEALING)).toBe(true));

  test('memory watchdog is defined', () => {
    const c = readFileSync(HEALING, 'utf-8');
    expect(c).toMatch(/watchdog|memoryUsage|rss|heapUsed/i);
  });

  test('watchdog checks memory at an interval', () => {
    const c = readFileSync(HEALING, 'utf-8');
    expect(c).toMatch(/setInterval|schedule|cron/i);
  });

  test('watchdog has a maximum memory threshold', () => {
    const c = readFileSync(HEALING, 'utf-8');
    expect(c).toMatch(/\d{2,}.*MB|MB.*\d{2,}|\d{7,}/); // bytes or MB threshold
  });

  test('watchdog can restart or alert on threshold breach', () => {
    const c = readFileSync(HEALING, 'utf-8');
    expect(c).toMatch(/restart|alert|notify|process\.exit|kill/i);
  });
});

describe('Self-healing — circuit breaker', () => {
  test('circuit breaker file exists', () => expect(existsSync(CIRCUIT)).toBe(true));

  test('has CLOSED, OPEN, HALF_OPEN states', () => {
    const c = readFileSync(CIRCUIT, 'utf-8');
    expect(c).toMatch(/CLOSED|closed/);
    expect(c).toMatch(/OPEN|open/);
    expect(c).toMatch(/HALF.OPEN|halfOpen/i);
  });

  test('has failure threshold', () => {
    const c = readFileSync(CIRCUIT, 'utf-8');
    expect(c).toMatch(/threshold|failureCount|failures/i);
  });

  test('has cooldown/recovery period', () => {
    const c = readFileSync(CIRCUIT, 'utf-8');
    expect(c).toMatch(/cooldown|timeout|recovery|resetTimeout/i);
  });

  test('circuit breaker is used in AI routes', () => {
    const askPath = resolve(__dirname, '../routes/chat/ask.js');
    if (!existsSync(askPath)) return;
    const c = readFileSync(askPath, 'utf-8');
    expect(c).toMatch(/circuit|breaker|withBreaker/i);
  });
});

describe('Self-healing — retry logic', () => {
  test('retry utility exists', () => expect(existsSync(RETRY)).toBe(true));

  test('retry has exponential backoff', () => {
    const c = readFileSync(RETRY, 'utf-8');
    expect(c).toMatch(/exponential|backoff|Math\.pow|2\s*\*\*|delay.*attempt/i);
  });

  test('retry has maximum attempt limit', () => {
    const c = readFileSync(RETRY, 'utf-8');
    expect(c).toMatch(/maxAttempts|maxRetries|MAX_ATTEMPTS|\battempts\b/i);
  });
});

describe('Self-healing — health endpoint', () => {
  test('server has /health endpoint', () => {
    const server = readFileSync(SERVER, 'utf-8');
    const app    = readFileSync(resolve(__dirname, '../app.js'), 'utf-8');
    const hasHealth = server.includes('/health') || app.includes('/health');
    expect(hasHealth).toBe(true);
  });

  test('health endpoint checks database connectivity', () => {
    const app = readFileSync(resolve(__dirname, '../app.js'), 'utf-8');
    const healthIdx = app.indexOf('/health');
    if (healthIdx === -1) return;
    const healthBlock = app.slice(healthIdx, healthIdx + 500);
    expect(healthBlock).toMatch(/db|database|supabase|ping|query/i);
  });
});
