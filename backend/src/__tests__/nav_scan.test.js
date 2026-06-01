/**
 * nav_scan.test.js — Automated 12-scan suite (runs in CI on every push)
 *
 * Encodes all 12 navigation/stub/quality scans as Jest tests.
 * Any regression will fail the build before it reaches production.
 */

import fs                from 'fs';
import path              from 'path';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';

const FE      = path.resolve('/tmp/JG/frontend/src');
const BE      = path.resolve('/tmp/JG/backend/src/routes');
const SCREENS = path.join(FE, 'screens');
const NAV     = readFileSync(path.join(FE, 'navigation/AppNavigator.tsx'), 'utf8');

// Helper: all screen files
function getScreens() {
  return readdirSync(SCREENS)
    .filter(f => f.endsWith('.tsx') && !f.endsWith('.web.tsx'));
}

function readScreen(fname) {
  return readFileSync(path.join(SCREENS, fname), 'utf8');
}

// Read all backend route files recursively
function getBeRoutes() {
  const routes = new Set();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(path.join(dir, entry.name)); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.relative(BE, path.join(dir, entry.name))
        .replace(/\\/g, '/').replace('.js', '').replace('/index', '');
      routes.add('/' + rel);
      routes.add('/' + rel.replace(/_/g, '-'));
    }
  }
  walk(BE);
  return routes;
}

