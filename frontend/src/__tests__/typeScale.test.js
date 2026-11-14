/**
 * typeScale.test.js — the app uses one set of text sizes (Nov 13 2026 UI clean-up).
 * Before it, screens mixed up to 15 sizes (29 across the app) and 256 places used
 * text under 12 px. Allowed: 12 · 14 · 16 · 18 · 22 · 28 (text), 36 · 48 · 60 · 80
 * (display numbers) — the TYPE scale in constants/theme.ts.
 */
const fs = require('fs');
const path = require('path');

const ALLOWED = new Set([12, 14, 16, 18, 22, 28, 36, 48, 60, 80]);
const ROOT = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
    else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p);
  }
})(ROOT);
files.push(path.join(ROOT, '..', 'App.tsx'));

const found = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/fontSize\s*:\s*([^,}\n]+)/g)) {
      for (const n of m[1].matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
        found.push({ file: path.relative(ROOT, f), line: i + 1, size: Number(n[1]) });
      }
    }
  });
}

describe('type scale', () => {
  it('finds the font sizes (sanity)', () => expect(found.length).toBeGreaterThan(500));
  it('every literal fontSize is on the scale', () => {
    expect(found.filter(x => !ALLOWED.has(x.size)).map(x => `${x.file}:${x.line} → ${x.size}`)).toEqual([]);
  });
  it('no text smaller than 12', () => {
    expect(found.filter(x => x.size < 12).map(x => `${x.file}:${x.line} → ${x.size}`)).toEqual([]);
  });
});
