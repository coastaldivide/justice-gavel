/**
 * Data refresh on Postgres (step 12) — scrapers write the main database through
 * services/dataRefresh, under the owner rule:
 *   - a provider not in the table is INSERTED (source / source_id / timestamps);
 *   - a difference for an EXISTING row is STAGED in provider_update_proposals,
 *     never written to the row; rows a scrape does not return are untouched;
 *   - re-running inserts nothing twice and proposes nothing twice;
 *   - only an admin (live DB role + X-Admin-Key) can apply / reject a proposal,
 *     and applying writes exactly one field and logs it;
 *   - with no GOOGLE_PLACES_KEY a run is a clean, logged skip.
 * The pre-existing lawyers / bail_agents rows are hashed before and after the
 * mocked scrapes and must be byte-identical.
 *
 * Google is never called: the Places HTTP layer is an in-memory mock.
 * PG-gated (TEST_DATABASE_URL), like the integration / security suites.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describeIntegration, initSecuritySuite, PG_URL } from '../security/_world.js';
import { placesMock, detailFromRow } from './_places_mock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../..');
const ADMIN_KEY = 'test-admin-key-refresh-0123456789';
const CITY = 'Jgtestville';
const ST = 'VT';

async function tableHash(db, table, maxId) {
  const r = await db.get(
    `SELECT COUNT(*)::int AS n, md5(string_agg(t::text, '' ORDER BY id)) AS h FROM ${table} t WHERE id <= ?`, [maxId]);
  return `${r.n}:${r.h}`;
}

describeIntegration('Data refresh → Postgres: insert new, stage changes, never overwrite', () => {
  const ctx = initSecuritySuite();
  const tag = `JGTEST_${Date.now().toString(36)}`;
  const g = placesMock();
  let refresh, admin, plain, before, maxIds, lawyer, bail, invalidateUserCache;
  const runIds = [];
  const savedEnv = {};

  const pid = (s) => `${tag}_${s}`;
  const run = async (extra = {}) => {
    const r = await refresh.runProviderRefresh({
      db: ctx.db, cities: [{ city: CITY, state: ST }, { city: lawyer.city, state: lawyer.state }, { city: bail.city, state: bail.state }],
      types: ['lawyers', 'bail'], sources: ['google'], trigger: 'test', fetchImpl: g.fetch, ...extra,
    });
    if (r.runId) runIds.push(r.runId);
    return r;
  };
  const adminReq = (who, method, url) => ctx.request()[method](url).set(who.headers).set('X-Admin-Key', ADMIN_KEY);
  const testRow = (sid) => ctx.db.get(`SELECT * FROM lawyers WHERE source_id = ?`, [`google_${pid(sid)}`]);

  beforeAll(async () => {
    if (!ctx.app) return;
    for (const k of ['GOOGLE_PLACES_KEY', 'YELP_API_KEY', 'GOOGLE_PLACES_MIN_INTERVAL_MS', 'ADMIN_KEY']) savedEnv[k] = process.env[k];
    process.env.GOOGLE_PLACES_KEY = 'test-places-key';
    process.env.GOOGLE_PLACES_MIN_INTERVAL_MS = '0';
    delete process.env.YELP_API_KEY;
    process.env.ADMIN_KEY = ADMIN_KEY;
    refresh = await import('../../services/dataRefresh/providerRefresh.js');
    ({ invalidateUserCache } = await import('../../middleware/auth.js'));

    maxIds = {
      lawyers: (await ctx.db.get('SELECT MAX(id)::bigint AS m FROM lawyers')).m,
      bail_agents: (await ctx.db.get('SELECT MAX(id)::bigint AS m FROM bail_agents')).m,
    };
    before = {
      lawyers: await tableHash(ctx.db, 'lawyers', maxIds.lawyers),
      bail_agents: await tableHash(ctx.db, 'bail_agents', maxIds.bail_agents),
    };
    lawyer = await ctx.db.get(`SELECT * FROM lawyers WHERE source_id LIKE 'google_%' AND phone IS NOT NULL
                                 AND address IS NOT NULL AND lat IS NOT NULL ORDER BY id LIMIT 1`);
    bail = await ctx.db.get(`SELECT * FROM bail_agents WHERE source_id LIKE 'google_%' AND phone LIKE '+1%'
                               AND hours IS NOT NULL ORDER BY id LIMIT 1`);

    admin = await ctx.persona('RefreshAdmin');
    plain = await ctx.persona('RefreshPlain');
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);

    // ── the mocked Google world ────────────────────────────────────────────
    g.add({ place_id: pid('new1'), name: `Jgtest Defense Group ${tag}`, formatted_address: `1 Main St, ${CITY}, ${ST} 05401, USA`,
      formatted_phone_number: '(802) 555-7101', website: 'https://jgtest-defense.example/', rating: 4.7, user_ratings_total: 12,
      geometry: { location: { lat: 44.47, lng: -73.21 } }, opening_hours: { weekday_text: ['Monday: 9 AM – 5 PM'] } },
    [`criminal defense lawyer ${CITY} ${ST}`]);
    g.add({ place_id: pid('new2'), name: `Jgtest Bail Bonds ${tag}`, formatted_address: `2 Main St, ${CITY}, ${ST} 05401, USA`,
      formatted_phone_number: '(802) 555-7102', rating: 4.1, user_ratings_total: 3 },
    [`bail bonds ${CITY} ${ST}`]);
    // an EXISTING verified lawyer, same Google place, new phone number
    g.add(detailFromRow(lawyer, { formatted_phone_number: '(802) 555-7199' }), [`criminal defense lawyer ${lawyer.city} ${lawyer.state}`]);
    // an EXISTING bail agent under a different place id, matched by phone, new hours
    g.add(detailFromRow(bail, { place_id: pid('bailphone'), opening_hours: { weekday_text: ['Monday: Open 24 hours', `Tuesday: closed ${tag}`] } }),
      [`bail bonds ${bail.city} ${bail.state}`]);

    ctx.addCleanup(async (db) => {
      const mine = `%${tag}%`;
      const ids = async (t) => (await db.all(`SELECT id FROM ${t} WHERE source_id LIKE ?`, [mine])).map(r => Number(r.id));
      const l = await ids('lawyers'); const b = await ids('bail_agents');
      await db.run(`DELETE FROM provider_update_proposals WHERE run_id = ANY(?::bigint[])
                      OR (table_name = 'lawyers' AND record_id = ANY(?::bigint[]))
                      OR (table_name = 'bail_agents' AND record_id = ANY(?::bigint[]))`, [runIds, l, b]);
      await db.run(`DELETE FROM provider_update_log WHERE (table_name = 'lawyers' AND record_id = ANY(?::bigint[]))`, [l]);
      await db.run(`DELETE FROM audit_log WHERE entity_type = 'provider_update_proposal' AND user_id = ?`, [admin?.id ?? -1]);
      await db.run(`DELETE FROM lawyers WHERE source_id LIKE ?`, [mine]);
      await db.run(`DELETE FROM bail_agents WHERE source_id LIKE ?`, [mine]);
      await db.run(`DELETE FROM scrape_runs WHERE id = ANY(?::bigint[])`, [runIds]);
      for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    });
  });

  it('fixture rows exist (a verified lawyer and bail agent to re-scrape)', () => {
    expect(lawyer?.id).toBeTruthy();
    expect(bail?.id).toBeTruthy();
  });

  it('a new provider is INSERTED with provenance; an existing row gets a PROPOSAL instead of a write', async () => {
    const r = await run();
    expect(r.status).toBe('ok');
    expect(r.counts).toMatchObject({ inserted: 2, proposed: 2, errors: 0 });

    const n1 = await testRow('new1');
    expect(n1).toMatchObject({ name: `Jgtest Defense Group ${tag}`, city: CITY, state: ST, phone: '+18025557101',
      source: 'google', active: 1, verified: 0, bar_verified: 0 });
    expect(n1.created_at).toBeTruthy();
    expect(n1.updated_at).toBeTruthy();
    const n2 = await ctx.db.get('SELECT * FROM bail_agents WHERE source_id = ?', [`google_${pid('new2')}`]);
    expect(n2).toMatchObject({ name: `Jgtest Bail Bonds ${tag}`, state: ST, active: 1, verified: 0, source: 'google' });

    // the verified lawyer row is untouched …
    const lNow = await ctx.db.get('SELECT * FROM lawyers WHERE id = ?', [lawyer.id]);
    expect(lNow).toEqual(lawyer);
    // … and the new number waits for review
    const lp = await ctx.db.all(`SELECT * FROM provider_update_proposals WHERE table_name = 'lawyers' AND record_id = ? AND run_id = ?`, [lawyer.id, r.runId]);
    expect(lp).toHaveLength(1);
    expect(lp[0]).toMatchObject({ field: 'phone', old_value: lawyer.phone, new_value: '+18025557199', status: 'pending', source: 'google' });

    const bp = await ctx.db.all(`SELECT * FROM provider_update_proposals WHERE table_name = 'bail_agents' AND record_id = ? AND run_id = ?`, [bail.id, r.runId]);
    expect(bp.map(p => p.field)).toEqual(['hours']);
    expect((await ctx.db.get('SELECT * FROM bail_agents WHERE id = ?', [bail.id]))).toEqual(bail);

    const logged = await ctx.db.get('SELECT * FROM scrape_runs WHERE id = ?', [r.runId]);
    expect(logged).toMatchObject({ job: 'providers', trigger: 'test', status: 'ok', inserted: 2, proposed: 2, errors: 0 });
    expect(logged.finished_at).toBeTruthy();
  });

  it('re-running is idempotent: no duplicate rows, no duplicate proposals', async () => {
    const countRows = async () => (await ctx.db.get(
      `SELECT (SELECT COUNT(*) FROM lawyers WHERE source_id LIKE ?)::int + (SELECT COUNT(*) FROM bail_agents WHERE source_id LIKE ?)::int AS n`,
      [`%${tag}%`, `%${tag}%`])).n;
    const countProps = async () => (await ctx.db.get(
      `SELECT COUNT(*)::int AS n FROM provider_update_proposals WHERE (table_name = 'lawyers' AND record_id = ?) OR (table_name = 'bail_agents' AND record_id = ?)`,
      [lawyer.id, bail.id])).n;
    const rows0 = await countRows(); const props0 = await countProps();
    const r = await run();
    expect(r.counts).toMatchObject({ inserted: 0, proposed: 0, errors: 0 });
    expect(await countRows()).toBe(rows0);
    expect(await countProps()).toBe(props0);
    const p = await ctx.db.get(`SELECT seen_count FROM provider_update_proposals WHERE table_name = 'lawyers' AND record_id = ? AND field = 'phone' AND status = 'pending'`, [lawyer.id]);
    expect(p.seen_count).toBe(2);

    // a duplicate listing under ANOTHER place id but same name + city + state is matched, not inserted
    g.add({ place_id: pid('dup'), name: `Jgtest Defense Group ${tag}`, formatted_address: `1 Main St, ${CITY}, ${ST} 05401, USA` },
      [`criminal defense lawyer ${CITY} ${ST}`]);
    const r2 = await run();
    expect(r2.counts.inserted).toBe(0);
    expect(await countRows()).toBe(rows0);
    g.remove(pid('dup'));
  });

  it('rows absent from a scrape are never removed or deactivated', async () => {
    g.remove(pid('new2'));
    const r = await run();
    expect(r.counts.errors).toBe(0);
    const n2 = await ctx.db.get('SELECT active FROM bail_agents WHERE source_id = ?', [`google_${pid('new2')}`]);
    expect(n2).toEqual({ active: 1 });
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM lawyers WHERE id <= ?', [maxIds.lawyers])).n))
      .toBe(Number(before.lawyers.split(':')[0]));
  });

  it('dry run: fetches and matches, writes nothing but its run log', async () => {
    g.add({ place_id: pid('dry'), name: `Jgtest Dry Run Law ${tag}`, formatted_phone_number: '(802) 555-7103' }, [`criminal defense lawyer ${CITY} ${ST}`]);
    const r = await run({ dryRun: true });
    expect(r.counts.inserted).toBe(1);
    expect(await testRow('dry')).toBeUndefined();
    expect((await ctx.db.get('SELECT dry_run FROM scrape_runs WHERE id = ?', [r.runId])).dry_run).toBe(true);
    g.remove(pid('dry'));
  });

  describe('admin review endpoints', () => {
    let n1;
    const proposalFor = async (field) => ctx.db.get(
      `SELECT * FROM provider_update_proposals WHERE table_name = 'lawyers' AND record_id = ? AND field = ? AND status = 'pending'`, [n1.id, field]);

    beforeAll(async () => { if (ctx.app) n1 = await testRow('new1'); });

    it('GET /api/admin/proposals: admin + key only (plain user 403, no key 401)', async () => {
      const ok = await adminReq(admin, 'get', `/api/admin/proposals?table=lawyers&record_id=${lawyer.id}`);
      expect(ok.status).toBe(200);
      expect(ok.body.rows.some(p => p.field === 'phone' && p.new_value === '+18025557199' && p.provider_name === lawyer.name)).toBe(true);
      expect((await adminReq(plain, 'get', '/api/admin/proposals')).status).toBe(403);
      expect((await ctx.request().get('/api/admin/proposals').set(admin.headers)).status).toBe(401);
      expect((await adminReq(admin, 'get', '/api/admin/proposals?table=users')).status).toBe(400);
      const runs = await adminReq(admin, 'get', '/api/admin/refresh/runs?job=providers');
      expect(runs.status).toBe(200);
      expect(runs.body.runs.some(x => runIds.includes(Number(x.id)))).toBe(true);
    });

    it('apply writes exactly the proposed field and logs it; a non-admin cannot apply', async () => {
      g.update(pid('new1'), { formatted_phone_number: '(802) 555-7111' });
      await run();
      const p = await proposalFor('phone');
      expect(p).toBeTruthy();
      const rowBefore = await testRow('new1');
      expect(rowBefore.phone).toBe('+18025557101');           // not written by the scrape

      expect((await adminReq(plain, 'post', `/api/admin/proposals/${p.id}/apply`).send({})).status).toBe(403);
      const res = await adminReq(admin, 'post', `/api/admin/proposals/${p.id}/apply`).send({ note: 'called the office' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'applied', field: 'phone', old_value: '+18025557101', new_value: '+18025557111' });

      const rowAfter = await testRow('new1');
      const { phone: _p, updated_at: _u, ...restAfter } = rowAfter;
      const { phone: _p0, updated_at: _u0, ...restBefore } = rowBefore;
      expect(rowAfter.phone).toBe('+18025557111');
      expect(restAfter).toEqual(restBefore);                  // nothing else changed
      expect((await ctx.db.get('SELECT status, decided_by FROM provider_update_proposals WHERE id = ?', [p.id])))
        .toEqual({ status: 'applied', decided_by: admin.id });
      const log = await ctx.db.get(`SELECT * FROM provider_update_log WHERE table_name = 'lawyers' AND record_id = ? AND field = 'phone' ORDER BY id DESC LIMIT 1`, [n1.id]);
      expect(log).toMatchObject({ old_value: '+18025557101', new_value: '+18025557111', updated_by: admin.id });
      const audit = await ctx.db.get(`SELECT * FROM audit_log WHERE action = 'provider_proposal_applied' AND user_id = ? ORDER BY id DESC LIMIT 1`, [admin.id]);
      expect(JSON.parse(audit.details)).toMatchObject({ proposal_id: Number(p.id), field: 'phone' });

      // applying twice is refused
      expect((await adminReq(admin, 'post', `/api/admin/proposals/${p.id}/apply`).send({})).status).toBe(409);
    });

    it('reject marks the proposal rejected and the same value is never proposed again', async () => {
      g.update(pid('new1'), { website: 'https://moved.jgtest.example/' });
      await run();
      const p = await proposalFor('website');
      const res = await adminReq(admin, 'post', `/api/admin/proposals/${p.id}/reject`).send({ note: 'directory spam' });
      expect(res.status).toBe(200);
      expect((await testRow('new1')).website).toBe('https://jgtest-defense.example/');
      const again = await run();
      expect(again.counts.proposed).toBe(0);
      expect((await ctx.db.get(`SELECT COUNT(*)::int AS n FROM provider_update_proposals WHERE table_name = 'lawyers' AND record_id = ? AND field = 'website'`, [n1.id])).n).toBe(1);
    });

    it('bulk apply / reject, per-id results; a stale proposal is refused (409)', async () => {
      g.update(pid('new1'), { rating: 3.9, user_ratings_total: 40, opening_hours: { weekday_text: ['Monday: 8 AM – 6 PM'] } });
      await run();
      const rating = await proposalFor('rating'); const reviews = await proposalFor('reviews'); const hours = await proposalFor('hours');
      const bulk = await adminReq(admin, 'post', '/api/admin/proposals/apply').send({ ids: [rating.id, reviews.id, 999999999] });
      expect(bulk.status).toBe(200);
      expect(bulk.body.succeeded).toBe(2);
      expect(bulk.body.results.find(r => r.id === 999999999)).toMatchObject({ ok: false, status: 404 });
      const row = await testRow('new1');
      expect(row.rating).toBe(3.9);
      expect(Number(row.reviews)).toBe(40);

      // the row changes underneath a pending proposal → apply refuses unless forced
      await ctx.db.run('UPDATE lawyers SET hours = ? WHERE id = ?', ['edited by staff', n1.id]);
      expect((await adminReq(admin, 'post', `/api/admin/proposals/${hours.id}/apply`).send({})).status).toBe(409);
      const rj = await adminReq(admin, 'post', '/api/admin/proposals/reject').send({ ids: [hours.id] });
      expect(rj.body.results[0]).toMatchObject({ ok: true, status: 'rejected' });
      expect((await adminReq(admin, 'post', '/api/admin/proposals/apply').send({ ids: [] })).status).toBe(400);
    });

    it('a DEMOTED admin\'s still-valid token is refused (role read from the DB)', async () => {
      const p = await ctx.db.get(`SELECT id FROM provider_update_proposals WHERE table_name = 'lawyers' AND record_id = ? AND status = 'pending' LIMIT 1`, [lawyer.id]);
      await ctx.db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [admin.id]);
      invalidateUserCache(admin.id);
      expect((await adminReq(admin, 'get', '/api/admin/proposals')).status).toBe(403);
      expect((await adminReq(admin, 'post', `/api/admin/proposals/${p.id}/reject`).send({})).status).toBe(403);
      expect((await ctx.db.get('SELECT status FROM provider_update_proposals WHERE id = ?', [p.id])).status).toBe('pending');
      await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
      invalidateUserCache(admin.id);
    });

    it('POST /api/admin/refresh with no key configured is a logged skip (no fetch)', async () => {
      const k = process.env.GOOGLE_PLACES_KEY;
      delete process.env.GOOGLE_PLACES_KEY;
      try {
        const res = await adminReq(admin, 'post', '/api/admin/refresh').send({ type: 'lawyers' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: false, skipped: true });
        runIds.push(res.body.run_id);
        const logged = await ctx.db.get('SELECT status, message, trigger FROM scrape_runs WHERE id = ?', [res.body.run_id]);
        expect(logged.status).toBe('skipped');
        expect(logged.trigger).toBe('admin');
        expect(logged.message).toMatch(/GOOGLE_PLACES_KEY/);
        expect((await adminReq(admin, 'post', '/api/admin/refresh').send({ type: 'nope' })).status).toBe(400);
      } finally { process.env.GOOGLE_PLACES_KEY = k; }
    });
  });

  it('missing GOOGLE_PLACES_KEY: library run is a recorded skip and makes no request', async () => {
    const k = process.env.GOOGLE_PLACES_KEY;
    delete process.env.GOOGLE_PLACES_KEY;
    const calls = g.calls.length;
    try {
      const r = await run();
      expect(r.status).toBe('skipped');
      expect(r.message).toMatch(/GOOGLE_PLACES_KEY is not set/);
      expect(g.calls.length).toBe(calls);
      expect((await ctx.db.get('SELECT status FROM scrape_runs WHERE id = ?', [r.runId])).status).toBe('skipped');
    } finally { process.env.GOOGLE_PLACES_KEY = k; }
  });

  it('missing GOOGLE_PLACES_KEY: the CLI scripts exit 0 with a clear message and write nothing', () => {
    const env = { ...process.env, DATABASE_URL: PG_URL, NODE_ENV: 'test', LOG_LEVEL: 'error' };
    delete env.GOOGLE_PLACES_KEY; delete env.YELP_API_KEY;
    for (const [script, args] of [['refresh.js', []], ['scrape_recovery_agents.js', []], ['scrape_providers_national.js', ['--source', 'google']]]) {
      const p = spawnSync(process.execPath, [path.join(BACKEND, 'src/scripts', script), ...args], { env, cwd: BACKEND, encoding: 'utf8', timeout: 60_000 });
      expect({ script, status: p.status }).toEqual({ script, status: 0 });
      expect(p.stdout).toMatch(/GOOGLE_PLACES_KEY/);
    }
  });

  it('pre-existing lawyers / bail_agents rows are byte-identical after every mocked scrape', async () => {
    expect(await tableHash(ctx.db, 'lawyers', maxIds.lawyers)).toBe(before.lawyers);
    expect(await tableHash(ctx.db, 'bail_agents', maxIds.bail_agents)).toBe(before.bail_agents);
  });
});
