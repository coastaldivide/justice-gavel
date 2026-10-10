/**
 * self_healing_config.test.js
 * Verifies the self-healing infrastructure is correctly configured:
 * watchdog and health checks.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const HEALING   = resolve(__dirname, '../monitoring/selfHealing.js');
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



describe('Self-healing — health endpoint', () => {
  test('server has /health endpoint', () => {
    const server = readFileSync(SERVER, 'utf-8');
    const app    = readFileSync(resolve(__dirname, '../app.js'), 'utf-8');
    const hasHealth = server.includes('/health') || app.includes('/health');
    expect(hasHealth).toBe(true);
  });

  test('health endpoint checks database connectivity', () => {
    const app = readFileSync(resolve(__dirname, '../app.js'), 'utf-8');
    // locate the route definition (not e.g. the ./utils/healthCheck.js import)
    const healthIdx = app.search(/app\.get\(\[?\s*'\/health'/);
    expect(healthIdx).toBeGreaterThan(-1);
    const healthBlock = app.slice(healthIdx, healthIdx + 500);
    expect(healthBlock).toMatch(/db|database|supabase|ping|query/i);
  });
});
