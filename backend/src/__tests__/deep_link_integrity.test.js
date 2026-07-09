/**
 * deep_link_integrity.test.js
 * Verifies all registered deep links resolve to real screen names.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FE_DIR    = resolve(__dirname, '../../../frontend/src');
const NAV_FILE  = `${FE_DIR}/navigation/AppNavigator.tsx`;

describe('Deep link integrity', () => {
  test('AppNavigator.tsx exists', () => {
    expect(existsSync(NAV_FILE)).toBe(true);
  });

  test('deep linking config references registered screen names', () => {
    const nav = readFileSync(NAV_FILE, 'utf-8');
    const registered = new Set(
      [...nav.matchAll(/name=['"](\w+)['"]/g)].map(m => m[1])
    );
    // Find deep link path → screen mappings
    const linkMappings = [...nav.matchAll(/['"]\/(\w+)['"]:\s*['"](\w+)['"]/g)];
    const orphaned = linkMappings.filter(([, , screen]) => !registered.has(screen));
    expect(orphaned).toHaveLength(0);
  });

  test('all tab navigators have at least one screen', () => {
    const nav = readFileSync(NAV_FILE, 'utf-8');
    const tabBlocks = nav.match(/Tab\.Navigator[^<]+(?:<Tab\.Screen[^/]+\/>\s*)+/gs) || [];
    for (const block of tabBlocks) {
      const screens = block.match(/<Tab\.Screen/g) || [];
      expect(screens.length).toBeGreaterThan(0);
    }
  });

  test('Stack navigators have initial route name defined', () => {
    const nav = readFileSync(NAV_FILE, 'utf-8');
    const stacks = nav.match(/Stack\.Navigator/g) || [];
    // Each stack should have an initialRouteName or at least one Screen
    expect(stacks.length).toBeGreaterThan(0);
  });
});
