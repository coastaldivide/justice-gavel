/**
 * final_pass_fixes.test.js
 *   - /health DB probe cache (utils/healthCheck.js)
 *   - court dates keep their calendar day (cases.safeCourtDate, DATE type parser)
 *   - migration 00000000000009_constraints.sql (static checks; plus a real
 *     Postgres round trip when TEST_DATABASE_URL points at a scratch database
 *     with migrations 00..09 applied — skipped otherwise)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDbHealthCheck } from '../utils/healthCheck.js';
import { safeCourtDate } from '../routes/cases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const MIG09 = path.join(REPO, 'supabase/migrations/00000000000009_constraints.sql');

// ── /health cache ──────────────────────────────────────────────────────────
describe('createDbHealthCheck', () => {
  const fakeDb = (impl) => {
    const db = { calls: 0, get: async () => { db.calls++; return impl(); } };
    return db;
  };

  it('runs at most one DB probe per TTL, however many requests arrive', async () => {
    const db = fakeDb(() => ({ ok: 1 }));
    const check = createDbHealthCheck(async () => db, { ttlMs: 60_000 });
    const results = await Promise.all(Array.from({ length: 50 }, () => check()));
    for (let i = 0; i < 20; i++) results.push(await check());
    expect(db.calls).toBe(1);
    expect(results.every(r => r.ok)).toBe(true);
    expect(results.filter(r => r.cached).length).toBeGreaterThan(0);
  });

  it('re-probes after the TTL', async () => {
    const db = fakeDb(() => ({ ok: 1 }));
    const check = createDbHealthCheck(async () => db, { ttlMs: 20 });
    await check();
    await new Promise(r => setTimeout(r, 30));
    await check();
    expect(db.calls).toBe(2);
  });

  it('reports the DB down (ok:false) and caches the failure too', async () => {
    const db = fakeDb(() => { throw new Error('ECONNREFUSED'); });
    const errors = [];
    const check = createDbHealthCheck(async () => db, { ttlMs: 60_000, onError: e => errors.push(e.message) });
    expect((await check()).ok).toBe(false);
    expect((await check()).ok).toBe(false);
    expect(db.calls).toBe(1);
    expect(errors).toEqual(['ECONNREFUSED']);
  });

  it('a hung DB counts as down after the timeout', async () => {
    const db = { get: () => new Promise(() => {}) };
    const check = createDbHealthCheck(async () => db, { ttlMs: 0, timeoutMs: 20 });
    expect((await check()).ok).toBe(false);
  });

  it('recovers once the DB is back and the TTL has passed', async () => {
    let up = false;
    const db = fakeDb(() => { if (!up) throw new Error('down'); return { ok: 1 }; });
    const check = createDbHealthCheck(async () => db, { ttlMs: 10 });
    expect((await check()).ok).toBe(false);
    up = true;
    await new Promise(r => setTimeout(r, 15));
    expect((await check()).ok).toBe(true);
  });

  it('app.js uses it for /health and /api/health', () => {
    const src = fs.readFileSync(path.join(REPO, 'backend/src/app.js'), 'utf8');
    expect(src).toMatch(/createDbHealthCheck\(getDb/);
    expect(src).toMatch(/await checkDbHealth\(\)/);
  });
});

// ── court dates ────────────────────────────────────────────────────────────
describe('court dates keep their calendar day', () => {
  it.each([
    ['2026-11-20', '2026-11-20'],
    ['2026-11-20T00:00:00.000Z', '2026-11-20'],
    ['2026-11-20T21:30:00-08:00', '2026-11-20'],   // evening in California: still the 20th
    ['2026-11-20 09:00', '2026-11-20'],
  ])('safeCourtDate(%s) → %s', (input, out) => expect(safeCourtDate(input)).toBe(out));

  it.each(['', null, 'tomorrow', '11/20/2026', '2026-02-30', '2026-13-01'])('rejects %p', (v) => {
    expect(safeCourtDate(v)).toBeNull();
  });

  it('the Postgres adapter returns DATE columns as plain YYYY-MM-DD strings', () => {
    const src = fs.readFileSync(path.join(REPO, 'backend/src/db/index.js'), 'utf8');
    expect(src).toMatch(/setTypeParser\(1082,\s*v\s*=>\s*v\)/);
  });
});

// ── migration 09 ───────────────────────────────────────────────────────────
describe('migration 00000000000009_constraints.sql', () => {
  const sql = fs.readFileSync(MIG09, 'utf8');

  it('restores the three unique indexes, guarded by a duplicate check that only warns', () => {
    expect(sql).toMatch(/'firm_members',\s*'uq_firm_members_firm_user',\s*'firm_id, user_id'/);
    expect(sql).toMatch(/'integration_connections',\s*'uq_integration_connections_firm_provider',\s*'firm_id, provider'/);
    expect(sql).toMatch(/'vertical_deadline_presets',\s*'uq_vertical_deadline_presets_rule',\s*'vertical, rule_key'/);
    expect(sql).toMatch(/HAVING count\(\*\) > 1/);
    expect(sql).toMatch(/RAISE WARNING/);
    expect(sql).not.toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/to_regclass\('public\.' \|\| spec\.idx\) IS NOT NULL/);   // idempotent
  });

  it('sets can_edit back to the deny default', () => {
    expect(sql).toMatch(/ALTER COLUMN can_edit SET DEFAULT 0/);
    expect(sql).toMatch(/'matter_team_members', 'matter_teams'/);
  });

  it('converts the date-only court date columns to DATE only while they are still timestamps', () => {
    expect(sql).toMatch(/\('cases',\s*'next_court_date'\)/);
    expect(sql).toMatch(/data_type IN \('timestamp with time zone'/);
    expect(sql).toMatch(/TYPE date USING/);
  });

  it('never touches lawyers / bail_agents and never deletes rows', () => {
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(lawyers|bail_agents)\b/);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });

  it('enables RLS on the new message_attachments table (08 requires RLS everywhere)', () => {
    expect(sql).toMatch(/ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY/);
  });
});

const PG_URL = process.env.TEST_DATABASE_URL;
(PG_URL ? describe : describe.skip)('against Postgres (TEST_DATABASE_URL)', () => {
  let pool;
  beforeAll(async () => {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(1082, v => v);
    pool = new pg.Pool({ connectionString: PG_URL, max: 2 });
  });
  afterAll(async () => { await pool?.end(); });

  it('migration 09 is idempotent (re-applying succeeds)', async () => {
    await pool.query(fs.readFileSync(MIG09, 'utf8'));
    await pool.query(fs.readFileSync(MIG09, 'utf8'));
  });

  it('unique indexes exist and match the code\'s conflict handling', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE indexname IN
        ('uq_firm_members_firm_user','uq_integration_connections_firm_provider','uq_vertical_deadline_presets_rule')`);
    expect(rows).toHaveLength(3);
  });

  it('a date-only court date round-trips as the same day in any session time zone', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(`INSERT INTO users (email) VALUES ('tz-${Date.now()}@example.test') RETURNING id`);
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
        await c.query(`SET LOCAL TIME ZONE '${tz}'`);
        const r = await c.query(
          `INSERT INTO cases (user_id, title, next_court_date) VALUES ($1, 'tz', $2) RETURNING next_court_date`,
          [u.rows[0].id, '2026-11-20']);
        expect(r.rows[0].next_court_date).toBe('2026-11-20');
      }
      const d = await c.query(`SELECT column_default FROM information_schema.columns
                                WHERE table_name='matter_team_members' AND column_name='can_edit'`);
      expect(d.rows[0].column_default).toBe('0');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
