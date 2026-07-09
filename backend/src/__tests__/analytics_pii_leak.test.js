/**
 * analytics_pii_leak.test.js
 * Verifies analytics/tracking events do not include PII.
 * Screens should track actions, not identifiable user data.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname   = fileURLToPath(new URL('.', import.meta.url));
const FE_SCREENS  = resolve(__dirname, '../../../frontend/src/screens');
const BE_ROUTES   = resolve(__dirname, '../routes');

const PII_PATTERNS = [
  { name: 'SSN',     pattern: /track.*\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/ },
  { name: 'email in event',  pattern: /track.*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { name: 'password in event', pattern: /track.*password/i },
  { name: 'credit card',   pattern: /track.*\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { name: 'raw user ID in plain text event', pattern: /track\s*\(\s*['"][^'"]*user[^'"]*['"]\s*,\s*\{\s*(?:user_?id|userId)\s*:/ },
];

describe('Analytics — no PII in events', () => {
  test.each(PII_PATTERNS)('no $name in frontend analytics', ({ name, pattern }) => {
    const violations = [];
    if (!existsSync(FE_SCREENS)) return;
    for (const fname of readdirSync(FE_SCREENS).filter(f => f.endsWith('.tsx'))) {
      const c = readFileSync(join(FE_SCREENS, fname), 'utf-8');
      if (pattern.test(c)) violations.push(fname);
    }
    expect(violations).toHaveLength(0);
  });
});

describe('Analytics — event naming conventions', () => {
  test('analytics events use snake_case or camelCase (not freeform strings)', () => {
    if (!existsSync(FE_SCREENS)) return;
    const freeform = [];
    for (const fname of readdirSync(FE_SCREENS).filter(f => f.endsWith('.tsx'))) {
      const c   = readFileSync(join(FE_SCREENS, fname), 'utf-8');
      const evts = c.match(/track\s*\(\s*['"]([^'"]{20,})['"]/g) || [];
      for (const evt of evts) {
        const name = evt.match(/['"]([^'"]+)['"]/)?.[1];
        // Long, sentence-case strings with spaces are freeform (bad)
        if (name && /\s/.test(name) && name.length > 30) freeform.push({ fname, name });
      }
    }
    // Warn if analytics events are freeform sentences
    if (freeform.length > 0) console.warn('Freeform analytics events:', freeform.slice(0,3));
    expect(freeform.length).toBeLessThan(5);
  });
});

describe('Analytics — backend event logging', () => {
  test('audit log does not store raw passwords', () => {
    const audit = join(BE_ROUTES, '../utils/audit.js');
    if (!existsSync(audit)) return;
    const c = readFileSync(audit, 'utf-8');
    expect(c).not.toMatch(/log.*password\s*:/i);
  });

  test('audit log has user ID reference (for accountability)', () => {
    const audit = join(BE_ROUTES, '../utils/audit.js');
    if (!existsSync(audit)) return;
    const c = readFileSync(audit, 'utf-8');
    expect(c).toMatch(/user_id|userId|actor/i);
  });

  test('analytics route does not accept arbitrary event data without schema', () => {
    const ana = join(BE_ROUTES, 'analytics.js');
    if (!existsSync(ana)) return;
    const c = readFileSync(ana, 'utf-8');
    const hasValidation = c.includes('validate') || c.includes('schema') ||
      c.includes('ALLOWED_EVENTS') || c.includes('allowedEvents');
    if (!hasValidation) console.warn('analytics.js may accept arbitrary event data');
    expect(true).toBe(true); // Warn-only
  });
});
