/**
 * audit11 L1 — no personal mailbox addresses hard-coded in shipped code.
 * SEV alerts used to default to two personal Gmail addresses; recipients now
 * come only from ONCALL_EMAIL / ONCALL_EMAIL_2 / ALERT_EMAIL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PERSONAL = /[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud|aol|proton(mail)?)\.(com|me)/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '__tests__', 'dist', '.expo'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs|ts|tsx|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('L1 — no personal email addresses in shipped code', () => {
  it('backend/src, frontend/src and frontend/App.tsx contain none', () => {
    const files = [...walk(path.join(REPO, 'backend/src')), ...walk(path.join(REPO, 'frontend/src')), path.join(REPO, 'frontend/App.tsx')];
    const hits = files.filter(f => PERSONAL.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(REPO, f));
    expect(hits).toEqual([]);
  });

  it('alert recipients come from the environment only', () => {
    const src = fs.readFileSync(path.join(REPO, 'backend/src/monitoring/errorNotifier.js'), 'utf8');
    expect(src).toContain('process.env.ONCALL_EMAIL');
  });
});
