/**
 * i18nScan.test.js — fails CI when new hard-coded English reaches the UI.
 *
 * Runs scripts/i18n-scan.mjs (TypeScript-AST scanner) over src/ as part of
 * the normal `npm test` step:
 *   - 0 findings (JSX text, user-facing props, Alert/toast text, label tables,
 *     PDF/HTML labels, and t() called at module scope — "eager")
 *   - every `// i18n-exempt:` carries a reason
 *   - the allowlist holds only brand names / codes / endonyms, each justified
 *   - the scanner still catches a planted string (so it cannot silently rot)
 *   - every literal t('key') used in src/ exists in en.json
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCAN = path.join(ROOT, 'scripts/i18n-scan.mjs');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/en.json'), 'utf8'));
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/i18n-allowlist.json'), 'utf8'));

function runScan() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'i18nscan-')), 'scan.json');
  execFileSync(process.execPath, [SCAN, '--json', out, '--quiet'], { cwd: ROOT, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

function scanSnippet(code) {
  const script = `
    import { scanSource } from ${JSON.stringify('file://' + SCAN)};
    const r = scanSource('src/screens/__Planted.tsx', ${JSON.stringify(code)});
    process.stdout.write(JSON.stringify(r.findings.filter(f => !f.exempt).map(f => f.kind + ':' + f.text)));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, stdio: 'pipe' }).toString());
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['__tests__', 'i18n'].includes(e.name) ? [] : walk(p);
    return /\.(tsx?|jsx?)$/.test(e.name) ? [p] : [];
  });
}

describe('i18n hard-coded string scan', () => {
  let result;
  beforeAll(() => { result = runScan(); }, 60000);

  it('finds no hard-coded user-facing English in src/', () => {
    const lines = result.findings.map(f => `${f.file}:${f.line} [${f.kind}] ${f.text.slice(0, 100)}`);
    expect(lines).toEqual([]);
  });

  it('never calls t() at module scope (text would freeze in the start-up language)', () => {
    expect(result.findings.filter(f => f.kind === 'eager')).toEqual([]);
  });

  it('every line exemption states a reason', () => {
    const files = [...new Set(result.exempted.map(e => e.file))];
    const bare = [];
    for (const f of files) {
      fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((l, i) => {
        if (/i18n-exempt(?!:\s*\S)/.test(l)) bare.push(`${f}:${i + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });

  it('the allowlist only holds justified non-translatables', () => {
    const strings = Object.entries(allow.strings || {});
    expect(strings.length).toBeLessThanOrEqual(30);
    for (const [s, why] of strings) {
      expect([s, typeof why === 'string' && why.length > 3]).toEqual([s, true]);
      // brand / code / endonym: no ordinary English sentence sneaks in
      const words = s.match(/[A-Za-zÀ-ỹ]{2,}/g) || [];
      expect([s, words.length <= 5 || words.every(w => w === w.toUpperCase())]).toEqual([s, true]);
    }
    for (const [f, why] of Object.entries(allow.files || {})) {
      expect([f, typeof why === 'string' && why.length > 3]).toEqual([f, true]);
    }
  });

  it('still catches planted English (self-test)', () => {
    const found = scanSnippet(`
      import React from 'react';
      import { Text, Alert } from 'react-native';
      export default function Planted() {
        Alert.alert('Something went wrong', 'Please try again later.');
        return <Text accessibilityLabel="Open the menu">Your case was saved</Text>;
      }
    `);
    const joined = found.join('\n');
    expect(joined).toMatch(/Something went wrong/);
    expect(joined).toMatch(/Please try again later/);
    expect(joined).toMatch(/Open the menu/);
    expect(joined).toMatch(/Your case was saved/);
  });

  it('does not flag translated, brand or code strings (self-test)', () => {
    const found = scanSnippet(`
      import React from 'react';
      import { Text } from 'react-native';
      import { t } from '../i18n';
      export default function Planted() {
        const route = 'CaseScreen';
        return <Text testID="case-title" accessibilityLabel={t('save')}>{t('save')} Justice Gavel</Text>;
      }
    `);
    expect(found).toEqual([]);
  });

  it('every literal t(\'key\') used in src/ exists in en.json', () => {
    const missing = [];
    for (const f of walk(path.join(ROOT, 'src'))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-z][a-z0-9_]*)'/g)) {
        if (!(m[1] in en)) missing.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