function getAppMounts() {
  const app = readFileSync('/tmp/JG/backend/src/app.js', 'utf8');
  return new Set(
    [...app.matchAll(/app\.use\(['"]([^'"]+)['"]/g)].map(m => m[1])
  );
}

describe('SCAN 1 — Dead Navigation', () => {
  test('all navigate() targets are registered in AppNavigator', () => {
    const registered = new Set(NAV.match(/name=["'](\w+)["']/g)?.map(m => m.replace(/name=["']|["']/g, '')) || []);
    const noise = new Set(['params','screen','initial','undefined','null','string','number']);
    const dead = [];
    for (const f of getScreens()) {
      const c = readScreen(f);
      for (const [, target] of c.matchAll(/navigate\(['"](\w+)['"]/g)) {
        if (!registered.has(target) && !noise.has(target)) {
          dead.push(`${f} → navigate('${target}')`);
        }
      }
    }
    expect(dead).toEqual([]);
  });
});

describe('SCAN 2 — Stub Screens', () => {
  test('no screens contain Coming Soon / TODO / Not Implemented', () => {
    const stubs = [];
    const patterns = [/Coming\s+Soon/i, /\bTODO\b(?!\s*\[)/, /Not\s+Implemented/i, /Lorem ipsum/i];
    for (const f of getScreens()) {
      let c = readScreen(f);
      c = c.replace(/placeholder=["'][^"']*["']/g, ''); // strip input hints
      c = c.replace(/\/\/[^\n]*/g, '');                 // strip comments
      for (const p of patterns) {
        if (p.test(c)) stubs.push(`${f}: ${p}`);
      }
    }
    expect(stubs).toEqual([]);
  });
});

describe('SCAN 3 — Broken Buttons', () => {
  test('no empty onPress handlers', () => {
    const broken = [];
    for (const f of getScreens()) {
      const c = readScreen(f);
      if (/onPress=\{\(\)\s*=>\s*\{\s*\}\}/.test(c)) broken.push(f + ': empty onPress');
      if (/onPress=\{(?:undefined|null)\}/.test(c))   broken.push(f + ': null/undefined onPress');
    }
    expect(broken).toEqual([]);
  });
});

describe('SCAN 4 — Loading State Leaks', () => {
  test('every setLoading(true) has a corresponding setLoading(false) or finally', () => {
    const leaks = [];
    for (const f of getScreens()) {
      const c = readScreen(f);
      const trues  = (c.match(/setLoading\(true\)/g) || []).length;
      const falses = (c.match(/setLoading\(false\)/g) || []).length;
      const hasFin = /finally\s*\{/.test(c);
      if (trues > 0 && falses === 0 && !hasFin) {
        leaks.push(`${f}: setLoading(true) x${trues} but never false`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe('SCAN 5 — API Route Gaps', () => {
  test('all frontend API calls have a matching backend route', () => {
    const beRoutes = getBeRoutes();
    const mounts   = getAppMounts();
    const missing  = [];
    for (const f of getScreens()) {
      const c = readScreen(f);
      for (const [, , fullPath] of c.matchAll(/api\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g)) {
        const pathOnly = fullPath.split('?')[0];           // strip query params
        const norm     = pathOnly.replace(/^\/api(?:\/v\d+)?/, '');
        const top      = '/' + norm.split('/').filter(Boolean)[0];
        const apiTop   = '/api' + top;
        const found    = beRoutes.has(top) || beRoutes.has(top.replace('-','_')) ||
                         mounts.has(apiTop) || mounts.has(apiTop.replace('-','_'));
        if (!found) missing.push(`${f}: ${fullPath}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('SCAN 6 — Unregistered Screens', () => {
  test('all screen files are referenced in AppNavigator or used as modals', () => {
    const orphans = [];
    for (const f of getScreens()) {
      const name = f.replace('.tsx', '');
      if (!NAV.includes(name)) {
        // Check if it's used in another screen (modal overlay pattern)
        const usedElsewhere = getScreens().some(other =>
          other !== f && readScreen(other).includes(name)
        );
        if (!usedElsewhere) orphans.push(f);
      }
    }
    expect(orphans).toEqual([]);
  });
});

describe('SCAN 7 — Tab Bar Completeness', () => {
  test('every tab component is a real screen or inline navigator', () => {
    const issues = [];
    for (const [, tabName, component] of NAV.matchAll(/<Tab\.Screen[^>]+name=['"](\w+)['"][^>]+component=\{(\w+)\}/gs)) {
      const inScreenDir = getScreens().some(f => f.replace('.tsx','') === component);
      const inNav       = NAV.includes(`function ${component}`);
      if (!inScreenDir && !inNav) {
        issues.push(`Tab '${tabName}': ${component} not found`);
      }
    }
    expect(issues).toEqual([]);
  });
});

describe('SCAN 8 — Empty Returns', () => {
  test('no screens have bare <View></View> as their only return', () => {
    const empty = [];
    for (const f of getScreens()) {
      const c = readScreen(f);
      if (/return\s*\(\s*<View\s*(?:style=\{[^}]+\})?>\s*<\/View>\s*\)/.test(c)) {
        empty.push(f);
      }
    }
    expect(empty).toEqual([]);
  });
});

describe('SCAN 9 — Missing Imports', () => {
  test('all local imports resolve to existing files', () => {
    const missing = [];
    for (const f of getScreens()) {
      const fp = path.join(SCREENS, f);
      const c  = readScreen(f);
      for (const [, imp] of c.matchAll(/from '(\.[^']+)'/g)) {
        const base = path.resolve(path.dirname(fp), imp);
        const ok   = [base, base+'.ts', base+'.tsx', base+'.js',
                      base+'/index.ts', base+'/index.tsx', base+'/index.js']
                      .some(p => existsSync(p));
        if (!ok) missing.push(`${f} → ${imp}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('SCAN 10 — Console Logs in Production', () => {
  test('no unguarded console.log/warn/debug in screens', () => {
    const found = [];
    for (const f of getScreens()) {
      const lines = readScreen(f).split('\n');
      lines.forEach((line, i) => {
        if (!/console\.(log|warn|debug)\b/.test(line)) return;
        const ctx = lines.slice(Math.max(0,i-2), i+1).join('\n');
        if (/__DEV__/.test(ctx)) return;           // guarded — OK
        if (/catch/.test(ctx) && /error/.test(line.toLowerCase())) return; // error catches — OK
        found.push(`${f}:L${i+1}: ${line.trim().slice(0,60)}`);
      });
    }
    expect(found).toEqual([]);
  });
});

describe('SCAN 11 — Hardcoded Test Data', () => {
  test('no hardcoded test emails, passwords, or Lorem ipsum in rendered content', () => {
    const bad = [];
    const pats = [/test@test\.com/, /password123/, /lorem ipsum/i, /abc123/];
    for (const f of getScreens()) {
      let c = readScreen(f);
      c = c.replace(/placeholder=["'][^"']*["']/g, '');
      c = c.replace(/\/\/[^\n]*/g, '');
      for (const p of pats) {
        if (p.test(c)) bad.push(`${f}: ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('SCAN 12 — Alert() Stubs', () => {
  test('no Alert() calls with stub/placeholder content', () => {
    const stubs = [];
    const re = /Alert\.alert\s*\([^)]*(?:TODO|Coming soon|Not implemented|stub|placeholder)[^)]*\)/gi;
    for (const f of getScreens()) {
      const hits = readScreen(f).match(re) || [];
      hits.forEach(h => stubs.push(`${f}: ${h.slice(0,60)}`));
    }
    expect(stubs).toEqual([]);
  });
});
