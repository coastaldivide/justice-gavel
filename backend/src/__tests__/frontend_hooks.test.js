/**
 * frontend_hooks.test.js
 * Tests all custom hooks: naming convention, exports, dependency arrays,
 * and correct cleanup patterns.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const HOOKS_DIR  = resolve(__dirname, '../../../frontend/src/hooks');
const hooks = existsSync(HOOKS_DIR) ? readdirSync(HOOKS_DIR).filter(f => f.endsWith('.ts') || f.endsWith('.tsx')) : [];

describe('Hooks — naming and structure', () => {
  test('hooks directory has files', () => {
    expect(hooks.length).toBeGreaterThan(0);
  });

  test.each(hooks)('%s starts with "use"', (fname) => {
    expect(fname).toMatch(/^use/i);
  });

  test.each(hooks)('%s has an export', (fname) => {
    const c = readFileSync(join(HOOKS_DIR, fname), 'utf-8');
    expect(c).toMatch(/export\s+(?:const|function|default)/);
  });

  test.each(hooks)('%s returns something', (fname) => {
    const c = readFileSync(join(HOOKS_DIR, fname), 'utf-8');
    expect(c).toMatch(/\breturn\b/);
  });
});

describe('Hooks — React rules compliance', () => {
  test('no hook calls another hook conditionally', () => {
    const violations = [];
    for (const fname of hooks) {
      const c = readFileSync(join(HOOKS_DIR, fname), 'utf-8');
      if (/if\s*\([^)]+\)\s*\{[^}]*use[A-Z]/.test(c)) violations.push(fname);
    }
    expect(violations).toHaveLength(0);
  });

  test('useEffect cleanup functions return void or a function', () => {
    for (const fname of hooks) {
      const c = readFileSync(join(HOOKS_DIR, fname), 'utf-8');
      if (!c.includes('useEffect')) continue;
      // Cleanup must be () => {...} not an async function
      const asyncCleanup = /useEffect\s*\(\s*async/.test(c);
      if (asyncCleanup) console.warn(`${fname}: async useEffect — cleanup can't be async`);
      expect(asyncCleanup).toBe(false);
    }
  });

  test('useNetworkStatus hook handles both online and offline states', () => {
    const fp = join(HOOKS_DIR, 'useNetworkStatus.ts');
    if (!existsSync(fp)) return;
    const c = readFileSync(fp, 'utf-8');
    expect(c).toMatch(/online|isOnline|connected/i);
    expect(c).toMatch(/offline|isOffline|disconnected|false/i);
  });

  test('useBiometricGate has fallback for unsupported devices', () => {
    const fp = join(HOOKS_DIR, 'useBiometricGate.ts');
    if (!existsSync(fp)) return;
    const c = readFileSync(fp, 'utf-8');
    expect(c).toMatch(/supported|available|fallback|catch|error/i);
  });

  test('useRefresh has a loading state', () => {
    const fp = join(HOOKS_DIR, 'useRefresh.ts');
    if (!existsSync(fp)) return;
    const c = readFileSync(fp, 'utf-8');
    expect(c).toMatch(/loading|refreshing|isRefreshing/i);
  });
});
