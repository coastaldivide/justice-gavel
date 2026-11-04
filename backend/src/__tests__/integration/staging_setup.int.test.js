/**
 * staging_setup.int.test.js — scripts/staging-setup.sh + scripts/seed-staging.mjs against real
 * Postgres (docs/STAGING.md):
 *   - refuses without APP_ENV=staging, without an explicit --database-url, and against the
 *     production URL;
 *   - a run migrates (no-op here), passes check-env and seeds the demo consumer (case, 2 future
 *     court dates with reminders), Bond Desk agency (owner + 1 staff, 2 bonds, 1 indemnitor) and
 *     public-defender office (2 clients) with contact details from the allow-lists;
 *   - a second run adds nothing; --reset removes only demo rows (a non-demo account stays).
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import pg from 'pg';

const PG_URL = process.env.TEST_DATABASE_URL || '';
const hasPsql = spawnSync('sh', ['-c', 'command -v psql']).status === 0;
const run = PG_URL && hasPsql ? describe : describe.skip;
const BACKEND = decodeURIComponent(new URL('../../../', import.meta.url).pathname);
const SCRIPT = path.join(BACKEND, 'scripts/staging-setup.sh');

const ENV = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  NODE_ENV: 'production', APP_ENV: 'staging',
  JWT_SECRET: crypto.randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  ATTACHMENTS_STORAGE: 'local', ATTACHMENTS_DIR: '/tmp/att_staging_setup_test', APP_URL: 'https://staging.example.org',
  STAGING_ALLOWED_PHONES: '+16155550171,+16155550172', STAGING_ALLOWED_EMAILS: '@demo-staging.example.org',
  STAGING_TEST_KEY: 'k'.repeat(40), STAGING_DEMO_PASSWORD: 'Staging-Demo-Pass-1!',
};
const setup = (args, env = {}) => spawnSync('sh', [SCRIPT, ...args], { cwd: BACKEND, env: { ...ENV, ...env }, encoding: 'utf8', timeout: 180_000 });

const COUNTS = `SELECT
  (SELECT COUNT(*)::int FROM users WHERE email LIKE '%jg-staging-demo-%') AS users,
  (SELECT COUNT(*)::int FROM cases c JOIN users u ON u.id = c.user_id WHERE u.email LIKE '%jg-staging-demo-%') AS cases,
  (SELECT COUNT(*)::int FROM court_dates d JOIN cases c ON c.id = d.case_id JOIN users u ON u.id = c.user_id WHERE u.email LIKE '%jg-staging-demo-%' AND d.court_date > CURRENT_DATE) AS court_dates,
  (SELECT COUNT(*)::int FROM bd_bonds b JOIN users u ON u.id = b.agent_id WHERE u.email LIKE '%jg-staging-demo-%') AS bonds,
  (SELECT COUNT(*)::int FROM bd_indemnitors i JOIN bd_bonds b ON b.id = i.bond_id JOIN users u ON u.id = b.agent_id WHERE u.email LIKE '%jg-staging-demo-%') AS indemnitors,
  (SELECT COUNT(*)::int FROM pd_offices WHERE name LIKE '%(staging demo)') AS offices,
  (SELECT COUNT(*)::int FROM pd_clients p JOIN pd_offices o ON o.id = p.office_id WHERE o.name LIKE '%(staging demo)') AS pd_clients`;

run('staging-setup.sh + seed-staging.mjs (real Postgres)', () => {
  let pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URL, max: 2 });
    setup(['--database-url', PG_URL, '--reset']);          // start clean (only demo rows)
  }, 120_000);
  afterAll(async () => {
    setup(['--database-url', PG_URL, '--reset']);
    await pool.query(`DELETE FROM users WHERE email = 'not-demo-staging@example.org'`);
    await pool.end();
  }, 120_000);
  const counts = async () => (await pool.query(COUNTS)).rows[0];

  it('refuses without APP_ENV=staging, without --database-url, and against the production database', () => {
    expect(setup(['--database-url', PG_URL], { APP_ENV: 'production' })).toMatchObject({ status: 3 });
    expect(setup([]).status).toBe(3);
    const prod = setup(['--database-url', PG_URL], { PROD_DATABASE_URL: PG_URL });
    expect(prod.status).toBe(3);
    expect(prod.stderr).toMatch(/PRODUCTION database/);
  }, 30_000);

  it('seeds the demo data once; a second run adds nothing; --reset removes only demo rows', async () => {
    await pool.query(`INSERT INTO users (email, display_name, password_hash) VALUES ('not-demo-staging@example.org', 'Keep me', 'x') ON CONFLICT DO NOTHING`);
    const a = setup(['--database-url', PG_URL]);
    expect(a.stderr.split('\n').filter(l => /seed-staging failed|REFUSED|❌/.test(l))).toEqual([]);
    expect(a.status).toBe(0);
    expect(a.stdout).toMatch(/Environment OK/);
    expect(a.stdout).toMatch(/Staging guard: texts only to 2 allowed number/);
    expect(a.stdout).toMatch(/13 created, 0 already there/);
    expect(a.stdout).toMatch(/jg-staging-demo-consumer@demo-staging\.example\.org/);
    const first = await counts();
    expect(first).toEqual({ users: 4, cases: 1, court_dates: 2, bonds: 2, indemnitors: 1, offices: 1, pd_clients: 2 });
    // every demo phone / e-mail is on the allow-lists
    const phones = (await pool.query(`SELECT phone FROM users WHERE email LIKE '%jg-staging-demo-%' AND phone IS NOT NULL
      UNION ALL SELECT p.phone FROM pd_clients p JOIN pd_offices o ON o.id = p.office_id WHERE o.name LIKE '%(staging demo)'`)).rows.map(r => r.phone);
    expect(phones.length).toBeGreaterThan(0);
    for (const p of phones) expect(ENV.STAGING_ALLOWED_PHONES.split(',')).toContain(p);
    const reminders = await pool.query(`SELECT COUNT(*)::int AS n FROM scheduled_pushes s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%jg-staging-demo-consumer%'`);
    expect(reminders.rows[0].n).toBeGreaterThanOrEqual(6);    // 7d/3d/1d/morning-of per date (past steps skipped)
    const staff = await pool.query(`SELECT COUNT(*)::int AS n FROM bd_staff s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%jg-staging-demo-staff%'`);
    expect(staff.rows[0].n).toBe(1);

    const b = setup(['--database-url', PG_URL]);
    expect(b.status).toBe(0);
    expect(b.stdout).toMatch(/0 created, 13 already there/);
    expect(await counts()).toEqual(first);

    const r = setup(['--database-url', PG_URL, '--reset']);
    expect(r.status).toBe(0);
    expect(await counts()).toEqual({ users: 0, cases: 0, court_dates: 0, bonds: 0, indemnitors: 0, offices: 0, pd_clients: 0 });
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'not-demo-staging@example.org'`)).rows[0].n).toBe(1);
  }, 400_000);
});
