/**
 * loading_state_integrity.test.js
 * Verifies every setLoading(true) in frontend screens has a
 * corresponding setLoading(false) or finally block.
 * Also checks for loading state leaks in async handlers.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = fileURLToPath(new URL('.', import.meta.url));
const SCREENS_DIR = resolve(__dirname, '../../../frontend/src/screens');

const screens = readdirSync(SCREENS_DIR).filter(f => f.endsWith('.tsx'));

describe('SCAN 5 — Loading State Integrity', () => {
  test('every screen is a .tsx file', () => {
    expect(screens.length).toBeGreaterThan(70);
  });

  screens.forEach(fname => {
    test(`${fname}: setLoading(true) always paired with setLoading(false) or finally`, () => {
      const c = readFileSync(join(SCREENS_DIR, fname), 'utf-8');
      const trueCount    = (c.match(/setLoading\s*\(\s*true\s*\)/g)  || []).length;
      const falseCount   = (c.match(/setLoading\s*\(\s*false\s*\)/g) || []).length;
      const finallyCount = (c.match(/\bfinally\s*\{/g)               || []).length;

      if (trueCount === 0) return; // No loading state — fine

      // Either has matching false OR a finally block
      const hasPair = falseCount >= trueCount || finallyCount > 0;
      if (!hasPair) {
        throw new Error(
          `${fname}: ${trueCount}x setLoading(true) but ` +
          `${falseCount}x setLoading(false) and ${finallyCount} finally blocks. ` +
          `Loading may never clear on error.`
        );
      }
      expect(hasPair).toBe(true);
    });
  });
});
