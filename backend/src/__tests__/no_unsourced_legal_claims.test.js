/**
 * no_unsourced_legal_claims.test.js — owner rule: never present unsourced or
 * possibly-wrong legal content as fact. Scans every user-visible source file
 * (app screens, components, services, translations; API routes and services)
 * for claims that were removed after the independent review:
 *   - a bail-agent premium / fee percentage ("10%", "~10%", "10–15%", "ten
 *     percent", a default rate in code) in a bail / bond context
 *   - the uncited public-defender timing claim ("… at your first appearance")
 * Comment lines are ignored (they document the removal).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const ROOTS = ['frontend/src', 'frontend/App.tsx', 'backend/src'];
const SKIP_DIR = /(__tests__|node_modules|\/scripts$|\/dist$)/;
const EXT = /\.(js|mjs|ts|tsx|json)$/;

function files(p) {
  const abs = join(REPO, p);
  const st = statSync(abs);
  if (st.isFile()) return EXT.test(abs) ? [abs] : [];
  if (SKIP_DIR.test(abs)) return [];
  return readdirSync(abs).flatMap(n => files(join(p, n)));
}
const isComment = (l) => /^\s*(\/\/|\*|\/\*|--)/.test(l);
const BAIL = /bail|bond|fianza|surety|premium|bondsman/i;
const PCT = /(~\s*)?\b1[05]\s?(–|-|to)?\s?(1[05])?\s?%|\bten per ?cent\b|\b10 percent\b|\*\s*0\.1[05]?\b|rate\s*=\s*0\.1[05]?\b|'0\.10'/i;

describe('no unsourced bail-fee or public-defender timing claims in user-visible code', () => {
  const all = ROOTS.flatMap(files);

  it('scans a real set of files', () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it('no bail-agent premium percentage anywhere', () => {
    const hits = [];
    for (const f of all) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (isComment(l) || !PCT.test(l)) return;
        const near = [lines[i - 1] || '', l, lines[i + 1] || ''].join(' ');
        if (BAIL.test(near)) hits.push(`${f.replace(REPO + '/', '')}:${i + 1}: ${l.trim().slice(0, 140)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('no "public defender at your first appearance" timing claim', () => {
    const hits = all.filter(f => /public defender at your first appearance/i.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the bail calculator returns no bondsman cost / rate', () => {
    const src = readFileSync(join(REPO, 'backend/src/routes/bail.js'), 'utf8');
    expect(src).not.toMatch(/bondsman_cost|bondsman_rate_pct|bondsman_min|premium_rate|BOND_RATE/);
  });
});
