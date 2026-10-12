/**
 * chat_jobs.int.test.js — POST /api/chat/ask + GET /api/jobs/:id polling and
 * GET/DELETE /api/chat/history/:sessionId, with Anthropic mocked locally via
 * ANTHROPIC_BASE_URL (no real API traffic). This is exactly the flow the app's
 * ChatScreen uses: ask → jobId → poll → reply, then history on reopen.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('chat ask + jobs polling + history (real Postgres, mock Anthropic)', () => {
  const ctx = initSuite({ anthropicMock: true });

  let user;
  beforeAll(async () => {
    if (!ctx.app) return;
    user = await ctx.register({ displayName: 'Chat User' });
  });

  it('blocks AI chat until the legal disclaimer is accepted (451 disclaimer_required)', async () => {
    const res = await ctx.request().post('/api/chat/ask').set(user.headers)
      .send({ message: 'Can police search my car?', sessionId: `${ctx.tag}-s0` });
    expect(res.status).toBe(451);
    expect(res.body.code).toBe('disclaimer_required');
    expect(typeof res.body.text).toBe('string');  // app shows this text
    expect(ctx.anthropic.requests).toHaveLength(0); // nothing reached the model
  });

  it('ask → jobId → poll /jobs/:id → mock reply; both turns persisted to chat_sessions', async () => {
    await ctx.acceptDisclaimer(user);
    ctx.anthropic.replyText = `MOCK-${ctx.tag}: You can refuse consent to a search. Not legal advice.`;
    const sessionId = `${ctx.tag}-s1`;

    const ask = await ctx.request().post('/api/chat/ask').set(user.headers)
      .send({ message: 'What are my rights at a traffic stop?', sessionId });
    expect(ask.status).toBe(200);
    expect(ask.body).toMatchObject({ status: 'pending', async: true, not_legal_advice: true });
    expect(typeof ask.body.jobId).toBe('string');

    const done = await ctx.pollJob(user, ask.body.jobId);
    expect(done.body.status).toBe('done');
    expect(done.body.result.reply).toBe(ctx.anthropic.replyText);
    expect(['post_arrest', 'charges', 'know_rights', 'find_lawyer', 'general']).toContain(done.body.result.intent);

    // The mock received a real Anthropic-shaped request
    const sent = ctx.anthropic.requests.find(r => r.path === '/v1/messages');
    expect(sent).toBeTruthy();
    expect(sent.body.messages[sent.body.messages.length - 1].content).toContain('traffic stop');
    expect(sent.headers['x-api-key']).toBeTruthy();

    // DB: user + assistant rows stored for this session (ids are UUIDs, so
    // order by created_at like the history endpoint does)
    const rows = await ctx.db.all(
      'SELECT role, content FROM chat_sessions WHERE session_id = ? AND user_id = ? ORDER BY created_at', [sessionId, user.user.id]);
    expect(rows.map(r => r.role).sort()).toEqual(['assistant', 'user']);
    expect(rows.find(r => r.role === 'assistant').content).toBe(ctx.anthropic.replyText);

    // History endpoint returns the same conversation to the app
    const hist = await ctx.request().get(`/api/chat/history/${sessionId}`).set(user.headers);
    expect(hist.status).toBe(200);
    expect(hist.body).toHaveLength(2);
    expect(hist.body[0]).toMatchObject({ role: 'user' });
  });

  it('another user cannot read my job or my history (IDOR)', async () => {
    const other = await ctx.register();
    await ctx.acceptDisclaimer(other);
    const sessionId = `${ctx.tag}-s2`;
    const ask = await ctx.request().post('/api/chat/ask').set(user.headers)
      .send({ message: 'Should I talk to the police?', sessionId });
    expect(ask.status).toBe(200);
    const stolen = await ctx.request().get(`/api/jobs/${ask.body.jobId}`).set(other.headers);
    expect(stolen.status).toBe(404);
    await ctx.pollJob(user, ask.body.jobId); // let it settle before next test

    const hist = await ctx.request().get(`/api/chat/history/${sessionId}`).set(other.headers);
    expect(hist.status).toBe(200);
    expect(hist.body).toHaveLength(0);     // scoped to the requesting user
  });

  it('a failed model call surfaces as a failed job, not a crash', async () => {
    ctx.anthropic.status = 500;
    const ask = await ctx.request().post('/api/chat/ask').set(user.headers)
      .send({ message: 'Will this fail?', sessionId: `${ctx.tag}-s3` });
    expect(ask.status).toBe(200);
    const failed = await ctx.pollJob(user, ask.body.jobId);
    expect(failed.body.status).toBe('failed');
    expect(String(failed.body.error)).toMatch(/Anthropic API error: 500/);
    ctx.anthropic.status = 200;
  });

  it('invalid bodies are 400s: missing message, missing sessionId, oversize message', async () => {
    expect((await ctx.request().post('/api/chat/ask').set(user.headers).send({ sessionId: 'x' })).status).toBe(400);
    expect((await ctx.request().post('/api/chat/ask').set(user.headers).send({ message: 'hi' })).status).toBe(400);
    expect((await ctx.request().post('/api/chat/ask').set(user.headers)
      .send({ message: 'a'.repeat(4001), sessionId: 'x' })).status).toBe(400);
    expect((await ctx.request().post('/api/chat/ask').send({ message: 'hi', sessionId: 'x' })).status).toBe(401);
  });

  it('DELETE /chat/history/:sessionId clears only my session', async () => {
    const sessionId = `${ctx.tag}-s1`;
    const other = await ctx.register();
    const foreign = await ctx.request().delete(`/api/chat/history/${sessionId}`).set(other.headers);
    expect(foreign.status).toBe(200);     // no-op for a session you don't own…
    let rows = await ctx.db.get('SELECT COUNT(*) AS n FROM chat_sessions WHERE session_id = ?', [sessionId]);
    expect(Number(rows.n)).toBe(2);       // …and my rows are untouched

    const del = await ctx.request().delete(`/api/chat/history/${sessionId}`).set(user.headers);
    expect(del.status).toBe(200);
    rows = await ctx.db.get('SELECT COUNT(*) AS n FROM chat_sessions WHERE session_id = ?', [sessionId]);
    expect(Number(rows.n)).toBe(0);
  });

  it('GET /jobs/:id rejects malformed ids and unknown ids cleanly', async () => {
    expect((await ctx.request().get('/api/jobs/%24weird%20id').set(user.headers)).status).toBe(400);
    expect((await ctx.request().get('/api/jobs/doesnotexist123').set(user.headers)).status).toBe(404);
  });
});
