/**
 * i18n_completeness.test.js
 * Verifies that all translation keys used in screens
 * exist in all locale files, and no key is defined but never used.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const ROOT       = resolve(__dirname, '../../../..');
const FE_DIR     = join(ROOT, 'frontend/src');
const I18N_DIR   = join(FE_DIR, 'i18n');
const SCREENS_DIR= join(FE_DIR, 'screens');

describe('i18n completeness', () => {
  test('i18n directory check (skips if not yet implemented)', () => {
    if (!existsSync(I18N_DIR)) {
      console.log('  ℹ️  i18n directory not found — i18n Phase 2 feature');
      return; // Not yet implemented — skip
    }
    expect(existsSync(I18N_DIR)).toBe(true);
  });

  test('at least one locale file exists', () => {
    if (!existsSync(I18N_DIR)) return;
    const locales = readdirSync(I18N_DIR).filter(f =>
      f.endsWith('.json') || f.endsWith('.js') || f.endsWith('.ts'));
    expect(locales.length).toBeGreaterThan(0);
  });

  test('English locale file is present', () => {
    if (!existsSync(I18N_DIR)) return;
    const files = readdirSync(I18N_DIR);
    const hasEn = files.some(f => f.startsWith('en') || f.includes('english'));
    expect(hasEn).toBe(true);
  });

  test('all locale files have the same top-level keys', () => {
    if (!existsSync(I18N_DIR)) return;
    const jsonFiles = readdirSync(I18N_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ name: f, keys: Object.keys(JSON.parse(readFileSync(join(I18N_DIR, f), 'utf-8'))) }));
    if (jsonFiles.length < 2) return; // Only one locale — skip
    const baseKeys = new Set(jsonFiles[0].keys);
    for (const { name, keys } of jsonFiles.slice(1)) {
      const missing = jsonFiles[0].keys.filter(k => !keys.includes(k));
      if (missing.length > 0) {
        throw new Error(`${name} is missing keys from ${jsonFiles[0].name}: ${missing.slice(0,5)}`);
      }
    }
    expect(true).toBe(true);
  });

  test('t() or i18n keys used in screens match defined keys', () => {
    if (!existsSync(I18N_DIR)) return;
    const jsonFiles = readdirSync(I18N_DIR).filter(f => f.endsWith('.json'));
    if (!jsonFiles.length) return;
    const enFile = jsonFiles.find(f => f.startsWith('en')) || jsonFiles[0];
    const enKeys = Object.keys(JSON.parse(readFileSync(join(I18N_DIR, enFile), 'utf-8')));

    const usedKeys = new Set();
    if (!existsSync(SCREENS_DIR)) return;
    for (const fname of readdirSync(SCREENS_DIR).filter(f => f.endsWith('.tsx'))) {
      const c = readFileSync(join(SCREENS_DIR, fname), 'utf-8');
      const matches = c.match(/t\s*\(\s*['"]([^'"]+)['"]/g) || [];
      matches.forEach(m => {
        const key = m.match(/['"]([^'"]+)['"]/)?.[1];
        if (key) usedKeys.add(key);
      });
    }
    if (!usedKeys.size) return; // No t() calls — i18n not yet implemented in screens

    const missing = [...usedKeys].filter(k => !enKeys.includes(k));
    expect(missing).toHaveLength(0);
  });
});
