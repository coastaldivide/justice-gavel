/**
 * backup_restore.int.test.js — checklist item 17: backups exist and a restore
 * has been tested. Runs the real scripts (backend/scripts/db-backup.sh and
 * db-restore.sh) against the migrated test database:
 *
 *   1. back up the live test DB → restore into a fresh database A
 *      (provider directory byte-identical, every migrated table present);
 *   2. back up A → restore into B with SOURCE_DATABASE_URL=A → the script's
 *      own verification (row counts + provider md5) passes;
 *   3. a tampered dump (checksum mismatch) and a non-empty target are refused.
 *
 * Skipped when pg_dump / pg_restore are not installed (CI's ubuntu image ships
 * PostgreSQL 16 client tools). Production backups themselves (Supabase daily
 * backups / PITR, and scheduling this script off-platform) are an owner action.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pg from 'pg';

const PG_URL = process.env.TEST_DATABASE_URL || '';
const hasTools = ['pg_dump', 'pg_restore', 'psql'].every(t => spawnSync('sh', ['-c', `command -v ${t}`]).status === 0);
const run = PG_URL && hasTools ? describe : describe.skip;
const SCRIPTS = decodeURIComponent(new URL('../../../scripts/', import.meta.url).pathname);

const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

run('db-backup.sh / db-restore.sh (real Postgres)', () => {
  const tag = `jgbk${Date.now().toString(36)}`;
  const dbA = `${tag}_a`, dbB = `${tag}_b`;
  let admin, dir;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: withDb(PG_URL, 'postgres') });
    await admin.connect();
    for (const d of [dbA, dbB]) await admin.query(`CREATE DATABASE ${d}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-backup-'));
  }, 60_000);

  afterAll(async () => {
    for (const d of [dbA, dbB]) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const sh = (script, args, env) => spawnSync('bash', [path.join(SCRIPTS, script), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const md5 = (url) => execFileSync('psql', [url, '-Atc',
    "select md5(coalesce((select string_agg(t::text,'|' order by id) from lawyers t),'') || coalesce((select string_agg(t::text,'|' order by id) from bail_agents t),''))"], { encoding: 'utf8' }).trim();
  const tables = (url) => execFileSync('psql', [url, '-Atc', "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"], { encoding: 'utf8' }).trim();

  it('backs up the live DB and restores it into an empty database', () => {
    const b = sh('db-backup.sh', [path.join(dir, 'one')], { DATABASE_URL: PG_URL });
    expect(b.stderr).toBe('');
    expect(b.status).toBe(0);
    const dump = fs.readdirSync(path.join(dir, 'one')).find(f => f.endsWith('.dump'));
    expect(dump).toBeDefined();
    expect(fs.existsSync(path.join(dir, 'one', `${dump}.sha256`))).toBe(true);

    const r = sh('db-restore.sh', [path.join(dir, 'one', dump)], { TARGET_DATABASE_URL: withDb(PG_URL, dbA) });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('restore ok');
    expect(md5(withDb(PG_URL, dbA))).toBe(md5(PG_URL));
    expect(tables(withDb(PG_URL, dbA))).toBe(tables(PG_URL));
  }, 180_000);

  it('a second round trip verifies itself against the source (counts + provider md5)', () => {
    const src = withDb(PG_URL, dbA);
    expect(sh('db-backup.sh', [path.join(dir, 'two')], { DATABASE_URL: src }).status).toBe(0);
    const dump = fs.readdirSync(path.join(dir, 'two')).find(f => f.endsWith('.dump'));
    const r = sh('db-restore.sh', [path.join(dir, 'two', dump)], { TARGET_DATABASE_URL: withDb(PG_URL, dbB), SOURCE_DATABASE_URL: src });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('verified: row counts and provider checksums match the source');
  }, 180_000);

  it('refuses a tampered dump and a non-empty target', () => {
    const d = path.join(dir, 'two');
    const dump = fs.readdirSync(d).find(f => f.endsWith('.dump'));
    // non-empty target (B was just restored)
    const busy = sh('db-restore.sh', [path.join(d, dump)], { TARGET_DATABASE_URL: withDb(PG_URL, dbB) });
    expect(busy.status).toBe(4);
    // tampered
    fs.appendFileSync(path.join(d, dump), 'x');
    const bad = sh('db-restore.sh', [path.join(d, dump)], { TARGET_DATABASE_URL: withDb(PG_URL, dbB) });
    expect(bad.status).toBe(3);
  }, 60_000);
});
