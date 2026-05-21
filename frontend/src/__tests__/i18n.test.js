/**
 * i18n.test.js
 * Tests translation key parity across all 4 languages.
 * Reads actual language files — catches missing keys before submission.
 */
const fs   = require('fs');
const path = require('path');

const I18N_DIR = require('path').resolve(__dirname, '../i18n');
const LANGS    = ['en', 'es', 'vi', 'pt'];

// Load all language files
let langs = {};
let loadError = null;
try {
  for (const lang of LANGS) {
    const filePath = path.join(I18N_DIR, `${lang}.json`);
    langs[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
} catch (e) {
  loadError = e.message;
}

// Recursively collect all keys from nested objects
function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('i18n Language Files', () => {
  it('all 4 language files load without error', () => {
    expect(loadError).toBeNull();
    expect(Object.keys(langs)).toHaveLength(LANGS.length);
  });

  it('all languages have the same number of keys as English', () => {
    if (loadError) return;
    const enKeys = collectKeys(langs.en);
    for (const lang of ['es', 'vi', 'pt']) {
      const keys = collectKeys(langs[lang]);
      expect(keys.length).toBe(enKeys.length);
    }
  });

  it('all keys in English exist in all other languages', () => {
    if (loadError) return;
    const enKeys = new Set(collectKeys(langs.en));
    for (const lang of ['es', 'vi', 'pt']) {
      const otherKeys = new Set(collectKeys(langs[lang]));
      const missing = [...enKeys].filter(k => !otherKeys.has(k));
      expect(missing).toHaveLength(0);
    }
  });

  it('no language has extra keys not present in English', () => {
    if (loadError) return;
    const enKeys = new Set(collectKeys(langs.en));
    for (const lang of ['es', 'vi', 'pt']) {
      const extra = collectKeys(langs[lang]).filter(k => !enKeys.has(k));
      expect(extra).toHaveLength(0);
    }
  });

  it('no translation value is an empty string', () => {
    if (loadError) return;
    for (const lang of LANGS) {
      const keys = collectKeys(langs[lang]);
      for (const key of keys) {
        const parts  = key.split('.');
        let   val    = langs[lang];
        for (const p of parts) val = val?.[p];
        if (typeof val === 'string') {
          expect(val.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('at least 600 translation keys exist (completeness sanity)', () => {
    if (loadError) return;
    const count = collectKeys(langs.en).length;
    expect(count).toBeGreaterThanOrEqual(600);
  });

  it('critical keys exist: emergency, rights, bail, attorney', () => {
    if (loadError) return;
    const allKeys = collectKeys(langs.en);
    const keyStr  = allKeys.join(' ');
    // At least one key containing these concepts
    expect(keyStr).toMatch(/emergency|sos/i);
    expect(keyStr).toMatch(/right|rights/i);
    expect(keyStr).toMatch(/bail|bond/i);
    expect(keyStr).toMatch(/attorney|lawyer/i);
  });
});
