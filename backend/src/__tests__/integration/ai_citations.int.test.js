/**
 * ai_citations.int.test.js — verified citations in chat and research on real Postgres, with the
 * documented-API mock (search_result blocks in, search_result_location citations out):
 *
 *   chat stream     checked segments only; done.sourced = what is saved; history renders it again
 *   follow-up       the earlier turn is resent byte-for-byte → cache read metered (ai_usage_log)
 *   foreign ids     citations to results never sent are dropped; the legal text is withheld
 *   nothing found   a legal question with no source: no model call, the person is told so
 *   refusal         unchanged: ai_refused, nothing saved
 *   research        /ask and /rag answers carry verified sources; the saved session renders them
 *   account         deletion removes research messages + citations; the export includes them
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('verified citations — chat + research (real Postgres, documented-API mock)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let user, atty;
  const sentMessages = () => ctx.anthropic.requests.filter((r) => r.path === '/v1/messages');
  // mode 'defender' (attorney accounts): no daily question cap across the many questions here
  const streamChat = (u, body, lang = 'en') => ctx.request().post('/api/chat/stream').set(u.headers).set('Accept-Language', lang).send({ mode: 'defender', ...body })
    .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });
  const frames = (raw) => String(raw).split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  const ask = (u, body, lang = 'en') => ctx.request().post('/api/chat/ask').set(u.headers).set('Accept-Language', lang).send({ mode: 'defender', ...body });

  beforeAll(async () => {
    if (!ctx.app) return;
    user = await ctx.register({ displayName: 'Cite User' });
    await ctx.acceptDisclaimer(user);
    atty = await ctx.register({ displayName: 'Cite Atty' });
    await ctx.acceptDisclaimer(atty);
    // professionals: no daily chat cap; research access
    await ctx.db.run(`UPDATE users SET role = 'attorney' WHERE id IN (?, ?)`, [user.user.id, atty.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(user.user.id); invalidateUserCache(atty.user.id);
    ctx.addCleanup(async (db) => {
      const ids = [user.user.id, atty.user.id];
      await db.run('DELETE FROM research_messages WHERE session_id::text IN (SELECT id::text FROM research_sessions WHERE user_id IN (?, ?))', ids).catch(() => {});
      await db.run('DELETE FROM research_sessions WHERE user_id IN (?, ?)', ids).catch(() => {});
      await db.run('DELETE FROM ai_usage_log WHERE user_id IN (?, ?)', ids).catch(() => {});
    });
  });
  afterEach(() => { ctx.anthropic.citeMode = 'auto'; ctx.anthropic.blocks = null; ctx.anthropic.mode = 'ok'; delete process.env.AI_FALLBACK; });

  it('stream: only checked segments are sent; the saved answer and history render the same citations', async () => {
    const sessionId = `${ctx.tag}-c1`;
    const r = await streamChat(user, { message: 'Can police search my car without a warrant?', sessionId, clientMessageId: `${ctx.tag}m1`, user_state: 'TN', user_state_name: 'Tennessee' });
    const f = frames(r.body);
    expect(f.some((x) => x.type === 'token')).toBe(false);
    const segs = f.filter((x) => x.type === 'segment');
    expect(segs.length).toBeGreaterThan(0);
    const done = f.find((x) => x.type === 'done');
    expect(done.sourced.grounded).toBe(true);
    expect(done.sourced.sources.length).toBeGreaterThan(0);
    expect(segs.map((s) => s.segment)).toEqual(done.sourced.segments);
    const src = done.sourced.sources[0];
    expect(src).toMatchObject({ n: 1, kind: expect.any(String), title: expect.any(String), checked: expect.any(String) });
    expect(src.passage.length).toBeGreaterThan(10);
    expect(done.full_text).toContain('[1]');

    const hist = await ctx.request().get(`/api/chat/history/${sessionId}`).set(user.headers);
    expect(hist.body).toHaveLength(2);
    expect(hist.body[1].sourced).toEqual(done.sourced);              // history renders exactly as first shown
    expect(hist.body[1].content).not.toContain('[1]');               // stored words: no markers
  });

  it('follow-up: the earlier turn (with its sources) is resent byte-for-byte and read from the cache', async () => {
    const sessionId = `${ctx.tag}-c1`;
    const before = sentMessages().length;
    const r = await streamChat(user, { message: 'And can they search my phone?', sessionId, clientMessageId: `${ctx.tag}m2`, user_state: 'TN', user_state_name: 'Tennessee' });
    expect(frames(r.body).find((x) => x.type === 'done')).toBeTruthy();
    const [prev, now] = sentMessages().slice(before - 1);
    expect(JSON.stringify(now.body.messages[0])).toBe(JSON.stringify(prev.body.messages.at(-1)));
    expect(now.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    await new Promise((res) => setTimeout(res, 200));
    const row = await ctx.db.get(`SELECT cache_read_tokens FROM ai_usage_log WHERE user_id = ? AND route LIKE 'chat_stream%' ORDER BY id DESC LIMIT 1`, [user.user.id]);
    expect(Number(row.cache_read_tokens)).toBeGreaterThan(0);
  });

  it('citations to sources we never sent are dropped and their legal text is withheld (job path)', async () => {
    ctx.anthropic.citeMode = 'foreign';
    const sessionId = `${ctx.tag}-c2`;
    const a = await ask(user, { message: 'Do I have to let police search my car?', sessionId });
    const done = await ctx.pollJob(user, a.body.jobId);
    expect(done.body.status).toBe('done');
    const s = done.body.result.sourced;
    expect(s.sources).toEqual([]);
    expect(s.dropped).toBeGreaterThan(0);
    expect(s.segments.some((g) => g.withheld)).toBe(true);
    expect(done.body.result.reply).toContain('No source found for this part');
    const row = await ctx.db.get(`SELECT content, ai_answer FROM chat_sessions WHERE session_id = ? AND role = 'assistant'`, [sessionId]);
    expect(row.ai_answer.sources).toEqual([]);
    expect(row.content).not.toMatch(/search|warrant/i);
  });

  it('nothing relevant for a legal question: no model call, the person is pointed to legal aid / the rights card', async () => {
    const before = sentMessages().length;
    const sessionId = `${ctx.tag}-c3`;
    const r = await streamChat(user, { message: 'Is quuxification lawful?', sessionId, clientMessageId: `${ctx.tag}m3` }, 'es');
    const done = frames(r.body).find((x) => x.type === 'done');
    expect(done.sourced.nothing_found).toBe(true);
    expect(done.full_text).toMatch(/no lo vamos a responder de memoria/);
    expect(sentMessages().length).toBe(before);
    const hist = await ctx.request().get(`/api/chat/history/${sessionId}`).set(user.headers);
    expect(hist.body[1].sourced.nothing_found).toBe(true);
  });

  it('refusal path unchanged: ai_refused, nothing saved', async () => {
    process.env.AI_FALLBACK = 'off';
    ctx.anthropic.mode = 'refusal';
    const sessionId = `${ctx.tag}-c4`;
    const a = await ask(user, { message: 'Can police search my car?', sessionId });
    const done = await ctx.pollJob(user, a.body.jobId);
    expect(done.body.status).toBe('failed');
    expect(done.body.code).toBe('ai_refused');
    expect(await ctx.db.all('SELECT id FROM chat_sessions WHERE session_id = ?', [sessionId])).toHaveLength(0);
  });

  it('research /ask: verified sources; the saved session renders them; /rag too', async () => {
    const yes = await ctx.request().post('/api/research/ask').set(atty.headers).send({ query: 'Can a DUI conviction be expunged in Tennessee?' });
    expect(yes.status).toBe(200);
    const done = await ctx.pollJob(atty, yes.body.jobId);
    expect(done.body.status).toBe('done');
    const s = done.body.result.sourced;
    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.sources.some((x) => x.kind === 'expungement' && x.jurisdiction === 'TN' && /^https?:\/\//.test(x.url))).toBe(true);
    const sent = sentMessages().at(-1);
    expect(sent.body.output_config.format).toBeUndefined();
    expect(sent.body.system[0].text).toContain('SOURCES');
    const sess = await ctx.request().get(`/api/research/session/${yes.body.session_id}`).set(atty.headers);
    const answerRow = sess.body.messages.find((m) => m.role === 'assistant');
    expect(answerRow.sourced).toEqual(s);
    expect(answerRow.content).toBe(done.body.result.answer);

    const rag = await ctx.request().post('/api/research/rag').set(atty.headers).send({ query: 'recording police officers in Texas', jurisdiction: 'TX' });
    expect(rag.status).toBe(200);
    expect(rag.body.sourced.sources.some((x) => x.kind === 'recording_law' && x.jurisdiction === 'TX')).toBe(true);
    expect(rag.body.citations).toEqual(rag.body.sourced.sources);

    const none = await ctx.request().post('/api/research/rag').set(atty.headers).send({ query: 'quuxification frobnication zorbing' });
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ nothing_found: true, citations: [] });
  });

  it('export includes research messages with citations; account deletion removes them', async () => {
    const victim = await ctx.register({ displayName: 'Cite Delete' });
    await ctx.acceptDisclaimer(victim);
    await ctx.db.run(`UPDATE users SET role = 'attorney' WHERE id = ?`, [victim.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(victim.user.id);
    const q = await ctx.request().post('/api/research/ask').set(victim.headers).send({ query: 'What should I wear to court?' });
    await ctx.pollJob(victim, q.body.jobId);
    const exp = await ctx.request().get('/api/auth/export').set(victim.headers);
    expect(exp.status).toBe(200);
    const msgs = exp.body.data.tables.research_messages;
    expect(msgs.find((m) => m.role === 'assistant').ai_answer.sources.length).toBeGreaterThan(0);
    const sid = q.body.session_id;
    const del = await ctx.request().delete('/api/auth/account').set(victim.headers).send({ password: victim.password, confirm: 'DELETE' });
    expect([200, 204]).toContain(del.status);
    const left = await ctx.db.get('SELECT COUNT(*) AS n FROM research_messages WHERE session_id = ?', [String(sid)]);
    expect(Number(left.n)).toBe(0);
  });
});
