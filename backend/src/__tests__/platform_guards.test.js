/**
 * platform_guards.test.js
 * Verifies platform-specific code is properly guarded so
 * web-only code never runs on native and vice versa.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = fileURLToPath(new URL('.', import.meta.url));
const FE_DIR      = resolve(__dirname, '../../../frontend/src');
const SCREENS_DIR = join(FE_DIR, 'screens');

describe('Platform guards', () => {
  test('.web.tsx files exist for web-specific implementations', () => {
    const webScreens = readdirSync(SCREENS_DIR).filter(f => f.endsWith('.web.tsx'));
    expect(webScreens.length).toBeGreaterThan(0);
    console.log(`  Web-specific screens: ${webScreens.length}`);
  });

  test('web-specific APIs (window, document) only appear in .web.tsx files', () => {
    const violations = [];
    for (const fname of readdirSync(SCREENS_DIR)) {
      if (!fname.endsWith('.tsx') || fname.endsWith('.web.tsx')) continue;
      const c = readFileSync(join(SCREENS_DIR, fname), 'utf-8');
      // These APIs crash on native — must be in .web.tsx
      const webAPIs = ['window.location', 'document.createElement', 'navigator.clipboard'];
      for (const api of webAPIs) {
        if (c.includes(api)) violations.push(`${fname} uses ${api}`);
      }
    }
    expect(violations).toHaveLength(0);
  });

  test('Platform.OS checks are present where platform-specific behaviour is needed', () => {
    const platformScreens = readdirSync(SCREENS_DIR).filter(fname => {
      if (!fname.endsWith('.tsx')) return false;
      const c = readFileSync(join(SCREENS_DIR, fname), 'utf-8');
      return c.includes('Platform.OS') || c.includes('Platform.select');
    });
    // Some screens should use Platform.OS — if none do, something is wrong
    expect(platformScreens.length).toBeGreaterThan(3);
  });

  test('native-only modules (react-native-reanimated etc) are not imported in .web.tsx', () => {
    const nativeModules = ['react-native-reanimated', 'react-native-gesture-handler',
                           'react-native-camera', '@react-native-community/blur'];
    const violations = [];
    for (const fname of readdirSync(SCREENS_DIR).filter(f => f.endsWith('.web.tsx'))) {
      const c = readFileSync(join(SCREENS_DIR, fname), 'utf-8');
      for (const mod of nativeModules) {
        if (c.includes(`from '${mod}'`)) violations.push(`${fname} imports ${mod}`);
      }
    }
    expect(violations).toHaveLength(0);
  });
});
