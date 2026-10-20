/**
 * migrate_runner.int.test.js — backend/scripts/migrate.sh, the Render
 * preDeployCommand, against real Postgres (scratch databases created and
 * dropped here; the shared test database is never touched).
 *
 *   1. fresh database: every supabase/migrations file applied once, in order,
 *      and recorded in jg_meta.schema_migrations; a second run applies nothing;
 *   2. an existing database without a ledger (applied by hand with psql, as
 *      before Render) is brought up to date by one idempotent replay;
 *   3. a failing migration exits non-zero, is not recorded, and nothing after
 *      it runs; a recorded file that changed is reported, never re-run;
 *   4. --baseline records files without running them; --status changes nothing.
 *
 * Runs with `sh` (dash on Ubuntu CI, like busybox ash in the Alpine image).
 */
import { spawnSync, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pg from 'pg';

const PG_URL = process.env.TEST_DATABASE_URL || '';
const hasPsql = spawnSync('sh', ['-c', 'command -v psql']).status === 0;
const run = PG_URL && hasPsql ? describe : describe.skip;
const BACKEND = decodeURIComponent(new URL('../../../', import.meta.url).pathname);
const SCRIPT = path.join(BACKEND, 'scripts/migrate.sh');
const MIGRATIONS = path.resolve(BACKEND, '../supabase/migrations');
const FILES = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();

const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

run('migrate.sh (Render pre-deploy migrations)', () => {
  const tag = `jgmig${Date.now().toString(36)}`;
  const dbs = { fresh: `${tag}_fresh`, legacy: `${tag}_legacy`, fail: `${tag}_fail` };
  let admin, tmp;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: withDb(PG_URL, 'postgres') });
    await admin.connect();
    for (const d of Object.values(dbs)) await admin.query(`CREATE DATABASE ${d}`);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-migrate-'));
  }, 60_000);

  afterAll(async () => {
    for (const d of Object.values(dbs)) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
    await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 60_000);   // dropping the scratch databases can take a few seconds on a loaded machine

  const migrate = (db, args = [], env = {}) => spawnSync('sh', [SCRIPT, ...args], {
    env: { ...process.env, DATABASE_URL: withDb(PG_URL, db), MIGRATIONS_DATABASE_URL: '', MIGRATIONS_DIR: '', ...env },
    encoding: 'utf8',
  });
  const q = (db, sql) => execFileSync('psql', [withDb(PG_URL, db), '-XAtc', sql], { encoding: 'utf8' }).trim();

  it('fresh database: applies every file once, in order, then nothing', () => {
    const a = migrate(dbs.fresh);
    expect(a.stderr).toBe('');
    expect(a.status).toBe(0);
    expect(a.stdout).toContain(`done: ${FILES.length} applied, 0 already applied`);
    const order = a.stdout.split('\n').filter(l => l.startsWith('[migrate] apply ')).map(l => l.slice(16));
    expect(order).toEqual(FILES);
    expect(q(dbs.fresh, 'select count(*) from jg_meta.schema_migrations')).toBe(String(FILES.length));
    expect(Number(q(dbs.fresh, "select count(*) from information_schema.tables where table_schema='public'"))).toBeGreaterThan(100);
    expect(q(dbs.fresh, "select relrowsecurity from pg_class where oid = 'jg_meta.schema_migrations'::regclass")).toBe('t');

    const b = migrate(dbs.fresh);
    expect(b.status).toBe(0);
    expect(b.stdout).toContain(`done: 0 applied, ${FILES.length} already applied`);
    expect(b.stdout).not.toContain('[migrate] apply');
  }, 180_000);

  it('existing database applied by hand (no ledger): one idempotent replay, then nothing', () => {
    for (const f of FILES) {
      execFileSync('psql', [withDb(PG_URL, dbs.legacy), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(MIGRATIONS, f)],
        { env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' }, stdio: ['ignore', 'ignore', 'pipe'] });
    }
    const before = q(dbs.legacy, "select count(*) from information_schema.columns where table_schema='public'");
    const a = migrate(dbs.legacy);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain(`done: ${FILES.length} applied`);
    expect(q(dbs.legacy, "select count(*) from information_schema.columns where table_schema='public'")).toBe(before);
    expect(migrate(dbs.legacy).stdout).toContain(`done: 0 applied, ${FILES.length} already applied`);
  }, 240_000);

  it('a failing migration stops the run (non-zero, not recorded, later files not run)', () => {
    const dir = path.join(tmp, 'fail');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE t_ok (id int);');
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE t_bad (id int);\nSELECT * FROM no_such_table;');
    fs.writeFileSync(path.join(dir, '003_after.sql'), 'CREATE TABLE t_after (id int);');
    const r = migrate(dbs.fail, [], { MIGRATIONS_DIR: dir });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no_such_table/);
    expect(q(dbs.fail, 'select string_agg(filename, \',\' order by filename) from jg_meta.schema_migrations')).toBe('001_ok.sql');
    expect(q(dbs.fail, "select to_regclass('public.t_after') is null")).toBe('t');

    // fixed file → the next deploy applies it and the rest
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE IF NOT EXISTS t_bad (id int);');
    const ok = migrate(dbs.fail, [], { MIGRATIONS_DIR: dir });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('done: 2 applied, 1 already applied');

    // an applied file that changes is reported, not re-run
    fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE t_ok (id int, extra int);');
    const changed = migrate(dbs.fail, [], { MIGRATIONS_DIR: dir });
    expect(changed.status).toBe(0);
    expect(changed.stderr).toContain('WARNING 001_ok.sql changed since it was applied (not re-run)');
    expect(q(dbs.fail, "select count(*) from information_schema.columns where table_name='t_ok'")).toBe('1');
  }, 60_000);

  it('--baseline records without running; --status lists and changes nothing', () => {
    const dir = path.join(tmp, 'base');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE b_a (id int);');
    fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE b_b (id int);');
    fs.writeFileSync(path.join(dir, '003_c.sql'), 'CREATE TABLE b_c (id int);');
    const db = dbs.fail;
    const st = migrate(db, ['--status'], { MIGRATIONS_DIR: dir });
    expect(st.status).toBe(0);
    expect(st.stdout.trim().split('\n')).toEqual(['pending  001_a.sql', 'pending  002_b.sql', 'pending  003_c.sql']);

    const r = migrate(db, ['--baseline', '002_b.sql'], { MIGRATIONS_DIR: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('done: 1 applied, 2 already applied');
    expect(q(db, "select to_regclass('public.b_a') is null and to_regclass('public.b_b') is null and to_regclass('public.b_c') is not null")).toBe('t');
    expect(q(db, "select string_agg(filename || ':' || mode, ',' order by filename) from jg_meta.schema_migrations where filename in ('001_a.sql','002_b.sql','003_c.sql')"))
      .toBe('001_a.sql:baseline,002_b.sql:baseline,003_c.sql:applied');

    expect(migrate(db, ['--baseline', 'nope.sql'], { MIGRATIONS_DIR: dir }).status).toBe(2);
    expect(migrate(db, [], { DATABASE_URL: '', MIGRATIONS_DIR: dir }).status).toBe(2);
  }, 60_000);
});
