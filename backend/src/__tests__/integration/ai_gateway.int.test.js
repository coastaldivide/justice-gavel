/**
 * ai_gateway.int.test.js — the AI gateway end to end on real Postgres with the documented-API
 * mock (scripts/anthropic-mock-lib.mjs via the harness):
 *
 *   - a chat answer is routed (class standard), prompt-cached (1h system breakpoint + automatic
 *     conversation caching) and metered into ai_usage_log with cache read / write tokens, task,
 *     class, stop reason and cost; the follow-up question reads the cache;
 *   - a refusal (job path and stream, before and mid-answer) saves nothing, is worded in the
 *     person's language ("can't be answered here"), and is metered as refused (unbilled category
 *     → $0);
 *   - server-side fallback: a declined chat is answered by the fallback model and recorded so;
 *   - structured output (motion review) is schema-checked; an invalid answer is never shown;
 *   - an oversized request is refused before it is sent (ai_too_large);
 *   - GET /api/admin/metrics/ai and /api/admin/diagnostics/ai report calls, cost, p50/p95,
 *     refusal and error rates by route / class / day; aiHealth raises its alarms.
 */
import { describeIntegration, initSuite } from './_harness.js';

process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'ai-gateway-admin-key-0123456789';

describeIntegration('AI gateway (real Postgres, documented-API mock)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let user, admin;
  const usage = (userId) => ctx.db.all(
    `SELECT route, task, task_class, model, requested_model, status, stop_reason, refusal, refusal_category, fallback_model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cost_usd, duration_ms, request_id
       FROM ai_usage_log WHERE user_id = ? ORDER BY id`, [userId]);
  const streamChat = (u, body) => ctx.request().post('/api/chat/stream').set(u.headers).send(body)
    .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });
  const frames = (raw) => String(raw).split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));

  beforeAll(async () => {
    if (!ctx.app) return;
    user = await ctx.register({ displayName: 'Gateway User' });
    await ctx.acceptDisclaimer(user);
    admin = await ctx.register({ displayName: 'Gateway Admin' });
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    // an attorney (defender mode: no daily cap); the auth middleware caches users
    await ctx.db.run(`UPDATE users SET role = 'attorney' WHERE id = ?`, [user.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(user.user.id);
    invalidateUserCache(admin.user.id);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM ai_usage_log WHERE user_id IN (?, ?)', [user.user.id, admin.user.id]); });
  });
  afterEach(() => { ctx.anthropic.mode = 'ok'; ctx.anthropic.json = null; delete process.env.AI_FALLBACK; delete process.env.AI_MAX_INPUT_TOKENS; });

  it('chat: routed, cached and metered with cache tokens; the follow-up reads the cache', async () => {
    const sessionId = `${ctx.tag}-c1`;
    const ask = async (message, id) => {
      const r = await ctx.request().post('/api/chat/ask').set(user.headers).send({ message, sessionId, clientMessageId: `${ctx.tag}${id}`, mode: 'defender' });
      expect(r.status).toBe(200);
      return ctx.pollJob(user, r.body.jobId);
    };
    expect((await ask('What is the Terry stop standard?', 'a1')).body.status).toBe('done');
    expect((await ask('And for a frisk?', 'a2')).body.status).toBe('done');
    const sent = ctx.anthropic.requests.filter((r) => r.path === '/v1/messages').slice(-2);
    expect(sent[0].body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(sent[0].body.cache_control).toEqual({ type: 'ephemeral' });
    expect(sent[0].body.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
    expect(sent[0].body.model).toBe('claude-sonnet-5-5');
    const rows = (await usage(user.user.id)).filter((r) => r.route === 'chat_defender');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ task: 'chat_defender', task_class: 'standard', model: 'claude-sonnet-5-5', status: 'completed', stop_reason: 'end_turn', refusal: false });
    expect(Number(rows[0].cache_write_1h_tokens)).toBeGreaterThan(500);
    expect(Number(rows[1].cache_read_tokens)).toBeGreaterThanOrEqual(Number(rows[0].cache_write_1h_tokens));
    expect(Number(rows[1].cost_usd)).toBeLessThan(Number(rows[0].cost_usd));
    expect(rows[0].request_id).toMatch(/^req_mock_/);
    expect(Number(rows[0].duration_ms)).toBeGreaterThanOrEqual(0);
  });

  it('a refused chat job saves nothing, is worded in Spanish, and is metered as refused at $0', async () => {
    process.env.AI_FALLBACK = 'off';
    ctx.anthropic.mode = 'refusal';
    const sessionId = `${ctx.tag}-r1`;
    const r = await ctx.request().post('/api/chat/ask').set(user.headers).set('Accept-Language', 'es')
      .send({ message: 'pregunta', sessionId, clientMessageId: `${ctx.tag}r1`, mode: 'defender' });
    const done = await ctx.pollJob(user, r.body.jobId);
    expect(done.body).toMatchObject({ status: 'failed', code: 'ai_refused' });
    expect(done.body.error).toMatch(/^This request can't be answered here\./);
    const es = await ctx.request().get(`/api/jobs/${r.body.jobId}`).set(user.headers).set('Accept-Language', 'es');
    expect(es.body.error).toMatch(/^No se puede responder esta solicitud aquí/);
    expect(await ctx.db.all('SELECT id FROM chat_sessions WHERE session_id = ?', [sessionId])).toHaveLength(0);
    const row = (await usage(user.user.id)).at(-1);
    expect(row).toMatchObject({ status: 'refused', stop_reason: 'refusal', refusal: true, refusal_category: 'general_harms' });
    expect(Number(row.cost_usd)).toBe(0);
  });

  it('server-side fallback: a declined chat is answered by the fallback model and recorded so', async () => {
    ctx.anthropic.mode = 'refusal';
    const r = await ctx.request().post('/api/chat/ask').set(user.headers)
      .send({ message: 'question', sessionId: `${ctx.tag}-f1`, clientMessageId: `${ctx.tag}f1`, mode: 'defender' });
    const done = await ctx.pollJob(user, r.body.jobId);
    expect(done.body.status).toBe('done');
    const sent = ctx.anthropic.requests.filter((x) => x.path === '/v1/messages').at(-1);
    expect(sent.body.fallbacks).toBe('default');
    expect(sent.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    const row = (await usage(user.user.id)).at(-1);
    expect(row).toMatchObject({ model: 'claude-opus-4-8', requested_model: 'claude-sonnet-5-5', fallback_model: 'claude-opus-4-8', refusal: true, status: 'completed' });
  });

  it('stream: a refusal mid-answer tells the app to discard the partial text and saves nothing', async () => {
    process.env.AI_FALLBACK = 'off';
    ctx.anthropic.mode = 'refusal_mid';
    ctx.anthropic.replyText = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
    const sessionId = `${ctx.tag}-s1`;
    const r = await streamChat(user, { message: 'q', sessionId, clientMessageId: `${ctx.tag}s1`, mode: 'defender' });
    const f = frames(r.body);
    expect(f.some((x) => x.type === 'segment')).toBe(true);     // checked sentences were shown…
    expect(f.some((x) => x.type === 'token')).toBe(false);      // …never unchecked text
    expect(f.at(-1)).toMatchObject({ type: 'error', code: 'ai_refused', discard: true });
    expect(f.at(-1).message).toMatch(/^This request can't be answered here\./);
    expect(f.some((x) => x.type === 'done')).toBe(false);
    expect(await ctx.db.all('SELECT id FROM chat_sessions WHERE session_id = ?', [sessionId])).toHaveLength(0);
    await new Promise((res) => setTimeout(res, 200));     // the stream meter writes after the response ends
    const row = (await usage(user.user.id)).filter((x) => x.route === 'chat_stream_defender').at(-1);
    expect(row).toMatchObject({ status: 'refused', refusal: true, task_class: 'standard' });
    expect(Number(row.cost_usd)).toBeGreaterThan(0);        // mid-stream refusals bill input + streamed output
    ctx.anthropic.replyText = 'MOCK REPLY: general legal information, not legal advice.';
  });

  it('motion review: schema-checked JSON; an invalid answer is never shown', async () => {
    ctx.anthropic.json = { score: 'FAIL', issues: ['Case number blank'], suggestions: ['Add the case number'], missing_fields: ['case number'] };
    const ok = await ctx.request().post('/api/motions/review').set(user.headers).send({ draft: 'IN THE CIRCUIT COURT … [CASE NUMBER]', motion_type: 'suppress', state: 'TN' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ score: 'fail', issues: ['Case number blank'], suggestions: ['Add the case number'], missing_fields: ['case number'] });
    const sent = ctx.anthropic.requests.filter((x) => x.path === '/v1/messages').at(-1);
    expect(sent.body.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
    expect(sent.body.model).toBe('claude-opus-5-5');
    ctx.anthropic.mode = 'invalid_json';
    const bad = await ctx.request().post('/api/motions/review').set(user.headers).send({ draft: 'draft text', motion_type: 'suppress', state: 'TN' });
    expect(bad.status).toBe(502);
    expect(bad.body.code).toBe('review_unreadable');
    expect((await usage(user.user.id)).at(-1)).toMatchObject({ status: 'invalid', task: 'motion_review' });
    ctx.anthropic.mode = 'refusal_hard';
    const refused = await ctx.request().post('/api/motions/review').set(user.headers).send({ draft: 'draft text', motion_type: 'suppress', state: 'TN' });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('ai_refused');
  });

  it('an oversized request is refused before it is sent', async () => {
    process.env.AI_MAX_INPUT_TOKENS = '1000';
    const before = ctx.anthropic.requests.length;
    const r = await ctx.request().post('/api/motions/review').set(user.headers).send({ draft: 'x'.repeat(5000), motion_type: 'suppress', state: 'TN' });
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ code: 'ai_too_large' });
    expect(r.body.message).toMatch(/too large/);
    expect(ctx.anthropic.requests.length).toBe(before);
  });

  it('admin metrics by route / class / day, diagnostics, and the aiHealth alarms', async () => {
    const H = { ...admin.headers, 'X-Admin-Key': process.env.ADMIN_KEY };
    expect((await ctx.request().get('/api/admin/metrics/ai').set(user.headers).set('X-Admin-Key', process.env.ADMIN_KEY)).status).toBe(403);
    expect((await ctx.request().get('/api/admin/metrics/ai?days=500').set(H)).status).toBe(400);
    const m = await ctx.request().get('/api/admin/metrics/ai?days=1').set(H);
    expect(m.status).toBe(200);
    const row = m.body.rows.find((r) => r.route === 'chat_defender' && r.task_class === 'standard');
    expect(row).toMatchObject({ day: new Date().toISOString().slice(0, 10) });
    expect(row.calls).toBeGreaterThanOrEqual(3);
    for (const k of ['cost_usd', 'p50_ms', 'p95_ms', 'refusal_rate', 'error_rate', 'cache_read_tokens', 'cache_read_share']) expect(row).toHaveProperty(k);
    expect(row.refusal_rate).toBeGreaterThan(0);
    expect(m.body.by_class.map((c) => c.task_class)).toEqual(expect.arrayContaining(['standard', 'deep']));
    const d = await ctx.request().get('/api/admin/diagnostics/ai').set(H);
    expect(d.status).toBe(200);
    expect(d.body).toHaveProperty('refusal_rate');
    expect(d.body).toHaveProperty('budget.spent_usd');

    const { aiHealth } = await import('../../monitoring/aiHealth.js');
    process.env.AI_ALERT_MIN_CALLS = '1';
    process.env.AI_ALERT_REFUSAL_PCT = '0.01';
    process.env.AI_ALERT_ERROR_PCT = '0.01';
    try {
      const h = await aiHealth(ctx.db);
      expect(h.total).toBeGreaterThan(0);
      expect(h.alarms).toEqual(expect.arrayContaining(['ai_refusal_rate', 'ai_error_rate']));
      process.env.AI_ALERT_MIN_CALLS = '1000000';
      expect((await aiHealth(ctx.db)).alarm).toBe(false);
    } finally {
      delete process.env.AI_ALERT_MIN_CALLS; delete process.env.AI_ALERT_REFUSAL_PCT; delete process.env.AI_ALERT_ERROR_PCT;
    }
  });
});
