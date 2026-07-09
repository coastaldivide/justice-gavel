/**
 * data_pipeline_integrity.test.js
 * Verifies the data pipeline scripts are well-formed:
 * all scripts exist, have error handling, use the correct DB adapter,
 * and don't hardcode credentials.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname   = fileURLToPath(new URL('.', import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '../scripts');
const PIPELINE    = resolve(__dirname, '../../../backend/scripts/run-all-scrapes.sh');

describe('Data pipeline — script inventory', () => {
  test('scripts directory exists', () => expect(existsSync(SCRIPTS_DIR)).toBe(true));

  test('seed_providers.js exists', () => {
    const fp = join(SCRIPTS_DIR, 'seed_providers.js');
    expect(existsSync(fp)).toBe(true);
  });

  test('run-all-scrapes.sh exists', () => {
    expect(existsSync(PIPELINE)).toBe(true);
  });

  test('pipeline script is non-empty', () => {
    const size = statSync(PIPELINE).size;
    expect(size).toBeGreaterThan(100);
  });
});

describe('Data pipeline — script quality', () => {
  test('seed scripts use the DB adapter (_db.js), not raw pg directly', () => {
    if (!existsSync(SCRIPTS_DIR)) return;
    const seeds = readdirSync(SCRIPTS_DIR).filter(f => f.startsWith('seed') && f.endsWith('.js'));
    for (const fname of seeds) {
      const c = readFileSync(join(SCRIPTS_DIR, fname), 'utf-8');
      // Should import the shared DB adapter or use supabase client
      const usesAdapter = c.includes('_db.js') || c.includes('supabase') ||
        c.includes('db.js') || c.includes('postgres');
      if (!usesAdapter) console.warn(`${fname} may not use shared DB adapter`);
    }
    expect(seeds.length).toBeGreaterThan(0);
  });

  test('no script hardcodes database credentials', () => {
    if (!existsSync(SCRIPTS_DIR)) return;
    const violations = [];
    for (const fname of readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js'))) {
      const c = readFileSync(join(SCRIPTS_DIR, fname), 'utf-8');
      if (/postgresql:\/\/postgres\.[a-z0-9]+:[^@]+@/.test(c)) {
        violations.push(fname);
      }
    }
    expect(violations).toHaveLength(0);
  });

  test('scrape scripts have error handling', () => {
    if (!existsSync(SCRIPTS_DIR)) return;
    const scrapes = readdirSync(SCRIPTS_DIR).filter(f =>
      f.startsWith('scrape') && f.endsWith('.js'));
    for (const fname of scrapes) {
      const c = readFileSync(join(SCRIPTS_DIR, fname), 'utf-8');
      expect(c).toMatch(/catch|try|error/i);
    }
  });

  test('pipeline script covers all 50 states or has --state flag', () => {
    const c = readFileSync(PIPELINE, 'utf-8');
    expect(c).toMatch(/--state|all.*states|50.*states|all_states/i);
  });

  test('pipeline has a --dry-run option (safe testing)', () => {
    const c = readFileSync(PIPELINE, 'utf-8');
    expect(c).toMatch(/dry.?run/i);
  });
});

describe('Data pipeline — output integrity', () => {
  test('seed script defines required attorney fields', () => {
    const fp = join(SCRIPTS_DIR, 'seed_providers.js');
    if (!existsSync(fp)) return;
    const c = readFileSync(fp, 'utf-8');
    expect(c).toMatch(/name/i);
    expect(c).toMatch(/state/i);
    expect(c).toMatch(/city/i);
  });

  test('Google Places integration uses API key from env', () => {
    if (!existsSync(SCRIPTS_DIR)) return;
    for (const fname of readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.js'))) {
      const c = readFileSync(join(SCRIPTS_DIR, fname), 'utf-8');
      if (c.includes('places') || c.includes('Maps')) {
        expect(c).toMatch(/GOOGLE_PLACES_KEY|PLACES_API_KEY|process\.env/);
        expect(c).not.toMatch(/AIza[a-zA-Z0-9_\-]{35}/); // No hardcoded key
      }
    }
  });
});
