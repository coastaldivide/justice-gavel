/**
 * errors_not_swallowed.test.js — checklist item 25.
 *
 * Best-effort side effects (a push after a saved message, an audit row, a
 * cache refresh) may fail without failing the request, but never silently:
 * they use utils/ignored.js logIgnored(where), which logs the failure. An empty
 * `.catch(() => {})` in routes / services / middleware fails this test
 * (121 of them were converted). Empty `catch {}` blocks must carry a comment
 * saying why (ESLint no-empty, enforced by `npm run lint`).
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { logIgnored } from '../utils/ignored.js';

const SRC = decodeURIComponent(new URL('../', import.meta.url).pathname);

test('no empty .catch(() => {}) in routes, services or middleware', () => {
  const bad = [];
  for (const d of ['routes', 'services', 'middleware']) {
    (function walk(dir) {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) {
          fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
            if (/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(l)) bad.push(`${path.relative(SRC, p)}:${i + 1}`);
          });
        }
      }
    })(path.join(SRC, d));
  }
  expect(bad).toEqual([]);
});

test('logIgnored logs where the best-effort step failed (scrubbed)', () => {
  const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    logIgnored('routes/messages')(new Error('push to jane@example.com failed'));
    const out = spy.mock.calls.flat().map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    expect(out).toContain('routes/messages');
    expect(out).toContain('***@example.com');
    expect(out).not.toContain('jane@');
  } finally { spy.mockRestore(); }
});
