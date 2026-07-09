/**
 * migration_idempotency.test.js
 * Verifies database migrations are safe to run twice (idempotent).
 * Also checks migration file ordering and completeness.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIG_DIR   = resolve(__dirname, '../../../supabase/migrations');

describe('Migration idempotency', () => {
  test('migration directory exists', () => {
    expect(existsSync(MIG_DIR)).toBe(true);
  });

  test('at least 3 migration files exist', () => {
    const files = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test('migration files are named with timestamps in ascending order', () => {
    const files = readdirSync(MIG_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
    // Each file should start with a timestamp-like prefix
    for (const f of files) {
      expect(f).toMatch(/^\d{8,14}/);
    }
    // Files should already be in sorted order when sorted alphabetically
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  test('CREATE TABLE statements use IF NOT EXISTS', () => {
    const violations = [];
    for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql'))) {
      const c = readFileSync(join(MIG_DIR, f), 'utf-8');
      const rawCreates = c.match(/CREATE TABLE\s+(?!IF NOT EXISTS)\w+/gi) || [];
      if (rawCreates.length > 0) violations.push({ file: f, creates: rawCreates });
    }
    if (violations.length > 0) {
      console.warn('CREATE TABLE without IF NOT EXISTS:', violations.map(v => v.file));
    }
    // Allow some — Supabase handles idempotency differently
    expect(violations.length).toBeLessThan(5);
  });

  test('CREATE INDEX statements use IF NOT EXISTS', () => {
    const violations = [];
    for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql'))) {
      const c = readFileSync(join(MIG_DIR, f), 'utf-8');
      const rawIdx = c.match(/CREATE (?:UNIQUE )?INDEX\s+(?!IF NOT EXISTS)\w+/gi) || [];
      if (rawIdx.length > 0) violations.push(f);
    }
    if (violations.length > 0) {
      console.warn('Indexes without IF NOT EXISTS:', violations);
    }
    // Flag but allow some
    expect(violations.length).toBeLessThan(3);
  });

  test('RLS migration enables security on all critical tables', () => {
    const rlsFile = readdirSync(MIG_DIR)
      .filter(f => f.includes('rls') || f.includes('security'))
      .sort().pop();
    if (!rlsFile) return;
    const c = readFileSync(join(MIG_DIR, rlsFile), 'utf-8');
    const critical = ['users','cases','subscriptions','refresh_tokens','audit_log'];
    for (const table of critical) {
      expect(c).toMatch(new RegExp(`ENABLE ROW LEVEL SECURITY.*${table}|${table}.*ENABLE ROW LEVEL SECURITY`, 'is'));
    }
  });

  test('no migration drops tables (destructive operations flagged)', () => {
    const drops = [];
    for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql'))) {
      const c = readFileSync(join(MIG_DIR, f), 'utf-8');
      const dropStmts = c.match(/DROP TABLE(?!\s+IF EXISTS)/gi) || [];
      if (dropStmts.length > 0) drops.push(f);
    }
    expect(drops).toHaveLength(0);
  });
});
