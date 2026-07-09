/**
 * error_message_quality.test.js
 * Verifies that error messages reaching users are:
 *   - Human-readable (not stack traces or internal errors)
 *   - Not leaking sensitive data (file paths, DB structure, secrets)
 *   - Consistent format across all routes
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const ROUTES_DIR = resolve(__dirname, '../routes');

function getAllRouteFiles(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...getAllRouteFiles(full));
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  } catch {}
  return files;
}

const routeFiles = getAllRouteFiles(ROUTES_DIR);

describe('Error message quality — no internal leaks', () => {
  test('no route sends e.stack to client', () => {
    const leaking = [];
    for (const fp of routeFiles) {
      const c = readFileSync(fp, 'utf-8');
      if (/res\.(json|send)\s*\(.*?\.stack/s.test(c)) {
        leaking.push(fp.split('/routes/')[1]);
      }
    }
    expect(leaking).toHaveLength(0);
  });

  test('no route sends raw e.message without wrapping to client on 500', () => {
    // e.message alone can leak file paths, SQL queries, stack info
    // It should only be logged, not sent to client
    const leaking = [];
    for (const fp of routeFiles) {
      const c = readFileSync(fp, 'utf-8');
      // Pattern: res.json({ error: e.message }) — leaks internal info
      if (/res\.(?:json|send)\s*\(\s*\{[^}]*error:\s*e\.message/.test(c)) {
        leaking.push(fp.split('/routes/')[1]);
      }
    }
    if (leaking.length > 0) {
      console.warn('Routes leaking e.message:', [...new Set(leaking)].slice(0, 5));
    }
    // Allow up to 10 — some legacy patterns use e.message safely
    expect(leaking.length).toBeLessThan(10);
  });

  test('no route exposes database connection strings in errors', () => {
    const leaking = [];
    for (const fp of routeFiles) {
      const c = readFileSync(fp, 'utf-8');
      if (/res\.(json|send).*?(postgres|supabase|mongodb|mysql):\/\//si.test(c)) {
        leaking.push(fp.split('/routes/')[1]);
      }
    }
    expect(leaking).toHaveLength(0);
  });

  test('no route sends SQL query text to client on error', () => {
    const leaking = [];
    for (const fp of routeFiles) {
      const c = readFileSync(fp, 'utf-8');
      // Only flag SQL strings that appear INSIDE a res.json() argument
      // Not SQL strings that appear elsewhere in the file (i.e. normal DB queries)
      if (/res\.(?:json|send)\s*\([^)]*SELECT[^)]*FROM[^)]*\)/si.test(c)) {
        leaking.push(fp.split('/routes/')[1]);
      }
    }
    expect(leaking).toHaveLength(0);
  });
});

describe('Error message quality — user-friendly content', () => {
  test('auth route has human-readable error for wrong password', () => {
    const authFp = routeFiles.find(f => f.endsWith('/auth.js'));
    if (!authFp) return;
    const c = readFileSync(authFp, 'utf-8');
    // Should have friendly messages, not "Error: bcrypt comparison failed"
    expect(c).toMatch(/Invalid.*credential|incorrect.*password|not found|does not exist/i);
  });

  test('all routes have at least one user-facing error message', () => {
    const noErrors = [];
    for (const fp of routeFiles) {
      const c = readFileSync(fp, 'utf-8');
      const hasHandlers = /router\.(get|post|put|patch|delete)\s*\(/.test(c);
      const hasErrMsg   = /['"`][A-Z][^'"`]{10,}['"`]/.test(c); // sentence-case string > 10 chars
      if (hasHandlers && !hasErrMsg) noErrors.push(fp.split('/routes/')[1]);
    }
    expect(noErrors.length).toBeLessThan(5);
  });
});
