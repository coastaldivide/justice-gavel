#!/usr/bin/env node
/**
 * validate-i18n.js — Check all translation files have same key count as en.json
 * Usage: node src/scripts/validate-i18n.js
 * Fails with exit code 1 if any language is missing keys.
 */
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N_DIR = path.resolve(__dirname, '../../../frontend/src/i18n');

const en = JSON.parse(readFileSync(`${I18N_DIR}/en.json`, 'utf8'));
const enKeys = new Set(Object.keys(en));

let hasErrors = false;

for (const file of readdirSync(I18N_DIR).filter(f => f.endsWith('.json') && f !== 'en.json')) {
  const lang = file.replace('.json', '');
  const translations = JSON.parse(readFileSync(`${I18N_DIR}/${file}`, 'utf8'));
  const missing = [...enKeys].filter(k => !(k in translations));
  const extra   = Object.keys(translations).filter(k => !enKeys.has(k));

  if (missing.length > 0) {
    console.error(`[i18n] ${lang}: ${missing.length} keys missing from en.json:`);
    missing.slice(0, 10).forEach(k => console.error(`  - ${k}`));
    hasErrors = true;
  } else {
    console.log(`[i18n] ${lang}: ✅ ${Object.keys(translations).length} keys (matches en.json)`);
  }
  if (extra.length > 0) {
    console.warn(`[i18n] ${lang}: ${extra.length} extra keys not in en.json (orphans)`);
  }
}

if (hasErrors) {
  console.error('\n❌ Translation validation failed. Add missing keys before deploying.');
  process.exit(1);
} else {
  console.log('\n✅ All translation files are complete.');
}
