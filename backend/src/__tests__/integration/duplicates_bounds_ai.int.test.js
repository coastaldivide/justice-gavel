/**
 * duplicates_bounds_ai.int.test.js — checklist items 23, 24, 50 against the
 * real app on real Postgres.
 *
 *  24  Idempotency-Key on create endpoints: a retry replays the first
 *      response (one row), a concurrent duplicate gets 409, a reused key
 *      with a different body 422; without the header nothing changes.
 *      saved_lawyers has a unique (user, lawyer) index: racing double taps
 *      leave one bookmark and both answer 201.
 *  23  Lists stay bounded when a user has hundreds of rows.
 *  50  /chat/ask is metered into ai_usage_log, and once the daily budget is
 *      spent the route answers 503 ai_unavailable / daily_budget_reached
 *      without calling the provider.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('duplicates, list bounds and AI budget (real Postgres)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let u;
  beforeAll(async () => {
    if (!ctx.app) return;
    u = await ctx.register({ displayName: 'Dup Tester' });
    ctx.addCleanup(async (db, tag) => { await db.run('DELETE FROM idempotency_keys WHERE key LIKE ?', [`${tag}%`]); });
  });

  it('a retried POST /cases with the same Idempotency-Key creates one case and replays the response', async () => {
    const key = `${ctx.tag}-case-1`;
    const body = { title: `${ctx.tag} idem case`, next_court_date: '2031-02-03' };
    const a = await ctx.request().post('/api/cases').set(u.headers).set('Idempotency-Key', key).send(body);
    expect(a.status).toBe(201);
    const b = await ctx.request().post('/api/cases').set(u.headers).set('Idempotency-Key', key).send(body);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    const n = await ctx.db.get('SELECT COUNT(*) AS n FROM cases WHERE user_id = ? AND title = ?', [u.user.id, body.title]);
    expect(Number(n.n)).toBe(1);
    // same key, different request → 422
    const c = await ctx.request().post('/api/cases').set(u.headers).set('Idempotency-Key', key).send({ title: 'something else' });
    expect(c.status).toBe(422);
    // malformed key → 400
    expect((await ctx.request().post('/api/cases').set(u.headers).set('Idempotency-Key', 'x').send(body)).status).toBe(400);
  });

  it('concurrent duplicates of a message: one row, the other request is told to retry (409) or replayed', async () => {
    const cas = await ctx.request().post('/api/cases').set(u.headers).send({ title: `${ctx.tag} msg case` });
    const key = `${ctx.tag}-msg-1`;
    const send = () => ctx.request().post(`/api/messages/${cas.body.id}`).set(u.headers).set('Idempotency-Key', key).send({ body: 'only once' });
    const rs = await Promise.all([send(), send(), send()]);
    for (const r of rs) expect([200, 201, 409]).toContain(r.status);
    const n = await ctx.db.get('SELECT COUNT(*) AS n FROM case_messages WHERE case_id = ?', [cas.body.id]);
    expect(Number(n.n)).toBe(1);
  });

  it('a failed request releases its key so the retry runs (no stored error)', async () => {
    const key = `${ctx.tag}-bad-1`;
    const bad = await ctx.request().post('/api/cases').set(u.headers).set('Idempotency-Key', key).send({ title: '' });
    expect(bad.status).toBe(400);
    // The key is released when the response has finished (res 'finish'), i.e. a
    // moment after the client has its answer: wait for that, then prove a retry runs.
    const deadline = Date.now() + 5000;
    while (await ctx.db.get('SELECT key FROM idempotency_keys WHERE key = ?', [key]) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
    }
    expect(await ctx.db.get('SELECT key FROM idempotency_keys WHERE key = ?', [key])).toBeUndefined();
    const retry = await ctx.request().post('/api/cases').set(u.headers).set('Idempotency-Key', key).send({ title: `${ctx.tag} retried` });
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('racing double taps on "save lawyer" leave one bookmark (unique index) and both succeed', async () => {
    const lawyer = await ctx.db.get('SELECT id FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1');
    const save = () => ctx.request().post('/api/saved/lawyers').set(u.headers).send({ lawyer_id: lawyer.id });
    const rs = await Promise.all([save(), save(), save(), save()]);
    for (const r of rs) expect(r.status).toBe(201);
    const n = await ctx.db.get('SELECT COUNT(*) AS n FROM saved_lawyers WHERE user_id = ? AND provider_id = ?', [u.user.id, lawyer.id]);
    expect(Number(n.n)).toBe(1);
    const idx = await ctx.db.get("SELECT indexname FROM pg_indexes WHERE indexname = 'uq_saved_lawyers_user_provider'");
    expect(idx).toBeDefined();
  });

  it('lists stay bounded when a user has hundreds of rows', async () => {
    const heavy = await ctx.register({ displayName: 'Heavy User' });
    const uid = heavy.user.id;
    await ctx.db.run(`INSERT INTO saved_lawyers (user_id, name) SELECT ?, 'Bookmark ' || g FROM generate_series(1, 260) g`, [uid]);
    await ctx.db.run(`INSERT INTO family_contacts (user_id, name, phone) SELECT ?, 'Contact ' || g, '615555' || lpad(g::text, 4, '0') FROM generate_series(1, 150) g`, [uid]);
    await ctx.db.run(`INSERT INTO arrest_monitors (user_id, watch_name, name, active) SELECT ?, 'W ' || g, 'W ' || g, 1 FROM generate_series(1, 150) g`, [uid]);
    const check = async (path, pick, max) => {
      const r = await ctx.request().get(path).set(heavy.headers);
      expect(r.status).toBe(200);
      const list = pick(r.body);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(max);
    };
    await check('/api/saved/lawyers', b => b, 200);
    await check('/api/family/contacts', b => (Array.isArray(b) ? b : b.contacts), 100);
    await check('/api/alerts/family-contacts', b => (Array.isArray(b) ? b : b.contacts), 100);
    await check('/api/arrests/monitors', b => b.monitors, 100);
    ctx.addCleanup(async (db) => {
      for (const t of ['saved_lawyers', 'family_contacts', 'arrest_monitors']) await db.run(`DELETE FROM ${t} WHERE user_id = ?`, [uid]).catch(() => {});
    });
  });

  it('/chat/ask is metered, and is refused (503, no provider call) once the daily budget is spent', async () => {
    const { _resetAiBudgetForTests } = await import('../../services/aiBudget.js');
    _resetAiBudgetForTests();
    const asker = await ctx.register({ displayName: 'Asker' });
    await ctx.acceptDisclaimer(asker);
    const ask = (q) => ctx.request().post('/api/chat/ask').set(asker.headers).send({ message: q, sessionId: `${ctx.tag}-sess` });
    const first = await ask('What are my rights?');
    expect(first.status).toBe(200);
    const done = await ctx.pollJob(asker, first.body.jobId);
    expect(done.body.status).toBe('done');
    const row = await ctx.db.get(`SELECT route, input_tokens, output_tokens, cost_usd, status FROM ai_usage_log WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [asker.user.id]);
    expect(row).toMatchObject({ route: 'chat', status: 'completed' });
    expect(Number(row.input_tokens)).toBe(10);
    expect(Number(row.cost_usd)).toBeGreaterThan(0);

    process.env.AI_DAILY_BUDGET_USD = '0.000001';
    try {
      _resetAiBudgetForTests();
      const providerCalls = ctx.anthropic.requests.length;
      const refused = await ask('Another question');
      expect(refused.status).toBe(503);
      expect(refused.body).toMatchObject({ error: 'ai_unavailable', reason: 'daily_budget_reached' });
      expect(ctx.anthropic.requests.length).toBe(providerCalls);
    } finally {
      delete process.env.AI_DAILY_BUDGET_USD;
      _resetAiBudgetForTests();
    }
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM ai_usage_log WHERE user_id = ?', [asker.user.id]).catch(() => {}); });
  });
});
