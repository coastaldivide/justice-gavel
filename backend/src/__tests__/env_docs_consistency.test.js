/**
 * env_docs_consistency.test.js — the environment-variable docs cannot drift
 * from the code.
 *
 * Source of truth: every `process.env.X` (dot, bracket or destructuring) read
 * in backend/src (tests excluded; the documentation-only ALL_ENV_VARS block in
 * config.js excluded so it cannot vouch for itself).
 *
 *   1. config.js ALL_ENV_VARS lists exactly that set (nothing missing, nothing
 *      stale).
 *   2. RAILWAY_ENV_SETUP.md (the single env reference) names every one.
 *   3. backend/.env.example has a `VAR=` (or commented `#VAR=`) line for every
 *      one, and no backend line for a variable the code never reads.
 *   4. The repo-root .env.example lists exactly the same variables.
 *   5. The EXPO_PUBLIC_* lines match what the frontend actually reads.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(__dirname, '../../..');
const SRC  = resolve(REPO, 'backend/src');

function walk(dir, exts, skip = () => false) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip(p, name)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some(e => name.endsWith(e))) out.push(p);
  }
  return out;
}

function envReads(text) {
  const vars = new Set();
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) vars.add(m[1]);
  for (const m of text.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g)) vars.add(m[1]);
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].split('=')[0].trim();
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) vars.add(name);
    }
  }
  return vars;
}

const CONFIG_PATH = join(SRC, 'config.js');
const configSrc   = readFileSync(CONFIG_PATH, 'utf8');
const blockStart  = configSrc.indexOf('export const ALL_ENV_VARS');
const blockEnd    = configSrc.indexOf('\n};', blockStart);
const ALL_BLOCK   = configSrc.slice(blockStart, blockEnd);

const codeVars = new Set();
for (const f of walk(SRC, ['.js', '.mjs'], (p, n) => n === '__tests__' || n === 'node_modules')) {
  let text = readFileSync(f, 'utf8');
  if (f === CONFIG_PATH) text = text.slice(0, blockStart) + text.slice(blockEnd);
  for (const v of envReads(text)) codeVars.add(v);
}

const frontendVars = new Set();
for (const f of walk(resolve(REPO, 'frontend/src'), ['.ts', '.tsx'], (p, n) => n === '__tests__')) {
  for (const v of envReads(readFileSync(f, 'utf8'))) if (v.startsWith('EXPO_PUBLIC_')) frontendVars.add(v);
}
for (const v of envReads(readFileSync(resolve(REPO, 'frontend/App.tsx'), 'utf8'))) {
  if (v.startsWith('EXPO_PUBLIC_')) frontendVars.add(v);
}

const exampleVars = (p) => new Set(
  [...readFileSync(resolve(REPO, p), 'utf8').matchAll(/^#?([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]),
);
const sorted = (s) => [...s].sort();

describe('environment variable documentation matches the code', () => {
  test('sanity: the scan found the real code', () => {
    expect(codeVars.size).toBeGreaterThan(100);
    expect(codeVars.has('DATABASE_URL')).toBe(true);
    expect(codeVars.has('VAPID_PRIVATE_KEY')).toBe(true);   // destructured read
    expect(frontendVars.has('EXPO_PUBLIC_API_BASE')).toBe(true);
  });

  test('config.js ALL_ENV_VARS lists exactly the variables the code reads', async () => {
    const { ALL_ENV_VARS } = await import('../config.js');
    const listed = new Set(Object.keys(ALL_ENV_VARS));
    expect(sorted([...codeVars].filter(v => !listed.has(v)))).toEqual([]);   // missing from ALL_ENV_VARS
    expect(sorted([...listed].filter(v => !codeVars.has(v)))).toEqual([]);   // stale entries
    expect(ALL_BLOCK.length).toBeGreaterThan(1000);
  });

  test('RAILWAY_ENV_SETUP.md documents every variable the code reads', () => {
    const doc = readFileSync(resolve(REPO, 'RAILWAY_ENV_SETUP.md'), 'utf8');
    const missing = [...codeVars].filter(v => !new RegExp(`(^|[^A-Z0-9_])${v}([^A-Z0-9_]|$)`, 'm').test(doc));
    expect(sorted(missing)).toEqual([]);
    const missingFe = [...frontendVars].filter(v => !doc.includes(v));
    expect(sorted(missingFe)).toEqual([]);
  });

  test('backend/.env.example lists every variable, and nothing the code never reads', () => {
    const ex = exampleVars('backend/.env.example');
    expect(sorted([...codeVars].filter(v => !ex.has(v)))).toEqual([]);
    const backendLines = [...ex].filter(v => !v.startsWith('EXPO_PUBLIC_'));
    expect(sorted(backendLines.filter(v => !codeVars.has(v)))).toEqual([]);
  });

  test('EXPO_PUBLIC_* lines match what the frontend reads', () => {
    for (const p of ['backend/.env.example', '.env.example', 'frontend/.env.example']) {
      const fe = new Set([...exampleVars(p)].filter(v => v.startsWith('EXPO_PUBLIC_')));
      expect({ file: p, vars: sorted(fe) }).toEqual({ file: p, vars: sorted(frontendVars) });
    }
  });

  test('repo-root .env.example lists exactly the same variables as backend/.env.example', () => {
    expect(sorted(exampleVars('.env.example'))).toEqual(sorted(exampleVars('backend/.env.example')));
  });

  test('.env.example files contain no real secret values', () => {
    for (const p of ['backend/.env.example', '.env.example', 'frontend/.env.example']) {
      const text = readFileSync(resolve(REPO, p), 'utf8');
      expect(text).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{8,}/);
      expect(text).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
      expect(text).not.toMatch(/whsec_[A-Za-z0-9]{8,}/);
      expect(text).not.toMatch(/\bre_[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/=[0-9a-f]{64}\s*$/m);
    }
  });
});
