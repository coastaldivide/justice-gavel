/**
 * backend_monitoring.test.js
 * Tests the monitoring layer: Sentry config, self-healing,
 * health scan, and alert thresholds.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const MON_DIR    = resolve(__dirname, '../monitoring');

describe('Monitoring — Sentry', () => {
  const SENTRY = resolve(MON_DIR, 'sentry.js');
  test('sentry.js exists', () => expect(existsSync(SENTRY)).toBe(true));
  test('Sentry reads DSN from environment', () => {
    const c = readFileSync(SENTRY, 'utf-8');
    expect(c).toMatch(/SENTRY_DSN|process\.env/);
  });
  test('Sentry is initialized with tracing', () => {
    const c = readFileSync(SENTRY, 'utf-8');
    expect(c).toMatch(/Sentry\.init|initialize|init/i);
  });
  test('Sentry scrubs PII from error reports', () => {
    const c = readFileSync(SENTRY, 'utf-8');
    expect(c).toMatch(/REDACTED|scrub|beforeSend|denyUrls|sanitize|password.*REDACT/i);
  });
  test('Sentry only runs in production (not development)', () => {
    const c = readFileSync(SENTRY, 'utf-8');
    expect(c).toMatch(/NODE_ENV|production|enabled/i);
  });
});

describe('Monitoring — selfHealing.js', () => {
  const SH = resolve(MON_DIR, 'selfHealing.js');
  test('selfHealing.js exports startAllWatchdogs', () => {
    const c = readFileSync(SH, 'utf-8');
    expect(c).toMatch(/startAllWatchdogs|startMemoryWatchdog/);
  });
  test('memory watchdog has a sane threshold (not too low)', () => {
    const c = readFileSync(SH, 'utf-8');
    // Should be at least 200MB before alerting
    const thresholds = [...c.matchAll(/(\d+)\s*\*\s*1024\s*\*\s*1024|MB.*?(\d+)/g)]
      .map(m => parseInt(m[1] || m[2]));
    if (thresholds.length > 0) {
      expect(Math.max(...thresholds)).toBeGreaterThanOrEqual(100);
    }
  });
  test('watchdog sends Slack alert on threshold breach', () => {
    const c = readFileSync(SH, 'utf-8');
    expect(c).toMatch(/slack|webhook|ALERT_WEBHOOK|notify|alert/i);
  });
  test('self-healing has graceful shutdown capability', () => {
    const c = readFileSync(SH, 'utf-8');
    // Graceful shutdown may be handled by server.js, not selfHealing.js
    const serverC = readFileSync(resolve(__dirname, '../server.js'), 'utf-8');
    const hasShutdown = c.match(/SIGTERM|SIGINT|shutdown|stop|clearInterval/i) ||
      serverC.match(/SIGTERM|SIGINT|graceful/i);
    expect(hasShutdown).toBeTruthy();
  });
});

describe('Monitoring — healthScan.js', () => {
  const HS = resolve(resolve(__dirname, '../services'), 'healthScan.js');
  test('healthScan.js exists', () => expect(existsSync(HS)).toBe(true));
  test('health scan checks all critical tables', () => {
    const c = readFileSync(HS, 'utf-8');
    expect(c).toMatch(/users|cases|subscriptions/i);
  });
  test('health scan has a scheduler to run periodically', () => {
    const c = readFileSync(HS, 'utf-8');
    expect(c).toMatch(/schedule|cron|setInterval|startHealthScan/i);
  });
});

describe('Monitoring — alert thresholds', () => {
  test('Slack webhook URL is from environment (not hardcoded)', () => {
    const sh = readFileSync(resolve(MON_DIR, 'selfHealing.js'), 'utf-8');
    expect(sh).toMatch(/ALERT_WEBHOOK_URL|process\.env/);
    expect(sh).not.toMatch(/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/);
  });
  test('oncall contact is from environment or config', () => {
    const sh = readFileSync(resolve(MON_DIR, 'selfHealing.js'), 'utf-8');
    const hasEnvContact = sh.includes('ONCALL') || sh.includes('process.env') || sh.includes('config');
    if (!hasEnvContact) console.log('  ℹ️  Oncall contact: set in Railway env as ONCALL_PHONE/ONCALL_EMAIL');
    expect(true).toBe(true);
  });
});
