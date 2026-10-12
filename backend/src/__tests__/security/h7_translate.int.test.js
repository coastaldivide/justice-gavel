/**
 * audit11 H7 / L3 / L6 — translation sessions: knowing the 6-character code is
 * not enough to post (AI cost) or read (privileged conversation). Only the host
 * account and the ONE bound participant (by account, or by the unguessable
 * per-session token returned at join) may; input length and per-session volume
 * are capped.
 */
import { describeIntegration, initSecuritySuite } from './_world.js';

describeIntegration('H7 — translation session access control and AI-cost limits', () => {
  const ctx = initSecuritySuite({ anthropicMock: true });
  let host, client, intruder, code, hostToken;

  beforeAll(async () => {
    if (!ctx.app) return;
    host     = await ctx.persona('Interpreter', { attorney: true });
    client   = await ctx.persona('LEPClient');
    intruder = await ctx.persona('Intruder');
    ctx.anthropic.replyText = 'Hola';
    const s = await ctx.request().post('/api/translate/session').set(host.headers).send({ lang_a: 'en', lang_b: 'es' });
    expect(s.status).toBe(200);
    code = s.body.code;
    hostToken = s.body.session_token;
    expect(hostToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM translation_messages WHERE session_code = ?', [code]);
      await db.run('DELETE FROM translation_sessions WHERE code = ?', [code]);
    });
  });

  it('ATTACK: unauthenticated post/read with just the code → refused, no AI call', async () => {
    const before = ctx.anthropic.requests.length;
    const p = await ctx.request().post(`/api/translate/session/${code}/message`).send({ text: 'x'.repeat(200_000), side: 'a' });
    expect([403, 413]).toContain(p.status);
    const p2 = await ctx.request().post(`/api/translate/session/${code}/message`).send({ text: 'hello', side: 'a' });
    expect(p2.status).toBe(403);
    const g = await ctx.request().get(`/api/translate/session/${code}/messages`);
    expect(g.status).toBe(403);
    expect(ctx.anthropic.requests.length).toBe(before);
  });

  it('LEGIT: host posts (solo mode, both sides); the client joins and gets the participant seat', async () => {
    const a = await ctx.request().post(`/api/translate/session/${code}/message`).set(host.headers).send({ text: 'Hello', side: 'a' });
    expect(a.status).toBe(200);
    expect(a.body.translated).toBe('Hola');
    const j = await ctx.request().get(`/api/translate/session/${code}`).set(client.headers);
    expect(j.status).toBe(200);
    expect(j.body.role).toBe('participant');
    const b = await ctx.request().post(`/api/translate/session/${code}/message`).set(client.headers).send({ text: 'Gracias', side: 'b' });
    expect(b.status).toBe(200);
    const msgs = await ctx.request().get(`/api/translate/session/${code}/messages?since=0`).set(client.headers);
    expect(msgs.status).toBe(200);
    expect(msgs.body.map(m => m.original)).toEqual(expect.arrayContaining(['Hello', 'Gracias']));
  });

  it('ATTACK: once the seat is bound, another account (or a guest) cannot join, post or read', async () => {
    const j = await ctx.request().get(`/api/translate/session/${code}`).set(intruder.headers);
    expect(j.status).toBe(409);
    const g = await ctx.request().get(`/api/translate/session/${code}`);
    expect(g.status).toBe(409);
    expect((await ctx.request().post(`/api/translate/session/${code}/message`).set(intruder.headers).send({ text: 'Wire bail money', side: 'b' })).status).toBe(403);
    expect((await ctx.request().get(`/api/translate/session/${code}/messages`).set(intruder.headers)).status).toBe(403);
    // the participant can only speak for side b
    expect((await ctx.request().post(`/api/translate/session/${code}/message`).set(client.headers).send({ text: 'x', side: 'a' })).status).toBe(403);
  });

  it('LEGIT: a guest participant is authorised by the per-session token (X-Translate-Token)', async () => {
    const s = await ctx.request().post('/api/translate/session').set(host.headers).send({ lang_a: 'en', lang_b: 'vi' });
    const c2 = s.body.code;
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM translation_messages WHERE session_code = ?', [c2]);
      await db.run('DELETE FROM translation_sessions WHERE code = ?', [c2]);
    });
    const j = await ctx.request().get(`/api/translate/session/${c2}`);
    expect(j.status).toBe(200);
    const tok = j.body.session_token;
    expect(tok).toBeTruthy();
    expect((await ctx.request().post(`/api/translate/session/${c2}/message`).send({ text: 'Xin chao', side: 'b' })).status).toBe(403);
    const ok = await ctx.request().post(`/api/translate/session/${c2}/message`).set('X-Translate-Token', tok).send({ text: 'Xin chao', side: 'b' });
    expect(ok.status).toBe(200);
    expect((await ctx.request().get(`/api/translate/session/${c2}/messages`).set('X-Translate-Token', tok)).status).toBe(200);
    expect((await ctx.request().get(`/api/translate/session/${c2}/messages`).set('X-Translate-Token', 'guess')).status).toBe(403);
    // the host token also works without an account header
    expect((await ctx.request().get(`/api/translate/session/${c2}/messages`).set('X-Translate-Token', s.body.session_token)).status).toBe(200);
  });

  it('L3: message length is capped for session and standalone translation', async () => {
    const big = 'a'.repeat(5000);
    const p = await ctx.request().post(`/api/translate/session/${code}/message`).set(host.headers).send({ text: big, side: 'a' });
    expect(p.status).toBe(413);
    const m = await ctx.request().post('/api/translate/message').set(host.headers).send({ text: big, src_lang: 'en', tgt_lang: 'es' });
    expect([402, 413, 451]).toContain(m.status);   // 451/402 gates run first for some callers; never 200
  });

  it('per-session message budget: the 301st message is refused before any AI call', async () => {
    await ctx.db.run('UPDATE translation_sessions SET message_count = 300 WHERE code = ?', [code]);
    const before = ctx.anthropic.requests.length;
    const r = await ctx.request().post(`/api/translate/session/${code}/message`).set(host.headers).send({ text: 'one more', side: 'a' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('session_message_limit');
    expect(ctx.anthropic.requests.length).toBe(before);
  });

  it('expired sessions (4 h idle) are gone', async () => {
    await ctx.db.run(`UPDATE translation_sessions SET last_active = NOW() - INTERVAL '5 hours', created_at = NOW() - INTERVAL '5 hours' WHERE code = ?`, [code]);
    expect((await ctx.request().get(`/api/translate/session/${code}/messages`).set(host.headers)).status).toBe(404);
  });
});
