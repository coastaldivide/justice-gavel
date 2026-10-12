/**
 * Operator importers / updaters on Postgres (step 12):
 *   - import_csv.js: a new provider is inserted, a provider already listed
 *     (matched by phone) only gets proposals; re-import is a no-op;
 *   - recovery agents (services/dataRefresh/recoveryRefresh.js): insert new,
 *     idempotent re-run, existing rows untouched;
 *   - update_legal_data.js: read-only by default, --dry-run writes nothing,
 *     an already-current value is not rewritten, a sourced change is written
 *     once and logged (scrape_runs + audit_log).
 * Pre-existing lawyers / bail_agents / recovery_agents rows stay byte-identical.
 * PG-gated (TEST_DATABASE_URL). No network.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describeIntegration, initSecuritySuite, PG_URL } from '../security/_world.js';
import { placesMock } from './_places_mock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../..');

const hash = async (db, table, maxId) => (await db.get(
  `SELECT COUNT(*)::int || ':' || md5(string_agg(t::text, '' ORDER BY id)) AS h FROM ${table} t WHERE id <= ?`, [maxId])).h;

function runScript(script, args, extraEnv = {}) {
  const env = { ...process.env, DATABASE_URL: PG_URL, NODE_ENV: 'test', LOG_LEVEL: 'error', ...extraEnv };
  return spawnSync(process.execPath, [path.join(BACKEND, 'src/scripts', script), ...args], { env, cwd: BACKEND, encoding: 'utf8', timeout: 60_000 });
}

describeIntegration('importers and legal-data updater write Postgres safely', () => {
  const ctx = initSecuritySuite();
  const tag = `JGTEST${Date.now().toString(36)}`;
  let tmp; let maxIds; let before; let existing; const runIds = [];

  beforeAll(async () => {
    if (!ctx.app) return;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-import-'));
    maxIds = {};
    before = {};
    for (const t of ['lawyers', 'bail_agents', 'recovery_agents']) {
      maxIds[t] = (await ctx.db.get(`SELECT MAX(id)::bigint AS m FROM ${t}`)).m;
      before[t] = await hash(ctx.db, t, maxIds[t]);
    }
    existing = await ctx.db.get(`SELECT * FROM lawyers WHERE phone LIKE '+1%' AND email IS NULL ORDER BY id LIMIT 1`);
    ctx.addCleanup(async (db) => {
      const like = `%${tag}%`;
      const l = (await db.all('SELECT id FROM lawyers WHERE source_id ILIKE ?', [like])).map(r => Number(r.id));
      const ra = (await db.all('SELECT id FROM recovery_agents WHERE source_id ILIKE ?', [like])).map(r => Number(r.id));
      const runs = (await db.all(`SELECT id FROM scrape_runs WHERE params::text ILIKE ? OR id = ANY(?::bigint[])`, [like, runIds])).map(r => Number(r.id));
      await db.run(`DELETE FROM provider_update_proposals WHERE run_id = ANY(?::bigint[]) OR (table_name = 'lawyers' AND record_id = ANY(?::bigint[])) OR (table_name = 'recovery_agents' AND record_id = ANY(?::bigint[]))`, [runs, l, ra]);
      await db.run('DELETE FROM lawyers WHERE source_id ILIKE ?', [like]);
      await db.run('DELETE FROM recovery_agents WHERE source_id ILIKE ?', [like]);
      await db.run(`DELETE FROM audit_log WHERE action = 'reference_data_update' AND details ILIKE ?`, [like]);
      await db.run('DELETE FROM scrape_runs WHERE id = ANY(?::bigint[])', [runs]);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  it('import_csv.js: inserts the new provider, stages a proposal for the listed one, re-import is a no-op', async () => {
    const file = path.join(tmp, `${tag}.csv`);
    fs.writeFileSync(file, [
      'name,phone,address,city,state,email,website',
      `${tag} Criminal Law,802-555-7401,"5 Elm St, Jgtestville, VT",Jgtestville,VT,office@${tag.toLowerCase()}.example,${tag.toLowerCase()}.example`,
      `"${existing.name}",${existing.phone},,${existing.city},${existing.state},intake@${tag.toLowerCase()}.example,`,
    ].join('\n'));
    const p1 = runScript('import_csv.js', ['--file', file, '--type', 'lawyers']);
    expect(p1.status).toBe(0);
    expect(p1.stdout).toMatch(/inserted 1 \| proposed 1 /);
    const row = await ctx.db.get('SELECT * FROM lawyers WHERE source_id ILIKE ?', [`csv_${tag.toLowerCase()}%`]);
    expect(row).toMatchObject({ name: `${tag} Criminal Law`, city: 'Jgtestville', state: 'VT', phone: '+18025557401', source: 'csv', active: 1 });
    const prop = await ctx.db.get(`SELECT * FROM provider_update_proposals WHERE table_name = 'lawyers' AND record_id = ? AND field = 'email'`, [existing.id]);
    expect(prop).toMatchObject({ old_value: null, new_value: `intake@${tag.toLowerCase()}.example`, status: 'pending', source: 'csv' });
    expect(await ctx.db.get('SELECT * FROM lawyers WHERE id = ?', [existing.id])).toEqual(existing);

    const p2 = runScript('import_csv.js', ['--file', file, '--type', 'lawyers']);
    expect(p2.status).toBe(0);
    expect(p2.stdout).toMatch(/inserted 0 \| proposed 0 \| unchanged 2 /);
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM lawyers WHERE source_id ILIKE ?', [`%${tag}%`])).n).toBe(1);
  });

  it('import scripts refuse to run without DATABASE_URL (no silent local SQLite / demo.db)', () => {
    const p = runScript('import_csv.js', ['--file', path.join(tmp, `${tag}.csv`)], { DATABASE_URL: '', POSTGRES_URL: '' });
    expect(p.status).toBe(1);
    expect(p.stderr).toMatch(/DATABASE_URL is not set/);
  });

  it('recovery agents: new agent inserted, re-run idempotent', async () => {
    const { runRecoveryAgentRefresh } = await import('../../services/dataRefresh/recoveryRefresh.js');
    const { createPlacesClient } = await import('../../services/dataRefresh/googlePlaces.js');
    const g = placesMock();
    g.add({ place_id: `${tag}_ra`, name: `${tag} Fugitive Recovery`, formatted_phone_number: '(802) 555-7501',
      formatted_address: '7 Oak St, Burlington, VT 05401, USA', opening_hours: { weekday_text: ['Monday: Open 24 hours'], periods: [{ open: { day: 0, time: '0000' } }] } },
    ['fugitive recovery agent burlington vt']);
    const placesClient = createPlacesClient({ key: 'test', fetchImpl: g.fetch, minIntervalMs: 0 });
    const cities = [{ city: 'Burlington', state: 'VT' }];
    const r1 = await runRecoveryAgentRefresh({ db: ctx.db, cities, trigger: 'test', placesClient });
    runIds.push(r1.runId);
    expect(r1.counts).toMatchObject({ inserted: 1, errors: 0 });
    const row = await ctx.db.get('SELECT * FROM recovery_agents WHERE source_id = ?', [`google_ra_${tag}_ra`]);
    expect(row).toMatchObject({ name: `${tag} Fugitive Recovery`, state: 'VT', phone: '+18025557501', available_24_7: 1, active: 1 });
    const r2 = await runRecoveryAgentRefresh({ db: ctx.db, cities, trigger: 'test', placesClient });
    runIds.push(r2.runId);
    expect(r2.counts).toMatchObject({ inserted: 0, proposed: 0, unchanged: 1 });
  });

  it('update_legal_data.js: read-only by default, dry run and same-value are no-ops, a sourced change is written once and logged', async () => {
    const vt = await ctx.db.get(`SELECT * FROM dui_laws WHERE state = 'VT'`);
    const show = runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT']);
    expect(show.status).toBe(0);
    expect(show.stdout).toMatch(/Read-only/);

    const src = `https://example.gov/${tag}`;
    const newVal = String(Number(vt.first_license_days || 0) + 1);
    const dry = runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT', '--set', `first_license_days=${newVal}`, '--source-url', src, '--verified-by', 'test', '--dry-run']);
    expect(dry.status).toBe(0);
    expect(await ctx.db.get(`SELECT * FROM dui_laws WHERE state = 'VT'`)).toEqual(vt);

    const same = runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT', '--set', `first_license_days=${vt.first_license_days}`, '--source-url', src, '--verified-by', 'test']);
    expect(same.status).toBe(0);
    expect(same.stdout).toMatch(/already current/);
    expect(await ctx.db.get(`SELECT * FROM dui_laws WHERE state = 'VT'`)).toEqual(vt);

    const noSource = runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT', '--set', `first_license_days=${newVal}`]);
    expect(noSource.status).toBe(1);

    try {
      const write = runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT', '--set', `first_license_days=${newVal}`, '--source-url', src, '--verified-by', 'test']);
      expect(write.status).toBe(0);
      const after = await ctx.db.get(`SELECT * FROM dui_laws WHERE state = 'VT'`);
      expect(after).toMatchObject({ first_license_days: Number(newVal), source_url: src, verified_by: 'test' });
      const audit = await ctx.db.get(`SELECT details FROM audit_log WHERE action = 'reference_data_update' AND details LIKE ? ORDER BY id DESC LIMIT 1`, [`%${tag}%`]);
      expect(JSON.parse(audit.details)).toMatchObject({ field: 'first_license_days', new_value: Number(newVal) });
      const again = runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT', '--set', `first_license_days=${newVal}`, '--source-url', src, '--verified-by', 'test']);
      expect(again.stdout).toMatch(/already current/);
      expect(runScript('update_legal_data.js', ['--type', 'dui', '--state', 'VT', '--set', 'id=5', '--source-url', src, '--verified-by', 'test']).status).toBe(1);
    } finally {
      // restore the reference row exactly
      await ctx.db.run(`UPDATE dui_laws SET first_license_days = ?, updated_at = ?, last_reviewed_at = ?, source_url = ?, verified_by = ? WHERE state = 'VT'`,
        [vt.first_license_days, vt.updated_at, vt.last_reviewed_at, vt.source_url, vt.verified_by]);
    }
    expect(await ctx.db.get(`SELECT * FROM dui_laws WHERE state = 'VT'`)).toEqual(vt);
  });

  it('pre-existing provider rows are byte-identical', async () => {
    for (const t of ['lawyers', 'bail_agents', 'recovery_agents']) {
      expect(await hash(ctx.db, t, maxIds[t])).toBe(before[t]);
    }
  });
});
